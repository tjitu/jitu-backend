import { ServiceUnavailableException } from '@nestjs/common';
import {
  canAccessTryoutSandbox,
  getSandboxPreviewTryoutId,
  getTryoutCurationMap,
} from './tryout-curation.helper';

describe('tryout-curation.helper', () => {
  const prisma = { $queryRaw: jest.fn() } as any;

  beforeEach(() => {
    prisma.$queryRaw.mockReset();
  });

  it('does not let a scoped preview token grant access to an unscoped tryout list', async () => {
    await expect(
      canAccessTryoutSandbox(prisma, undefined, undefined, 'a'.repeat(64)),
    ).resolves.toBe(false);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns the tryout scope from a valid, unexpired preview token', async () => {
    prisma.$queryRaw.mockResolvedValue([{ tryoutId: 'tryout-1' }]);

    await expect(
      getSandboxPreviewTryoutId(prisma, 'a'.repeat(64)),
    ).resolves.toBe('tryout-1');
  });

  it('allows a preview token only for its matching tryout', async () => {
    prisma.$queryRaw.mockResolvedValue([{ tryoutId: 'tryout-1' }]);

    await expect(
      canAccessTryoutSandbox(prisma, undefined, 'tryout-1', 'a'.repeat(64)),
    ).resolves.toBe(true);
    await expect(
      canAccessTryoutSandbox(prisma, undefined, 'tryout-2', 'a'.repeat(64)),
    ).resolves.toBe(false);
  });

  it('fails closed when the curation query fails for reasons other than a missing legacy column', async () => {
    prisma.$queryRaw.mockRejectedValue(Object.assign(new Error('database offline'), { code: '08006' }));

    await expect(getTryoutCurationMap(prisma, ['tryout-1'])).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('keeps legacy databases readable when only the curation column is missing', async () => {
    prisma.$queryRaw.mockRejectedValue(Object.assign(new Error('column missing'), { code: '42703' }));

    await expect(getTryoutCurationMap(prisma, ['tryout-1'])).resolves.toEqual(
      new Map([['tryout-1', 'PUBLISHED']]),
    );
  });
});
