-- Align the active public tryout schema with prisma/schema.prisma.
-- Additive and safe to rerun; existing answers and scores remain intact.

ALTER TABLE public."Question"
  ADD COLUMN IF NOT EXISTS "irt_a" DOUBLE PRECISION DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "irt_b" DOUBLE PRECISION DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS "irt_c" DOUBLE PRECISION DEFAULT 0.0;

CREATE TABLE IF NOT EXISTS public."TryOutSubtestScore" (
  "id" TEXT NOT NULL,
  "tryout_attempt_id" TEXT NOT NULL,
  "subtest_id" TEXT NOT NULL,
  "subtest_name" public."SubtestName" NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "theta" DOUBLE PRECISION NOT NULL,
  "sem" DOUBLE PRECISION,
  "correct_count" INTEGER NOT NULL,
  "wrong_count" INTEGER NOT NULL,
  "empty_count" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TryOutSubtestScore_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TryOutSubtestScore_tryout_attempt_id_fkey"
    FOREIGN KEY ("tryout_attempt_id") REFERENCES public."TryOutAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TryOutSubtestScore_subtest_id_fkey"
    FOREIGN KEY ("subtest_id") REFERENCES public."Subtest"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TryOutSubtestScore_tryout_attempt_id_subtest_id_key"
  ON public."TryOutSubtestScore"("tryout_attempt_id", "subtest_id");
CREATE INDEX IF NOT EXISTS "TryOutSubtestScore_tryout_attempt_id_idx"
  ON public."TryOutSubtestScore"("tryout_attempt_id");
CREATE INDEX IF NOT EXISTS "TryOutSubtestScore_subtest_id_idx"
  ON public."TryOutSubtestScore"("subtest_id");

ALTER TABLE public."TryOutSubtestScore" ENABLE ROW LEVEL SECURITY;
