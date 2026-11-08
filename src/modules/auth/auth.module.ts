import { Global, Module } from '@nestjs/common';
import { AdminAuthGuard, AuthGuard } from '../../guards/auth.guard';
import { AuthController } from './auth.controller';
import { AuthIdentityService } from './auth-identity.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthIdentityService, AuthGuard, AdminAuthGuard],
  exports: [AuthIdentityService, AuthGuard, AdminAuthGuard],
})
export class AuthModule {}
