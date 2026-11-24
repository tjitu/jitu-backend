import { UnauthorizedException } from '@nestjs/common';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { AuthIdentityService } from './auth-identity.service';
import type { PrismaService } from '../../prisma.service';

describe('AuthIdentityService', () => {
  const token = {
    uid: 'firebase-1', email: 'qc@example.com', email_verified: false,
    firebase: { sign_in_provider: 'password', identities: { email: ['qc@example.com'] } },
  } as DecodedIdToken;
  const user = { id: 'user-1', emailVerified: false };
  const prisma = {
    account: { findFirst: jest.fn(), createMany: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const service = new AuthIdentityService(prisma as unknown as PrismaService);

  beforeEach(() => jest.resetAllMocks());

  it('accepts an unverified user with an existing Firebase mapping', async () => {
    prisma.account.findFirst.mockResolvedValue({ user });
    await expect(service.resolveUser(token)).resolves.toEqual(user);
  });

  it('creates a new user without claiming the email is verified', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(user);
    await expect(service.resolveUser(token)).resolves.toEqual(user);
    expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ emailVerified: false }),
    }));
  });

  it('does not link an unverified identity to an existing account by email', async () => {
    prisma.user.findFirst.mockResolvedValue(user);
    await expect(service.resolveUser(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.account.createMany).not.toHaveBeenCalled();
  });

  it('does not link an unverified identity after a concurrent account creation', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
    prisma.user.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.resolveUser(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.account.createMany).not.toHaveBeenCalled();
  });
});
