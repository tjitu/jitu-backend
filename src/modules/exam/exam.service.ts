import { areTryoutResultsAvailable } from '../../common/utils/tryout-results.util';
import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service'; // Sesuaikan path ini jika perlu
import { Observable, of, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { MessageEvent } from './interfaces';
import {
  getReadyQuestionIdSet,
  getSandboxUserIdSet,
  resolveTryoutAccess,
} from '../tryout/tryout-curation.helper';
import { IrtService } from '../irt/irt.service';

@Injectable()
export class ExamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExamService.name);
  private autoGradeTimer: NodeJS.Timeout | null = null;
  private isSweepingExpired = false;

  constructor(
    private prisma: PrismaService,
    private irtService: IrtService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) return;
    this.autoGradeTimer = setInterval(() => {
      void this.autoGradeExpiredAttempts().catch(() => undefined);
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.autoGradeTimer) {
      clearInterval(this.autoGradeTimer);
      this.autoGradeTimer = null;
    }
  }

  /**
   * Auto-submits and IRT-grades IN_PROGRESS attempts whose tryout scheduledEnd has passed.
   */
  async autoGradeExpiredAttempts(userId?: string, tryOutId?: string): Promise<number> {
    if (this.isSweepingExpired && !userId) return 0;
    const findMany = (this.prisma?.tryOutAttempt as { findMany?: unknown } | undefined)?.findMany;
    if (typeof findMany !== 'function') return 0;

    if (!userId) this.isSweepingExpired = true;
    try {
      const now = new Date();
      const [expiredAttempts, sandboxUserIds] = await Promise.all([
        this.prisma.tryOutAttempt.findMany({
          where: {
            status: 'IN_PROGRESS',
            ...(userId ? { userId } : {}),
            ...(tryOutId ? { tryOutId } : {}),
            tryOut: {
              scheduledEnd: { lt: now },
            },
          },
          select: {
            id: true,
            userId: true,
            tryOutId: true,
          },
          take: 50,
        }),
        getSandboxUserIdSet(this.prisma).catch(() => new Set<string>()),
      ]);

      let gradedCount = 0;
      for (const att of expiredAttempts) {
        if (sandboxUserIds.has(att.userId)) continue;
        try {
          await this.finishExam(att.id, att.userId);
          gradedCount += 1;
        } catch (err) {
          this.logger.warn(
            `Auto-grade failed for attempt ${att.id}: ${err instanceof Error ? err.message : 'unknown'}`,
          );
        }
      }
      return gradedCount;
    } finally {
      if (!userId) this.isSweepingExpired = false;
    }
  }

  async startExam(tryOutId: string, userId: string, sandboxToken?: string) {
    const { curationStatus, questionsReleased, canSandbox } =
      await resolveTryoutAccess(
        this.prisma,
        tryOutId,
        userId,
        sandboxToken,
      );

    if (!canSandbox && !questionsReleased) {
      throw new BadRequestException(
        'Soal ujian untuk Tryout ini belum diluncurkan oleh panitia. Silakan tunggu hingga soal dibuka menjelang jadwal pelaksanaan.',
      );
    }

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
        await this.autoGradeExpiredAttempts(userId, tryOutId);
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
    // If it's already in progress, check whether the active subtest has expired while disconnected.
    if (existingAttempt.status === 'IN_PROGRESS') {
      if (existingAttempt.subtestStartedAt) {
        const subtests = await this.prisma.subtest.findMany({
          where: { tryOutId },
          orderBy: { order: 'asc' },
          include: {
            questions: { select: { id: true } },
          },
        });
        const readyIds = canSandbox
          ? null
          : await getReadyQuestionIdSet(this.prisma, tryOutId);
        const populatedSubtests = subtests.filter((sub) => {
          const qs = sub.questions ?? [];
          return readyIds ? qs.some((q) => readyIds.has(q.id)) : qs.length > 0;
        });
        const activeSubtests = populatedSubtests.length > 0 ? populatedSubtests : subtests;
        const currentSubtest = activeSubtests.find(
          (s) => s.order === existingAttempt.currentSubtestOrder,
        );
        if (currentSubtest && currentSubtest.durationMinutes > 0) {
          const endMs =
            new Date(existingAttempt.subtestStartedAt).getTime() +
            currentSubtest.durationMinutes * 60_000;
          if (Date.now() >= endMs) {
            const nextSubtest = activeSubtests.find(
              (s) => s.order > existingAttempt.currentSubtestOrder,
            );
            if (!nextSubtest) {
              return this.finishExam(existingAttempt.id, userId);
            }
            return {
              ...existingAttempt,
              subtestExpired: true,
              isWaitingTransition: true,
              nextSubtestOrder: nextSubtest.order,
              nextSubtestName: nextSubtest.name,
            };
          }
        }
      }
      return existingAttempt;
    }

    // If it's not started, update it to IN_PROGRESS and start at the first populated subtest (default 1).
    if (existingAttempt.status === 'NOT_STARTED') {
      const tryoutSubtests = await this.prisma.subtest.findMany({
        where: { tryOutId },
        orderBy: { order: 'asc' },
        include: { _count: { select: { questions: true } } },
      });
      let firstPopulatedOrder =
        tryoutSubtests.find((s) => s._count.questions > 0)?.order ?? 1;

      if (!canSandbox) {
        const readyIds = await getReadyQuestionIdSet(this.prisma, tryOutId);
        if (readyIds) {
          const subtestQuestions = await this.prisma.subtest.findMany({
            where: { tryOutId },
            orderBy: { order: 'asc' },
            include: { questions: { select: { id: true } } },
          });
          const readySubtest = subtestQuestions.find((s) =>
            (s.questions ?? []).some((q) => readyIds.has(q.id)),
          );
          if (readySubtest) {
            firstPopulatedOrder = readySubtest.order;
          }
        }
      }

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
    let populatedSubtests = subtests.filter((subtest) => subtest._count.questions > 0);
    const readyIds = await getReadyQuestionIdSet(this.prisma, attempt.tryOutId);
    if (readyIds) {
      const subtestQs = await this.prisma.subtest.findMany({
        where: { tryOutId: attempt.tryOutId },
        orderBy: { order: 'asc' },
        include: { questions: { select: { id: true } } },
      });
      const readyOrderSet = new Set(
        subtestQs
          .filter((s) => (s.questions ?? []).some((q) => readyIds.has(q.id)))
          .map((s) => s.order),
      );
      if (readyOrderSet.size > 0) {
        populatedSubtests = populatedSubtests.filter((s) => readyOrderSet.has(s.order));
      }
    }
    const activeSubtests = populatedSubtests.length > 0 ? populatedSubtests : subtests;
    const nextSubtest = activeSubtests.find(
      (subtest) => subtest.order > attempt.currentSubtestOrder,
    );
    if (!nextSubtest || nextSubtest.order !== order) {
      throw new ForbiddenException('Kamu hanya bisa melanjutkan ke subtes berikutnya.');
    }

    // Only one concurrent request may advance the attempt and set its timer.
    await this.prisma.tryOutAttempt.updateMany({
      where: { id: attemptId, userId, status: 'IN_PROGRESS', currentSubtestOrder: attempt.currentSubtestOrder },
      data: {
        currentSubtestOrder: order,
        subtestStartedAt: new Date(),
      },
    });
    const current = await this.prisma.tryOutAttempt.findUnique({ where: { id: attemptId } });
    if (!current || current.status !== 'IN_PROGRESS' || current.userId !== userId || current.currentSubtestOrder !== order) {
      throw new BadRequestException('Status subtes telah berubah. Muat ulang halaman.');
    }
    return current;
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
          subtestStartedAt: true,
          tryOut: {
            select: {
              scheduledEnd: true,
              subtests: {
                select: { order: true, durationMinutes: true },
              },
            },
          },
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

      if (attempt.tryOut?.scheduledEnd && Date.now() > new Date(attempt.tryOut.scheduledEnd).getTime() + 5000) {
        throw new BadRequestException('Masa pengerjaan tryout sudah berakhir.');
      }

      if (attempt.subtestStartedAt && attempt.tryOut?.subtests) {
        const activeSub = attempt.tryOut.subtests.find(
          (s) => s.order === attempt.currentSubtestOrder,
        );
        if (activeSub && activeSub.durationMinutes > 0) {
          const subtestEndMs =
            new Date(attempt.subtestStartedAt).getTime() +
            activeSub.durationMinutes * 60_000;
          if (Date.now() > subtestEndMs + 5000) {
            throw new BadRequestException('Waktu subtes ini sudah habis.');
          }
        }
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

      // Update streak for active tryout attempt (minimal mengerjakan 1 soal tryout)
      this.updateUserStreakForActivity(userId).catch((err) => {
        this.logger.warn(`Failed to update user streak in tryout: ${err?.message || err}`);
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
   * Updates user daily streak on question activity (WIB / UTC+7 timezone).
   * Ensures streak increases once per day across tryout & practice.
   */
  private async updateUserStreakForActivity(userId: string): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { currentStreak: true, lastDailyDate: true },
      });
      if (!user) return;

      const now = new Date();
      const toWibDate = (d: Date) => {
        const wib = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        return wib.toISOString().slice(0, 10);
      };

      const todayStr = toWibDate(now);
      const lastDate = user.lastDailyDate;
      const lastDateStr = lastDate ? toWibDate(new Date(lastDate)) : null;

      // Already recorded activity today -> maintain current streak
      if (lastDateStr === todayStr) return;

      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayStr = toWibDate(yesterday);

      let newStreak = 1;
      if (lastDateStr === yesterdayStr) {
        newStreak = (user.currentStreak || 0) + 1;
      }

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          currentStreak: newStreak,
          lastDailyDate: now,
        },
      });
    } catch (e) {
      this.logger.warn(`Error updating user streak in exam: ${e instanceof Error ? e.message : e}`);
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
      select: { userId: true, status: true, tryOut: { select: { scheduledEnd: true } } },
    });
    if (!attempt) throw new BadRequestException('Attempt tidak ditemukan');
    if (attempt.userId !== userId) {
      throw new ForbiddenException('Kamu tidak memiliki akses ke sesi tryout ini.');
    }
    if (attempt.status === 'FINISHED') {
      return this.getFinishedExamResult(attemptId, attempt.tryOut?.scheduledEnd);
    }
    if (attempt.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Attempt tidak aktif atau sudah selesai.');
    }

    // 1. Get all answers for this attempt
    const answers = await this.prisma.userAnswer.findMany({
      where: { tryOutAttemptId: attemptId },
      select: {
        id: true,
        questionId: true,
        questionItemId: true,
        inputText: true,
      },
    });

    // 2. Grade each answer and update in database
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
    }

    // 3. Calculate 3PL EAP IRT scores (per subtest and composite overall score) & persist
    await this.irtService.calculateAndSaveAttemptScore(attemptId, userId);

    return this.getFinishedExamResult(attemptId, attempt.tryOut?.scheduledEnd);
  }

  private async getFinishedExamResult(attemptId: string, scheduledEnd: Date | null | undefined) {
    const result = await this.prisma.tryOutAttempt.findUnique({
      where: { id: attemptId },
      include: { subtestScores: { orderBy: { subtest: { order: 'asc' } } } },
    });
    if (!result || areTryoutResultsAvailable(scheduledEnd)) return result;
    return { ...result, totalScore: null, subtestScores: [] };
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
