import {
  computeItemProbability,
  estimateThetaEAP,
  thetaToUtbkScore,
  evaluateSubtestIrt,
  evaluateTryoutIrt,
} from './irt.engine';
import { StudentItemEvaluation, SubtestEvaluationInput } from './irt.types';

describe('IrtEngine', () => {
  describe('computeItemProbability', () => {
    it('should return c when theta is extremely low', () => {
      const p = computeItemProbability(-10, 1.0, 0.0, 0.2);
      expect(p).toBeCloseTo(0.2, 2);
    });

    it('should return 1.0 when theta is extremely high', () => {
      const p = computeItemProbability(10, 1.0, 0.0, 0.2);
      expect(p).toBeCloseTo(1.0, 2);
    });

    it('should return inflection point c + (1-c)/2 when theta equals difficulty b', () => {
      const p = computeItemProbability(0.5, 1.0, 0.5, 0.2);
      expect(p).toBeCloseTo(0.6, 2);
    });

    it('should increase monotonically with higher ability theta', () => {
      const p1 = computeItemProbability(-1.0, 1.2, 0.0, 0.2);
      const p2 = computeItemProbability(0.0, 1.2, 0.0, 0.2);
      const p3 = computeItemProbability(1.0, 1.2, 0.0, 0.2);
      expect(p1).toBeLessThan(p2);
      expect(p2).toBeLessThan(p3);
    });
  });

  describe('estimateThetaEAP', () => {
    const buildItems = (
      pattern: Array<{ isCorrect: boolean; b: number }>,
    ): StudentItemEvaluation[] =>
      pattern.map((item, idx) => ({
        questionId: `q-${idx}`,
        isCorrect: item.isCorrect,
        isAnswered: true,
        params: {
          questionId: `q-${idx}`,
          a: 1.2,
          b: item.b,
          c: 0.2,
        },
      }));

    it('should estimate high positive theta for all correct responses on full subtest', () => {
      const fullCorrect = buildItems([
        { isCorrect: true, b: -1.5 },
        { isCorrect: true, b: -1.0 },
        { isCorrect: true, b: -0.5 },
        { isCorrect: true, b: 0.0 },
        { isCorrect: true, b: 0.5 },
        { isCorrect: true, b: 1.0 },
        { isCorrect: true, b: 1.5 },
        { isCorrect: true, b: 2.0 },
      ]);
      const { theta, sem } = estimateThetaEAP(fullCorrect);
      expect(theta).toBeGreaterThan(1.5);
      expect(sem).toBeGreaterThan(0);
    });

    it('should estimate negative theta for all incorrect responses', () => {
      const fullWrong = buildItems([
        { isCorrect: false, b: -1.0 },
        { isCorrect: false, b: 0.0 },
        { isCorrect: false, b: 1.0 },
        { isCorrect: false, b: 2.0 },
      ]);
      const { theta } = estimateThetaEAP(fullWrong);
      expect(theta).toBeLessThan(-1.0);
    });

    it('should demonstrate difficulty monotonicity: solving harder problems correctly yields higher theta', () => {
      // Student A solves easy questions correctly (b = -1.5, b = -0.5)
      const studentA = buildItems([
        { isCorrect: true, b: -1.5 },
        { isCorrect: true, b: -0.5 },
      ]);
      // Student B solves hard questions correctly (b = 0.5, b = 1.5)
      const studentB = buildItems([
        { isCorrect: true, b: 0.5 },
        { isCorrect: true, b: 1.5 },
      ]);

      const thetaA = estimateThetaEAP(studentA).theta;
      const thetaB = estimateThetaEAP(studentB).theta;
      expect(thetaB).toBeGreaterThan(thetaA);
    });
  });

  describe('thetaToUtbkScore', () => {
    it('should map theta 0 to 500', () => {
      expect(thetaToUtbkScore(0)).toBe(500);
    });

    it('should map theta +2 to 700', () => {
      expect(thetaToUtbkScore(2)).toBe(700);
    });

    it('should clamp scores within 200 to 1000', () => {
      expect(thetaToUtbkScore(-5.0)).toBe(200);
      expect(thetaToUtbkScore(6.0)).toBe(1000);
    });
  });

  describe('evaluateSubtestIrt & evaluateTryoutIrt', () => {
    it('should calculate subtest and overall composite IRT scores', () => {
      const subtest1: SubtestEvaluationInput = {
        subtestId: 'sub-pu',
        subtestName: 'PU',
        items: [
          {
            questionId: 'q1',
            isCorrect: true,
            isAnswered: true,
            params: { questionId: 'q1', a: 1.2, b: 0.5, c: 0.2 },
          },
          {
            questionId: 'q2',
            isCorrect: true,
            isAnswered: true,
            params: { questionId: 'q2', a: 1.0, b: 0.0, c: 0.2 },
          },
        ],
      };

      const subtest2: SubtestEvaluationInput = {
        subtestId: 'sub-pk',
        subtestName: 'PK',
        items: [
          {
            questionId: 'q3',
            isCorrect: false,
            isAnswered: true,
            params: { questionId: 'q3', a: 1.0, b: 0.0, c: 0.2 },
          },
          {
            questionId: 'q4',
            isCorrect: false,
            isAnswered: false,
            params: { questionId: 'q4', a: 1.0, b: 1.0, c: 0.2 },
          },
        ],
      };

      const result = evaluateTryoutIrt([subtest1, subtest2]);

      expect(result.subtestScores).toHaveLength(2);
      expect(result.subtestScores[0].subtestName).toBe('PU');
      expect(result.subtestScores[0].score).toBeGreaterThan(500);
      expect(result.subtestScores[1].subtestName).toBe('PK');
      expect(result.subtestScores[1].score).toBeLessThan(500);

      // Overall score is the average
      const expectedAvg = Math.round(
        (result.subtestScores[0].score + result.subtestScores[1].score) / 2,
      );
      expect(result.overallScore).toBe(expectedAvg);
      expect(result.overallScore).toBeGreaterThanOrEqual(200);
      expect(result.overallScore).toBeLessThanOrEqual(1000);
    });
  });
});
