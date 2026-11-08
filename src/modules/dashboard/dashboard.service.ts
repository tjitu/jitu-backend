import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { v2 as cloudinary } from 'cloudinary';
import * as streamifier from 'streamifier';

import {
  DashboardDataDto,
  UserStatsDto,
  DailyQuestionResponseDto,
  SubmitDailyAnswerDto,
  ScoreDataDto,
  ActiveTryoutDto,
  OngoingTryoutDto,
} from './dto/dashboard.dto';

enum TryoutStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  FINISHED = 'FINISHED',
}
@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  private async uploadToCloudinary(file: Express.Multer.File): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'jitu-profile-pictures',
          resource_type: 'auto',
        },
        (error, result) => {
          if (error) return reject(error);
          if (!result || !result.secure_url) {
            return reject(
              new Error('Gagal mengupload gambar ke Cloudinary: Result kosong'),
            );
          }
          resolve(result.secure_url);
        },
      );
      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  async updateProfile(
    userId: string,
    payload: UpdateProfileDto,
    file?: Express.Multer.File,
  ) {
    const updateData: any = { ...payload };

    if (file) {
      try {
        const imageUrl = await this.uploadToCloudinary(file);
        updateData.image = imageUrl;
      } catch (error) {
        throw new BadRequestException('Gagal mengupload gambar ke Cloudinary');
      }
    }

    return await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        target: true,
        updatedAt: true,
      },
    });
  }

  async getUserStats(userId: string): Promise<UserStatsDto> {
    const now = new Date();
    const oneWeekAgo = new Date(now.setDate(now.getDate() - 7));

    const [user, lastAttempt, bestScore, weeklyActivity, totalFinished] =
      await Promise.all([
        this.prisma.user.findUnique({
          where: { id: userId },
          select: {
            tokenBalance: true,
            currentStreak: true,
            isPremium: true,
            premiumExpiresAt: true,
          },
        }),
        this.prisma.tryOutAttempt.findFirst({
          where: { userId, status: TryoutStatus.FINISHED },
          orderBy: { finishedAt: 'desc' },
          select: { totalScore: true },
        }),
        this.prisma.tryOutAttempt.aggregate({
          where: { userId, status: TryoutStatus.FINISHED },
          _max: { totalScore: true },
        }),
        this.prisma.tryOutAttempt.count({
          where: {
            userId,
            startedAt: { gte: oneWeekAgo },
          },
        }),
        this.prisma.tryOutAttempt.count({
          where: { userId, status: TryoutStatus.FINISHED },
        }),
      ]);

    return {
      lastScore: lastAttempt?.totalScore
        ? Math.round(lastAttempt.totalScore)
        : 0,
      personalBest: bestScore._max.totalScore
        ? Math.round(bestScore._max.totalScore)
        : 0,
      weeklyActivity: weeklyActivity,
      totalFinished: totalFinished,
      tokenBalance: user?.tokenBalance || 0,
      currentStreak: user?.currentStreak || 0,
      isPremium: Boolean(
        user?.isPremium &&
          (!user?.premiumExpiresAt || user.premiumExpiresAt > new Date()),
      ),
      premiumExpiresAt: user?.premiumExpiresAt || null,
    };
  }

  async getDailyQuestion(userId: string): Promise<DailyQuestionResponseDto> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingLog = await this.prisma.dailyQuestionLog.findFirst({
      where: {
        userId,
        completedAt: { gte: today },
      },
    });

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currentStreak: true },
    });

    if (existingLog) {
      return {
        isCompleted: true,
        streak: user?.currentStreak || 0,
        question: null,
      };
    }

    const totalQuestion = await this.prisma.question.count();
    const skip = Math.floor(Math.random() * totalQuestion);

    const randomQuestion = await this.prisma.question.findFirst({
      skip: skip,
      include: {
        items: true,
      },
    });

    if (!randomQuestion) {
      return {
        isCompleted: false,
        streak: user?.currentStreak || 0,
        question: null,
      };
    }

    return {
      isCompleted: false,
      streak: user?.currentStreak || 0,
      question: {
        id: randomQuestion.id,
        content: randomQuestion.content || 'Soal Error!',
        options: randomQuestion.items.map((item) => ({
          id: item.id,
          content: item.content || '',
        })),
      },
    };
  }

  async answerDailyQuestion(userId: string, payload: SubmitDailyAnswerDto) {
    const selectedItem = await this.prisma.questionItem.findUnique({
      where: { id: payload.answerId },
    });

    if (!selectedItem) {
      throw new BadRequestException('Jawaban tidak valid!');
    }
    const isCorrect = selectedItem.isCorrect;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    let newStreak = user?.currentStreak || 0;

    const now = new Date();

    if (isCorrect) {
      newStreak += 1;
    } else {
      newStreak = 0;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.dailyQuestionLog.create({
        data: {
          userId,
          questionId: selectedItem.questionId,
          isCorrect,
          completedAt: now,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          currentStreak: newStreak,
          lastDailyDate: now,
        },
      });
    });

    let correctAnswerId: string | undefined = undefined;
    if (!isCorrect) {
      const correctItem = await this.prisma.questionItem.findFirst({
        where: { questionId: selectedItem.questionId, isCorrect: true },
      });
      correctAnswerId = correctItem?.id;
    }

    return { isCorrect, newStreak, correctAnswerId };
  }

  async getScoreHistory(userId: string): Promise<ScoreDataDto[]> {
    const attempts = await this.prisma.tryOutAttempt.findMany({
      where: {
        userId,
        status: 'FINISHED',
      },
      orderBy: {
        finishedAt: 'asc',
      },
      include: {
        tryOut: {
          select: {
            code: true,
          },
        },
        answers: {
          include: {
            question: {
              select: {
                points: true,
                subtest: true, // Ambil semua field subtest termasuk name
              },
            },
          },
        },
      },
    });

    return attempts.map((attempt) => {
      const scores = {
        pu: 0,
        ppu: 0,
        pbm: 0,
        pk: 0,
        lbi: 0,
        lbe: 0,
        pm: 0,
      };

      attempt.answers.forEach((answer) => {
        if (answer.isCorrect && answer.question?.subtest?.name) {
          const subtestName = answer.question.subtest.name.toUpperCase().trim();
          const points = answer.question.points || 0;

          if (subtestName === 'PU') scores.pu += points;
          if (subtestName === 'PPU') scores.ppu += points;
          if (subtestName === 'PBM') scores.pbm += points;
          if (subtestName === 'PK') scores.pk += points;
          if (subtestName === 'LBI') scores.lbi += points;
          if (subtestName === 'LBE') scores.lbe += points;
          if (subtestName === 'PM') scores.pm += points;
        }
      });

      return {
        to: `TO ${attempt.tryOut.code}`,
        total: attempt.totalScore ? Math.round(attempt.totalScore) : 0, // Use stored totalScore
        ...scores,
      };
    });
  }

  async getActiveTryouts(userId: string): Promise<ActiveTryoutDto[]> {
    const registeredTryouts = await this.prisma.tryOutAttempt.findMany({
      where: {
        userId,
        status: 'IN_PROGRESS',
      },
      include: {
        tryOut: {
          include: {
            subtests: {
              select: { id: true },
            },
            _count: {
              select: {
                attempts: true,
              },
            },
          },
        },
        answers: {
          select: {
            question: {
              select: {
                subtestId: true,
              },
            },
          },
        },
      },
    });

    return registeredTryouts.map((tryout) => {
      const ansSubtestId = new Set(
        tryout.answers.map((a) => a.question.subtestId),
      );
      return {
        id: tryout.tryOut.id,
        title: tryout.tryOut.title,
        code: tryout.tryOut.code,
        batch: tryout.tryOut.batch,
        participants: tryout.tryOut._count.attempts,
        progress: ansSubtestId.size,
        totalSubtests: tryout.tryOut.subtests.length,
        endDate: tryout.tryOut.scheduledStart,
      };
    });
  }

  async getOngoingTryouts(userId: string): Promise<OngoingTryoutDto[]> {
    const now = new Date();
    const tryouts = await this.prisma.tryOut.findMany({
      where: {
        scheduledStart: { lte: now },
        isPublic: true,
      },
      include: {
        _count: {
          select: { attempts: true },
        },
        attempts: {
          where: { userId },
          select: { id: true, status: true, totalScore: true }, // Select score
          orderBy: { startedAt: 'desc' }, // Ambil attempt terbaru
          take: 1,
        },
      },
      orderBy: { scheduledStart: 'desc' },
    });

    return tryouts.map((t) => {
      const now = new Date();
      let status = t.attempts.length > 0 ? t.attempts[0].status : undefined;

      // Force status to FINISHED if tryout expired (Override attempt status)
      if (t.scheduledEnd && now > t.scheduledEnd) {
        status = 'FINISHED';
      }

      return {
        id: t.id,
        title: t.title,
        description: t.description,
        solutionPrice: t.solutionPrice,
        isPublic: t.isPublic,
        scheduledStart: t.scheduledStart,
        createdAt: t.createdAt,
        participants: t._count.attempts,
        isRegistered: t.attempts.length > 0,
        status: status,
        score: t.attempts.length > 0 ? t.attempts[0].totalScore : undefined, // Map score
      };
    });
  }

  async getAvailableTryouts(userId: string): Promise<OngoingTryoutDto[]> {
    const now = new Date();
    const tryouts = await this.prisma.tryOut.findMany({
      where: {
        scheduledStart: { gt: now },
        isPublic: true,
      },
      include: {
        _count: {
          select: { attempts: true },
        },
        attempts: {
          where: { userId },
          select: { id: true, status: true }, // Pastikan status di-select
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { scheduledStart: 'asc' },
    });

    return tryouts.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      solutionPrice: t.solutionPrice,
      isPublic: t.isPublic,
      scheduledStart: t.scheduledStart,
      createdAt: t.createdAt,
      participants: t._count.attempts,
      isRegistered: t.attempts.length > 0,
      status: t.attempts.length > 0 ? t.attempts[0].status : undefined,
    }));
  }
}
