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
    } catch (error) {
      const details = error instanceof Error ? error : new Error(String(error));
      const cause =
        error && typeof error === 'object' && 'cause' in error
          ? (error as { cause?: { code?: unknown } }).cause
          : undefined;
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : cause?.code;

      console.error('[HealthController] Database readiness check failed', {
        name: details.name,
        code: typeof code === 'string' ? code : undefined,
        message: details.message.replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]'),
      });
      throw new ServiceUnavailableException({
        status: 'error',
        checks: { database: 'unavailable' },
      });
    }
  }
}
