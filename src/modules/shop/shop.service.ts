import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '../../../generated/prisma/client';
import { MidtransService } from './services/midtrans.service';
import type {
  EWalletPaymentResponse,
  MidtransNotificationDto,
  ValidateVoucherResponse,
} from './dto/ewallet.dto';

@Injectable()
export class ShopService {
  private readonly logger = new Logger(ShopService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly midtransService: MidtransService,
  ) {}

  private mergePaymentMetadata(
    metadata: unknown,
    notification: MidtransNotificationDto,
  ): Prisma.InputJsonValue {
    const current =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, Prisma.InputJsonValue>)
        : {};
    const sanitizedNotification = JSON.parse(
      JSON.stringify(notification),
    ) as Prisma.InputJsonValue;

    return {
      ...current,
      last_notification: sanitizedNotification,
      last_notification_at: new Date().toISOString(),
    };
  }

  private isMatchingPaymentAmount(
    notification: MidtransNotificationDto,
    amount: number,
  ) {
    if (!notification.gross_amount) {
      return false;
    }

    const notificationAmount = Number(notification.gross_amount);
    if (!Number.isFinite(notificationAmount)) {
      return false;
    }

    return Math.round(notificationAmount * 100) === amount * 100;
  }

  // Ambil daftar paket dari database
  async getPackages() {
    return this.prisma.tokenPackage.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
  }

  /**
   * Get user's pending e-wallet payment if exists
   */
  async getPendingEWalletPayment(userId: string) {
    const pendingPayment = await this.prisma.payment.findFirst({
      where: {
        userId,
        status: PaymentStatus.PENDING,
        paymentMethod: { in: ['GOPAY', 'QRIS'] },
      },
      include: {
        tokenPackage: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!pendingPayment) {
      return null;
    }

    // Check if payment is expired (15 minutes)
    const expiryTime = new Date(pendingPayment.createdAt);
    expiryTime.setMinutes(expiryTime.getMinutes() + 15);
    const isExpired = new Date() > expiryTime;

    if (isExpired) {
      // Auto-cancel expired payment
      await this.prisma.payment.update({
        where: { id: pendingPayment.id },
        data: { status: PaymentStatus.CANCELLED },
      });
      return null;
    }

    return {
      ...pendingPayment,
      expiresAt: expiryTime,
      isExpired,
    };
  }

  /**
   * Cancel a pending payment
   */
  async cancelPayment(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: {
        id: paymentId,
        userId,
        status: PaymentStatus.PENDING,
      },
    });

    if (!payment) {
      throw new BadRequestException('Payment not found or already processed');
    }

    // Try to cancel on Midtrans side if we have transaction ID
    if (payment.metadata && typeof payment.metadata === 'object') {
      const metadata = payment.metadata as any;
      if (metadata.midtrans_transaction_id) {
        try {
          await this.midtransService.cancelTransaction(payment.orderId);
        } catch (error) {
          this.logger.warn(
            'Failed to cancel on Midtrans, continuing with local cancellation',
            error,
          );
        }
      }
    }

    // Update payment status to CANCELLED
    const updatedPayment = await this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.CANCELLED },
    });

    return {
      success: true,
      message: 'Payment cancelled successfully',
      payment: updatedPayment,
    };
  }

  async createTokenTransaction(userId: string, packageId: string) {
    // Cari paket di database
    const selectedPackage = await this.prisma.tokenPackage.findUnique({
      where: { id: packageId },
    });

    if (!selectedPackage) {
      throw new BadRequestException('Paket tidak valid atau tidak ditemukan!');
    }

    // TODO: Add logic cek unpaid transaction jika perlu

    // Buat Payment/Transaction baru
    // Sesuaikan dengan schema Payment yang baru (ada orderId)
    // Gunakan Payment model, bukan TokenTransaction (karena schema sudah berubah ke Payment + TokenPackage)
    // TAPI, kode lama pakai TokenTransaction. Mari kita cek schema sebentar.
    // Asumsi: Kita migrasi ke model Payment yang terhubung ke TokenPackage.

    // Karena TokenTransaction di schema lama agak beda dengan Payment baru,
    // Saya akan sesuaikan dengan schema Payment yang ada di seed.ts tadi.

    const orderId = `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const transaction = await this.prisma.payment.create({
      data: {
        userId,
        tokenPackageId: selectedPackage.id,
        orderId,
        amount: selectedPackage.price,
        tokenAmount: selectedPackage.tokenAmount,
        status: PaymentStatus.PENDING,
        paymentMethod: 'QRIS_STATIC',
      },
    });

    // Generate QRIS
    let qrisString = '';
    try {
      qrisString = this.midtransService.generateQris(
        selectedPackage.price,
        transaction.orderId,
      );
    } catch (error) {
      this.logger.error('Failed to generate QRIS', error);
      throw new BadRequestException('Gagal generate QRIS Code');
    }

    return {
      ...transaction,
      qris: qrisString,
      packageName: selectedPackage.name,
    };
  }

  /**
   * Validate a voucher / referral code and calculate discount
   */
  async validateVoucher(
    rawCode: string,
    packageId: string,
    userId?: string,
  ): Promise<ValidateVoucherResponse> {
    if (!rawCode || !rawCode.trim()) {
      throw new BadRequestException('Kode voucher wajib diisi.');
    }

    const code = rawCode.trim().toUpperCase();

    // 1. Find voucher in database
    const voucher = await this.prisma.voucher.findUnique({
      where: { code },
    });

    if (!voucher) {
      throw new BadRequestException('Kode voucher / referal tidak ditemukan.');
    }

    if (!voucher.isActive) {
      throw new BadRequestException('Kode voucher / referal sudah tidak aktif.');
    }

    const now = new Date();
    if (voucher.expiresAt && voucher.expiresAt < now) {
      throw new BadRequestException('Kode voucher / referal sudah kedaluwarsa.');
    }

    if (
      voucher.maxUsage !== null &&
      voucher.maxUsage !== undefined &&
      voucher.usedCount >= voucher.maxUsage
    ) {
      throw new BadRequestException(
        'Kuota penggunaan kode voucher ini sudah habis.',
      );
    }

    // 2. Find package
    const selectedPackage = await this.prisma.tokenPackage.findUnique({
      where: { id: packageId },
    });

    if (!selectedPackage) {
      throw new BadRequestException(
        'Paket koin tidak valid atau tidak ditemukan.',
      );
    }

    if (voucher.minPurchase > 0 && selectedPackage.price < voucher.minPurchase) {
      throw new BadRequestException(
        `Minimal pembelian untuk kode ini adalah Rp ${voucher.minPurchase.toLocaleString('id-ID')}.`,
      );
    }

    // 3. Calculate discount
    let discountAmount = Math.round(
      (selectedPackage.price * voucher.discountPercent) / 100,
    );
    if (voucher.maxDiscount && discountAmount > voucher.maxDiscount) {
      discountAmount = voucher.maxDiscount;
    }
    const finalPrice = Math.max(0, selectedPackage.price - discountAmount);

    return {
      valid: true,
      voucherId: voucher.id,
      code: voucher.code,
      discountPercent: voucher.discountPercent,
      discountAmount,
      originalPrice: selectedPackage.price,
      finalPrice,
      description: voucher.description || `Diskon ${voucher.discountPercent}%`,
      referrerName: voucher.referrerName,
    };
  }

  /**
   * Create E-Wallet payment using Midtrans GoPay with optional voucher discount
   */
  async createEWalletPayment(
    userId: string,
    packageId: string,
    callbackUrl?: string,
    voucherCode?: string,
  ): Promise<EWalletPaymentResponse> {
    // Find package
    const selectedPackage = await this.prisma.tokenPackage.findUnique({
      where: { id: packageId },
    });

    if (!selectedPackage) {
      throw new BadRequestException('Package not found or invalid!');
    }

    // Check for existing pending transactions
    const existingPending = await this.prisma.payment.findFirst({
      where: {
        userId,
        tokenPackageId: packageId,
        status: PaymentStatus.PENDING,
        paymentMethod: { in: ['GOPAY', 'QRIS'] },
      },
    });

    if (existingPending) {
      throw new BadRequestException(
        'You have a pending e-wallet transaction. Please complete or cancel it first.',
      );
    }

    // Apply voucher if provided
    let voucherId: string | null = null;
    let appliedVoucherCode: string | null = null;
    let discountAmount = 0;
    let finalPrice = selectedPackage.price;

    if (voucherCode && voucherCode.trim()) {
      const vResult = await this.validateVoucher(
        voucherCode.trim(),
        packageId,
        userId,
      );
      voucherId = vResult.voucherId;
      appliedVoucherCode = vResult.code;
      discountAmount = vResult.discountAmount;
      finalPrice = vResult.finalPrice;
    }

    // Generate unique order ID
    const orderId = `ORDER-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    // Create payment record
    const payment = await this.prisma.payment.create({
      data: {
        userId,
        tokenPackageId: selectedPackage.id,
        orderId,
        amount: finalPrice,
        originalAmount: selectedPackage.price,
        discountAmount,
        voucherId,
        voucherCode: appliedVoucherCode,
        tokenAmount: selectedPackage.tokenAmount,
        status: finalPrice === 0 ? PaymentStatus.CONFIRMED : PaymentStatus.PENDING,
        paymentMethod: finalPrice === 0 ? 'FREE_VOUCHER' : 'GOPAY',
      },
    });

    // If 100% discount free voucher: confirm immediately and credit benefits!
    if (finalPrice === 0) {
      await this.setPaid(payment.id);
      return {
        transactionId: payment.id,
        orderId: payment.orderId,
        amount: 0,
        originalAmount: selectedPackage.price,
        discountAmount,
        voucherCode: appliedVoucherCode || undefined,
        tokenAmount: payment.tokenAmount,
        status: PaymentStatus.CONFIRMED,
        paymentMethod: 'FREE_VOUCHER',
        packageName: selectedPackage.name,
      };
    }

    try {
      // 1. Fetch user info for Snap
      const user = await this.prisma.user.findUnique({ where: { id: userId } });

      // 2. Call Midtrans Direct QRIS via Snap charge with final discounted price
      const qrisResult = await this.midtransService.createQrisTransaction(
        orderId,
        finalPrice,
        [
          {
            id: selectedPackage.id,
            price: finalPrice,
            quantity: 1,
            name: `${selectedPackage.name}${discountAmount > 0 ? ` (${appliedVoucherCode})` : ''}`.slice(
              0,
              50,
            ),
          },
        ],
        {
          first_name: user?.name || user?.email?.split('@')[0] || 'Siswa Jitu',
          email: user?.email || undefined,
        },
      );

      // 3. Update payment with Midtrans Snap token and metadata
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          snapToken: qrisResult.token,
          paymentMethod: 'QRIS',
          metadata: {
            redirect_url: qrisResult.redirect_url,
            qr_code_url: qrisResult.qr_url,
            qr_string: qrisResult.qr_string,
            package_name: selectedPackage.name,
            original_amount: selectedPackage.price,
            discount_amount: discountAmount,
            voucher_code: appliedVoucherCode,
          },
        },
      });

      return {
        transactionId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount,
        originalAmount: selectedPackage.price,
        discountAmount,
        voucherCode: appliedVoucherCode || undefined,
        tokenAmount: payment.tokenAmount,
        status: payment.status,
        paymentMethod: 'QRIS',
        snapToken: qrisResult.token,
        redirectUrl: qrisResult.redirect_url,
        qrCodeUrl: qrisResult.qr_url,
        expiryTime: qrisResult.expiry_time,
        packageName: selectedPackage.name,
      };
    } catch (error) {
      // If Midtrans API fails, delete the payment record
      await this.prisma.payment.delete({ where: { id: payment.id } }).catch(() => {});
      throw new BadRequestException(
        `Failed to create e-wallet payment: ${error.message}`,
      );
    }
  }

  async getPendingTransactions(userId: string) {
    const transactions = await this.prisma.payment.findMany({
      where: {
        userId,
        status: PaymentStatus.PENDING,
      },
      include: {
        tokenPackage: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return transactions.map((trx) => ({
      ...trx,
      totalPrice: trx.amount, // Map amount to totalPrice for frontend compatibility
      packageName: trx.tokenPackage.name,
    }));
  }

  async getPastTransactions(userId: string) {
    const transactions = await this.prisma.payment.findMany({
      where: {
        userId,
        status: { not: PaymentStatus.PENDING },
      },
      include: {
        tokenPackage: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return transactions.map((trx) => ({
      ...trx,
      totalPrice: trx.amount, // Map amount to totalPrice for frontend compatibility
      packageName: trx.tokenPackage.name,
    }));
  }

  async getData(userId: string, transactionId: string) {
    const transaction = await this.prisma.payment.findUnique({
      where: { id: transactionId }, // Cari berdasarkan ID (Primary Key)
      include: { tokenPackage: true },
    });

    if (!transaction || transaction.userId !== userId) {
      throw new BadRequestException('Transaksi tidak ditemukan!');
    }

    let qrisString = '';
    try {
      // Gunakan amount transaksi, bukan dari paket (karena harga bisa berubah)
      qrisString = this.midtransService.generateQris(
        transaction.amount,
        transaction.orderId,
      );
    } catch (error) {
      this.logger.error('Failed to generate QRIS', error);
    }

    return {
      ...transaction,
      totalPrice: transaction.amount, // Map amount -> totalPrice
      qris: qrisString,
      packageName: transaction.tokenPackage.name,
    };
  }

  // Webhook atau Manual Check
  async setPaid(transactionId: string) {
    // Cari by ID (karena webhook mungkin kirim ID) atau orderId?
    // Biasanya Midtrans kirim orderId. Tapi fungsi ini parameter namanya transactionId.
    // Kita coba cari by ID dulu, kalau gagal cari by orderId (opsional).
    // Tapi amannya kita asumsikan transactionId adalah ID database.

    const transaction = await this.prisma.payment.findUnique({
      where: { id: transactionId },
    });

    if (!transaction)
      throw new BadRequestException('Transaksi tidak ditemukan!');

    // Update Status Transaksi
    return await this.prisma.$transaction(async (tx) => {
      const updateResult = await tx.payment.updateMany({
        where: {
          id: transactionId,
          status: { not: 'CONFIRMED' },
        },
        data: {
          status: 'CONFIRMED',
        },
      });

      const res = await tx.payment.findUnique({
        where: { id: transactionId },
        include: { tokenPackage: true },
      });

      if (!res) {
        throw new BadRequestException('Transaksi tidak ditemukan!');
      }

      if (updateResult.count > 0) {
        const pkgName =
          res.tokenPackage?.name ||
          (res.metadata as any)?.package_name ||
          '';
        const isPass = pkgName.toLowerCase().includes('pass');

        const currentUser = await tx.user.findUnique({
          where: { id: res.userId },
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

        await tx.user.update({
          where: { id: res.userId },
          data: {
            tokenBalance: { increment: res.tokenAmount },
            ...(isPass
              ? { isPremium: true, premiumExpiresAt: newPremiumExpiresAt }
              : {}),
          },
        });

        // If payment used a voucher, increment usedCount and record usage
        if (res.voucherId) {
          await tx.voucher
            .update({
              where: { id: res.voucherId },
              data: { usedCount: { increment: 1 } },
            })
            .catch((e) =>
              this.logger.warn(`Failed to increment voucher usage: ${e.message}`),
            );

          await tx.voucherUsage
            .create({
              data: {
                voucherId: res.voucherId,
                userId: res.userId,
                paymentId: res.id,
                discount: res.discountAmount || 0,
              },
            })
            .catch((e) =>
              this.logger.warn(`Failed to record voucher usage: ${e.message}`),
            );
        }
      }

      return res;
    });
  }

  /**
   * Manual confirmation by Order ID for local development
   */
  async setPaidByOrderId(orderId: string) {
    const transaction = await this.prisma.payment.findUnique({
      where: { orderId: orderId },
    });

    if (!transaction) {
      throw new BadRequestException(
        'Transaction with that Order ID not found!',
      );
    }

    // Call the original setPaid method that uses the internal ID
    return this.setPaid(transaction.id);
  }

  /**
   * Handle Midtrans webhook notification
   */
  async handleMidtransNotification(
    notification: MidtransNotificationDto,
  ): Promise<{ success: boolean; message: string }> {
    this.logger.log(
      `Received Midtrans notification for order: ${notification.order_id}`,
    );
    this.logger.debug('Notification payload:', JSON.stringify(notification));

    try {
      const isValid = this.midtransService.verifySignature(notification);
      this.logger.log(
        `Signature verification for ${notification.order_id}: ${
          isValid ? 'VALID' : 'INVALID'
        }`,
      );

      if (!isValid) {
        this.logger.warn(
          `Invalid signature received for order: ${notification.order_id}`,
        );
        throw new BadRequestException('Invalid signature');
      }

      if (!this.midtransService.verifyMerchant(notification)) {
        throw new BadRequestException('Invalid merchant');
      }

      const payment = await this.prisma.payment.findUnique({
        where: { orderId: notification.order_id },
      });

      if (!payment) {
        this.logger.warn(
          `Payment not found for order: ${notification.order_id}`,
        );
        throw new BadRequestException('Payment not found');
      }

      if (!this.isMatchingPaymentAmount(notification, payment.amount)) {
        throw new BadRequestException('Invalid payment amount');
      }

      this.logger.log(
        `Found payment ${payment.id} with current status: ${payment.status}`,
      );

      this.logger.log(
        `Verifying transaction status with Midtrans API for order: ${notification.order_id}`,
      );
      const midtransStatus = await this.midtransService.getTransactionStatus(
        notification.order_id,
      );
      this.logger.debug(
        'Midtrans Get Status response:',
        JSON.stringify(midtransStatus),
      );

      const newStatus = this.midtransService.mapTransactionStatus(
        midtransStatus.transaction_status ||
          notification.transaction_status ||
          '',
        midtransStatus.fraud_status || notification.fraud_status,
      );
      this.logger.log(
        `Status mapping for ${notification.order_id}: ${midtransStatus.transaction_status} -> ${newStatus}`,
      );

      const notificationMetadata = this.mergePaymentMetadata(
        payment.metadata,
        notification,
      );
      const baseMetadata =
        notificationMetadata &&
        typeof notificationMetadata === 'object' &&
        !Array.isArray(notificationMetadata)
          ? (notificationMetadata as Record<string, Prisma.InputJsonValue>)
          : {};
      const metadata = {
        ...baseMetadata,
        last_status_check: JSON.parse(
          JSON.stringify(midtransStatus),
        ) as Prisma.InputJsonValue,
        last_status_check_at: new Date().toISOString(),
      } as Prisma.InputJsonValue;

      const result = (await this.prisma.$transaction(
        async (
          tx,
        ): Promise<{ alreadyConfirmed: boolean; credited: boolean }> => {
          const currentPayment = await tx.payment.findUnique({
            where: { id: payment.id },
            include: { tokenPackage: true },
          });

          if (!currentPayment) {
            throw new BadRequestException('Payment not found in our system.');
          }

          if (currentPayment.status === PaymentStatus.CONFIRMED) {
            await tx.payment.update({
              where: { id: currentPayment.id },
              data: { metadata },
            });

            return { alreadyConfirmed: true, credited: false };
          }

          await tx.payment.update({
            where: { id: currentPayment.id },
            data: {
              status: newStatus,
              metadata,
            },
          });

          if (newStatus === PaymentStatus.CONFIRMED) {
            const pkgName =
              currentPayment.tokenPackage?.name ||
              (currentPayment.metadata as any)?.package_name ||
              '';
            const isPass = pkgName.toLowerCase().includes('pass');

            const currentUser = await tx.user.findUnique({
              where: { id: currentPayment.userId },
              select: { premiumExpiresAt: true },
            });

            const now = new Date();
            let newPremiumExpiresAt: Date | undefined = undefined;
            if (isPass) {
              const baseDate =
                currentUser?.premiumExpiresAt &&
                currentUser.premiumExpiresAt > now
                  ? currentUser.premiumExpiresAt
                  : now;
              newPremiumExpiresAt = new Date(
                baseDate.getTime() + 30 * 24 * 60 * 60 * 1000,
              );
            }

            await tx.user.update({
              where: { id: currentPayment.userId },
              data: {
                tokenBalance: { increment: currentPayment.tokenAmount },
                ...(isPass
                  ? { isPremium: true, premiumExpiresAt: newPremiumExpiresAt }
                  : {}),
              },
            });

            // If payment used a voucher, increment usedCount and record usage
            if (currentPayment.voucherId) {
              await tx.voucher
                .update({
                  where: { id: currentPayment.voucherId },
                  data: { usedCount: { increment: 1 } },
                })
                .catch((e) =>
                  this.logger.warn(`Failed to increment voucher usage: ${e.message}`),
                );

              await tx.voucherUsage
                .create({
                  data: {
                    voucherId: currentPayment.voucherId,
                    userId: currentPayment.userId,
                    paymentId: currentPayment.id,
                    discount: currentPayment.discountAmount || 0,
                  },
                })
                .catch((e) =>
                  this.logger.warn(`Failed to record voucher usage: ${e.message}`),
                );
            }

            return { alreadyConfirmed: false, credited: true };
          }

          return { alreadyConfirmed: false, credited: false };
        },
      )) as { alreadyConfirmed: boolean; credited: boolean };

      if (result.credited) {
        this.logger.log(
          `Payment ${payment.id} confirmed. Credited ${payment.tokenAmount} tokens to user ${payment.userId}`,
        );

        return {
          success: true,
          message: 'Payment confirmed and tokens credited',
        };
      }

      if (result.alreadyConfirmed) {
        return {
          success: true,
          message: 'Payment already confirmed; notification recorded',
        };
      }

      return {
        success: true,
        message: `Payment status updated to ${newStatus}`,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error(
        `Unexpected error processing notification for order ${notification.order_id}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to process payment notification',
      );
    }
  }

  async checkMidtransAndConfirm(orderId: string, userId: string) {
    // 1. Find the local payment record
    const payment = await this.prisma.payment.findFirst({
      where: { orderId, userId },
    });

    if (!payment) {
      throw new BadRequestException('Payment not found in our system.');
    }

    // 2. If already confirmed, just return it
    if (payment.status === PaymentStatus.CONFIRMED) {
      return payment;
    }

    // 3. Get latest status from Midtrans
    const midtransStatus =
      await this.midtransService.getTransactionStatus(orderId);

    // 4. Map the status
    const newStatus = this.midtransService.mapTransactionStatus(
      midtransStatus.transaction_status,
      midtransStatus.fraud_status,
    );

    // 5. If confirmed on Midtrans, finalize it locally
    if (newStatus === PaymentStatus.CONFIRMED) {
      return this.setPaid(payment.id);
    }

    // 6. Otherwise, just return the current local state
    return payment;
  }

  checkTransactionStatus(userId: string, transactionId: string) {
    return this.prisma.payment.findFirst({
      where: {
        id: transactionId,
        userId,
      },
    });
  }
}
