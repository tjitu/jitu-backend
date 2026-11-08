import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../../guards/auth.guard';

@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(AuthGuard)
  getCurrentUser(@Req() request: Request & { user?: unknown }) {
    return { user: request.user };
  }
}
