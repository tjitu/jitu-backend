import { NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma.service';

export type TryoutCurationStatus =
  | 'DRAFT'
  | 'QC_SANDBOX'
  | 'NEEDS_REVISION'
  | 'PUBLISHED';

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
  } catch {
    for (const id of cleanIds) {
      map.set(id, 'PUBLISHED');
    }
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

  const cleanToken = String(sandboxToken || '').trim();
  if (/^[a-f0-9]{64}$/i.test(cleanToken)) {
    const tokenHash = createHash('sha256').update(cleanToken).digest('hex');
    try {
      const sessionRows = await prisma.$queryRaw<
        Array<{ tryoutId: string | null }>
      >(
        Prisma.sql`SELECT "tryout_id" AS "tryoutId"
         FROM public."QcSandboxPreviewSession"
         WHERE "token_hash" = ${tokenHash} AND "expires_at" > CURRENT_TIMESTAMP
         LIMIT 1`,
      );
      const session = sessionRows[0];
      if (session) {
        if (!tryoutId || !session.tryoutId || session.tryoutId === tryoutId) {
          return true;
        }
      }
    } catch {
      return false;
    }
  }

  return false;
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
  } catch {
    return new Set();
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
  const curationStatus = curationMap.get(tryoutId) ?? 'PUBLISHED';

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
