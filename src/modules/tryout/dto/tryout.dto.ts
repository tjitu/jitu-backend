export class TryOutCardDto {
  id: string;
  title: string;
  number: string;
  canEdit: boolean;
  participants: number;
  badge: string;
  description?: string | null;
  solutionPrice?: number;
  isPublic?: boolean;
  isSpecial?: boolean;
  isRegistered?: boolean;
  curationStatus?: string;
  isSandboxPreview?: boolean;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  latestAttemptStatus?: 'IN_PROGRESS' | 'FINISHED' | 'NOT_STARTED' | null;
  latestFinishedAttemptId?: string | null;
  resumeUrl?: string | null;
}

export class SubjectDto {
  id: number;
  title: string;
  gradient: string;
  count: number;
}

export class TryoutDetailDto {
  id: string;
  title: string;
  number: string;
  badge: string;
  participants: number;
  description: string;
  duration: number;
  totalQuestions: number;
  startDate: string;
  endDate: string;
  isRegistered: boolean;
  isFree: boolean;
  isSpecial?: boolean;
  tokenCost?: number;
  latestFinishedAttemptId?: string | null;
  latestAttemptStatus?: 'IN_PROGRESS' | 'FINISHED' | 'NOT_STARTED' | null;
  latestAttemptId?: string | null;
  currentSubtestOrder?: number;
  isWaitingTransition?: boolean;
  nextSubtestOrder?: number | null;
  resumeUrl?: string | null;
  latestScore?: number;
  correctCount?: number;
  wrongCount?: number;
  emptyCount?: number;
  categories: {
    id: number;
    name: string;
    questionCount: number;
    duration: number;
    isCompleted: boolean;
    score?: number;
    correctCount?: number;
    wrongCount?: number;
    emptyCount?: number;
  }[];
  benefits: string[];
  requirements: string[];
  unlockedSolutions: any[];
  curationStatus?: string;
  questionsReleased?: boolean;
  breakSeconds?: number;
  isSandboxPreview?: boolean;
}

export class QuestionDto {
  id: number;
  questionText: string;
  options: string[];
  correctAnswer?: number;
  solution?: string;
}

export class SubtestExamDto {
  subtestId: number;
  subtestName: string;
  tryoutId: string;
  tryoutTitle: string;
  duration: number;
  questions: any[];
  allSubtests?: any[];
}

export class LeaderboardItemDto {
  rank: number;
  name: string;
  score: number;
  isCurrentUser: boolean;
}

export class LeaderboardDto {
  top10: LeaderboardItemDto[];
  currentUserRank: LeaderboardItemDto | null;
}
