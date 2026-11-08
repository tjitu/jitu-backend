# Backend Production: GCP Cloud Run

Target production shape:

- Backend API: GCP Cloud Run
- Database: Supabase Postgres
- Asset storage: Cloudinary
- Frontend origin: Vercel Pro
- AI provider implementation: OpenAI in production.

## Required Environment

Use `.env.production.example` as the Cloud Run variable checklist. Important values:

- `HOST=0.0.0.0`
- `PORT=8080`
- `DATABASE_URL` from Supabase with `schema=jitu_backend` and `sslmode=require`
- `FRONTEND_URL=https://YOUR_VERCEL_DOMAIN`
- `ALLOWED_ORIGINS=https://YOUR_VERCEL_DOMAIN`
- `FIREBASE_PROJECT_ID=jitu-ptn-main-auth-2026`
- `AI_SERVICE_URL=https://YOUR_AI_SERVICE_CLOUD_RUN_URL`
- `AI_SERVICE_INTERNAL_API_KEY` must match the AI service `INTERNAL_API_KEY`
- `CLOUDINARY_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
- `CLOUDINARY_CLOUD_NAME` should use the same value as `CLOUDINARY_NAME`

## One-time GCP Setup

Create these before running the GitHub workflow:

- Cloud Run service: `jitu-backend`
- Artifact Registry Docker repository, for example `jitu`
- GitHub Workload Identity Federation provider
- GitHub deploy service account with Cloud Run Admin, Artifact Registry Writer, Secret Manager Secret Accessor, and Service Account User permissions
- GCP Secret Manager secrets listed below

Required GitHub repository variables:

```text
GCP_PROJECT_ID=your-gcp-project-id
GCP_REGION=asia-southeast2
GCP_WORKLOAD_IDENTITY_PROVIDER=projects/PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/jitu-backend
GCP_SERVICE_ACCOUNT=github-deploy@your-gcp-project-id.iam.gserviceaccount.com
ARTIFACT_REGISTRY_REPOSITORY=jitu
BACKEND_CLOUD_RUN_SERVICE=jitu-backend
BACKEND_URL=https://YOUR_BACKEND_CLOUD_RUN_URL
FRONTEND_URL=https://YOUR_VERCEL_DOMAIN
AI_SERVICE_URL=https://YOUR_AI_SERVICE_CLOUD_RUN_URL
```

Required GCP Secret Manager secrets:

```text
backend-database-url
cloudinary-cloud-name
cloudinary-api-key
cloudinary-api-secret
midtrans-merchant-id
midtrans-client-key
midtrans-server-key
ai-internal-api-key
```

The value of `ai-internal-api-key` must be exactly the same secret used by the AI service as `INTERNAL_API_KEY`.

The backend verifies tokens using this project ID and Google's public signing certificates. It does not need a Firebase service-account key; do not add one to the repository.

## Supabase Database

Use one Supabase project for JituPTN, but keep backend and AI service tables in separate Postgres schemas.

Run this once in Supabase SQL Editor:

```sql
create schema if not exists jitu_backend;
create schema if not exists jitu_ai;
```

Backend production `DATABASE_URL` should point to the backend schema:

```text
postgresql://USER:PASSWORD@HOST:PORT/postgres?schema=jitu_backend&sslmode=require
```

Use Supabase's direct connection string for Prisma migrations when possible. If the deployment network is IPv4-only and the direct endpoint is unavailable, use Supabase session pooler instead of transaction pooler for Prisma-backed backend services.

## GitHub Deploy

After variables and secrets are ready, run:

```text
GitHub Actions -> Deploy Backend to Cloud Run -> Run workflow
```

The workflow builds a Docker image, pushes it to Artifact Registry, runs `pnpm prisma migrate deploy` against Supabase, and deploys the image to Cloud Run.

## Build And Deploy

```bash
gcloud builds submit --tag gcr.io/PROJECT_ID/jitu-backend
gcloud run deploy jitu-backend \
  --image gcr.io/PROJECT_ID/jitu-backend \
  --region asia-southeast2 \
  --platform managed \
  --allow-unauthenticated \
  --port 8080
```

Set secrets through Cloud Run environment variables or Secret Manager. Do not commit real secrets.

## Database Migration

Run Prisma migrations against Supabase before routing traffic:

```bash
DATABASE_URL="postgresql://..." pnpm prisma migrate deploy
```

Do not run `prisma db seed` against production. The seed file creates local/demo users and tryout fixtures.

For the first production admin user, create the account through the app, then promote it with a controlled DB update:

```sql
update jitu_backend."user"
set role = 'ADMIN'
where email = 'YOUR_ADMIN_EMAIL';
```
