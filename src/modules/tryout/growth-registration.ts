import { HttpException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma.service';

export interface GrowthRegistrationState {
  tryoutId: string;
  tryoutName: string;
  isRegistered: boolean;
  configVersion: number;
  registrationClosed: boolean;
  exempt: boolean;
  config: Prisma.JsonObject;
  verification: { id: string; status: 'PENDING_VERIFICATION' | 'APPROVED' | 'REJECTED'; version: number } | null;
}
type Database = Pick<PrismaService, '$queryRaw'>;
export interface TryoutRegistrationResult {
  message: string; isRegistered: boolean; attemptId?: string; isPremium?: boolean; solutionPrice?: number;
  verificationStatus?: 'PENDING_VERIFICATION' | 'APPROVED' | 'REJECTED';
}
export async function growthQuery<T>(db: Database, statement: Prisma.Sql): Promise<T[]> {
  try { return await db.$queryRaw<T[]>(statement); }
  catch (error) {
    let message = '';
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const adapter = error.meta?.driverAdapterError as { cause?: { originalMessage?: unknown; message?: unknown } } | undefined;
      message = [error.meta?.message, adapter?.cause?.originalMessage, adapter?.cause?.message]
        .find((value): value is string => typeof value === 'string') ?? '';
    }
    const match = message.match(/GROWTH_([A-Z_]+): ([^\n]+)/);
    if (!match) throw error;
    const code = match[1];
    const status = code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : ['FORBIDDEN','PENDING','REJECTED'].includes(code) ? 403 : 400;
    throw new HttpException({ code: `GROWTH_${code}`, message: match[2] }, status);
  }
}
export async function submitGrowthRegistration(db: Database, tryoutId: string, userId: string, input?: unknown) {
  const rows = await growthQuery<{ state: GrowthRegistrationState | null }>(db,
    Prisma.sql`SELECT growth_submit(${tryoutId},${userId},${JSON.stringify(input ?? {})}::jsonb) AS state`);
  const state = rows[0]?.state;
  if (!state) return null;
  return { ...state, verificationStatus: state.verification?.status,
    message: state.verification?.status === 'PENDING_VERIFICATION' ? 'Pendaftaranmu akan diverifikasi terlebih dahulu.' : 'Pendaftaran Berhasil!' };
}
export async function assertGrowthAccess(db: Database, tryoutId: string, userId: string) {
  await growthQuery(db, Prisma.sql`SELECT growth_assert_access(${tryoutId},${userId}) AS allowed`);
}
