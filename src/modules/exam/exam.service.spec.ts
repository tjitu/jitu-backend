import { Test, TestingModule } from '@nestjs/testing';
import { ExamService } from './exam.service';
import { PrismaService } from '../../prisma.service';

const prismaMock = {
  $queryRaw: jest.fn().mockResolvedValue([
    { id: 'tryout-1', curationStatus: 'PUBLISHED' },
  ]),
  subtest: {
    findMany: jest.fn(),
  },
  tryOutAttempt: {
    findFirst: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },

  questionItem: {
    findUnique: jest.fn(),
  },
  question: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },

  userAnswer: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  },
};

describe('ExamService', () => {
  let service: ExamService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamService,

        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<ExamService>(ExamService);

    jest.clearAllMocks();
  });

  describe('startExam', () => {
    it('should resume existing attempt if found', async () => {
      const mockAttempt = { id: 'attempt-1', status: 'IN_PROGRESS' };

      prismaMock.tryOutAttempt.findFirst.mockResolvedValue(mockAttempt);

      const result = await service.startExam('tryout-1', 'user-1');

      expect(prismaMock.tryOutAttempt.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', tryOutId: 'tryout-1' },
        orderBy: { startedAt: 'desc' },
      });

      expect(result).toEqual(mockAttempt);
    });

    it('should throw if user has not registered the tryout', async () => {
      prismaMock.tryOutAttempt.findFirst.mockResolvedValue(null);

      await expect(service.startExam('tryout-1', 'user-1')).rejects.toThrow(
        'Anda belum terdaftar di tryout ini. Silakan daftar terlebih dahulu.',
      );
      expect(prismaMock.tryOutAttempt.create).not.toHaveBeenCalled();
    });

    it('should mark a registered NOT_STARTED attempt as IN_PROGRESS', async () => {
      const attempt = { id: 'attempt-2', status: 'NOT_STARTED' };
      const updatedAttempt = { ...attempt, status: 'IN_PROGRESS' };
      prismaMock.subtest.findMany.mockResolvedValue([
        { order: 1, _count: { questions: 4 } },
      ]);
      prismaMock.tryOutAttempt.findFirst.mockResolvedValue(attempt);
      prismaMock.tryOutAttempt.update.mockResolvedValue(updatedAttempt);

      const result = await service.startExam('tryout-1', 'user-1');

      expect(prismaMock.tryOutAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-2' },
        data: {
          status: 'IN_PROGRESS',
          startedAt: expect.any(Date),
          subtestStartedAt: expect.any(Date),
          currentSubtestOrder: 1,
        },
      });
      expect(prismaMock.subtest.findMany).toHaveBeenCalledWith({
        where: { tryOutId: 'tryout-1' },
        orderBy: { order: 'asc' },
        include: { _count: { select: { questions: true } } },
      });
      expect(result).toEqual(updatedAttempt);
    });
  });

  describe('saveAnswer', () => {
    beforeEach(() => {
      prismaMock.tryOutAttempt.findUnique.mockResolvedValue({
        id: 'attempt-1',
        userId: 'user-1',
        tryOutId: 'tryout-1',
        currentSubtestOrder: 1,
        status: 'IN_PROGRESS',
      });
      prismaMock.question.findFirst.mockResolvedValue({ id: 'q-1' });
    });

    it('should save selected item without grading immediately', async () => {
      prismaMock.questionItem.findUnique.mockResolvedValue({
        id: 'opt-B',
        questionId: 'q-1',
        isCorrect: true,
      });

      const mockSavedAnswer = { id: 'ans-1', isCorrect: false };

      prismaMock.userAnswer.upsert.mockResolvedValue(mockSavedAnswer);

      const result = await service.saveAnswer('attempt-1', 'user-1', 'q-1', 'opt-B');

      expect(prismaMock.userAnswer.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            isCorrect: false,
            questionItemId: 'opt-B',
          }),

          update: expect.objectContaining({
            questionItemId: 'opt-B',
          }),
        }),
      );

      expect(result.isCorrect).toBe(false);
    });

    it('does not save answers to another user\'s attempt', async () => {
      prismaMock.tryOutAttempt.findUnique.mockResolvedValue({
        id: 'attempt-1',
        userId: 'another-user',
        status: 'IN_PROGRESS',
      });

      await expect(
        service.saveAnswer('attempt-1', 'user-1', 'q-1', 'opt-B'),
      ).rejects.toThrow('Kamu tidak memiliki akses ke sesi tryout ini.');
      expect(prismaMock.userAnswer.upsert).not.toHaveBeenCalled();
    });

    it('rejects answer options belonging to another question', async () => {
      prismaMock.questionItem.findUnique.mockResolvedValue({
        id: 'opt-B',
        questionId: 'q-2',
      });

      await expect(
        service.saveAnswer('attempt-1', 'user-1', 'q-1', 'opt-B'),
      ).rejects.toThrow('Pilihan jawaban tidak valid untuk soal q-1.');
      expect(prismaMock.userAnswer.upsert).not.toHaveBeenCalled();
    });

    it('should throw if attempt is already finished', async () => {
      prismaMock.tryOutAttempt.findUnique.mockResolvedValue({
        id: 'attempt-1',
        userId: 'user-1',
        status: 'FINISHED',
      });

      await expect(
        service.saveAnswer('attempt-1', 'user-1', 'q-1', 'opt-A'),
      ).rejects.toThrow('Ujian sudah selesai, tidak bisa menyimpan jawaban.');
      expect(prismaMock.userAnswer.upsert).not.toHaveBeenCalled();
    });

    it('should throw error if question item invalid', async () => {
      prismaMock.questionItem.findUnique.mockResolvedValue(null);

      await expect(
        service.saveAnswer('attempt-1', 'user-1', 'q-1', 'invalid-opt'),
      ).rejects.toThrow('Pilihan jawaban tidak valid untuk soal q-1.');
    });
  });

  describe('finishExam', () => {
    it('should grade all answers and update attempt status to FINISHED', async () => {
      prismaMock.tryOutAttempt.findUnique.mockResolvedValue({
        userId: 'user-1',
        status: 'IN_PROGRESS',
      });
      const finishedAttempt = {
        id: 'attempt-1',
        status: 'FINISHED',
        totalScore: 2,
      };

      prismaMock.userAnswer.findMany.mockResolvedValue([
        {
          id: 'ans-1',
          questionId: 'q-1',
          questionItemId: 'opt-B',
          inputText: null,
          question: { points: 2 },
        },
        {
          id: 'ans-2',
          questionId: 'q-2',
          questionItemId: 'opt-A',
          inputText: null,
          question: { points: 2 },
        },
      ]);
      prismaMock.questionItem.findUnique
        .mockResolvedValueOnce({ isCorrect: true })
        .mockResolvedValueOnce({ isCorrect: false });

      prismaMock.tryOutAttempt.update.mockResolvedValue(finishedAttempt);

      const result = await service.finishExam('attempt-1', 'user-1');

      expect(prismaMock.userAnswer.findMany).toHaveBeenCalledWith({
        where: { tryOutAttemptId: 'attempt-1' },
        include: { question: true },
      });
      expect(prismaMock.userAnswer.update).toHaveBeenNthCalledWith(1, {
        where: { id: 'ans-1' },
        data: { isCorrect: true },
      });
      expect(prismaMock.userAnswer.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'ans-2' },
        data: { isCorrect: false },
      });

      expect(prismaMock.tryOutAttempt.update).toHaveBeenCalledWith({
        where: { id: 'attempt-1' },

        data: {
          status: 'FINISHED',
          totalScore: 2,
          finishedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(finishedAttempt);
    });

    it('does not finish another user\'s attempt', async () => {
      prismaMock.tryOutAttempt.findUnique.mockResolvedValue({
        userId: 'another-user',
        status: 'IN_PROGRESS',
      });

      await expect(service.finishExam('attempt-1', 'user-1')).rejects.toThrow(
        'Kamu tidak memiliki akses ke sesi tryout ini.',
      );
      expect(prismaMock.userAnswer.findMany).not.toHaveBeenCalled();
    });
  });

  describe('startSubtest', () => {
    it('rejects attempts to skip a populated subtest', async () => {
      prismaMock.tryOutAttempt.findUnique.mockResolvedValue({
        id: 'attempt-1',
        userId: 'user-1',
        tryOutId: 'tryout-1',
        currentSubtestOrder: 1,
        status: 'IN_PROGRESS',
      });
      prismaMock.subtest.findMany.mockResolvedValue([
        { order: 2, _count: { questions: 5 } },
        { order: 3, _count: { questions: 5 } },
      ]);

      await expect(service.startSubtest('attempt-1', 3, 'user-1')).rejects.toThrow(
        'Kamu hanya bisa melanjutkan ke subtes berikutnya.',
      );
      expect(prismaMock.tryOutAttempt.update).not.toHaveBeenCalled();
    });
  });
});
