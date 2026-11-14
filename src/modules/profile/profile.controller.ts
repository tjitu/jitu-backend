import {
  Controller,
  Get,
  Patch,
  Body,
  NotFoundException,
  UseGuards,
  Session,
} from '@nestjs/common';
import { ProfileService } from './profile.service';
import { AuthGuard } from '../../guards/auth.guard';
import type { UserSession } from '../../decorators/session.decorator';
@Controller('profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  async getProfile(@Session() session: UserSession) {
    const userId = session.user.id;

    if (!userId) {
      throw new NotFoundException('User ID tidak ditemukan');
    }

    const profile = await this.profileService.getProfile(userId);

    if (!profile) {
      throw new NotFoundException('User tidak ditemukan');
    }

    return profile;
  }

  @Patch()
  async updateProfile(
    @Session() session: UserSession,
    @Body()
    body: {
      name?: string;
      target?: string;
      phoneNumber?: string;
      school?: string;
    },
  ) {
    const userId = session.user.id;

    if (!userId) {
      throw new NotFoundException('User ID tidak ditemukan');
    }

    return this.profileService.updateProfile(userId, body);
  }
}
