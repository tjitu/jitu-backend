import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import {
  TryOutCardDto,
  TryoutDetailDto,
  LeaderboardDto,
  LeaderboardItemDto,
} from './dto/tryout.dto';
import { SubtestName } from '../../../generated/prisma/client';
import { ExamService } from '../exam/exam.service';
import {
  canAccessTryoutSandbox,
  getSandboxUserIdSet,
  getSandboxPreviewTryoutId,
  getTryoutCurationMap,
  resolveTryoutAccess,
} from './tryout-curation.helper';

@Injectable()
export class TryoutService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ExamService))
    private readonly examService: ExamService,
  ) {}

  /**
   * Helper: Map TryOut entity -> TryoutDetailDto
   */
  private mapTryoutToDto(
    tryout: any,
    answeredQuestionIds?: Set<string>,
    userAnswersByQuestionId?: Map<string, boolean>,
  ): TryoutDetailDto {
    const totalQuestions = (tryout.subtests ?? []).reduce(
      (sum: number, s: any) => sum + (s.questions?.length ?? 0),
      0,
    );

    const totalDuration = (tryout.subtests ?? []).reduce(
      (sum: number, s: any) => sum + (s.durationMinutes ?? 0),
      0,
    );

    const answeredSet = answeredQuestionIds ?? new Set<string>();

    return {
      id: tryout.id,
      title: tryout.title,
      number: tryout.code?.toString() ?? '0',
      badge: tryout.batch,
      participants: tryout._count?.attempts ?? 0,
      description: tryout.description ?? '',
      duration: totalDuration,
      totalQuestions,
      startDate: tryout.scheduledStart?.toISOString() ?? '',
      endDate: tryout.scheduledEnd?.toISOString() ?? '',
      isRegistered: (tryout.attempts?.length ?? 0) > 0,
      isFree: tryout.solutionPrice === 0,
      isSpecial: Boolean(tryout.isSpecial),
      tokenCost: tryout.solutionPrice,
      unlockedSolutions: tryout.unlockedSolutions ?? [], // FIX: Mapping data unlock
      categories: (tryout.subtests ?? [])
        .slice()
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((s: any) => {
          const qIds = (s.questions ?? []).map((q: any) => String(q.id));
          const answeredCount = qIds.filter((id: string) =>
            answeredSet.has(id),
          ).length;

          let subtestCorrect: number | undefined = undefined;
          let subtestWrong: number | undefined = undefined;
          let subtestEmpty: number | undefined = undefined;

          if (userAnswersByQuestionId) {
            const correct = qIds.filter(
              (id: string) => userAnswersByQuestionId.get(id) === true,
            ).length;
            const wrong = qIds.filter(
              (id: string) =>
                userAnswersByQuestionId.has(id) &&
                userAnswersByQuestionId.get(id) === false,
            ).length;
            subtestCorrect = correct;
            subtestWrong = wrong;
            subtestEmpty = Math.max(0, qIds.length - (correct + wrong));
          }

          return {
            id: Number(s.order),
            name: s.name,
            questionCount: s.questions?.length ?? 0,
            duration: s.durationMinutes,
            isCompleted:
              (s.questions?.length ?? 0) > 0 &&
              answeredCount === (s.questions?.length ?? 0),
            correctCount: subtestCorrect,
            wrongCount: subtestWrong,
            emptyCount: subtestEmpty,
          };
        }),
      benefits: ['Pembahasan lengkap', 'Analisis hasil', 'Simulasi UTBK'],
      requirements: ['Akun terverifikasi', 'Token mencukupi'],
    };
  }

  async registerTryout(userId: string, tryoutId: string, sandboxToken?: string) {
    // 1. Cek Tryout
    const tryout = await this.prisma.tryOut.findUnique({
      where: { id: tryoutId },
    });
    if (!tryout) throw new NotFoundException('Tryout tidak ditemukan');

    const { curationStatus } = await resolveTryoutAccess(
      this.prisma,
      tryoutId,
      userId,
      sandboxToken,
    );

    // Cek Status Waktu (Sandbox testers can test unpublished tryouts regardless of future schedule dates)
    // Siswa dapat mendaftar sebelum dan selama tryout berlangsung; pendaftaran ditutup hanya jika jadwal sudah berakhir
    if (curationStatus === 'PUBLISHED') {
      const now = new Date();
      if (tryout.scheduledEnd && now > tryout.scheduledEnd) {
        throw new BadRequestException('Masa pengerjaan tryout sudah berakhir.');
      }
    }

    // 2. Cek apakah user sudah terdaftar (punya attempt apa saja)
    const existingAttempt = await this.prisma.tryOutAttempt.findFirst({
      where: { userId, tryOutId: tryoutId },
    });

    if (existingAttempt) {
      // Sudah terdaftar, kembalikan attemptId yang ada
      return {
        message: 'User sudah terdaftar pada tryout ini',
        attemptId: existingAttempt.id,
        isRegistered: true,
      };
    }

    // 3. Buat attempt baru karena pendaftaran selalu gratis
    const newAttempt = await this.prisma.tryOutAttempt.create({
      data: {
        userId,
        tryOutId: tryoutId,
        status: 'NOT_STARTED',
        totalScore: 0,
        currentSubtestOrder: 0,
      },
    });

    return {
      message: 'Berhasil mendaftar tryout',
      attemptId: newAttempt.id,
      isRegistered: true,
    };
  }

  /**
   * Logic: Unlock Pembahasan menggunakan Token
   */
  async unlockSolution(userId: string, tryoutId: string) {
    const tryout = await this.prisma.tryOut.findUnique({
      where: { id: tryoutId },
      select: { solutionPrice: true, title: true },
    });

    if (!tryout) throw new NotFoundException('Tryout tidak ditemukan');

    // 1. Cek apakah sudah di-unlock
    const existingUnlock = await this.prisma.unlockedSolution.findFirst({
      where: { userId, tryOutId: tryoutId },
    });
    if (existingUnlock) return { message: 'Pembahasan sudah terbuka' };

    // 2. Cek saldo & status premium user
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { tokenBalance: true, isPremium: true, premiumExpiresAt: true },
    });

    const isUserPremium = Boolean(
      user?.isPremium &&
        (!user?.premiumExpiresAt || user.premiumExpiresAt > new Date()),
    );

    // Premium Pass user gets solutions unlocked without spending coins
    if (isUserPremium) {
      return await this.prisma.unlockedSolution.create({
        data: { userId, tryOutId: tryoutId },
      });
    }

    if (!user || user.tokenBalance < tryout.solutionPrice) {
      throw new BadRequestException('Saldo Token tidak mencukupi');
    }

    // 3. Transaksi (Potong Saldo & Unlock)
    return await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { tokenBalance: { decrement: tryout.solutionPrice } },
      });

      await tx.tokenTransaction.create({
        data: {
          userId,
          amount: -tryout.solutionPrice,
          type: 'PURCHASE_SOLUTION',
          referenceId: tryoutId,
        },
      });

      return await tx.unlockedSolution.create({
        data: { userId, tryOutId: tryoutId },
      });
    });
  }

  async getTryouts(
    userId?: string,
    sandboxToken?: string,
  ): Promise<TryOutCardDto[]> {
    const [canSandbox, previewTryoutId] = await Promise.all([
      canAccessTryoutSandbox(this.prisma, userId),
      getSandboxPreviewTryoutId(this.prisma, sandboxToken),
    ]);

    const tryouts = await this.prisma.tryOut.findMany({
      where: canSandbox
        ? undefined
        : previewTryoutId
          ? { OR: [{ isPublic: true }, { id: previewTryoutId }] }
          : { isPublic: true },
      include: {
        _count: { select: { attempts: true } },
        // Include attempts only if a user is logged in
        attempts: userId ? { where: { userId } } : false,
      },
      orderBy: { scheduledStart: 'desc' },
    });

    const curationMap = await getTryoutCurationMap(
      this.prisma,
      tryouts.map((t) => t.id),
    );

    const visibleTryouts = tryouts.filter((t) => {
      const status = curationMap.get(t.id) ?? 'DRAFT';
      if (status === 'PUBLISHED' && t.isPublic) return true;
      if (canSandbox) return true;
      if (previewTryoutId === t.id && status !== 'PUBLISHED') return true;
      return false;
    });

    const result = visibleTryouts.map((t) => {
      const curationStatus = curationMap.get(t.id) ?? 'DRAFT';
      const isRegistered = t.attempts ? t.attempts.length > 0 : false;
      return {
        id: t.id,
        title: t.title,
        number: t.code.toString(),
        canEdit: false,
        participants: t._count.attempts,
        badge: t.batch,
        description: t.description ?? null,
        solutionPrice: t.solutionPrice,
        isPublic: t.isPublic,
        isSpecial: Boolean(t.isSpecial),
        isRegistered: isRegistered,
        curationStatus,
        isSandboxPreview: curationStatus !== 'PUBLISHED',
        scheduledStart: t.scheduledStart?.toISOString() ?? null,
        scheduledEnd: t.scheduledEnd?.toISOString() ?? null,
      };
    });

    return result;
  }

  async getTryoutById(
    id: string,
    userId?: string,
    sandboxToken?: string,
  ): Promise<TryoutDetailDto> {
    const tryout = await this.prisma.tryOut.findUnique({
      where: { id },
      include: {
        subtests: {
          include: {
            questions: { select: { id: true } },
          },
        },
        attempts: userId
          ? {
              where: { userId },
              select: {
                id: true,
                status: true,
                startedAt: true,
                finishedAt: true,
              },
              orderBy: { startedAt: 'desc' },
            }
          : false,
        _count: { select: { attempts: true } },
        unlockedSolutions: userId ? { where: { userId } } : false, // FIX: Sertakan data unlock
      },
    });

    if (!tryout) throw new NotFoundException('Tryout not found');

    const { curationStatus } = await resolveTryoutAccess(
      this.prisma,
      id,
      userId,
      sandboxToken,
    );

    let answeredQuestionIds = new Set<string>();
    if (
      userId &&
      Array.isArray(tryout.attempts) &&
      tryout.attempts.length > 0
    ) {
      const inProgress = tryout.attempts.find(
        (a: any) => a.status === 'IN_PROGRESS',
      );
      if (inProgress?.id) {
        const answers = await this.prisma.userAnswer.findMany({
          where: { tryOutAttemptId: String(inProgress.id) },
          select: { questionId: true },
        });
        answeredQuestionIds = new Set<string>(
          answers.map((a) => String(a.questionId)),
        );
      }
    }

    let latestFinishedAttemptId: string | null = null;
    let latestAttemptStatus:
      | 'IN_PROGRESS'
      | 'FINISHED'
      | 'NOT_STARTED'
      | null = null;
    let latestAttemptId: string | null = null;
    let currentSubtestOrder = 1;
    let latestScore = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let emptyCount = 0;
    let userAnswersMap: Map<string, boolean> | undefined = undefined;

    const totalQuestions = (tryout.subtests ?? []).reduce(
      (sum: number, s: any) => sum + (s.questions?.length ?? 0),
      0,
    );

    if (userId) {
      const latestAttempt = await this.prisma.tryOutAttempt.findFirst({
        where: { userId, tryOutId: id },
        orderBy: { startedAt: 'desc' },
        select: { id: true, status: true, currentSubtestOrder: true },
      });
      latestAttemptStatus = (latestAttempt?.status as any) ?? null;
      latestAttemptId = latestAttempt?.id ?? null;
      currentSubtestOrder = latestAttempt?.currentSubtestOrder ?? 1;

      const latestFinished = await this.prisma.tryOutAttempt.findFirst({
        where: { userId, tryOutId: id, status: 'FINISHED' },
        orderBy: { finishedAt: 'desc' },
        select: {
          id: true,
          totalScore: true,
          answers: { select: { questionId: true, isCorrect: true } },
        },
      });
      latestFinishedAttemptId = latestFinished?.id ?? null;
      latestScore = latestFinished?.totalScore
        ? Math.round(latestFinished.totalScore)
        : 0;

      if (latestFinished) {
        userAnswersMap = new Map<string, boolean>();
        const answers = latestFinished.answers ?? [];
        for (const ans of answers) {
          userAnswersMap.set(String(ans.questionId), Boolean(ans.isCorrect));
        }
        correctCount = answers.filter((a) => a.isCorrect).length;
        wrongCount = answers.filter((a) => !a.isCorrect).length;
        emptyCount = Math.max(0, totalQuestions - answers.length);
      }
    }

    const user = userId
      ? await this.prisma.user.findUnique({
          where: { id: userId },
          select: { isPremium: true, premiumExpiresAt: true },
        })
      : null;
    const isUserPremium = Boolean(
      user?.isPremium &&
        (!user?.premiumExpiresAt || user.premiumExpiresAt > new Date()),
    );

    const dto = this.mapTryoutToDto(
      tryout,
      answeredQuestionIds,
      userAnswersMap,
    );
    if (isUserPremium) {
      dto.unlockedSolutions = [
        { id: 'premium-pass', userId, tryOutId: id, unlockedAt: new Date() },
      ];
    }
    return {
      ...dto,
      latestFinishedAttemptId,
      latestAttemptStatus,
      latestAttemptId,
      currentSubtestOrder,
      latestScore,
      correctCount,
      wrongCount,
      emptyCount,
      curationStatus,
      isSandboxPreview: curationStatus !== 'PUBLISHED',
    };
  }

  async getLeaderboard(
    tryoutId: string,
    userId: string,
  ): Promise<LeaderboardDto> {
    const tryout = await this.prisma.tryOut.findUnique({
      where: { id: tryoutId },
      select: { scheduledEnd: true },
    });

    if (!tryout) {
      throw new NotFoundException('Tryout not found');
    }

    if (!tryout.scheduledEnd) {
      throw new ForbiddenException(
        'Leaderboard is not available for this tryout.',
      );
    }

    // The leaderboard itself is only visible after the tryout period has ended.
    if (new Date() < new Date(tryout.scheduledEnd)) {
      throw new ForbiddenException('Leaderboard will be available after the tryout ends.');
    }

    // 1. Get ALL finished attempts to determine the user's rank among everyone (excluding sandbox QA accounts).
    const [rawFinishedAttempts, sandboxUserIds] = await Promise.all([
      this.prisma.tryOutAttempt.findMany({
        where: {
          tryOutId: tryoutId,
          status: 'FINISHED',
        },
        orderBy: { totalScore: 'desc' },
        include: { user: { select: { id: true, name: true } } },
      }),
      getSandboxUserIdSet(this.prisma),
    ]);

    const allFinishedAttempts = rawFinishedAttempts.filter(
      (attempt) => !sandboxUserIds.has(attempt.userId) || attempt.userId === userId,
    );

    // 2. Filter for attempts that are eligible for the official leaderboard.
    const eligibleAttempts = allFinishedAttempts.filter(
      (attempt) =>
        attempt.finishedAt &&
        new Date(attempt.finishedAt) <= new Date(tryout.scheduledEnd!),
    );

    // 3. Create the official leaderboard ranking from eligible attempts.
    const officialLeaderboard: LeaderboardItemDto[] = eligibleAttempts.map(
      (attempt, index) => ({
        rank: index + 1,
        name: attempt.user?.name || 'Peserta',
        score: Math.round(attempt.totalScore || 0),
        isCurrentUser: attempt.userId === userId,
      }),
    );

    // 4. Find the current user's rank among ALL participants.
    let currentUserRank: LeaderboardItemDto | null = null;
    const userAttemptIndex = allFinishedAttempts.findIndex(
      (a) => a.userId === userId,
    );

    if (userAttemptIndex !== -1) {
      const userAttempt = allFinishedAttempts[userAttemptIndex];
      currentUserRank = {
        rank: userAttemptIndex + 1,
        name: userAttempt.user?.name || 'Peserta',
        score: Math.round(userAttempt.totalScore || 0),
        isCurrentUser: true,
      };
    }

    // 5. Get the top 10 from the official leaderboard.
    const top10 = officialLeaderboard.slice(0, 10);

    return {
      top10,
      currentUserRank,
    };
  }

  async getSubtestQuestions(
    tryOutId: string,
    subtestIdOrOrder: string | number,
    userId: string, // Wajibkan userId demi keamanan
    attemptId?: string,
    sandboxToken?: string,
  ) {
    const { curationStatus } = await resolveTryoutAccess(
      this.prisma,
      tryOutId,
      userId,
      sandboxToken,
    );

    let subtest: any;
    const order = Number(subtestIdOrOrder);

    if (!isNaN(order)) {
      subtest = await this.prisma.subtest.findFirst({
        where: { tryOutId, order },
      });
    } else {
      subtest = await this.prisma.subtest.findFirst({
        where: {
          tryOutId,
          OR: [
            { id: String(subtestIdOrOrder) },
            { name: String(subtestIdOrOrder) as SubtestName },
          ],
        },
      });
    }

    if (!subtest) throw new NotFoundException('Subtest tidak ditemukan');

    let currentAttempt: any = null;
    const hasAttemptId =
      !!attemptId && attemptId !== 'undefined' && attemptId !== 'null';

    if (hasAttemptId) {
      currentAttempt = await this.prisma.tryOutAttempt.findUnique({
        where: { id: String(attemptId) },
        include: { tryOut: { include: { subtests: true } } },
      });

      if (currentAttempt && currentAttempt.userId !== userId) {
        throw new ForbiddenException(
          'Kamu tidak memiliki akses ke sesi tryout ini.',
        );
      }
    } else {
      currentAttempt = await this.prisma.tryOutAttempt.findFirst({
        where: { userId, tryOutId, status: 'IN_PROGRESS' },
        orderBy: { startedAt: 'desc' },
        include: { tryOut: { include: { subtests: true } } },
      });
    }

    if (currentAttempt && currentAttempt.tryOutId !== tryOutId) {
      throw new ForbiddenException(
        'Kamu tidak memiliki akses ke tryout ini.',
      );
    }

    // --- AUTO FINISH LOGIC (DIPERBAIKI) ---
    if (currentAttempt && currentAttempt.status === 'IN_PROGRESS') {
      const now = new Date();

      // 1. Cek Durasi Pengerjaan (+ alokasi jeda 1 menit antar subtes)
      const totalDuration = currentAttempt.tryOut.subtests.reduce(
        (acc, s) => acc + (s.durationMinutes || 0),
        0,
      );
      const breakAllowanceMs =
        Math.max(0, (currentAttempt.tryOut.subtests?.length ?? 1) - 1) * 60_000;
      const expiryTime = new Date(
        currentAttempt.startedAt.getTime() +
          totalDuration * 60000 +
          breakAllowanceMs,
      );

      // 2. Cek Jadwal Tryout Berakhir (lewati saat Sandbox preview agar QA leluasa menguji)
      const scheduleEnded =
        curationStatus === 'PUBLISHED' &&
        currentAttempt.tryOut.scheduledEnd &&
        now > currentAttempt.tryOut.scheduledEnd;

      if (now > expiryTime || scheduleEnded) {
        // Gunakan ExamService untuk finish agar logic skor konsisten
        currentAttempt = await this.examService.finishExam(currentAttempt.id, userId);

        // Reload attempt dengan relation yang dibutuhkan
        currentAttempt = await this.prisma.tryOutAttempt.findUnique({
          where: { id: currentAttempt.id },
          include: { tryOut: { include: { subtests: true } } },
        });
      }
    }

    if (!currentAttempt) {
      currentAttempt = await this.prisma.tryOutAttempt.findFirst({
        where: { userId, tryOutId, status: 'FINISHED' },
        orderBy: { finishedAt: 'desc' },
      });
    }

    if (!currentAttempt) throw new NotFoundException('Sesi tidak ditemukan');

    const isReviewMode = currentAttempt.status === 'FINISHED';

    // [SECURITY] Cegah skip subtest atau akses subtest masa lalu/depan
    // Standar UTBK: User HANYA boleh ada di subtes yang sedang aktif.
    if (!isReviewMode && currentAttempt.status === 'IN_PROGRESS') {
      const requestedOrder = subtest.order;
      const currentOrder = currentAttempt.currentSubtestOrder;

      if (requestedOrder !== currentOrder) {
        throw new ForbiddenException(
          requestedOrder < currentOrder
            ? `Waktu subtes ini sudah habis. Kamu tidak bisa kembali.`
            : `Kamu belum bisa mengerjakan subtes ini. Selesaikan subtes sebelumnya dahulu.`,
        );
      }
    }

    // --- PROTEKSI PEMBAHASAN BERBAYAR ---
    let showSolution = false;
    if (isReviewMode) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isPremium: true, premiumExpiresAt: true },
      });
      const isUserPremium = Boolean(
        user?.isPremium &&
          (!user?.premiumExpiresAt || user.premiumExpiresAt > new Date()),
      );

      if (isUserPremium) {
        showSolution = true;
      } else {
        const tryout = await this.prisma.tryOut.findUnique({
          where: { id: tryOutId },
          select: { solutionPrice: true },
        });

        if (tryout && tryout.solutionPrice > 0) {
          const unlocked = await this.prisma.unlockedSolution.findFirst({
            where: { userId, tryOutId },
          });
          if (unlocked) {
            showSolution = true;
          }
        } else if (tryout && tryout.solutionPrice <= 0) {
          showSolution = true;
        }
      }
    }

    const questions = await this.prisma.question.findMany({
      where: { subtestId: subtest.id },
      orderBy: { id: 'asc' },
      include: {
        items: { orderBy: { order: 'asc' } },
        userAnswers: { where: { tryOutAttemptId: currentAttempt.id } },
      },
    });

    const tryoutInfo = await this.prisma.tryOut.findUnique({
      where: { id: tryOutId },
      include: {
        subtests: {
          include: {
            _count: { select: { questions: true } },
          },
          orderBy: { order: 'asc' },
        },
      },
    });

    const timerStartMs = currentAttempt.subtestStartedAt
      ? new Date(currentAttempt.subtestStartedAt).getTime()
      : new Date(currentAttempt.startedAt).getTime();
    const timerEndDate = new Date(
      timerStartMs + (subtest.durationMinutes || 0) * 60_000,
    );
    const serverNow = new Date();
    const remainingSeconds = !isReviewMode
      ? Math.max(
          0,
          Math.floor((timerEndDate.getTime() - serverNow.getTime()) / 1000),
        )
      : 0;

    return {
      subtestId: subtest.order,
      subtestName: subtest.name,
      tryOutId,
      tryoutTitle: tryoutInfo?.title || 'Tryout',
      durationMinutes: subtest.durationMinutes,
      curationStatus,
      endTime: !isReviewMode ? timerEndDate.toISOString() : null,
      serverTime: !isReviewMode ? serverNow.toISOString() : null,
      remainingSeconds: !isReviewMode ? remainingSeconds : null,
      allSubtests: tryoutInfo?.subtests.map((s) => ({
        id: s.id,
        name: s.name,
        order: s.order,
        durationMinutes: s.durationMinutes,
        questionCount: s._count.questions,
      })),
      questions: questions.map((q: any) => {
        const ua = q.userAnswers?.[0];
        const correctItem = q.items.find((i: any) => i.isCorrect);

        return {
          id: q.id,
          type: q.type,
          questionText: q.content,
          solution: showSolution
            ? q.explanation || 'Tidak ada pembahasan.'
            : null,
          correctAnswerText: showSolution ? q.correctAnswer : null,
          // FIX: Agar soal kosong tidak dianggap benar (null === null)
          correctAnswerId: showSolution
            ? correctItem?.id ?? 'NO_KEY'
            : null,
          options: q.items.map((i: any) => ({
            id: i.id,
            text: i.content,
            order: i.order,
            isCorrect: showSolution ? i.isCorrect : undefined,
          })),
          userAnswer: ua
            ? {
                questionItemId: ua.questionItemId,
                inputText: ua.inputText,
                isCorrect: showSolution ? ua.isCorrect : false,
              }
            : {
                questionItemId: null,
                inputText: null,
                isCorrect: false, // User tidak jawab = Salah
              },
        };
      }),
      isReviewMode,
      attemptId: currentAttempt.id,
    };
  }
}
