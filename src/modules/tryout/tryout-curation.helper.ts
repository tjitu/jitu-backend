import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma.service';

export type TryoutCurationStatus =
  | 'DRAFT'
  | 'QC_SANDBOX'
  | 'NEEDS_REVISION'
  | 'PUBLISHED';

function postgresErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; driverAdapterError?: { cause?: { code?: unknown } } };
    cause?: { code?: unknown };
  };
  const candidateCodes = [
    value.meta?.code,
    value.meta?.driverAdapterError?.cause?.code,
    value.cause?.code,
    value.code,
  ];
  for (const candidate of candidateCodes) {
    if (typeof candidate === 'string' && candidate !== 'P2010') {
      return candidate;
    }
  }
  const msg = typeof value.message === 'string' ? value.message : '';
  if (msg.includes('42703') || msg.includes('column') && msg.includes('does not exist')) {
    return '42703';
  }
  return typeof value.code === 'string' ? value.code : undefined;
}

/** Fetches curation_status for given tryout IDs cleanly even if schema migration ran out-of-band. */
export async function getTryoutCurationMap(
  prisma: PrismaService,
  ids: string[],
): Promise<Map<string, TryoutCurationStatus>> {
  const map = new Map<string, TryoutCurationStatus>();
  const cleanIds = Array.from(new Set(ids.filter(Boolean)));
  if (cleanIds.length === 0) return map;

  try {
    const rows = await prisma.$queryRaw<
      Array<{ id: string; curationStatus: string | null }>
    >(
      Prisma.sql`SELECT "id", COALESCE("curation_status", 'PUBLISHED') AS "curationStatus"
       FROM public."TryOut"
       WHERE "id" IN (${Prisma.join(cleanIds)})`,
    );
    for (const row of rows) {
      const normalized = String(row.curationStatus || 'PUBLISHED')
        .toUpperCase()
        .trim() as TryoutCurationStatus;
      map.set(row.id, normalized);
    }
  } catch (error) {
    // Older production databases may not have been initialized by Control Center yet.
    // In that specific case the legacy behavior is that existing tryouts are published.
    if (postgresErrorCode(error) !== '42703') {
      throw new ServiceUnavailableException(
        'Status kurasi tryout sedang tidak tersedia.',
      );
    }
    for (const id of cleanIds) map.set(id, 'PUBLISHED');
  }

  return map;
}

/** Checks whether the authenticated user is a sandbox or admin QA tester. */
export async function canAccessTryoutSandbox(
  prisma: PrismaService,
  userId?: string | null,
  _tryoutId?: string | null,
  _sandboxToken?: string | null,
): Promise<boolean> {
  if (userId) {
    try {
      const userRows = await prisma.$queryRaw<
        Array<{ isSandbox: boolean | null; role: string | null }>
      >(
        Prisma.sql`SELECT COALESCE("isSandbox", false) AS "isSandbox", "role"::text AS "role"
         FROM public."user"
         WHERE "id" = ${userId}
         LIMIT 1`,
      );
      const user = userRows[0];
      if (user && (Boolean(user.isSandbox) || user.role === 'ADMIN')) {
        return true;
      }
    } catch {
      // Column may not exist yet before first Control Center boot; ignore safely.
    }
  }

  return false;
}

/** Returns the single tryout a valid preview token is scoped to. */
export async function getSandboxPreviewTryoutId(
  prisma: PrismaService,
  sandboxToken?: string | null,
): Promise<string | null> {
  const cleanToken = String(sandboxToken || '').trim();
  if (/^[a-f0-9]{64}$/i.test(cleanToken)) {
    const tokenHash = createHash('sha256').update(cleanToken).digest('hex');
    try {
      const sessionRows = await prisma.$queryRaw<Array<{ tryoutId: string | null }>>(
        Prisma.sql`SELECT "tryout_id" AS "tryoutId"
         FROM public."QcSandboxPreviewSession"
         WHERE "token_hash" = ${tokenHash} AND "expires_at" > CURRENT_TIMESTAMP
         LIMIT 1`,
      );
      const session = sessionRows[0];
      return session?.tryoutId ?? null;
    } catch {
      return null;
    }
  }

  return null;
}

/** Returns user IDs marked as sandbox QA accounts so they can be hidden from student leaderboards. */
export async function getSandboxUserIdSet(
  prisma: PrismaService,
): Promise<Set<string>> {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT "id" FROM public."user" WHERE COALESCE("isSandbox", false) = true`,
    );
    return new Set(rows.map((r) => r.id));
  } catch (error) {
    if (postgresErrorCode(error) === '42703') return new Set();
    throw new ServiceUnavailableException(
      'Status akun Sandbox sedang tidak tersedia.',
    );
  }
}

/** Fetches curation_status, questions_released, and break_seconds for a tryout cleanly even if schema migration ran out-of-band. */
export async function getTryoutGovernanceMeta(
  prisma: PrismaService,
  tryoutId: string,
): Promise<{
  curationStatus: TryoutCurationStatus;
  questionsReleased: boolean;
  breakSeconds: number;
}> {
  if (!tryoutId) {
    return { curationStatus: 'DRAFT', questionsReleased: false, breakSeconds: 60 };
  }

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        curationStatus: string | null;
        questionsReleased: boolean | null;
        breakSeconds: number | null;
        scheduledStart: Date | null;
        isPublic: boolean | null;
      }>
    >(
      Prisma.sql`SELECT
        COALESCE("curation_status", 'PUBLISHED') AS "curationStatus",
        COALESCE("questions_released", COALESCE("curation_status", 'PUBLISHED') = 'PUBLISHED') AS "questionsReleased",
        COALESCE("break_seconds", 60)::int AS "breakSeconds",
        "scheduledStart",
        "isPublic"
       FROM public."TryOut"
       WHERE "id" = ${tryoutId}
       LIMIT 1`,
    );
    const row = rows[0];
    if (!row) {
      return { curationStatus: 'DRAFT', questionsReleased: false, breakSeconds: 60 };
    }
    const normalized = String(row.curationStatus || 'PUBLISHED')
      .toUpperCase()
      .trim() as TryoutCurationStatus;
    const isLiveBySchedule =
      normalized === 'PUBLISHED' &&
      Boolean(row.isPublic ?? true) &&
      (!row.scheduledStart || new Date(row.scheduledStart).getTime() <= Date.now());
    return {
      curationStatus: normalized,
      questionsReleased: Boolean(row.questionsReleased) || isLiveBySchedule,
      breakSeconds: Math.max(0, Math.min(1800, Number(row.breakSeconds ?? 60))),
    };
  } catch (error) {
    if (postgresErrorCode(error) !== '42703') {
      throw new ServiceUnavailableException(
        'Status kurasi tryout sedang tidak tersedia.',
      );
    }
    const map = await getTryoutCurationMap(prisma, [tryoutId]);
    const curationStatus = map.get(tryoutId) ?? 'PUBLISHED';
    return {
      curationStatus,
      questionsReleased: curationStatus === 'PUBLISHED',
      breakSeconds: 60,
    };
  }
}

/**
 * Returns the set of question IDs in a tryout whose status is READY.
 * Falls back to null (meaning no status column / do not filter) if older DBs lack Question.status.
 */
export async function getReadyQuestionIdSet(
  prisma: PrismaService,
  tryOutId: string,
): Promise<Set<string> | null> {
  if (!tryOutId) return new Set();
  const queryRaw = (prisma as unknown as { $queryRaw?: unknown })?.$queryRaw;
  if (typeof queryRaw !== 'function') return null;

  try {
    const rows = await prisma.$queryRaw<Array<{ readyQuestionId?: string }>>(
      Prisma.sql`SELECT DISTINCT q."id" AS "readyQuestionId"
       FROM public."Question" q
       LEFT JOIN public."Subtest" sub ON sub."id" = q."subtest_id"
       WHERE (q."tryoutId" = ${tryOutId} OR sub."try_out_id" = ${tryOutId})
         AND COALESCE(q."status", 'DRAFT') = 'READY'`,
    );
    if (rows.length > 0 && !('readyQuestionId' in rows[0])) {
      return null;
    }
    return new Set(
      rows
        .map((r) => r.readyQuestionId)
        .filter((id): id is string => Boolean(id))
        .map(String),
    );
  } catch (error) {
    if (postgresErrorCode(error) === '42703') {
      return null;
    }
    return null;
  }
}

/** Verifies whether a user/token is permitted to view or attempt a tryout given its curation state. */
export async function resolveTryoutAccess(
  prisma: PrismaService,
  tryoutId: string,
  userId?: string | null,
  sandboxToken?: string | null,
): Promise<{
  curationStatus: TryoutCurationStatus;
  questionsReleased: boolean;
  breakSeconds: number;
  canSandbox: boolean;
}> {
  const [meta, canSandbox] = await Promise.all([
    getTryoutGovernanceMeta(prisma, tryoutId),
    canAccessTryoutSandbox(prisma, userId, tryoutId, sandboxToken),
  ]);
  const { curationStatus, questionsReleased, breakSeconds } = meta;

  if (curationStatus === 'PUBLISHED') {
    return { curationStatus, questionsReleased, breakSeconds, canSandbox };
  }

  if (canSandbox) {
    return { curationStatus, questionsReleased, breakSeconds, canSandbox };
  }

  throw new NotFoundException(
    'Tryout tidak ditemukan atau masih dalam tahap penyiapan QC.',
  );
}
