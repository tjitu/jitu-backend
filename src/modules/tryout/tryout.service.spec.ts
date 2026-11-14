import { Test, TestingModule } from '@nestjs/testing';
import { TryoutService } from './tryout.service';
import { PrismaService } from '../../prisma.service';
import { ExamService } from '../exam/exam.service';

const prismaMock = {
  $queryRaw: jest.fn().mockResolvedValue([
    { id: 'cku1tryout1', curationStatus: 'PUBLISHED' },
    { id: 'cku1tryout2', curationStatus: 'PUBLISHED' },
  ]),
  tryOut: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  tryOutAttempt: {
    findFirst: jest.fn(),
  },
  user: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
  userAnswer: {
    findMany: jest.fn(),
  },
};

describe('TryoutService', () => {
  let service: TryoutService;

  const mockTryoutsComplete = [
    {
      id: 'cku1tryout1',
      code: 1,
      title: 'Try Out UTBK SNBT 1',
      batch: 'SNBT',
      description: 'Simulasi UTBK SNBT lengkap',
      solutionPrice: 0,
      isPublic: true,
      referralCode: null,
      scheduledStart: new Date('2025-01-10T08:00:00Z'),
      createdAt: new Date(),
      subtests: [
        {
          order: 1,
          name: 'Penalaran Umum',
          durationMinutes: 30,
          questions: [{}, {}, {}], // 3 questions
        },
        {
          order: 2,
          name: 'Pengetahuan Kuantitatif',
          durationMinutes: 45,
          questions: [{}, {}], // 2 questions
        },
      ],
      attempts: [],
      unlockedSolutions: [],
      _count: {
        attempts: 10,
      },
    },
    {
      id: 'cku1tryout2',
      code: 2,
      title: 'Try Out UTBK SNBT 2',
      batch: 'SNBT',
      description: 'Try out lanjutan',
      solutionPrice: 30000,
      isPublic: true,
      referralCode: null,
      scheduledStart: new Date('2025-01-17T08:00:00Z'),
      createdAt: new Date(),
      subtests: [],
      attempts: [],
      unlockedSolutions: [],
      _count: {
        attempts: 5,
      },
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TryoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: ExamService, useValue: {} },
      ],
    }).compile();

    service = module.get<TryoutService>(TryoutService);

    prismaMock.$queryRaw.mockReset().mockResolvedValue([
      { id: 'cku1tryout1', curationStatus: 'PUBLISHED' },
      { id: 'cku1tryout2', curationStatus: 'PUBLISHED' },
    ]);
    prismaMock.tryOut.findMany.mockClear();
    prismaMock.tryOut.findUnique.mockClear();
    prismaMock.tryOutAttempt.findFirst.mockClear();
    prismaMock.userAnswer.findMany.mockClear();
    prismaMock.user.findUnique.mockResolvedValue(null);
  });

  describe('getTryouts', () => {
    it('should return mapped tryouts with correct format', async () => {
      prismaMock.tryOut.findMany.mockResolvedValue(mockTryoutsComplete);

      const result = await service.getTryouts();

      expect(prismaMock.tryOut.findMany).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);

      // Verifikasi Item 1
      expect(result[0]).toEqual({
        id: 'cku1tryout1', // Sekarang string CUID
        title: 'Try Out UTBK SNBT 1',
        number: '1',
        canEdit: false,
        participants: 10, // Mengambil dari _count.attempts
        badge: 'SNBT',
        description: 'Simulasi UTBK SNBT lengkap',
        solutionPrice: 0,
        isPublic: true,
        isSpecial: false,
        isRegistered: false,
        curationStatus: 'PUBLISHED',
        isSandboxPreview: false,
        scheduledStart: '2025-01-10T08:00:00.000Z',
        scheduledEnd: null,
      });

      // Verifikasi Item 2
      expect(result[1]).toEqual({
        id: 'cku1tryout2', // Sekarang string CUID
        title: 'Try Out UTBK SNBT 2',
        number: '2',
        canEdit: false,
        participants: 5,
        badge: 'SNBT',
        description: 'Try out lanjutan',
        solutionPrice: 30000,
        isPublic: true,
        isSpecial: false,
        isRegistered: false,
        curationStatus: 'PUBLISHED',
        isSandboxPreview: false,
        scheduledStart: '2025-01-17T08:00:00.000Z',
        scheduledEnd: null,
      });
    });

    it('only exposes the unpublished tryout scoped to a preview token', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([{ tryoutId: 'cku1tryout1' }])
        .mockResolvedValueOnce([
          { id: 'cku1tryout1', curationStatus: 'QC_SANDBOX' },
          { id: 'cku1tryout2', curationStatus: 'DRAFT' },
        ]);
      prismaMock.tryOut.findMany.mockResolvedValue(mockTryoutsComplete);

      const result = await service.getTryouts(undefined, 'a'.repeat(64));

      expect(result.map((tryout) => tryout.id)).toEqual(['cku1tryout1']);
      expect(prismaMock.tryOut.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ isPublic: true }, { id: 'cku1tryout1' }] },
        }),
      );
    });
  });

  describe('getTryoutById', () => {
    it('should return detailed tryout DTO', async () => {
      // Ambil item pertama dari array mock sebagai target test
      const targetTryout = mockTryoutsComplete[0];
      prismaMock.tryOut.findUnique.mockResolvedValue(targetTryout);
      prismaMock.tryOutAttempt.findFirst.mockResolvedValue(null);

      const result = await service.getTryoutById('cku1tryout1', 'user123');

      expect(prismaMock.tryOut.findUnique).toHaveBeenCalledWith({
        where: { id: 'cku1tryout1' },
        include: {
          subtests: {
            include: {
              questions: { select: { id: true } },
            },
          },
          attempts: {
            where: { userId: 'user123' },
            select: {
              id: true,
              status: true,
              startedAt: true,
              finishedAt: true,
            },
            orderBy: { startedAt: 'desc' },
          },
          _count: { select: { attempts: true } },
          unlockedSolutions: { where: { userId: 'user123' } },
        },
      });
      expect(prismaMock.tryOutAttempt.findFirst).toHaveBeenCalledTimes(2);

      expect(result).toEqual({
        id: 'cku1tryout1', // CUID
        title: 'Try Out UTBK SNBT 1',
        number: '1',
        badge: 'SNBT',
        participants: 10,
        description: 'Simulasi UTBK SNBT lengkap',
        duration: 75,
        totalQuestions: 5,
        startDate: targetTryout.scheduledStart.toISOString(),
        endDate: '',
        isRegistered: false,
        isFree: true,
        isSpecial: false,
        tokenCost: 0,
        unlockedSolutions: [],
        latestFinishedAttemptId: null,
        latestAttemptStatus: null,
        latestAttemptId: null,
        currentSubtestOrder: 1,
        latestScore: 0,
        curationStatus: 'PUBLISHED',
        isSandboxPreview: false,
        categories: [
          {
            id: 1,
            name: 'Penalaran Umum',
            questionCount: 3,
            duration: 30,
            isCompleted: false,
          },
          {
            id: 2,
            name: 'Pengetahuan Kuantitatif',
            questionCount: 2,
            duration: 45,
            isCompleted: false,
          },
        ],
        benefits: expect.any(Array),
        requirements: expect.any(Array),
      });
    });
  });
});
