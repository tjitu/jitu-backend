import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma.service';

const accountProviderId = (providerId: string) => {
  if (providerId === 'password') return 'firebase-password';
  if (providerId === 'google.com') return 'firebase-google';
  return `firebase-${providerId.replace(/[^a-z0-9-]/gi, '-')}`;
};

@Injectable()
export class AuthIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveUser(token: DecodedIdToken) {
    const email = token.email?.trim().toLowerCase();
    if (!email) throw new UnauthorizedException('Akun Firebase harus memiliki email.');
    if (token.firebase?.sign_in_provider === 'password' && token.email_verified !== true) {
      throw new UnauthorizedException('Verifikasi email Firebase sebelum menggunakan akun Jitu.');
    }

    const mappedAccount = await this.prisma.account.findFirst({
      where: { providerId: { startsWith: 'firebase-' }, accountId: token.uid },
      include: { user: true },
    });
    if (mappedAccount) {
      return this.syncFirebaseAccounts(mappedAccount.user, token);
    }

    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existingUser && token.email_verified !== true) {
      throw new UnauthorizedException(
        'Verifikasi email Firebase sebelum menghubungkan akun Jitu yang sudah ada.',
      );
    }

    let user = existingUser;
    if (!user) {
      try {
        user = await this.prisma.user.create({
          data: {
            id: randomUUID(),
            name: token.name?.trim() || email.split('@')[0],
            email,
            emailVerified: token.email_verified === true,
            image: token.picture ?? null,
          },
        });
      } catch (error) {
        if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2002') {
          throw error;
        }
        user = await this.prisma.user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
        });
        if (!user) throw error;
      }
    }

    return this.syncFirebaseAccounts(user, token);
  }

  private async syncFirebaseAccounts(
    user: { id: string; emailVerified: boolean },
    token: DecodedIdToken,
  ) {
    const identities = token.firebase?.identities ?? {};
    const providers = new Set(
      Object.keys(identities).map((providerId) => providerId === 'email' ? 'password' : providerId),
    );
    if (token.firebase?.sign_in_provider) providers.add(token.firebase.sign_in_provider);

    const accounts = [...providers].map((provider) => {
      const providerId = accountProviderId(provider);
      const id = `firebase:${token.uid}:${providerId}`;
      return { id, accountId: token.uid, providerId, userId: user.id };
    });
    if (accounts.length) {
      await this.prisma.account.createMany({ data: accounts, skipDuplicates: true });
    }

    if (token.email_verified === true && !user.emailVerified) {
      return this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });
    }
    return user;
  }
}
