import { Test, TestingModule } from '@nestjs/testing';
import { ShopService } from './shop.service';
import { PrismaService } from '../../prisma.service';
import { ConfigService } from '@nestjs/config';
import { MidtransService } from './services/midtrans.service'; // Import MidtransService
import { BadRequestException } from '@nestjs/common';
import { AffiliatePricingService } from './services/affiliate-pricing.service';

// --- MOCK CONSTANTS ---
const MOCK_USER_ID = 'user-123';
const MOCK_TX_ID = 'tx-abc-123';
const MOCK_QRIS_STATIC =
  '00020101021126570014ID.LINKAJA.WWW0118936009153355276600021520090815335527660303UMI51440014ID.OR.Q-RIS.WWW0215ID10200211756470303UMI5204581253033605802ID5919JITU STORE TESTING6012KOTA JAKARTA61051211063042A25';

describe('ShopService', () => {
  let service: ShopService;
  let prismaService: PrismaService;
  let configService: ConfigService;
  let midtransService: MidtransService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopService,
        { provide: AffiliatePricingService,useValue: { quote: jest.fn().mockResolvedValue(null),refund: jest.fn().mockResolvedValue(false) } },
        {
          provide: PrismaService,
          useValue: {
            payment: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              findMany: jest.fn(),
            },
            tokenPackage: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
            },
            user: {
              update: jest.fn(),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(MOCK_QRIS_STATIC),
          },
        },
        {
          provide: MidtransService, // Mock MidtransService
          useValue: {
            generateQris: jest.fn((nominal, txId) => {
               // Simple mock implementation returning string containing expected values
               return `MOCK_QRIS_${nominal}_${txId}_CRC`;
            }),
            createEWalletCharge: jest.fn(),
            verifySignature: jest.fn(),
            mapTransactionStatus: jest.fn(),
            getTransactionStatus: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ShopService>(ShopService);
    prismaService = module.get<PrismaService>(PrismaService);
    configService = module.get<ConfigService>(ConfigService);
    midtransService = module.get<MidtransService>(MidtransService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTokenTransaction', () => {
    it('should create a transaction and return dynamic QRIS', async () => {
      // Mock data paket
      const mockPackage = {
          id: 'pkg-1',
          name: 'Paket 1',
          price: 99000,
          tokenAmount: 10,
          isActive: true
      };
      
      // Mock data transaksi yang dibuat
      const mockTx = {
        id: MOCK_TX_ID,
        userId: MOCK_USER_ID,
        tokenPackageId: mockPackage.id,
        orderId: 'ORDER-123',
        amount: mockPackage.price,
        tokenAmount: mockPackage.tokenAmount,
        status: 'PENDING',
        paymentMethod: 'QRIS_STATIC',
        createdAt: new Date(),
      };

      jest.spyOn(prismaService.tokenPackage as any, 'findUnique').mockResolvedValue(mockPackage);
      jest.spyOn(prismaService.payment as any, 'create').mockResolvedValue(mockTx);
      jest.spyOn(midtransService, 'generateQris').mockReturnValue('540599000...6210ORDER-123...010212');

      // Panggil fungsi
      const result = await service.createTokenTransaction(MOCK_USER_ID, mockPackage.id);

      // Verifikasi:
      expect(prismaService.payment.create).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({
              amount: 99000,
              userId: MOCK_USER_ID,
              status: 'PENDING'
          })
      }));

      // Check result properties directly
      expect(result.qris).toContain('540599000');
      expect(result.qris).toContain('6210ORDER-123');
      expect(result.qris).toContain('010212');
      expect(result.amount).toBe(99000);
    });

    it('should throw BadRequestException if package is invalid', async () => {
      jest.spyOn(prismaService.tokenPackage as any, 'findUnique').mockResolvedValue(null);
      await expect(
        service.createTokenTransaction(MOCK_USER_ID, 'invalid-pkg-id'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
