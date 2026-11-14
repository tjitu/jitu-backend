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

/** Checks whether the current user is a sandbox/admin QA tester or holds a valid preview token. */
export async function canAccessTryoutSandbox(
  prisma: PrismaService,
  userId?: string | null,
  tryoutId?: string | null,
  sandboxToken?: string | null,
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

  if (!tryoutId) return false;

  return (await getSandboxPreviewTryoutId(prisma, sandboxToken)) === tryoutId;
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

/** Verifies whether a user/token is permitted to view or attempt a tryout given its curation state. */
export async function resolveTryoutAccess(
  prisma: PrismaService,
  tryoutId: string,
  userId?: string | null,
  sandboxToken?: string | null,
): Promise<{ curationStatus: TryoutCurationStatus; canSandbox: boolean }> {
  const [curationMap, canSandbox] = await Promise.all([
    getTryoutCurationMap(prisma, [tryoutId]),
    canAccessTryoutSandbox(prisma, userId, tryoutId, sandboxToken),
  ]);
  const curationStatus = curationMap.get(tryoutId) ?? 'DRAFT';

  if (curationStatus === 'PUBLISHED') {
    return { curationStatus, canSandbox };
  }

  if (canSandbox) {
    return { curationStatus, canSandbox };
  }

  throw new NotFoundException(
    'Tryout tidak ditemukan atau masih dalam tahap penyiapan QC.',
  );
}
