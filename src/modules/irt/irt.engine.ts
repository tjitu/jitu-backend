import {
  StudentItemEvaluation,
  SubtestEvaluationInput,
  SubtestIrtResult,
  TryoutIrtEvaluationResult,
} from './irt.types';

export const D_SCALING = 1.702;
export const QUADRATURE_COUNT = 41;
export const THETA_MIN = -4.0;
export const THETA_MAX = 4.0;
export const SCORE_MIN = 200;
export const SCORE_MAX = 1000;
export const SCORE_MEAN = 500;
export const SCORE_SD = 100;

interface QuadratureNode {
  theta: number;
  weight: number; // Prior N(0, 1) density
}

/** Pre-computed Gauss-Hermite / uniform grid quadrature nodes for EAP calculation */
const QUADRATURE_NODES: QuadratureNode[] = (() => {
  const nodes: QuadratureNode[] = [];
  const step = (THETA_MAX - THETA_MIN) / (QUADRATURE_COUNT - 1);
  const invSqrt2Pi = 1 / Math.sqrt(2 * Math.PI);

  for (let i = 0; i < QUADRATURE_COUNT; i++) {
    const theta = THETA_MIN + i * step;
    const weight = invSqrt2Pi * Math.exp(-0.5 * theta * theta);
    nodes.push({ theta, weight });
  }
  return nodes;
})();

/**
 * Computes 3-Parameter Logistic (3PL) Item Response Theory probability:
 * P(theta) = c + (1 - c) / (1 + exp(-1.702 * a * (theta - b)))
 */
export function computeItemProbability(
  theta: number,
  a: number,
  b: number,
  c: number,
): number {
  const boundedC = Math.max(0, Math.min(0.5, Number.isFinite(c) ? c : 0.0));
  const boundedA = Math.max(0.1, Math.min(4.0, Number.isFinite(a) ? a : 1.0));
  const boundedB = Math.max(-4.0, Math.min(4.0, Number.isFinite(b) ? b : 0.0));

  const exponent = -D_SCALING * boundedA * (theta - boundedB);

  // Numerical precision guard against extreme exponents
  if (exponent > 35) return boundedC;
  if (exponent < -35) return 1.0;

  return boundedC + (1 - boundedC) / (1 + Math.exp(exponent));
}

/**
 * Expected A Posteriori (EAP) Bayesian estimator for Examinee Ability (theta).
 * Yields stable, finite theta and standard error of measurement (SEM) for any response pattern.
 */
export function estimateThetaEAP(items: StudentItemEvaluation[]): {
  theta: number;
  sem: number;
} {
  if (!items || items.length === 0) {
    return { theta: 0.0, sem: 1.0 };
  }

  // Pre-calculate log-likelihood for each quadrature point
  const logLikelihoods = new Float64Array(QUADRATURE_COUNT);

  for (let k = 0; k < QUADRATURE_COUNT; k++) {
    const theta = QUADRATURE_NODES[k].theta;
    let logLikelihood = 0.0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const p = computeItemProbability(
        theta,
        item.params.a,
        item.params.b,
        item.params.c,
      );
      const safeP = Math.max(1e-9, Math.min(1.0 - 1e-9, p));

      if (item.isCorrect) {
        logLikelihood += Math.log(safeP);
      } else {
        logLikelihood += Math.log(1.0 - safeP);
      }
    }
    logLikelihoods[k] = logLikelihood;
  }

  // Log-sum-exp trick for numerical stability without underflow/overflow
  let maxLog = -Infinity;
  for (let k = 0; k < QUADRATURE_COUNT; k++) {
    if (logLikelihoods[k] > maxLog) maxLog = logLikelihoods[k];
  }

  const posteriorWeights = new Float64Array(QUADRATURE_COUNT);
  let sumWeights = 0.0;

  for (let k = 0; k < QUADRATURE_COUNT; k++) {
    const likelihood = Math.exp(logLikelihoods[k] - maxLog);
    const postWeight = likelihood * QUADRATURE_NODES[k].weight;
    posteriorWeights[k] = postWeight;
    sumWeights += postWeight;
  }

  if (sumWeights <= 0 || !Number.isFinite(sumWeights)) {
    return { theta: 0.0, sem: 1.0 };
  }

  // Compute posterior mean (EAP theta)
  let eapTheta = 0.0;
  for (let k = 0; k < QUADRATURE_COUNT; k++) {
    const normWeight = posteriorWeights[k] / sumWeights;
    eapTheta += QUADRATURE_NODES[k].theta * normWeight;
  }

  // Compute posterior variance & SEM
  let variance = 0.0;
  for (let k = 0; k < QUADRATURE_COUNT; k++) {
    const normWeight = posteriorWeights[k] / sumWeights;
    const diff = QUADRATURE_NODES[k].theta - eapTheta;
    variance += diff * diff * normWeight;
  }

  const sem = Math.sqrt(Math.max(1e-4, variance));

  return {
    theta: Math.max(THETA_MIN, Math.min(THETA_MAX, eapTheta)),
    sem: Number(sem.toFixed(4)),
  };
}

/** Converts normal-ogive ability theta to UTBK standard scaled score (200 - 1000). */
export function thetaToUtbkScore(theta: number): number {
  const rawScore = SCORE_MEAN + SCORE_SD * theta;
  return Math.round(Math.max(SCORE_MIN, Math.min(SCORE_MAX, rawScore)));
}

/** Evaluates a single subtest and produces its IRT metrics. */
export function evaluateSubtestIrt(
  input: SubtestEvaluationInput,
): SubtestIrtResult {
  const { subtestId, subtestName, items } = input;
  const totalQuestions = items.length;
  const correctCount = items.filter((it) => it.isCorrect).length;
  const wrongCount = items.filter((it) => it.isAnswered && !it.isCorrect).length;
  const emptyCount = items.filter((it) => !it.isAnswered).length;

  const { theta, sem } = estimateThetaEAP(items);
  const score = thetaToUtbkScore(theta);

  return {
    subtestId,
    subtestName,
    theta: Number(theta.toFixed(4)),
    sem,
    score,
    correctCount,
    wrongCount,
    emptyCount,
    totalQuestions,
  };
}

/** Evaluates all subtests of a tryout and calculates composite overall score. */
export function evaluateTryoutIrt(
  subtests: SubtestEvaluationInput[],
): TryoutIrtEvaluationResult {
  if (!subtests || subtests.length === 0) {
    return { overallScore: SCORE_MIN, subtestScores: [] };
  }

  const subtestScores = subtests.map(evaluateSubtestIrt);
  const totalSubtestScore = subtestScores.reduce((sum, res) => sum + res.score, 0);
  const overallScore = Math.round(
    Math.max(
      SCORE_MIN,
      Math.min(SCORE_MAX, totalSubtestScore / subtestScores.length),
    ),
  );

  return {
    overallScore,
    subtestScores,
  };
}
