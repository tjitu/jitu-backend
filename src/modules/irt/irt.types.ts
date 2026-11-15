export interface ItemParameters {
  questionId: string;
  a: number; // Discrimination parameter (0.5 to 2.5, default 1.0)
  b: number; // Difficulty parameter (-3.0 to +3.0, default 0.0)
  c: number; // Guessing parameter (0.0 to 0.25, default 0.2 for MC, 0.0 for short answer)
}

export interface StudentItemEvaluation {
  questionId: string;
  isCorrect: boolean;
  isAnswered: boolean;
  params: ItemParameters;
}

export interface SubtestEvaluationInput {
  subtestId: string;
  subtestName: string;
  items: StudentItemEvaluation[];
}

export interface SubtestIrtResult {
  subtestId: string;
  subtestName: string;
  theta: number;
  sem: number;
  score: number; // UTBK scaled score (200 - 1000)
  correctCount: number;
  wrongCount: number;
  emptyCount: number;
  totalQuestions: number;
}

export interface TryoutIrtEvaluationResult {
  overallScore: number; // UTBK scaled score (200 - 1000)
  subtestScores: SubtestIrtResult[];
}
