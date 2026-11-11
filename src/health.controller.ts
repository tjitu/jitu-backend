import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  getHealth() {
    return { status: 'ok' };
  }

  @Get('ready')
  async getReadiness() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', checks: { database: 'ok' } };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        checks: { database: 'unavailable' },
      });
    }
  }
}
