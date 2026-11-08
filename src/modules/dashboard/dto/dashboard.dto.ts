import { IsNotEmpty, IsString } from 'class-validator';

export class StatCardDto {
  label: string;
  value: string;
  color?: string;
  bgColor?: string;
  suffix?: string;
}

export class ScoreDataDto {
  to: string;
  total: number;
  pu: number;
  ppu: number;
  pbm: number;
  pk: number;
  lbi: number;
  lbe: number;
  pm: number;
}

export class SubtestDto {
  id: string;
  label: string;
  color: string;
  hoverColor: string;
}

export class MenuItemDto {
  label: string;
  description: string;
  color?: string;
  bgColor?: string;
  action?: string;
  items?: {
    label: string;
    description?: string;
    toggle?: boolean;
    link?: boolean;
  }[];
}

export class DashboardDataDto {
  stats: StatCardDto[];
  scoreHistory: ScoreDataDto[];
  subtests: SubtestDto[];
  menuItems: MenuItemDto[];
}

export class UserStatsDto {
  lastScore: number;
  personalBest: number;
  weeklyActivity: number;
  totalFinished: number;
  tokenBalance: number;
  currentStreak: number;
  isPremium?: boolean;
  premiumExpiresAt?: Date | null;
}

export class SubmitDailyAnswerDto {
  @IsString()
  @IsNotEmpty()
  questionId: string;

  @IsString()
  @IsNotEmpty()
  answerId: string;
}

export class DailyQuestionDto {
  id: string;
  content: string;
  options: {
    id: string;
    content: string;
  }[];
}

export class DailyQuestionResponseDto {
  isCompleted: boolean;
  streak: number;
  question: DailyQuestionDto | null;
}

export class ActiveTryoutDto {
  id: string;
  title: string;
  code: number;
  batch: string;
  participants: number;
  progress: number;
  totalSubtests: number;
  endDate: Date | null;
}

export class OngoingTryoutDto {
  id: string;
  title: string;
  description: string | null;
  solutionPrice: number;
  isPublic: boolean;
  scheduledStart: Date | null;
  createdAt: Date;
  participants: number;
  isRegistered: boolean;
  status?: string; // IN_PROGRESS, FINISHED, NOT_STARTED
  score?: number;
}
