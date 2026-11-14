# JITU BACKEND REPOSITORY MAP

> Quick reference for LLM agents. Consult before reading backend modules.

---

## 1. Directory Structure

```
jitu-backend/
├── src/
│   ├── main.ts           # NestJS bootstrap, CORS, global validation pipe, port 3000
│   ├── app.module.ts     # Root module registering all feature modules
│   ├── lib/              # Core libraries
│   │   ├── auth.ts       # Better Auth server configuration
│   │   ├── prisma.ts     # PrismaClient singleton
│   │   └── ...
│   ├── modules/          # Domain-driven NestJS modules
│   │   ├── auth/         # Authentication endpoints & session management
│   │   ├── tryout/       # Tryout creation, registration, scoring, subtests
│   │   ├── question/     # Question bank, options, explanations
│   │   ├── user/         # Student profiles, targets, history
│   │   ├── payment/      # Midtrans payment gateway webhook & order state
│   │   ├── shop/         # Coin packages, transaction history
│   │   └── leaderboard/  # National ranking & percentile calculations
│   └── common/           # Guards, interceptors, decorators, filters
├── prisma/
│   └── schema.prisma     # Database schema (models: User, Tryout, Question, Order, etc.)
└── generated/
    └── prisma/           # Generated Prisma 7 Client
```

---

## 2. Key Architecture Patterns

* **ORM**: Prisma 7 with custom output path at `generated/prisma`. Use singleton service or injection.
* **Database**: PostgreSQL hosted on Supabase (`DATABASE_URL` pooler).
* **Payment Webhooks**: Midtrans webhooks handled at `/payment/notification` with signature validation.
* **AI Service Client**: Communicates with `jitu-ai-service` on port 3010 for question drafting and AI hints.
