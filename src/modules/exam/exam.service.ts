import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service'; // Sesuaikan path ini jika perlu
import { Observable, of, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { MessageEvent } from './interfaces';
import { resolveTryoutAccess } from '../tryout/tryout-curation.helper';

@Injectable()
export class ExamService {
  private readonly logger = new Logger(ExamService.name);

  constructor(private prisma: PrismaService) {}

  async startExam(tryOutId: string, userId: string, sandboxToken?: string) {
    const { curationStatus, canSandbox } = await resolveTryoutAccess(
      this.prisma,
      tryOutId,
      userId,
      sandboxToken,
    );

    if (curationStatus === 'PUBLISHED' && !canSandbox) {
      const tryout = await this.prisma.tryOut.findUnique({
        where: { id: tryOutId },
        select: { scheduledStart: true, scheduledEnd: true },
      });
      const now = new Date();
      if (tryout?.scheduledStart && now < tryout.scheduledStart) {
        throw new BadRequestException(
          'Tryout belum dimulai. Ujian baru dapat dikerjakan sesuai jadwal.',
        );
      }
      if (tryout?.scheduledEnd && now > tryout.scheduledEnd) {
        throw new BadRequestException('Masa pengerjaan tryout sudah berakhir.');
      }
    }

    // 1. Find ANY existing attempt for this user and tryout.
    const existingAttempt = await this.prisma.tryOutAttempt.findFirst({
      where: { userId, tryOutId },
      orderBy: { startedAt: 'desc' }, // Get the latest one if multiple somehow exist
    });

    // If no attempt exists, the user hasn't registered.
    if (!existingAttempt) {
      throw new BadRequestException(
        'Anda belum terdaftar di tryout ini. Silakan daftar terlebih dahulu.',
      );
    }

    // 2. If an attempt already exists, handle based on status
    // If it's already in progress, just return it.
    if (existingAttempt.status === 'IN_PROGRESS') {
      return existingAttempt;
    }

    // If it's not started, update it to IN_PROGRESS and start at the first populated subtest (default 1).
    if (existingAttempt.status === 'NOT_STARTED') {
      const tryoutSubtests = await this.prisma.subtest.findMany({
        where: { tryOutId },
        orderBy: { order: 'asc' },
        include: { _count: { select: { questions: true } } },
      });
      const firstPopulatedOrder =
        tryoutSubtests.find((s) => s._count.questions > 0)?.order ?? 1;

      return this.prisma.tryOutAttempt.update({
        where: { id: existingAttempt.id },
        data: {
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          subtestStartedAt: new Date(),
          currentSubtestOrder: firstPopulatedOrder,
        },
      });
    }

    // If it's finished, user should not be able to start it again via this endpoint.
    if (existingAttempt.status === 'FINISHED') {
      throw new BadRequestException(
        'Ujian sudah selesai. Tidak dapat memulai lagi.',
      );
    }

    // Fallthrough for any other unexpected status
    throw new InternalServerErrorException(
      `Status attempt tidak valid: ${existingAttempt.status}`,
    );
  }

  async startSubtest(attemptId: string, order: number, userId: string) {
    // Pastikan attempt valid
    const attempt = await this.prisma.tryOutAttempt.findUnique({
      where: { id: attemptId },
    });

    if (!attempt || attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Attempt tidak valid atau sudah selesai');
    }
    if (attempt.userId !== userId) {
      throw new ForbiddenException('Kamu tidak memiliki akses ke sesi tryout ini.');
    }

    // [SECURITY] Cegah reset timer jika user refresh halaman di subtes yang sama
    if (attempt.currentSubtestOrder === order) {
      return attempt;
    }

    const subtests = await this.prisma.subtest.findMany({
      where: { tryOutId: attempt.tryOutId },
      orderBy: { order: 'asc' },
      include: { _count: { select: { questions: true } } },
    });
    const populatedSubtests = subtests.filter((subtest) => subtest._count.questions > 0);
    const activeSubtests = populatedSubtests.length > 0 ? populatedSubtests : subtests;
    const nextSubtest = activeSubtests.find(
      (subtest) => subtest.order > attempt.currentSubtestOrder,
    );
    if (!nextSubtest || nextSubtest.order !== order) {
      throw new ForbiddenException('Kamu hanya bisa melanjutkan ke subtes berikutnya.');
    }

    // Update waktu mulai subtes baru
    return this.prisma.tryOutAttempt.update({
      where: { id: attemptId },
      data: {
        currentSubtestOrder: order,
        subtestStartedAt: new Date(),
      },
    });
  }

  /** Computes current subtest endTime/remainingSeconds for both authenticated GET and SSE clients. */
  private computeTimerPayload(attempt: any, order: number) {
    if (!attempt || attempt.status !== 'IN_PROGRESS') {
      return { status: 'FINISHED', remainingSeconds: 0 };
    }

    const activeOrder = order || attempt.currentSubtestOrder;
    const currentSubtest = attempt.tryOut.subtests.find(
      (s: any) => s.order === activeOrder,
    );

    if (!currentSubtest) {
      return { status: 'ERROR', remainingSeconds: 0 };
    }

    const startTime = attempt.subtestStartedAt
      ? attempt.subtestStartedAt.getTime()
      : attempt.startedAt.getTime();

    const durationMs = currentSubtest.durationMinutes * 60000;
    const endTime = new Date(startTime + durationMs);
    const serverTime = new Date();
    const remainingSeconds = Math.max(
      0,
      Math.floor((endTime.getTime() - serverTime.getTime()) / 1000),
    );

    return {
      type: 'init',
      status: remainingSeconds > 0 ? 'IN_PROGRESS' : 'SUBTEST_FINISHED',
      endTime: endTime.toISOString(),
      serverTime: serverTime.toISOString(),
      remainingSeconds,
      durationMinutes: currentSubtest.durationMinutes,
      subtestOrder: activeOrder,
    };
  }

  async getTimerSnapshot(attemptId: string, order: number, userId: string) {
    const attempt = await this.prisma.tryOutAttempt.findUnique({
      where: { id: attemptId },
      include: {
        tryOut: {
          include: {
            subtests: { orderBy: { order: 'asc' } },
          },
        },
      },
    });
    if (!attempt) {
      throw new BadRequestException('Attempt tidak ditemukan');
    }
    if (attempt.userId !== userId) {
      throw new ForbiddenException('Kamu tidak memiliki akses ke timer ini.');
    }
    return this.computeTimerPayload(attempt, order);
  }

  /**
   * SSE endpoint for exam timer.
   * Instead of creating per-user interval timers (which causes event loop starvation),
   * we send the endTime and serverTime once. The client handles the countdown.
   */
  getExamStream(attemptId: string, order: number, userId: string): Observable<MessageEvent> {
    return from(
      this.prisma.tryOutAttempt.findUnique({
        where: { id: attemptId },
        include: {
          tryOut: {
            include: {
              subtests: { orderBy: { order: 'asc' } },
            },
          },
        },
      }),
    ).pipe(
      switchMap((attempt) => {
        if (!attempt) return throwError(() => new BadRequestException('Attempt tidak ditemukan'));
        if (attempt.userId !== userId) {
          return throwError(() => new ForbiddenException('Kamu tidak memiliki akses ke timer ini.'));
        }
        return of({ data: this.computeTimerPayload(attempt, order) } as MessageEvent);
      }),
    );
  }



  /**
   * Saves user's answer without grading.
   * Grading is deferred to finishExam to ensure:
   * - Answer key corrections after submission are reflected
   * - Consistent grading at exam completion time
   */
  async saveAnswer(
    attemptId: string,
    userId: string,
    questionId: string,
    questionItemId?: string,
    inputText?: string,
  ) {
    this.logger.debug('Processing save answer request', {
      attemptId,
      questionId,
    });

    try {
      // [SECURITY] Validate attempt status before saving
      const attempt = await this.prisma.tryOutAttempt.findUnique({
        where: { id: attemptId },
        select: {
          status: true,
          userId: true,
          tryOutId: true,
          currentSubtestOrder: true,
        },
      });

      if (!attempt) {
        throw new BadRequestException('Attempt tidak ditemukan');
      }
      if (attempt.userId !== userId) {
        throw new ForbiddenException('Kamu tidak memiliki akses ke sesi tryout ini.');
      }

      if (attempt.status === 'FINISHED') {
        throw new BadRequestException(
          'Ujian sudah selesai, tidak bisa menyimpan jawaban.',
        );
      }
      if (attempt.status !== 'IN_PROGRESS') {
        throw new BadRequestException('Ujian belum dimulai.');
      }

      const question = await this.prisma.question.findFirst({
        where: {
          id: questionId,
          subtest: {
            tryOutId: attempt.tryOutId,
            order: attempt.currentSubtestOrder,
          },
        },
        select: { id: true },
      });
      if (!question) {
        throw new BadRequestException('Soal tidak termasuk subtes yang sedang dikerjakan.');
      }

      // Validate questionItemId if provided
      if (questionItemId) {
        const selectedItem = await this.prisma.questionItem.findUnique({
          where: { id: questionItemId },
          select: { id: true, questionId: true },
        });

        if (!selectedItem || selectedItem.questionId !== questionId) {
          throw new BadRequestException(
            `Pilihan jawaban tidak valid untuk soal ${questionId}.`,
          );
        }
      }

      // Save answer WITHOUT grading - grading deferred to finishExam
      // This ensures answer key corrections are reflected in final score
      const result = await this.prisma.userAnswer.upsert({
        where: {
          tryOutAttemptId_questionId: {
            tryOutAttemptId: attemptId,
            questionId: questionId,
          },
        },
        update: {
          questionItemId: questionItemId || null,
          inputText: inputText ?? null,
          // isCorrect is NOT set here - will be graded in finishExam
          updatedAt: new Date(),
        },
        create: {
          tryOutAttemptId: attemptId,
          questionId: questionId,
          questionItemId: questionItemId || null,
          inputText: inputText ?? null,
          isCorrect: false, // Default value, will be updated in finishExam
        },
      });

      return result;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ForbiddenException) throw error;

      this.logger.error('Failed to save answer', {
        attemptId,
        questionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      throw new InternalServerErrorException('Failed to save answer');
    }
  }

  /**
   * Grades a single answer against the current question key.
   * Used by finishExam to ensure answers are graded with the latest key.
   */
  private async gradeAnswer(answer: {
    questionItemId: string | null;
    inputText: string | null;
    questionId: string;
  }): Promise<boolean> {
    // For multiple choice / true-false: check if selected item is correct
    if (answer.questionItemId) {
      const selectedItem = await this.prisma.questionItem.findUnique({
        where: { id: answer.questionItemId },
        select: { isCorrect: true },
      });
      return selectedItem?.isCorrect ?? false;
    }

    // For short answer: compare text against correct answer key with tolerant normalization
    if (answer.inputText !== null) {
      const question = await this.prisma.question.findUnique({
        where: { id: answer.questionId },
        select: { correctAnswer: true },
      });

      if (!question?.correctAnswer) {
        return false;
      }

      return this.checkShortAnswer(answer.inputText, question.correctAnswer);
    }

    return false;
  }

  /**
   * Finishes the exam and grades all answers.
   * Grading is done at this point to ensure:
   * - Answer key corrections after submission are reflected
   * - All answers are graded consistently at exam completion
   */
  async finishExam(attemptId: string, userId: string) {
    const attempt = await this.prisma.tryOutAttempt.findUnique({
      where: { id: attemptId },
      select: { userId: true, status: true },
    });
    if (!attempt) throw new BadRequestException('Attempt tidak ditemukan');
    if (attempt.userId !== userId) {
      throw new ForbiddenException('Kamu tidak memiliki akses ke sesi tryout ini.');
    }
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Attempt tidak aktif atau sudah selesai.');
    }

    // 1. Get all answers for this attempt
    const answers = await this.prisma.userAnswer.findMany({
      where: { tryOutAttemptId: attemptId },
      include: { question: true },
    });

    // 2. Grade each answer and update in database
    let totalScore = 0;
    for (const answer of answers) {
      const isCorrect = await this.gradeAnswer({
        questionItemId: answer.questionItemId,
        inputText: answer.inputText,
        questionId: answer.questionId,
      });

      // Update the answer with grading result
      await this.prisma.userAnswer.update({
        where: { id: answer.id },
        data: { isCorrect },
      });

      // Add points if correct
      if (isCorrect) {
        totalScore += answer.question.points || 0;
      }
    }

    // 3. Update attempt status and score
    return this.prisma.tryOutAttempt.update({
      where: { id: attemptId },
      data: {
        status: 'FINISHED',
        totalScore,
        finishedAt: new Date(),
      },
    });
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
