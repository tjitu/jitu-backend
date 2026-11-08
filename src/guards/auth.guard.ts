import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getFirebaseAdminAuth } from '../lib/firebase-admin';
import { AuthIdentityService } from '../modules/auth/auth-identity.service';

type AuthenticatedRequest = Request & {
  user?: Record<string, unknown>;
  session?: { id: string; userId: string; expiresAt: Date };
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly identities: AuthIdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('Firebase ID token is required.');

    let decoded: DecodedIdToken;
    try {
      decoded = await getFirebaseAdminAuth().verifyIdToken(match[1]);
    } catch {
      throw new UnauthorizedException('Firebase ID token is invalid or expired.');
    }

    const user = await this.identities.resolveUser(decoded);
    request.user = user as unknown as Record<string, unknown>;
    request.session = {
      id: decoded.uid,
      userId: user.id,
      expiresAt: new Date(decoded.exp * 1000),
    };
    return true;
  }
}

@Injectable()
export class OptionalAuthGuard extends AuthGuard {
  constructor(identities: AuthIdentityService) {
    super(identities);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) return true;
    try {
      return await super.canActivate(context);
    } catch {
      return true;
    }
  }
}

@Injectable()
export class AdminAuthGuard extends AuthGuard {
  constructor(identities: AuthIdentityService) {
    super(identities);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.user?.role !== 'ADMIN') {
      throw new ForbiddenException('Admin access is required.');
    }
    return true;
  }
}
