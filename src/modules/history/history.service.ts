import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TryoutHistoryDto } from './dto/history.dto';

@Injectable()
export class HistoryService {
  constructor(private prisma: PrismaService) {}

  async getHistoryTryouts(userId: string): Promise<TryoutHistoryDto[]> {
    const tryouts = await this.prisma.tryOutAttempt.findMany({
      where: {
        userId,
        status: 'FINISHED',
      },
      orderBy: {
        finishedAt: 'desc',
      },
      include: {
        tryOut: {
          include: {
            subtests: {
              include: {
                questions: {
                  select: { id: true },
                },
              },
            },
          },
        },
        answers: {
          include: {
            question: {
              select: {
                points: true,
                subtest: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    return tryouts.map((tryout) => {
      const start = new Date(tryout.startedAt);
      const end = tryout.finishedAt ? new Date(tryout.finishedAt) : new Date();
      const durationMinutes = Math.round(
        (end.getTime() - start.getTime()) / 60000,
      );

      let totalQuestion = 0;
      tryout.tryOut.subtests.forEach((sub) => {
        totalQuestion += sub.questions.length;
      });

      const scores = {
        pu: 0,
        ppu: 0,
        pbm: 0,
        pk: 0,
        lbi: 0,
        lbe: 0,
        pm: 0,
      };

      tryout.answers.forEach((ans) => {
        if (ans.isCorrect && ans.question.subtest) {
          const subtestName = ans.question.subtest.name;
          const points = ans.question.points;

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
        id: tryout.tryOut.id,
        title: tryout.tryOut.title,
        date: tryout.finishedAt?.toISOString() ?? new Date().toISOString(),
        score: Math.round(tryout.totalScore),
        maxScore: 1000,
        duration: `${durationMinutes} Menit`,
        questionsAnswered: tryout.answers.length,
        totalQuestions: totalQuestion,
        category: tryout.tryOut.batch,
        status: 'selesai',
        breakdown: scores,
      };
    });
  }
}
