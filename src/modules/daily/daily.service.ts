import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  SubmitDailyAnswerDto,
  DailyQuestionResponseDto,
  DailyStreakResponseDto,
  DailyAnswerResponseDto,
} from './dto/daily.dto';

@Injectable()
export class DailyService {
  constructor(private prisma: PrismaService) {}

  async getDailyQuestion(userId: string): Promise<DailyQuestionResponseDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Check if user already answered today
    const existingLog = await this.prisma.dailyQuestionLog.findFirst({
      where: {
        userId,
        completedAt: { gte: today },
      },
      include: {
        question: {
          include: {
            items: {
              orderBy: { order: 'asc' },
            },
          },
        },
      },
    });

    if (existingLog) {
      return {
        alreadyAnswered: true,
        isCorrect: existingLog.isCorrect,
        userAnswer: existingLog.userAnswer || undefined, // Return jawaban user
        question: {
          id: existingLog.question.id,
          type: existingLog.question.type,
          content: existingLog.question.content,
          imageUrl: existingLog.question.imageUrl,
          narration: existingLog.question.narration,
          options: existingLog.question.items.map((item) => ({
            id: item.id,
            content: item.content,
            order: item.order,
          })),
        },
      };
    }

    // Use deterministic selection based on PostgreSQL HASHTEXT function
    // This ensures adding new questions doesn't shift the selection for today.
    // Moved hash logic to SQL to avoid loading all question IDs into memory.
    const dateStr = new Date().toISOString().split('T')[0];

    // Use raw SQL to select question with highest hash (deterministic for the day)
    const selectedQuestion = await this.prisma.$queryRaw<
      Array<{ id: string }>
    >`
      SELECT id FROM "Question"
      ORDER BY ABS(HASHTEXT(id || ${dateStr})) DESC
      LIMIT 1
    `;

    if (!selectedQuestion || selectedQuestion.length === 0) {
      throw new BadRequestException('Tidak ada soal yang tersedia');
    }

    const question = await this.prisma.question.findUnique({
      where: { id: selectedQuestion[0].id },
      include: {
        items: {
          orderBy: { order: 'asc' },
        },
      },
    });

    if (!question) {
      throw new BadRequestException('Tidak ada soal yang tersedia');
    }

    return {
      alreadyAnswered: false,
      question: {
        id: question.id,
        type: question.type,
        content: question.content,
        imageUrl: question.imageUrl,
        narration: question.narration,
        options: question.items.map((item) => ({
          id: item.id,
          content: item.content,
          order: item.order,
        })),
      },
    };
  }

  async getStreak(userId: string): Promise<DailyStreakResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currentStreak: true },
    });

    // Get best streak (max consecutive correct answers)
    const logs = await this.prisma.dailyQuestionLog.findMany({
      where: { userId },
      orderBy: { completedAt: 'asc' },
      select: { isCorrect: true, completedAt: true },
    });

    let bestStreak = 0;
    let tempStreak = 0;
    let lastDate: Date | null = null;

    for (const log of logs) {
      const logDate = new Date(log.completedAt);
      logDate.setHours(0, 0, 0, 0);

      if (lastDate) {
        const expectedDate = new Date(lastDate);
        expectedDate.setDate(expectedDate.getDate() + 1);

        // Check if consecutive day
        if (logDate.getTime() === expectedDate.getTime()) {
          if (log.isCorrect) {
            tempStreak++;
            bestStreak = Math.max(bestStreak, tempStreak);
          } else {
            tempStreak = 0;
          }
        } else {
          // Gap in days, reset
          tempStreak = log.isCorrect ? 1 : 0;
        }
      } else {
        tempStreak = log.isCorrect ? 1 : 0;
      }

      lastDate = logDate;
      bestStreak = Math.max(bestStreak, tempStreak);
    }

    const totalProblemsSolved = await this.prisma.dailyQuestionLog.count({
      where: { userId, isCorrect: true },
    });

    return {
      currentStreak: user?.currentStreak || 0,
      bestStreak,
      totalProblemsSolved,
    };
  }

  async answerDailyQuestion(
    userId: string,
    payload: SubmitDailyAnswerDto,
  ): Promise<DailyAnswerResponseDto> {
    // Check if user already answered today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingLog = await this.prisma.dailyQuestionLog.findFirst({
      where: {
        userId,
        completedAt: { gte: today },
      },
    });

    if (existingLog) {
      throw new BadRequestException('Anda sudah menjawab soal hari ini!');
    }

    // Verify the question exists
    const question = await this.prisma.question.findUnique({
      where: { id: payload.questionId },
      include: {
        items: true,
      },
    });

    if (!question) {
      throw new BadRequestException('Soal tidak ditemukan!');
    }

    let isCorrect = false;

    // Logic Jawaban
    if (question.type === 'ISIAN_SINGKAT') {
      // Untuk isian singkat, bandingkan string jawaban secara cerdas & toleran
      if (!question.correctAnswer) {
        // Fallback safety if DB is missing correct answer
        isCorrect = false;
      } else {
        isCorrect = this.checkShortAnswer(payload.answer, question.correctAnswer);
      }
    } else {
      // Untuk Pilihan Ganda / Benar Salah, cek ID item
      const selectedItem = await this.prisma.questionItem.findUnique({
        where: { id: payload.answer },
      });

      if (!selectedItem || selectedItem.questionId !== payload.questionId) {
        // Jika payload bukan ID valid atau bukan milik soal ini
        throw new BadRequestException('Jawaban tidak valid!');
      }
      isCorrect = selectedItem.isCorrect;
    }

    // Streak Logic
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    const lastDate = user?.lastDailyDate;
    let newStreak = user?.currentStreak || 0;

    // Hitung tanggal kemarin (untuk cek streak continuity)
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    if (isCorrect) {
      if (lastDate) {
        const lastDateNormalized = new Date(lastDate);
        lastDateNormalized.setHours(0, 0, 0, 0);

        // Jika terakhir jawab kemarin -> Streak Lanjut
        if (lastDateNormalized.getTime() === yesterday.getTime()) {
          newStreak += 1;
        } 
        // Jika terakhir jawab hari ini (double check logic) -> Tetap (Harusnya kena block di awal)
        else if (lastDateNormalized.getTime() === today.getTime()) {
           // Do nothing, keep streak
        } 
        // Jika terlewat sehari atau lebih -> Reset jadi 1
        else {
          newStreak = 1;
        }
      } else {
        // Belum pernah jawab -> Streak 1
        newStreak = 1;
      }
    } else {
      // Jawaban salah -> Reset Streak
      newStreak = 0;
    }

    // Save to database
    await this.prisma.$transaction(async (tx) => {
      await tx.dailyQuestionLog.create({
        data: {
          userId,
          questionId: payload.questionId,
          userAnswer: payload.answer, // Simpan jawaban user
          isCorrect,
          completedAt: new Date(),
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          currentStreak: newStreak,
          lastDailyDate: new Date(),
        },
      });
    });

    return {
      success: true,
      isCorrect,
      newStreak,
      explanation: question.explanation || undefined,
      message: isCorrect ? 'Jawaban Anda benar!' : 'Jawaban Anda kurang tepat.',
    };
  }

  private checkShortAnswer(rawUser: string, rawKey: string): boolean {
    if (!rawUser || !rawKey) return false;
    const user = String(rawUser).trim().toLowerCase();
    const key = String(rawKey).trim().toLowerCase();

    // 1. Direct match (case-insensitive & trimmed)
    if (user === key) return true;

    // 2. Strip trailing punctuation (e.g. "42.", "42,", "42;")
    const userNoPunct = user.replace(/[.,;]+$/, '').trim();
    const keyNoPunct = key.replace(/[.,;]+$/, '').trim();
    if (userNoPunct === keyNoPunct) return true;

    // 3. Strip common algebraic prefixes (e.g. "x = 42" or "= 42")
    const strippedUser = userNoPunct.replace(/^[a-z]\s*=\s*/, '').replace(/^=\s*/, '').trim();
    if (strippedUser === keyNoPunct) return true;

    // 4. Numeric normalization (handles thousand separators, spaces, and decimal commas)
    const normKey = keyNoPunct.replace(/\s+/g, '');
    const normUser = strippedUser.replace(/\s+/g, '');

    const parseNum = (val: string): number | null => {
      if (/^-?\d{1,3}([.,]\d{3})+$/.test(val)) {
        const cleaned = val.replace(/[.,]/g, '');
        const n = Number(cleaned);
        return Number.isFinite(n) ? n : null;
      }
      const standardDecimal = val.replace(',', '.');
      const n = Number(standardDecimal);
      return Number.isFinite(n) ? n : null;
    };

    const keyNum = parseNum(normKey);
    const userNum = parseNum(normUser);

    if (keyNum !== null && userNum !== null) {
      return Math.abs(keyNum - userNum) < 1e-6;
    }

    return false;
  }
}
