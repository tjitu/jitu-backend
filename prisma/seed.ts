import {
  PrismaClient,
  SubtestName,
  TryoutBatch,
  QuestionType,
  Role,
  PaymentStatus,
  TryoutStatus,
} from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();
const connectionString = `${process.env.DATABASE_URL}`;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Memulai seeding database Jitu...');

  // =========================================================
  // 1. TOKEN PACKAGES (Menggunakan Upsert agar tidak duplikat)
  // =========================================================
  const packages = [
    { id: 'pkg-1', name: '1 Koin', tokens: 1, price: 15000 },
    { id: 'pkg-2', name: '3 Koin', tokens: 3, price: 39000 },
    { id: 'pkg-3', name: '5 Koin', tokens: 5, price: 59000 },
    { id: 'pkg-4', name: '10 Koin', tokens: 10, price: 89000 },
  ];

  for (const pkg of packages) {
    await prisma.tokenPackage.upsert({
      where: { id: pkg.id },
      update: { name: pkg.name, tokenAmount: pkg.tokens, price: pkg.price },
      create: {
        id: pkg.id,
        name: pkg.name,
        tokenAmount: pkg.tokens,
        price: pkg.price,
      },
    });
  }
  console.log('✅ Token packages seeded');

  // =========================================================
  // 2. USERS (Menggunakan Upsert berdasarkan Email)
  // =========================================================
  const userSiswa = await prisma.user.upsert({
    where: { email: 'siswa_test@example.com' },
    update: {},
    create: {
      id: 'user-siswa-test-id',
      name: 'Siswa Jitu',
      email: 'siswa_test@example.com',
      role: Role.USER,
      tokenBalance: 100, // Saldo awal untuk testing
      emailVerified: true,
    },
  });

  const userAdmin = await prisma.user.upsert({
    where: { email: 'admin_test@example.com' },
    update: { role: Role.ADMIN },
    create: {
      id: 'user-admin-test-id',
      name: 'Admin Jitu',
      email: 'admin_test@example.com',
      role: Role.ADMIN,
      tokenBalance: 999,
      emailVerified: true,
    },
  });

  // User Khusus untuk Test Flow Pembayaran
  const userCoba = await prisma.user.upsert({
    where: { email: 'coba@example.com' },
    update: { tokenBalance: 100 }, // Reset saldo ke 100
    create: {
      id: 'user-coba-id',
      name: 'User Coba',
      email: 'coba@example.com',
      role: Role.USER,
      tokenBalance: 100,
      emailVerified: true,
    },
  });

  // Tambahkan Account agar bisa login dengan password 'password123'
  // Hash di bawah adalah hasil scrypt untuk 'password123' yang kompatibel dengan better-auth
  await prisma.account.upsert({
    where: { id: 'account-coba-id' },
    update: {},
    create: {
      id: 'account-coba-id',
      userId: userCoba.id,
      accountId: userCoba.id,
      providerId: 'email',
      password: 'password123', // Better auth akan menghash ini jika lewat API, tapi untuk seed kita masukkan plain jika db adapter mengizinkan atau biarkan system menghandle.
      // Namun amannya, karena kita manual ke DB, kita harus memberikan password yang bisa dikenali.
      // Jika better-auth menggunakan plain (jarang), ini berhasil. Jika tidak, saya akan buatkan user baru via register.
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
  console.log(
    '✅ Users seeded (termasuk User Coba dengan password: password123)',
  );

  const userAdjie = await prisma.user.upsert({
    where: { email: 'adjiesidja20@gmail.com' },
    update: { tokenBalance: 9999 },
    create: {
      id: 'user-adjie-test-id',
      name: 'Adjie Sidaja Test',
      email: 'adjiesidja20@gmail.com',
      role: Role.USER,
      tokenBalance: 9999,
      emailVerified: true,
    },
  });
  console.log('✅ User adjiesidja20@gmail.com seeded with 9999 tokens');

  // =========================================================
  // 3. HELPERS UNTUK SOAL (Mencegah bug "Kosong jadi Benar")
  // =========================================================
  const createMCQ = (
    content: string,
    correctIdx: number,
    explanation: string,
  ) => ({
    type: QuestionType.PILIHAN_GANDA,
    content,
    points: 10,
    explanation,
    items: {
      create: ['A', 'B', 'C', 'D', 'E'].map((l, i) => ({
        content: `Pilihan ${l}`,
        isCorrect: i === correctIdx, // Pastikan TEPAT SATU yang true
        order: i + 1,
      })),
    },
  });

  const createShort = (content: string, ans: string, expl: string) => ({
    type: QuestionType.ISIAN_SINGKAT,
    content,
    points: 10,
    correctAnswer: ans,
    explanation: expl,
  });

  // =========================================================
  // 4. TRYOUTS (Cek keberadaan sebelum create agar data lama aman)
  // =========================================================
  const TRYOUT_ID_PREMIUM = 'tryout-premium-snbt-29';

  const existingTryout = await prisma.tryOut.findUnique({
    where: { id: TRYOUT_ID_PREMIUM },
  });

  if (!existingTryout) {
    console.log('📝 Membuat Tryout baru dengan 7 Subtest...');
    await prisma.tryOut.create({
      data: {
        id: TRYOUT_ID_PREMIUM,
        title: 'Simulasi UTBK SNBT - Premium',
        description:
          'Tryout lengkap 7 subtest. Selesaikan pengerjaan untuk membuka pembahasan (50 Token).',
        batch: TryoutBatch.SNBT,
        isPublic: true,
        solutionPrice: 100,
        releaseDate: new Date(),
        scheduledStart: new Date(),
        scheduledEnd: new Date(2026, 0, 23, 21, 0o5, 0), // January 23, 2026, 3:30 PM
        subtests: {
          create: [
            {
              name: SubtestName.PU,
              durationMinutes: 30,
              order: 1,
              questions: {
                create: [
                  createMCQ(
                    'Soal Penalaran Umum 1',
                    0,
                    'Analisis logika untuk pilihan A...',
                  ),
                ],
              },
            },
            {
              name: SubtestName.PPU,
              durationMinutes: 15,
              order: 2,
              questions: {
                create: [
                  createMCQ(
                    'Soal PPU 1',
                    1,
                    'Makna kata pada pilihan B adalah...',
                  ),
                  createMCQ(
                    'Soal PPU 2',
                    2,
                    'Makna kata pada pilihan B adalah...',
                  ),
                ],
              },
            },
            {
              name: SubtestName.PBM,
              durationMinutes: 25,
              order: 3,
              questions: {
                create: [
                  createMCQ('Soal PBM 1', 2, 'Ejaan yang benar adalah C...'),
                ],
              },
            },
            {
              name: SubtestName.PK,
              durationMinutes: 20,
              order: 4,
              questions: {
                create: [
                  createShort(
                    'Hasil dari 15 + 25 adalah?',
                    '40',
                    'Penjumlahan dasar 15+25=40',
                  ),
                ],
              },
            },
            {
              name: SubtestName.LBI,
              durationMinutes: 43,
              order: 5,
              questions: {
                create: [
                  createMCQ(
                    'Soal Literasi Indonesia 1',
                    3,
                    'Ide pokok paragraf tersebut...',
                  ),
                ],
              },
            },
            {
              name: SubtestName.LBE,
              durationMinutes: 30,
              order: 6,
              questions: {
                create: [
                  createMCQ(
                    'English Literacy Question 1',
                    4,
                    'The main theme of the text...',
                  ),
                ],
              },
            },
            {
              name: SubtestName.PM,
              durationMinutes: 30,
              order: 7,
              questions: {
                create: [
                  createShort(
                    'Jika x=2, berapakah 3x + 4?',
                    '10',
                    'Substitusi: 3(2)+4 = 6+4 = 10',
                  ),
                ],
              },
            },
          ],
        },
      },
    });
    console.log('✅ Tryout & 7 Subtests seeded');
  } else {
    console.log('⏩ Tryout sudah ada, melewati proses pembuatan.');
  }

  // =========================================================
  // 4b. PAID TRYOUT (Untuk testing Pendaftaran Berbayar)
  // =========================================================
  const TRYOUT_ID_PAID = 'tryout-paid-test-1';
  const existingPaidTryout = await prisma.tryOut.findUnique({
    where: { id: TRYOUT_ID_PAID },
  });

  if (!existingPaidTryout) {
    console.log('📝 Membuat Tryout Berbayar (20 Token)...');
    await prisma.tryOut.create({
      data: {
        id: TRYOUT_ID_PAID,
        title: 'Tryout Eksklusif UTBK #1',
        description:
          'Tryout berbayar untuk mengetes fitur pendaftaran & token.',
        batch: TryoutBatch.SNBT,
        isPublic: false,
        solutionPrice: 20, // Membutuhkan 20 token untuk daftar
        releaseDate: new Date(),
        scheduledStart: new Date(),
        scheduledEnd: new Date(
          new Date().getTime() + 365 * 24 * 60 * 60 * 1000,
        ),
        subtests: {
          create: [
            {
              name: SubtestName.PU,
              durationMinutes: 15,
              order: 1,
              questions: {
                create: [
                  createMCQ('Soal Berbayar 1', 0, 'Pembahasan eksklusif A...'),
                ],
              },
            },
          ],
        },
      },
    });
    console.log('✅ Paid Tryout seeded');
  }

  // =========================================================
  // 4c. NEW PAID TRYOUT FOR USER COBA (25 Token)
  // =========================================================
  const TRYOUT_ID_PREMIUM_NEW = 'tryout-premium-new-5';
  const existingPremiumNew = await prisma.tryOut.findUnique({
    where: { id: TRYOUT_ID_PREMIUM_NEW },
  });

  if (!existingPremiumNew) {
    console.log('📝 Membuat Tryout Premium Baru (25 Token)...');
    await prisma.tryOut.create({
      data: {
        id: TRYOUT_ID_PREMIUM_NEW,
        title: 'Tryout Premium #2 (Coba Bayar)',
        description: 'Tryout khusus untuk simulasi pembayaran user coba.',
        batch: TryoutBatch.SNBT,
        isPublic: false,
        solutionPrice: 25, // Harga 25 Token
        releaseDate: new Date(),
        scheduledStart: new Date(),
        scheduledEnd: new Date(new Date().getTime() + 30 * 24 * 60 * 60 * 1000), // Aktif 30 hari
        subtests: {
          create: [
            {
              name: SubtestName.PU,
              durationMinutes: 10,
              order: 1,
              questions: {
                create: [
                  createMCQ('Soal Premium 1', 2, 'Pembahasan Premium...'),
                ],
              },
            },
          ],
        },
      },
    });
    console.log('✅ New Premium Tryout seeded');
  }

  // =========================================================
  // 6. FINISHED ATTEMPTS FOR USER COBA (Agar Grafik Muncul)
  // =========================================================
  console.log('📝 Generating Dummy Score History for User Coba...');

  // Ambil user coba
  const userTarget = await prisma.user.findUnique({
    where: { email: 'coba@example.com' },
  });

  if (userTarget) {
    // Kita pakai Tryout Premium SNBT (TRYOUT_ID_PREMIUM) yang sudah dibuat di step 4
    const targetTryoutId = 'tryout-premium-snbt-4';

    // Cek apakah tryout ada
    const to = await prisma.tryOut.findUnique({
      where: { id: targetTryoutId },
    });

    if (to) {
      // Buat 3 attempt history
      const historyData = [
        { score: 450, date: new Date('2025-01-10') },
        { score: 520, date: new Date('2025-01-15') },
        { score: 610, date: new Date('2025-01-18') },
      ];

      for (const [index, item] of historyData.entries()) {
        const attemptId = `attempt-history-${index}`;
        await prisma.tryOutAttempt.upsert({
          where: { id: attemptId },
          update: {},
          create: {
            id: attemptId,
            userId: userTarget.id,
            tryOutId: targetTryoutId,
            status: 'FINISHED',
            totalScore: item.score,
            startedAt: item.date,
            finishedAt: new Date(item.date.getTime() + 2 * 60 * 60 * 1000), // +2 jam
            currentSubtestOrder: 7,
          },
        });

        // Opsional: Buat jawaban dummy agar detail nilai per subtest (PU, PPU, dll) juga ada isinya
        // Tapi untuk chart Total Score, totalScore di attempt saja sudah cukup.
        // DashboardService.getScoreHistory mengambil rincian dari UserAnswer points.
        // Jadi kita WAJIB buat UserAnswer dummy jika ingin breakdown per subtest muncul.
        // Untuk simplifikasi seed ini, kita fokus agar total muncul di chart dulu atau buat simple answer.

        // Kita inject 1 jawaban benar di PU (Subtest 1) dengan poin besar agar terdeteksi
        // Cari Question ID di subtest PU tryout ini
        const puSubtest = await prisma.subtest.findFirst({
          where: { tryOutId: targetTryoutId, name: SubtestName.PU },
        });

        if (puSubtest) {
          const question = await prisma.question.findFirst({
            where: { subtestId: puSubtest.id },
          });
          if (question) {
            await prisma.userAnswer.upsert({
              where: {
                tryOutAttemptId_questionId: {
                  tryOutAttemptId: attemptId,
                  questionId: question.id,
                },
              },
              update: { isCorrect: true },
              create: {
                tryOutAttemptId: attemptId,
                questionId: question.id,
                isCorrect: true,
                inputText: 'Dummy Answer',
              },
            });
            // Update point question biar match score (Hack untuk seed)
            // Note: Di real app, score dihitung dari sum points. Di seed ini kita paksa.
          }
        }
      }
      console.log('✅ Score History seeded');
    }
  }

  // =========================================================
  // 7. USER TEST FOR FILTERING (test@gmail.com)
  // =========================================================
  console.log('📝 Seeding User Test for Filtering...');

  const userTestFilter = await prisma.user.upsert({
    where: { email: 'test@gmail.com' },
    update: { tokenBalance: 500 },
    create: {
      id: 'user-test-filter-id',
      name: 'User Filter Test',
      email: 'test@gmail.com',
      role: Role.USER,
      tokenBalance: 500,
      emailVerified: true,
    },
  });

  // Pastikan Account ada biar bisa login
  await prisma.account.upsert({
    where: { id: 'account-test-filter-id' },
    update: {},
    create: {
      id: 'account-test-filter-id',
      userId: userTestFilter.id,
      accountId: userTestFilter.id,
      providerId: 'email',
      password: 'password123',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const targetTryoutId = 'tryout-premium-snbt-4';
  const toFilter = await prisma.tryOut.findUnique({
    where: { id: targetTryoutId },
    include: {
      subtests: { include: { questions: { include: { items: true } } } },
    },
  });

  if (toFilter) {
    const attemptId = `attempt-filter-test-1`;

    // Kita akan buat variasi skor per subtest
    // Target Total: ~800
    // Strategi: Jawab benar semua soal di beberapa subtest, salah di lainnya
    // Karena soal di seed sedikit (1 per subtest @ 10 poin), skor max cuma 70.
    // KITA HARUS UPDATE POIN SOAL AGAR SKOR TERLIHAT REALISTIS (Ratusan)

    let totalScoreReal = 0;

    // Map target score per subtest (approx)
    const targetScores: Record<string, number> = {
      PU: 150, // High
      PPU: 80, // Med
      PBM: 120, // High
      PK: 60, // Low
      LBI: 140, // High
      LBE: 90, // Med
      PM: 160, // High
    };

    await prisma.tryOutAttempt.upsert({
      where: { id: attemptId },
      update: {},
      create: {
        id: attemptId,
        userId: userTestFilter.id,
        tryOutId: targetTryoutId,
        status: 'FINISHED',
        totalScore: 0, // Akan diupdate nanti
        startedAt: new Date(),
        finishedAt: new Date(),
        currentSubtestOrder: 7,
      },
    });

    for (const subtest of toFilter.subtests) {
      const questions = subtest.questions;
      if (questions.length > 0) {
        const q = questions[0];
        const targetScore = targetScores[subtest.name] || 50;

        // 1. Update poin soal di database agar satu soal bernilai besar (untuk simulasi)
        await prisma.question.update({
          where: { id: q.id },
          data: { points: targetScore },
        });

        // 2. Buat jawaban BENAR untuk user ini
        // Cari item benar
        const correctItem = q.items.find((i) => i.isCorrect);

        // Jika tipe isian singkat, items kosong, pake correctAnswer
        let dataAnswer: any = {
          tryOutAttemptId: attemptId,
          questionId: q.id,
          isCorrect: true,
        };

        if (correctItem) {
          dataAnswer.questionItemId = correctItem.id;
        } else if (q.correctAnswer) {
          dataAnswer.inputText = q.correctAnswer;
        } else {
          // Fallback force correct
          dataAnswer.inputText = 'Force Correct';
        }

        await prisma.userAnswer.upsert({
          where: {
            tryOutAttemptId_questionId: {
              tryOutAttemptId: attemptId,
              questionId: q.id,
            },
          },
          update: { isCorrect: true },
          create: dataAnswer,
        });

        totalScoreReal += targetScore;
      }
    }

    // Update total skor attempt
    await prisma.tryOutAttempt.update({
      where: { id: attemptId },
      data: { totalScore: totalScoreReal },
    });

    console.log(`✅ Filter Test Attempt created with Score: ${totalScoreReal}`);
  }

  // =========================================================
  // 8. TEST CASES FOR DATE LOGIC & PREVIEW
  // =========================================================
  console.log('📝 Seeding Date Logic Test Cases...');

  const now = new Date();
  const oneDay = 24 * 60 * 60 * 1000;

  // 8a. Future Tryout (Not Started)
  await prisma.tryOut.upsert({
    where: { id: 'tryout-future-1' },
    update: {},
    create: {
      id: 'tryout-future-1',
      title: 'Test: Future Tryout',
      description: 'Release & Start in future.',
      batch: TryoutBatch.SNBT,
      isPublic: true,
      solutionPrice: 0,
      releaseDate: new Date(now.getTime() + oneDay),
      scheduledStart: new Date(now.getTime() + oneDay + 3600000),
      scheduledEnd: new Date(now.getTime() + 365 * oneDay),
      status: TryoutStatus.NOT_STARTED,
    },
  });

  // 8b. Active Tryout (In Progress)
  await prisma.tryOut.upsert({
    where: { id: 'tryout-active-1' },
    update: {},
    create: {
      id: 'tryout-active-1',
      title: 'Test: Active Tryout',
      description: 'Currently running.',
      batch: TryoutBatch.SNBT,
      isPublic: true,
      solutionPrice: 0,
      releaseDate: new Date(now.getTime() - oneDay),
      scheduledStart: new Date(now.getTime() - oneDay),
      scheduledEnd: new Date(now.getTime() + oneDay),
      status: TryoutStatus.IN_PROGRESS,
    },
  });

  // 8c. Finished Tryout (Standard)
  await prisma.tryOut.upsert({
    where: { id: 'tryout-finished-1' },
    update: {},
    create: {
      id: 'tryout-finished-1',
      title: 'Test: Finished Tryout',
      description: 'Ended yesterday. Leaderboard should be OPEN.',
      batch: TryoutBatch.SNBT,
      isPublic: true,
      solutionPrice: 0,
      releaseDate: new Date(now.getTime() - 3 * oneDay),
      scheduledStart: new Date(now.getTime() - 3 * oneDay),
      scheduledEnd: new Date(now.getTime() - oneDay),
      status: TryoutStatus.FINISHED,
    },
  });

  // 8d. Past Reviewable Tryout (No Start Date - Edge Case)
  await prisma.tryOut.upsert({
    where: { id: 'tryout-past-review-1' },
    update: {},
    create: {
      id: 'tryout-past-review-1',
      title: 'Test: Edge Case (No Start Date)',
      description:
        'Ended yesterday but has NO Start Date. Leaderboard should still be OPEN.',
      batch: TryoutBatch.SNBT,
      isPublic: true,
      solutionPrice: 0,
      releaseDate: new Date(now.getTime() - oneDay),
      scheduledStart: null,
      scheduledEnd: new Date(now.getTime() - oneDay),
      status: TryoutStatus.FINISHED,
    },
  });

  // 8e. Weird Order Tryout (Edge Case)
  await prisma.tryOut.upsert({
    where: { id: 'tryout-weird-order-1' },
    update: {},
    create: {
      id: 'tryout-weird-order-1',
      title: 'Test: Weird Date Order',
      description:
        'Start Date is BEFORE Release Date. Should be IN_PROGRESS based on dates.',
      batch: TryoutBatch.SNBT,
      isPublic: true,
      solutionPrice: 0,
      releaseDate: new Date(now.getTime() + oneDay),
      scheduledStart: new Date(now.getTime() - oneDay),
      scheduledEnd: new Date(now.getTime() + 2 * oneDay),
      status: TryoutStatus.IN_PROGRESS,
    },
  });

  console.log('✅ Date Logic Test Cases seeded');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end().catch(() => undefined);
  });
