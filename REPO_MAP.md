# JITU BACKEND REPOSITORY MAP

> Quick reference for LLM agents. Consult before reading backend modules. This file is mutable — update it when adding modules or changing architecture.

---

## 1. Directory Structure

```
jitu-backend/
├── src/
│   ├── main.ts           # NestJS bootstrap, CORS, global validation pipe, port 3000
│   ├── app.module.ts     # Root module registering all domain modules
│   ├── health.controller.ts # Health check endpoints
│   ├── prisma.module.ts / prisma.service.ts # Prisma 7 global DB service
│   ├── lib/              # Core libraries (Better Auth server config, helpers)
│   ├── modules/          # Domain-driven NestJS modules
│   │   ├── auth/         # Better Auth & Firebase session/auth endpoints
│   │   ├── tryout/       # Tryout catalog, registration, subtests, leaderboards
│   │   ├── exam/         # Active exam sessions, answers, submissions
│   │   ├── irt/          # 3PL EAP IRT engine, item calibration & UTBK scaled scoring
│   │   ├── history/      # Student attempt history & score review
│   │   ├── daily/        # Daily practice drills & streak tracking
│   │   ├── dashboard/    # Student dashboard aggregations
│   │   ├── profile/      # Student profiles & PTN/jurusan targets
│   │   ├── referral/     # Referral codes & rewards
│   │   ├── shop/         # Coin packages, Midtrans checkout, payment webhooks & orders
│   │   ├── articles/     # Blog/article content endpoints
│   │   └── admin/        # Admin operations (tryouts, questions, users, packages, payments)
│   └── common/           # Guards, interceptors, decorators, filters
├── prisma/
│   └── schema.prisma     # Database schema (Supabase PostgreSQL)
├── generated/
│   └── prisma/           # Generated Prisma 7 Client
├── AGENTS.md             # NestJS module/DTO/anti-pattern conventions
└── docs/
    └── production-vercel.md
```

---

## 2. Key Architecture Patterns

* **Affiliate finance**: `prisma/affiliate.prisma` contains Main DB profiles, terms, quotas, boost activations, agreements, acceptance snapshots, checkout snapshots, journal, payouts and audit. `prisma.config.ts` loads the `prisma/` schema directory.
* **Shared affiliate pricing**: additive `20261127*` migrations define `affiliate_quote`, `affiliate_rates`, atomic activation/allocation, immutable payment attribution, confirmation triggers and cumulative refund adjustments. Nest and student Next checkout use the same database rules.
* **Gateway adapter**: `modules/shop/services/affiliate-pricing.service.ts` validates affiliate quotes and verified refunds; `affiliate-midtrans-expiry.ts` derives gateway expiry from checkout timing. `docs/affiliate-program.md` is the migration/release runbook; `test/affiliate-*.test.cjs` covers PostgreSQL rules and races.

* **ORM**: Prisma 7 with custom output path at `generated/prisma`. Use `PrismaService` injection.
* **Database**: PostgreSQL hosted on Supabase (`DATABASE_URL` pooler).
* **Payment Webhooks**: Midtrans notifications handled inside `shop/` with signature validation.
