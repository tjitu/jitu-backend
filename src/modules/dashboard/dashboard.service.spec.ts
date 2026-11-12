import { Test, TestingModule } from '@nestjs/testing';
import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../prisma.service';
import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';
import { BadRequestException } from '@nestjs/common';
// Gunakan path relatif ke generated prisma client
import { TryoutStatus } from '../../../generated/prisma/enums';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
    },
  },
}));

jest.mock('streamifier', () => ({
  createReadStream: jest.fn(),
}));

const prismaMock = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  tryOutAttempt: {
    findFirst: jest.fn(),
    aggregate: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  dailyQuestionLog: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  question: {
    count: jest.fn(),
    findFirst: jest.fn(),
  },
  questionItem: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn((callback) =>
    callback({
      dailyQuestionLog: {
        create: prismaMock.dailyQuestionLog.create,
      },
      user: {
        update: prismaMock.user.update,
      },
    }),
  ),
};

describe('DashboardService', () => {
  let service: DashboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<DashboardService>(DashboardService);
    jest.clearAllMocks();
  });

  // ... (Test updateProfile dan getUserStats yang sudah ada tetap di sini)
  describe('updateProfile', () => {
    it('should update profile without image', async () => {
      const userId = 'user-1';
      const payload = { name: 'New Name', target: 'UGM' };

      prismaMock.user.update.mockResolvedValue({
        id: userId,
        ...payload,
        email: 'test@test.com',
        image: null,
        updatedAt: new Date(),
      });

      const result = await service.updateProfile(userId, payload);

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: payload,
        select: expect.any(Object),
      });
      expect(result.name).toBe('New Name');
      expect(result.target).toBe('UGM');
    });

    it('should upload image and update profile', async () => {
      const userId = 'user-1';
      const payload = { name: 'New Name' };
      const mockFile = {
        buffer: Buffer.from('fake-image'),
      } as Express.Multer.File;

      const mockUrl = 'https://cloudinary.com/image.jpg';

      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (options, callback) => {
          callback(null, { secure_url: mockUrl });
          return {}; // dummy stream
        },
      );

      (streamifier.createReadStream as jest.Mock).mockReturnValue({
        pipe: jest.fn(),
      });

      prismaMock.user.update.mockResolvedValue({
        id: userId,
        name: payload.name,
        image: mockUrl,
        email: 'test@test.com',
        target: 'Bismillah Lolos UTBK 2029',
        updatedAt: new Date(),
      });

      const result = await service.updateProfile(userId, payload, mockFile);

      expect(cloudinary.uploader.upload_stream).toHaveBeenCalled();
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: { ...payload, image: mockUrl },
        select: expect.any(Object),
      });
      expect(result.image).toBe(mockUrl);
    });

    it('should throw BadRequestException if upload fails', async () => {
      const userId = 'user-1';
      const payload = {};
      const mockFile = {
        buffer: Buffer.from('fake-image'),
      } as Express.Multer.File;

      (cloudinary.uploader.upload_stream as jest.Mock).mockImplementation(
        (options, callback) => {
          callback(new Error('Cloudinary Error'), null);
          return {};
        },
      );

      (streamifier.createReadStream as jest.Mock).mockReturnValue({
        pipe: jest.fn(),
      });

      await expect(
        service.updateProfile(userId, payload, mockFile),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getUserStats', () => {
    it('should return correct calculated stats when user has activity', async () => {
      const userId = 'user-active';

      prismaMock.tryOutAttempt.findFirst.mockResolvedValue({ totalScore: 750 });
      prismaMock.tryOutAttempt.aggregate.mockResolvedValue({
        _max: { totalScore: 800 },
      });
      prismaMock.tryOutAttempt.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(5);
      prismaMock.user.findUnique.mockResolvedValue({
        tokenBalance: 12,
        currentStreak: 4,
      });

      const result = await service.getUserStats(userId);

      expect(result).toEqual({
        lastScore: 750,
        personalBest: 800,
        weeklyActivity: 3,
        totalFinished: 5,
        tokenBalance: 12,
        currentStreak: 4,
        isPremium: false,
        premiumExpiresAt: null,
      });
    });

    it('should return zero stats for new user', async () => {
      const userId = 'user-new';

      prismaMock.tryOutAttempt.findFirst.mockResolvedValue(null);
      prismaMock.tryOutAttempt.aggregate.mockResolvedValue({
        _max: { totalScore: null },
      });
      prismaMock.tryOutAttempt.count.mockResolvedValue(0);
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await service.getUserStats(userId);

      expect(result).toEqual({
        lastScore: 0,
        personalBest: 0,
        weeklyActivity: 0,
        totalFinished: 0,
        tokenBalance: 0,
        currentStreak: 0,
        isPremium: false,
        premiumExpiresAt: null,
      });
    });
  });

  describe('getDailyQuestion', () => {
    it('should return isCompleted=true if user already answered today', async () => {
      const userId = 'user-1';
      // Mock existing log
      prismaMock.dailyQuestionLog.findFirst.mockResolvedValue({ id: 'log-1' });
      // Mock user streak
      prismaMock.user.findUnique.mockResolvedValue({ currentStreak: 5 });

      const result = await service.getDailyQuestion(userId);

      expect(result).toEqual({
        isCompleted: true,
        streak: 5,
        question: null,
      });
      expect(prismaMock.dailyQuestionLog.findFirst).toHaveBeenCalled();
    });

    it('should return a random question if user has not answered today', async () => {
      const userId = 'user-1';
      // Mock no existing log
      prismaMock.dailyQuestionLog.findFirst.mockResolvedValue(null);
      prismaMock.user.findUnique.mockResolvedValue({ currentStreak: 5 });

      // Mock Question Data
      prismaMock.question.count.mockResolvedValue(100);
      prismaMock.question.findFirst.mockResolvedValue({
        id: 'q-1',
        content: 'Apa ibukota Indonesia?',
        items: [
          { id: 'opt-1', content: 'Jakarta' },
          { id: 'opt-2', content: 'Bandung' },
        ],
      });

      const result = await service.getDailyQuestion(userId);

      expect(result).toEqual({
        isCompleted: false,
        streak: 5,
        question: {
          id: 'q-1',
          content: 'Apa ibukota Indonesia?',
          options: [
            { id: 'opt-1', content: 'Jakarta' },
            { id: 'opt-2', content: 'Bandung' },
          ],
        },
      });
      expect(prismaMock.question.findFirst).toHaveBeenCalled();
    });
  });

  describe('answerDailyQuestion', () => {
    it('should increase streak if answer is correct', async () => {
      const userId = 'user-1';
      const payload = { questionId: 'q-1', answerId: 'opt-correct' };

      // Mock correct answer
      prismaMock.questionItem.findUnique.mockResolvedValue({
        id: 'opt-correct',
        questionId: 'q-1',
        isCorrect: true,
      });

      // Mock user data
      prismaMock.user.findUnique.mockResolvedValue({
        id: userId,
        currentStreak: 5,
      });

      const result = await service.answerDailyQuestion(userId, payload);

      expect(result.isCorrect).toBe(true);
      expect(result.newStreak).toBe(6);

      // Verify DB Updates
      expect(prismaMock.dailyQuestionLog.create).toHaveBeenCalled();
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: expect.objectContaining({ currentStreak: 6 }),
      });
    });

    it('should reset streak to 0 if answer is incorrect', async () => {
      const userId = 'user-1';
      const payload = { questionId: 'q-1', answerId: 'opt-wrong' };

      // Mock wrong answer
      prismaMock.questionItem.findUnique.mockResolvedValue({
        id: 'opt-wrong',
        questionId: 'q-1',
        isCorrect: false,
      });

      // Mock correct answer lookup for feedback
      prismaMock.questionItem.findFirst.mockResolvedValue({
        id: 'opt-correct',
        isCorrect: true,
      });

      prismaMock.user.findUnique.mockResolvedValue({
        id: userId,
        currentStreak: 5,
      });

      const result = await service.answerDailyQuestion(userId, payload);

      expect(result.isCorrect).toBe(false);
      expect(result.newStreak).toBe(0);
      expect(result.correctAnswerId).toBe('opt-correct');

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: userId },
        data: expect.objectContaining({ currentStreak: 0 }),
      });
    });
  });

  describe('getScoreHistory', () => {
    it('should return score history with correct subtest aggregation', async () => {
      const userId = 'user-test';
      const mockAttempts = [
        {
          totalScore: 500,
          finishedAt: new Date(),
          tryOut: { code: 1 },
          answers: [
            {
              isCorrect: true,
              question: { points: 10, subtest: { name: 'PU' } },
            },
            {
              isCorrect: true,
              question: { points: 10, subtest: { name: 'PPU' } },
            },
            {
              isCorrect: true,
              question: { points: 10, subtest: { name: 'PBM' } },
            },
            {
              isCorrect: true,
              question: { points: 10, subtest: { name: 'PK' } },
            },
            {
              isCorrect: true,
              question: { points: 10, subtest: { name: 'LBI' } },
            },
            {
              isCorrect: true,
              question: { points: 10, subtest: { name: 'LBE' } },
            },
            {
              isCorrect: true,
              question: { points: 10, subtest: { name: 'PM' } },
            },
          ],
        },
      ];

      prismaMock.tryOutAttempt.findMany.mockResolvedValue(mockAttempts);

      const result = await service.getScoreHistory(userId);

      expect(result[0]).toEqual(
        expect.objectContaining({
          to: 'TO 1',
          total: 500,
          pu: 10,
          ppu: 10,
          pbm: 10,
          pk: 10,

          lbi: 10,
          lbe: 10,
          pm: 10,
        }),
      );
    });

    it('should return empty array if no finished attempts found', async () => {
      prismaMock.tryOutAttempt.findMany.mockResolvedValue([]);

      const result = await service.getScoreHistory('user-no-history');

      expect(result).toEqual([]);
    });
  });

  describe('getActiveTryouts', () => {
    it('should return active tryouts with correct progress and participant count', async () => {
      const userId = 'user-active-to';
      const mockDate = new Date();

      const mockActiveAttempts = [
        {
          tryOut: {
            id: 'to-1',
            title: 'Try Out SNBT 1',
            code: 1,
            batch: 'SNBT',
            scheduledStart: mockDate,
            subtests: [{ id: 'sub-1' }, { id: 'sub-2' }, { id: 'sub-3' }],
            _count: { attempts: 150 },
          },
          answers: [
            { question: { subtestId: 'sub-1' } },
            { question: { subtestId: 'sub-1' } },
            { question: { subtestId: 'sub-2' } },
          ],
        },
      ];

      prismaMock.tryOutAttempt.findMany.mockResolvedValue(mockActiveAttempts);

      const result = await service.getActiveTryouts(userId);

      expect(prismaMock.tryOutAttempt.findMany).toHaveBeenCalledWith({
        where: { userId, status: 'IN_PROGRESS' },
        include: expect.any(Object),
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'to-1',
        title: 'Try Out SNBT 1',
        code: 1,
        batch: 'SNBT',
        participants: 150,
        progress: 2, // sub-1 and sub-2
        totalSubtests: 3,
        endDate: mockDate,
      });
    });

    it('should return empty array if no active tryouts found', async () => {
      prismaMock.tryOutAttempt.findMany.mockResolvedValue([]);

      const result = await service.getActiveTryouts('user-idle');

      expect(result).toEqual([]);
    });
  });
});
