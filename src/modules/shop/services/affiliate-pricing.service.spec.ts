import { AffiliatePricingService } from './affiliate-pricing.service';
import { PrismaService } from '../../../prisma.service';

describe('AffiliatePricingService verified refund boundary',() => {
  const prisma = { payment: { findUnique: jest.fn() },$queryRaw: jest.fn(),$executeRaw: jest.fn() };
  const service = new AffiliatePricingService(prisma as unknown as PrismaService);
  beforeEach(() => { jest.clearAllMocks(); prisma.payment.findUnique.mockResolvedValue({ amount: 9350,status: 'CONFIRMED' }); });
  it('ignores non-refund gateway states',async () => {
    expect(await service.refund('order',{ transaction_status: 'pending' })).toBe(false);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('rejects a gross amount mismatch and invalid cumulative total',async () => {
    await expect(service.refund('order',{transaction_status:'refund',gross_amount:'1'})).rejects.toThrow('does not match');
    await expect(service.refund('order',{transaction_status:'partial_refund',gross_amount:'9350',refund_amount:'10000'})).rejects.toThrow('Invalid');
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('passes a verified cumulative partial refund to the atomic database ledger',async () => {
    expect(await service.refund('order',{transaction_status:'partial_refund',gross_amount:'9350',refund_amount:'1000'})).toBe(true);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw.mock.calls[0].slice(1)).toEqual(['order',1000]);
  });
});
