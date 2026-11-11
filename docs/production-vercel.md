# Backend Production: Vercel

Vercel detects this NestJS app from `src/main.ts` and deploys it as a Node.js Function. The database remains on Supabase, assets remain on Cloudinary, and authentication uses Firebase Auth. AI service hosting is outside this setup.

## Create the backend project

1. Open Vercel and choose **Add New → Project**.
2. Import the `tjitu/jitu-backend` repository and select the `main` branch.
3. Keep the Root Directory at the repository root. Vercel should detect NestJS automatically.
4. Add the environment values below, then deploy.
5. Copy the deployed backend URL and use it as `NEXT_PUBLIC_BACKEND_URL` in the Vercel `jitu-frontend` project. Redeploy the frontend after changing that value.

## Environment values

- `DATABASE_URL`: Supabase Postgres URL with `schema=jitu_backend` and `sslmode=require`; use the direct URL or session pooler URL for Prisma.
- `ALLOWED_ORIGINS`: comma-separated frontend origins, such as `https://jituptn.com,https://jitu-frontend.vercel.app`.
- `FRONTEND_URL`: production frontend URL.
- `FIREBASE_PROJECT_ID=jitu-ptn-main-auth-2026`.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: image uploads.
- `MERCHANT_ID`, `CLIENT_KEY`, `SERVER_KEY`: Midtrans payments.

Firebase ID tokens are verified using the Firebase project ID and Google's public signing certificates; the backend does not need a service-account key.

The public API health endpoints are `GET /health` for liveness and `GET /health/ready` for database readiness. When called through the Main website, the Next.js rewrite exposes database readiness at `/api/proxy/health/ready`.

Keep production data in Supabase and uploaded files in Cloudinary. Vercel Functions have a 4.5 MB request/response body limit, so oversized image uploads may need to be sent directly from the frontend to Cloudinary.

## Supabase schema and migrations

Keep backend tables in the `jitu_backend` schema. If it has not been created yet, run this once in Supabase SQL Editor:

```sql
create schema if not exists jitu_backend;
```

Apply Prisma migrations from a trusted local environment after setting `DATABASE_URL`:

```bash
pnpm prisma migrate deploy
```

Do not run `prisma db seed` against production. The seed file creates local/demo users and tryout fixtures.
