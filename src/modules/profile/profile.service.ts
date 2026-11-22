import { areTryoutResultsAvailable } from '../../common/utils/tryout-results.util';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MidtransService } from '../shop/services/midtrans.service';
import { isUserPremiumActive } from '../../common/utils/premium.util';

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private prisma: PrismaService,
    private midtransService: MidtransService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        accounts: true,
      },
    });

    if (!user) return null;

    // 1. Ambil 5 riwayat terakhir untuk list
    const recentAttempts = await this.prisma.tryOutAttempt.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      take: 5,
      include: { tryOut: { select: { title: true, batch: true, scheduledEnd: true } } },
    });

    // 2. Hitung statistik global (hanya yang FINISHED)
    const stats = await this.prisma.tryOutAttempt.aggregate({
      where: { userId, status: 'FINISHED', tryOut: { scheduledEnd: { lte: new Date() } } },
      _avg: { totalScore: true },
    });

    const totalTryout = await this.prisma.tryOutAttempt.count({ where: { userId, status: 'FINISHED' } });

    // 3. Ambil pending payment (jika ada) untuk ditampilkan di profile
    const pendingPayment = await this.prisma.payment.findFirst({
      where: {
        userId,
        status: 'PENDING',
        paymentMethod: { in: ['GOPAY', 'QRIS'] },
      },
      include: {
        tokenPackage: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    let paymentData: any = null;
    if (pendingPayment) {
      const expiryTime = new Date(pendingPayment.createdAt);
      expiryTime.setMinutes(expiryTime.getMinutes() + 15);
      const isExpired = new Date() > expiryTime;

      if (isExpired) {
        await this.prisma.payment.update({
          where: { id: pendingPayment.id },
          data: { status: 'CANCELLED' },
        });
      } else {
        let qrisString = '';
        try {
          qrisString = this.midtransService.generateQris(
            pendingPayment.amount,
            pendingPayment.orderId,
          );
        } catch (error) {
          this.logger.error('Failed to generate QRIS in Profile', error);
        }

        paymentData = {
          ...pendingPayment,
          qris: qrisString,
          packageName: pendingPayment.tokenPackage.name,
          expiresAt: expiryTime,
        };
      }
    }

    const hasPassword = user.accounts.some(
      (account) => account.providerId === 'firebase-password',
    );

    return {
      user: {
        name: user.name,
        email: user.email,
        image: user.image,
        tokenBalance: user.tokenBalance,
        target: user.target,
        phone: user.phoneNumber || null,
        phoneNumber: user.phoneNumber || null,
        school: user.school || null,
        hasPassword,
        isPremium: isUserPremiumActive(user),
        premiumExpiresAt: user.premiumExpiresAt || null,
      },
      stats: {
        totalTryout,
        averageScore: Math.round(stats._avg.totalScore || 0),
        lastScore:
          recentAttempts.length > 0 && areTryoutResultsAvailable(recentAttempts[0].tryOut.scheduledEnd) ? recentAttempts[0].totalScore : 0,
        streak: user.currentStreak,
      },
      pendingPayment: paymentData,
      attempts: recentAttempts.map((attempt) => ({
        id: attempt.id,
        title: attempt.tryOut.title,
        date: attempt.startedAt,
        score: attempt.status === 'FINISHED' && areTryoutResultsAvailable(attempt.tryOut.scheduledEnd) ? attempt.totalScore : null,
        status: attempt.status === 'FINISHED' ? (areTryoutResultsAvailable(attempt.tryOut.scheduledEnd) && attempt.totalScore > 700 ? 'EXCELLENT' : 'COMPLETED') : 'ONGOING',
      })),
    };
  }

  async updateProfile(
    userId: string,
    data: {
      name?: string;
      target?: string;
      phoneNumber?: string;
      school?: string;
    },
  ) {
    const updateData: {
      name?: string;
      target?: string;
      phoneNumber?: string;
      school?: string;
    } = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.target !== undefined) updateData.target = data.target;
    if (data.phoneNumber !== undefined) updateData.phoneNumber = data.phoneNumber;
    if (data.school !== undefined) updateData.school = data.school;

    return this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

}
