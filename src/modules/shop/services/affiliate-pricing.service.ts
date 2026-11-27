import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';

export interface AffiliateQuote {
  id: string; discountRate: number; commissionRate: number; discountAmount: number;
  paidAmount: number; commission: number; createdAt: string; expiresAt: string;
}
interface VerifiedRefundStatus {
  transaction_status?: string; gross_amount?: string; refund_amount?: string;
}
@Injectable()
export class AffiliatePricingService {
  constructor(private readonly prisma: PrismaService) {}
  async quote(voucherId: string, originalAmount: number, reservationId: string | null = null): Promise<AffiliateQuote | null> {
    try {
      const [row] = await this.prisma.$queryRaw<Array<{ quote: AffiliateQuote | null }>>`
        SELECT affiliate_quote(${voucherId},${originalAmount}::integer,${reservationId}) AS quote`;
      return row.quote;
    } catch (error) {
      const databaseError=error as { code?: string; meta?: { code?: string; message?: string } };
      if (databaseError.code==='P2010' && databaseError.meta?.code==='P0001') throw new BadRequestException('Affiliate referral is currently ineligible.');
      throw error;
    }
  }
  async refund(orderId: string, status: VerifiedRefundStatus) {
    if (!['refund','partial_refund'].includes(status.transaction_status ?? '')) return false;
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment || Number(status.gross_amount) !== payment.amount) throw new BadRequestException('Verified refund amount does not match payment.');
    const refund = status.transaction_status === 'refund' ? payment.amount : Number(status.refund_amount);
    if (!Number.isSafeInteger(refund) || refund < 0 || refund > payment.amount) throw new BadRequestException('Invalid verified refund total.');
    await this.prisma.$executeRaw`SELECT affiliate_refund(${orderId},${refund}::integer)`;
    return true;
  }
}
