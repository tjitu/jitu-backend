import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { evaluateTryoutIrt } from './irt.engine';
import {
  StudentItemEvaluation,
  SubtestEvaluationInput,
  TryoutIrtEvaluationResult,
} from './irt.types';
import { QuestionType, SubtestName } from '../../../generated/prisma/client';

@Injectable()
export class IrtService {
  private readonly logger = new Logger(IrtService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculates comprehensive 3PL EAP IRT scores for all subtests and composite overall score,
   * then persists results to TryOutSubtestScore and updates TryOutAttempt.totalScore.
   */
  async calculateAndSaveAttemptScore(
    attemptId: string,
    userId?: string,
  ): Promise<TryoutIrtEvaluationResult> {
    const attempt = await this.prisma.tryOutAttempt.findUnique({
      where: { id: attemptId },
      include: {
        tryOut: {
          include: {
            subtests: {
              orderBy: { order: 'asc' },
              include: {
                questions: {
                  select: {
                    id: true,
                    type: true,
                    irtA: true,
                    irtB: true,
                    irtC: true,
                  },
                },
              },
            },
          },
        },
        answers: {
          select: {
            questionId: true,
            isCorrect: true,
          },
        },
      },
    });

    if (!attempt) {
      throw new NotFoundException(`Attempt ${attemptId} tidak ditemukan.`);
    }

    // Build fast lookup for student's graded answers
    const answersMap = new Map<string, boolean>();
    for (const ans of attempt.answers) {
      answersMap.set(ans.questionId, Boolean(ans.isCorrect));
    }

    const subtestInputs: SubtestEvaluationInput[] = [];

    for (const subtest of attempt.tryOut.subtests) {
      const questions = subtest.questions || [];
      const items: StudentItemEvaluation[] = questions.map((q) => {
        const isAnswered = answersMap.has(q.id);
        const isCorrect = isAnswered && answersMap.get(q.id) === true;

        const defaultC =
          q.type === QuestionType.PILIHAN_GANDA ? 0.2 : 0.0;

        return {
          questionId: q.id,
          isCorrect,
          isAnswered,
          params: {
            questionId: q.id,
            a: typeof q.irtA === 'number' && Number.isFinite(q.irtA) ? q.irtA : 1.0,
            b: typeof q.irtB === 'number' && Number.isFinite(q.irtB) ? q.irtB : 0.0,
            c: typeof q.irtC === 'number' && Number.isFinite(q.irtC) ? q.irtC : defaultC,
          },
        };
      });

      subtestInputs.push({
        subtestId: subtest.id,
        subtestName: subtest.name,
        items,
      });
    }

    const evaluation = evaluateTryoutIrt(subtestInputs);

    this.logger.log(
      `IRT Evaluation for Attempt ${attemptId}: Overall Score = ${evaluation.overallScore}, Subtests = ${evaluation.subtestScores.length}`,
    );

    // Atomically persist subtest scores and update attempt totalScore
    await this.prisma.$transaction(async (tx) => {
      for (const res of evaluation.subtestScores) {
        await tx.tryOutSubtestScore.upsert({
          where: {
            tryOutAttemptId_subtestId: {
              tryOutAttemptId: attemptId,
              subtestId: res.subtestId,
            },
          },
          update: {
            score: res.score,
            theta: res.theta,
            sem: res.sem,
            correctCount: res.correctCount,
            wrongCount: res.wrongCount,
            emptyCount: res.emptyCount,
          },
          create: {
            tryOutAttemptId: attemptId,
            subtestId: res.subtestId,
            subtestName: res.subtestName as SubtestName,
            score: res.score,
            theta: res.theta,
            sem: res.sem,
            correctCount: res.correctCount,
            wrongCount: res.wrongCount,
            emptyCount: res.emptyCount,
          },
        });
      }

      await tx.tryOutAttempt.update({
        where: { id: attemptId },
        data: {
          totalScore: evaluation.overallScore,
          status: 'FINISHED',
          finishedAt: new Date(),
        },
      });
    });

    return evaluation;
  }
}
