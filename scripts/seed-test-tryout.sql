-- Paket SNBT dummy untuk menguji alur tryout end-to-end.
-- Aman dijalankan ulang: seluruh ID tetap dan INSERT memakai ON CONFLICT.
-- Soal dan jawaban sengaja sama di seluruh 160 nomor.

BEGIN;

INSERT INTO public."TryOut" (
  "id", "title", "description", "solutionPrice", "isPublic", "isSpecial",
  "scheduledStart", "scheduledEnd", "releaseDate", "status", "batch",
  "curation_status", "questions_released", "questions_released_at", "break_seconds"
) VALUES (
  'tryout-test-snbt-160',
  'TESTING - Tryout Lengkap SNBT (160 Soal Dummy)',
  'Paket uji 7 subtes. Semua soal dummy sama: 2 + 2. Jangan gunakan hasilnya sebagai nilai akademik.',
  0, true, false,
  (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 hour',
  (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '30 days',
  CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
  'IN_PROGRESS'::public."TryoutStatus", 'SNBT'::public."TryoutBatch",
  'PUBLISHED', true, CURRENT_TIMESTAMP, 60
)
ON CONFLICT ("id") DO NOTHING;

WITH plans(name, duration_minutes, subtest_order, question_count) AS (
  VALUES
    ('PU', 30, 1, 30),
    ('PPU', 15, 2, 20),
    ('PBM', 25, 3, 20),
    ('PK', 20, 4, 20),
    ('LBI', 43, 5, 30),
    ('LBE', 30, 6, 20),
    ('PM', 30, 7, 20)
)
INSERT INTO public."Subtest" (
  "id", "try_out_id", "name", "duration_minutes", "order", "target_question_count"
)
SELECT
  'tryout-test-snbt-160-' || lower(name),
  'tryout-test-snbt-160',
  name::public."SubtestName",
  duration_minutes,
  subtest_order,
  question_count
FROM plans
ON CONFLICT ("id") DO NOTHING;

WITH plans(name, question_count) AS (
  VALUES
    ('PU', 30), ('PPU', 20), ('PBM', 20), ('PK', 20),
    ('LBI', 30), ('LBE', 20), ('PM', 20)
)
INSERT INTO public."Question" (
  "id", "subtest_id", "subtest", "tryoutId", "type", "target", "status",
  "difficulty", "content", "explanation", "points"
)
SELECT
  'tryout-test-snbt-160-' || lower(plans.name) || '-' || lpad(number::text, 3, '0'),
  'tryout-test-snbt-160-' || lower(plans.name),
  plans.name,
  'tryout-test-snbt-160',
  'PILIHAN_GANDA'::public."QuestionType",
  'FOR_TRYOUT',
  'READY',
  'MEDIUM',
  'Berapa hasil dari 2 + 2?',
  '2 + 2 = 4. Jawaban yang benar adalah A.',
  1
FROM plans
CROSS JOIN LATERAL generate_series(1, plans.question_count) AS number
ON CONFLICT ("id") DO NOTHING;

WITH options(option_order, option_text, is_correct, option_code) AS (
  VALUES
    (1, '4', true, 'a'),
    (2, '3', false, 'b'),
    (3, '5', false, 'c'),
    (4, '6', false, 'd'),
    (5, '7', false, 'e')
)
INSERT INTO public."QuestionItem" (
  "id", "question_id", "content", "is_correct", "order"
)
SELECT
  question."id" || '-' || options.option_code,
  question."id",
  options.option_text,
  options.is_correct,
  options.option_order
FROM public."Question" AS question
CROSS JOIN options
WHERE question."tryoutId" = 'tryout-test-snbt-160'
ON CONFLICT ("id") DO NOTHING;

COMMIT;
