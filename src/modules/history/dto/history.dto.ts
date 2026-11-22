export class TryoutHistoryDto {
  id: string;
  title: string;
  date: string;
  score: number | null;
  maxScore: number;
  duration: string;
  questionsAnswered: number;
  totalQuestions: number;
  category: string;
  status: string;
  breakdown: {
    pu: number;
    ppu: number;
    pbm: number;
    pk: number;
    lbi: number;
    lbe: number;
    pm: number;
  };
}
