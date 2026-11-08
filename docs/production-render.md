# Backend Production: Render

The backend runs as a Docker web service on Render. The database remains on Supabase, uploaded assets remain on Cloudinary, and authentication uses Firebase Auth.

## Create the service

1. In Render, choose **New → Blueprint** and connect the `tjitu/jitu-backend` repository.
2. Render reads `render.yaml` and creates the `jitu-backend` web service.
3. Set the prompted environment values in Render. Use Supabase's direct database URL where available; otherwise use its session pooler URL for Prisma.
4. Deploy the service and copy its `https://<service>.onrender.com` URL.
5. In the Vercel `jitu-frontend` project, set `NEXT_PUBLIC_BACKEND_URL` to that URL for the environments you deploy, then create a new frontend deployment.
6. Update Render's `ALLOWED_ORIGINS` and `FRONTEND_URL` to the production frontend origin (for example, `https://jituptn.com`).

The backend verifies Firebase ID tokens with the Firebase project ID and Google's public signing certificates. It does not need a Firebase service-account key. Keep `FIREBASE_PROJECT_ID=jitu-ptn-main-auth-2026`.

## Environment values

`render.yaml` supplies non-secret values and prompts for these values:

- `DATABASE_URL`: Supabase Postgres connection string with `schema=jitu_backend` and `sslmode=require`.
- `ALLOWED_ORIGINS`: comma-separated frontend origins, such as `https://jituptn.com,https://jitu-frontend.vercel.app`.
- `FRONTEND_URL`: the production frontend URL.
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: image upload integration.
- `MERCHANT_ID`, `CLIENT_KEY`, `SERVER_KEY`: Midtrans integration.
- `AI_SERVICE_URL`, `AI_SERVICE_INTERNAL_API_KEY`: AI service URL and matching internal key.

Do not commit secret values. Add optional integration values in the Render dashboard if those features are used.

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

## Free plan behavior

Render's free web service sleeps after 15 minutes without inbound traffic and can take about a minute to wake on the next request. Use it for development/early traffic; expect the first API request after idle to be slow. The free service has an ephemeral filesystem, so persistent uploads must stay in Cloudinary and persistent data in Supabase.
