export const TryoutBatch = {
  SNBT: "SNBT",
  MANDIRI: "MANDIRI",
};

export const TryoutStatus = {
  NOT_STARTED: "NOT_STARTED",
  IN_PROGRESS: "IN_PROGRESS",
  FINISHED: "FINISHED",
};

export const SubtestName = {
  PU: "PU",
  PPU: "PPU",
  PBM: "PBM",
  PK: "PK",
  LBI: "LBI",
  LBE: "LBE",
  PM: "PM",
};

export const Role = {
  USER: "USER",
  ADMIN: "ADMIN",
};

export const QuestionType = {
  PILIHAN_GANDA: "PILIHAN_GANDA",
  ISIAN_SINGKAT: "ISIAN_SINGKAT",
  BENAR_SALAH: "BENAR_SALAH",
};

export const PaymentStatus = {
  PENDING: "PENDING",
  CONFIRMED: "CONFIRMED",
  CANCELLED: "CANCELLED",
  DECLINED: "DECLINED",
};

export const Prisma = {
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: [...strings],
    values,
  }),
  join: (values: unknown[]) => ({ values }),
};

export class PrismaClient {
  user = {};
  session = {};
  account = {};
  verification = {};
  tryOut = {};
  dailyQuestionLog = {};
  subtest = {};
  question = {};
  questionItem = {};
  tokenTransaction = {};
  tokenPackage = {};
  payment = {};
  unlockedSolution = {};
  tryOutAttempt = {};
  userAnswer = {};

  async $connect() {
    return undefined;
  }

  async $disconnect() {
    return undefined;
  }

  async $transaction<T>(callback: (tx: this) => Promise<T>) {
    return callback(this);
  }

  async $queryRaw() {
    return undefined;
  }

  async $executeRaw() {
    return 0;
  }
}
