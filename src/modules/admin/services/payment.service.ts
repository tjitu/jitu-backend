import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { PaymentStatus, Prisma } from '../../../../generated/prisma/client';

@Injectable()
export class AdminPaymentService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllPayments(
    page = 1,
    limit = 10,
    status?: PaymentStatus,
    search?: string,
  ) {
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (search) {
      where.user = {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              name: true,
              email: true,
            },
          },
          tokenPackage: {
            select: {
              name: true,
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        lastPage: Math.ceil(total / limit),
      },
    };
  }

  async getPaymentStats() {
    const [totalRevenue, totalSuccess, totalPending] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.CONFIRMED },
        _sum: { amount: true },
      }),
      this.prisma.payment.count({
        where: { status: PaymentStatus.CONFIRMED },
      }),
      this.prisma.payment.count({
        where: { status: PaymentStatus.PENDING },
      }),
    ]);

    return {
      totalRevenue: totalRevenue._sum.amount || 0,
      totalSuccess,
      totalPending,
    };
  }

  async confirmPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { tokenPackage: true },
    });

    if (!payment) {
      throw new NotFoundException('Data pembayaran tidak ditemukan');
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        'Hanya pembayaran berstatus PENDING yang bisa dikonfirmasi',
      );
    }

    // CRITICAL: Database Transaction
    return await this.prisma.$transaction(async (tx) => {
      // 1. Update Status Payment
      const updatedPayment = await tx.payment.update({
        where: { id: paymentId },
        data: { status: PaymentStatus.CONFIRMED },
      });

      const pkgName =
        payment.tokenPackage?.name ||
        (payment.metadata as any)?.package_name ||
        '';
      const isPass = pkgName.toLowerCase().includes('pass');

      const currentUser = await tx.user.findUnique({
        where: { id: payment.userId },
        select: { premiumExpiresAt: true },
      });

      const now = new Date();
      let newPremiumExpiresAt: Date | undefined = undefined;
      if (isPass) {
        const baseDate =
          currentUser?.premiumExpiresAt && currentUser.premiumExpiresAt > now
            ? currentUser.premiumExpiresAt
            : now;
        newPremiumExpiresAt = new Date(
          baseDate.getTime() + 30 * 24 * 60 * 60 * 1000,
        );
      }

      // 2. Tambah Token User & Update status Premium jika Pass
      await tx.user.update({
        where: { id: payment.userId },
        data: {
          tokenBalance: { increment: payment.tokenAmount },
          ...(isPass
            ? { isPremium: true, premiumExpiresAt: newPremiumExpiresAt }
            : {}),
        },
      });

      // 3. Catat di Riwayat Transaksi Token
      await tx.tokenTransaction.create({
        data: {
          userId: payment.userId,
          amount: payment.tokenAmount,
          type: 'TOPUP',
          referenceId: `PAYMENT_ID: ${paymentId}`,
        },
      });

      // 4. Update Voucher usage if used
      if (payment.voucherId) {
        await tx.voucher
          .update({
            where: { id: payment.voucherId },
            data: { usedCount: { increment: 1 } },
          })
          .catch(() => undefined);

        await tx.voucherUsage
          .create({
            data: {
              voucherId: payment.voucherId,
              userId: payment.userId,
              paymentId: payment.id,
              discount: payment.discountAmount || 0,
            },
          })
          .catch(() => undefined);
      }

      return updatedPayment;
    });
  }

  async rejectPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundException('Data pembayaran tidak ditemukan');
    }

    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(
        'Hanya pembayaran berstatus PENDING yang bisa ditolak',
      );
    }

    return await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.DECLINED },
    });
  }
}
