import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../guards/auth.guard';
import { Session, type UserSession } from '../../decorators/session.decorator';
import { PrismaService } from '../../prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { TryoutService } from './tryout.service';
import { resolveTryoutAccess } from './tryout-curation.helper';
import { growthQuery, type GrowthRegistrationState } from './growth-registration';
import { GrowthClientEventDto, RegisterTryoutDto } from './dto/growth-registration.dto';

@Controller('tryout')
@UseGuards(AuthGuard)
export class TryoutGrowthController {
  constructor(private readonly tryouts: TryoutService, private readonly db: PrismaService) {}
  @Post(':id/register')
  register(@Param('id') id: string, @Session() session: UserSession, @Body() body: RegisterTryoutDto,
    @Query('sandboxToken') token?: string, @Headers('x-sandbox-token') header?: string) {
    return this.tryouts.registerTryout(session.user.id, id, token || header, body.mode ?? 'FREE', body.expectedSolutionPrice, body.growth);
  }
  @Get(':id/growth')
  async state(@Param('id') id: string, @Session() session: UserSession) {
    const access = await resolveTryoutAccess(this.db, id, session.user.id);
    const state = (await growthQuery<{ state: GrowthRegistrationState }>(this.db,
      Prisma.sql`SELECT growth_user_state(${id},${session.user.id}) AS state`))[0].state;
    return { ...state, exempt: state.exempt || access.curationStatus !== 'PUBLISHED' };
  }
  @Post(':id/growth/events')
  async event(@Param('id') id: string, @Session() session: UserSession, @Body() body: GrowthClientEventDto) {
    await resolveTryoutAccess(this.db, id, session.user.id);
    await growthQuery(this.db, Prisma.sql`SELECT growth_client_event(${id},${session.user.id},${JSON.stringify(body)}::jsonb)`);
    return { ok: true };
  }
}
