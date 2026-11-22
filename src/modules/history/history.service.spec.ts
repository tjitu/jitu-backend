import { Test, TestingModule } from '@nestjs/testing';
import { HistoryService } from './history.service';
import { PrismaService } from '../../prisma.service';

const prismaMock = {
  tryOutAttempt: {
    findMany: jest.fn(),
  },
};

describe('HistoryService', () => {
  let service: HistoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HistoryService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get<HistoryService>(HistoryService);
    jest.clearAllMocks();
  });

  describe('getHistoryTryouts', () => {
    it('should return history with correct calculations', async () => {
      const userId = 'user-test';
      // Mock Start: 10:00, End: 11:30 (Durasi 90 menit)
      const startDate = new Date('2024-01-01T10:00:00Z');
      const endDate = new Date('2024-01-01T11:30:00Z');

      const mockAttempts = [
        {
          id: 'attempt-1',
          startedAt: startDate,
          finishedAt: endDate,
          totalScore: 750,
          tryOut: {
            id: 'to-1',
            title: 'Try Out SNBT 1',
            batch: 'SNBT',
            scheduledEnd: new Date('2024-01-01T12:00:00Z'),
            subtests: [
              { questions: [{}, {}, {}] }, // Subtest 1: 3 soal
              { questions: [{}, {}] }, // Subtest 2: 2 soal (Total 5 soal)
            ],
          },
          answers: [
            // Jawaban Benar (PU) -> Poin 20
            {
              isCorrect: true,
              question: { points: 20, subtest: { name: 'PU' } },
            },
            // Jawaban Benar (PBM) -> Poin 30
            {
              isCorrect: true,
              question: { points: 30, subtest: { name: 'PBM' } },
            },
            // Jawaban Salah (PK) -> Poin 0 (walaupun soal bernilai 50)
            {
              isCorrect: false,
              question: { points: 50, subtest: { name: 'PK' } },
            },
          ],
        },
      ];

      prismaMock.tryOutAttempt.findMany.mockResolvedValue(mockAttempts);

      const result = await service.getHistoryTryouts(userId);

      expect(prismaMock.tryOutAttempt.findMany).toHaveBeenCalledWith({
        where: { userId, status: 'FINISHED' },
        orderBy: { finishedAt: 'desc' },
        include: expect.any(Object),
      });

      expect(result).toHaveLength(1);
      const history = result[0];

      // Verifikasi Data Dasar
      expect(history.id).toBe('to-1');
      expect(history.title).toBe('Try Out SNBT 1');
      expect(history.score).toBe(750);
      expect(history.category).toBe('SNBT');
      expect(history.status).toBe('selesai');

      // Verifikasi Kalkulasi Durasi
      // 90 menit (beda waktu 10:00 - 11:30)
      expect(history.duration).toBe('90 Menit');

      // Verifikasi Total Soal & Jawaban
      expect(history.totalQuestions).toBe(5); // 3 + 2
      expect(history.questionsAnswered).toBe(3); // Panjang array answers

      // Verifikasi Breakdown Skor
      expect(history.breakdown).toEqual({
        pu: 20, // Benar
        ppu: 0, // Tidak ada jawaban
        pbm: 30, // Benar
        pk: 0, // Salah (poin tidak dihitung)
        lbi: 0,
        lbe: 0,
        pm: 0,
      });
    });

    it('should return empty array if no history found', async () => {
      prismaMock.tryOutAttempt.findMany.mockResolvedValue([]);

      const result = await service.getHistoryTryouts('user-none');

      expect(result).toEqual([]);
    });
  });
});
