import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma.service';

export interface ReviewSolution {
  id: string;
  questionId: string;
  steps: Prisma.JsonValue;
  staticContent: string | null;
  quickTrick: string | null;
  keyFormula: string | null;
  defaultView: string;
}

export async function loadReviewSolutions(prisma: PrismaService, ids: string[]) {
  const solutions = new Map<string, ReviewSolution>();
  if (!ids.length) return solutions;
  const rows = await prisma.$queryRaw<ReviewSolution[]>`
    SELECT id, "questionId",
           steps, "staticContent", "quickTrick", "keyFormula", "defaultView"
    FROM public."QuestionSolution"
    WHERE "questionId" IN (${Prisma.join(ids)})
  `;
  for (const row of rows) {
    let steps = row.steps;
    if (typeof steps === 'string') {
      try {
        steps = JSON.parse(steps);
      } catch {
        steps = [];
      }
    }
    solutions.set(row.questionId, { ...row, steps: Array.isArray(steps) ? steps : [] });
  }
  return solutions;
}
