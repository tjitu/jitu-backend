import { Test, TestingModule } from '@nestjs/testing';
import { TryoutService } from './tryout.service';
import { PrismaService } from '../../prisma.service';
import { ExamService } from '../exam/exam.service';

const prismaMock = {
  $transaction: jest.fn(),
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
    findUnique: jest.fn(),
  },
  subtest: { findFirst: jest.fn() },
  question: { findMany: jest.fn() },
  user: {
    findUnique: jest.fn().mockResolvedValue(null),
  },
  userAnswer: {
    findMany: jest.fn(),
  },
};

describe('TryoutService', () => {
  let service: TryoutService;

  it.each([new Date('2999-01-01'), null])('withholds finished exam questions before release (%s)', async scheduledEnd => {
    prismaMock.subtest.findFirst.mockResolvedValue({ id: 'sub', order: 1 });
    prismaMock.tryOutAttempt.findUnique.mockResolvedValue({
      id: 'attempt', userId: 'student', tryOutId: 'tryout', status: 'FINISHED', tryOut: { scheduledEnd },
    });
    await expect(service.getSubtestQuestions('tryout', 1, 'student', 'attempt'))
      .rejects.toMatchObject({ response: { code: 'TRYOUT_REVIEW_NOT_RELEASED' } });
    expect(prismaMock.question.findMany).not.toHaveBeenCalled();
  });

  it.each([
    ['student', new Date('2020-01-01')],
    ['sandbox', new Date('2999-01-01')],
  ] as const)('allows released review or sandbox QC for %s', async (userId, scheduledEnd) => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: 'sandbox', curationStatus: 'PUBLISHED', questionsReleased: true }]);
    prismaMock.subtest.findFirst.mockResolvedValue({ id: 'sub', order: 1, durationMinutes: 30 });
    prismaMock.tryOutAttempt.findUnique.mockResolvedValue({
      id: 'attempt', tryOutId: 'tryout', userId, status: 'FINISHED', startedAt: new Date(), tryOut: { scheduledEnd },
    });
    prismaMock.tryOut.findUnique.mockResolvedValue({ solutionPrice: 0, subtests: [] });
    prismaMock.question.findMany.mockResolvedValue([]);
    await expect(service.getSubtestQuestions('tryout', 1, userId, 'attempt')).resolves.toMatchObject({ isReviewMode: true });
  });

  it('rejects direct question and review access for a reset attempt', async () => {
    prismaMock.subtest.findFirst.mockResolvedValue({ id: 'subtest-1', order: 1 });
    prismaMock.tryOutAttempt.findUnique.mockResolvedValue({ id: 'attempt-1', userId: 'user-1', tryOutId: 'tryout-1', status: 'NOT_STARTED' });
    await expect(service.getSubtestQuestions('tryout-1', 1, 'user-1', 'attempt-1')).rejects.toThrow('Tryout belum dimulai');
  });

  it('rejects a direct exam request before the start time', async () => {
    prismaMock.subtest.findFirst.mockResolvedValue({ id: 'subtest-1', order: 1 });
    prismaMock.tryOutAttempt.findUnique.mockResolvedValue({ id: 'attempt-1', userId: 'user-1', tryOutId: 'tryout-1', status: 'IN_PROGRESS', tryOut: { scheduledStart: new Date('2999-01-01T00:00:00Z') } });
    await expect(service.getSubtestQuestions('tryout-1', 1, 'user-1', 'attempt-1')).rejects.toMatchObject({ response: { code: 'TRYOUT_NOT_STARTED' } });
  });

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
    prismaMock.$transaction.mockReset();
    prismaMock.tryOut.findMany.mockClear();
    prismaMock.tryOut.findUnique.mockClear();
    prismaMock.tryOutAttempt.findFirst.mockClear();
    prismaMock.userAnswer.findMany.mockClear();
    prismaMock.user.findUnique.mockResolvedValue(null);
  });

  describe('leaderboard release', () => {
    it.each([null, new Date('2099-01-01T00:00:00Z')])(
      'rejects requests before a scheduled end (%s)', async (scheduledEnd) => {
        prismaMock.tryOut.findUnique.mockResolvedValue({ scheduledEnd, solutionPrice: 0 });
        await expect(service.getLeaderboard('tryout-1', 'user-1')).rejects.toThrow();
      },
    );
  });

  describe('registerTryout', () => {
    const setup = (price: number) => {
      prismaMock.tryOut.findUnique.mockResolvedValue({
        id: 'tryout-1', solutionPrice: price, scheduledEnd: null,
      });
      prismaMock.$queryRaw.mockResolvedValue([{
        curationStatus: 'PUBLISHED', questionsReleased: true, breakSeconds: 60,
      }]);
      const tx = {
        $queryRaw: jest.fn()
          .mockResolvedValueOnce([{ id: 'user-1' }])
          .mockResolvedValueOnce([{ solutionPrice: price }]),
        tryOutAttempt: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
        },
        unlockedSolution: {
          findFirst: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockResolvedValue({ id: 'unlock-1' }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ isPremium: false, premiumExpiresAt: null }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        tokenTransaction: { create: jest.fn().mockResolvedValue({ id: 'tx-1' }) },
      };
      prismaMock.$transaction.mockImplementation((callback) => callback(tx));
      return tx;
    };

    it('registers the free mode without spending coin', async () => {
      const tx = setup(3);
      const result = await service.registerTryout('user-1', 'tryout-1', undefined, 'FREE', 3);
      expect(result.attemptId).toBe('attempt-1');
      expect(result.isPremium).toBe(false);
      expect(tx.user.updateMany).not.toHaveBeenCalled();
      expect(tx.unlockedSolution.create).not.toHaveBeenCalled();
    });

    it('charges the confirmed price and unlocks atomically in premium mode', async () => {
      const tx = setup(3);
      const result = await service.registerTryout('user-1', 'tryout-1', undefined, 'PREMIUM', 3);
      expect(result.isPremium).toBe(true);
      expect(tx.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', tokenBalance: { gte: 3 } },
        data: { tokenBalance: { decrement: 3 } },
      });
      expect(tx.tokenTransaction.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', amount: -3, type: 'PURCHASE_SOLUTION', referenceId: 'tryout-1' },
      });
      expect(tx.unlockedSolution.create).toHaveBeenCalledTimes(1);
    });
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

    it('does not expose unpublished tryouts to a token without sandbox access', async () => {
      prismaMock.$queryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { id: 'cku1tryout1', curationStatus: 'QC_SANDBOX' },
          { id: 'cku1tryout2', curationStatus: 'DRAFT' },
        ]);
      prismaMock.tryOut.findMany.mockResolvedValue(mockTryoutsComplete);

      const result = await service.getTryouts(undefined, 'a'.repeat(64));

      expect(result.map((tryout) => tryout.id)).toEqual([]);
      expect(prismaMock.tryOut.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isPublic: true },
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
      prismaMock.$queryRaw.mockResolvedValueOnce([]);

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
          _count: { select: { attempts: { where: { userId: { notIn: [] } } } } },
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
        isWaitingTransition: false,
        nextSubtestOrder: null,
        resumeUrl: null,
        latestScore: null,
        resultsAvailable: false,
        correctCount: 0,
        wrongCount: 0,
        emptyCount: 0,
        curationStatus: 'PUBLISHED',
        questionsReleased: true,
        breakSeconds: 60,
        isSandboxPreview: false,
        categories: [
          {
            id: 1,
            name: 'Penalaran Umum',
            questionCount: 3,
            duration: 30,
            isCompleted: false,
            score: undefined,
            correctCount: undefined,
            wrongCount: undefined,
            emptyCount: undefined,
          },
          {
            id: 2,
            name: 'Pengetahuan Kuantitatif',
            questionCount: 2,
            duration: 45,
            isCompleted: false,
            score: undefined,
            correctCount: undefined,
            wrongCount: undefined,
            emptyCount: undefined,
          },
        ],
        benefits: expect.any(Array),
        requirements: expect.any(Array),
      });
    });
  });
});
