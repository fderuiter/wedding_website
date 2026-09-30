# Deployment Recipes & Hosting Guides

This directory contains provider-specific deployment recipes layered on top of the application's shared runtime contract.

---

## Shared Runtime Contract

All deployment targets consume the exact same application runtime contract, ensuring zero provider lock-in and seamless portability:

1.  **Node.js Runtime Specification**: Node.js v22.x LTS, Next.js App Router standalone build (`output: 'standalone'`).
2.  **Database Engine & ORM**: PostgreSQL 15+ accessed via Prisma ORM v7.x (`@prisma/client`). Connection string provided via `DATABASE_URL` (plus `POSTGRES_URL_NON_POOLING` for direct schema migrations when using connection poolers like PgBouncer).
3.  **Migration Mechanism**: Database migrations are managed via `npx prisma migrate deploy`. Migrations run prior to application startup via container entrypoint (`docker-entrypoint.sh`), release commands, or CI/CD pipelines.
4.  **Environment Variable Validation**: Validated at startup by `src/env.ts` (Zod schema). Missing required variables (`DATABASE_URL`, `ADMIN_PASSWORD`, `ALLOWED_HOSTS`) fail fast during initialization.
5.  **Asset Storage Abstraction**: File uploads use local disk storage (`/app/public/uploads`) or provider-agnostic S3-compatible object storage (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_PUBLIC_URL`). No provider-specific storage SDKs are included in core business logic.
6.  **Health Check Endpoint**: Built-in health probe endpoint at `/api/health` returning HTTP 200 JSON status `{ status: "ok", timestamp: ..., services: { database: "healthy" } }` for liveness and readiness checks.
7.  **Host Header Validation**: Enforced via `ALLOWED_HOSTS` host matching.

---

## Support Tier Matrix

To distinguish officially verified deployment targets from community-maintained examples, hosting options are classified into support tiers:

| Target Platform | Category | Support Tier | Primary Artifact |
|---|---|---|---|
| [**Generic Docker / VPS**](./docker-vps.md) | Canonical Portable Baseline | **Tier 1 — Officially Tested** | Root `Dockerfile` & `docker-compose.yml` |
| [**Google Cloud Run**](./gcp-cloud-run.md) | Container / Serverless | **Tier 1 — Officially Tested** | Container image + `.github/workflows/deploy.yml` |
| [**Vercel**](./vercel.md) | Serverless Node / Edge | **Tier 1 — Officially Tested** | Next.js serverless runtime adapter |
| [**Railway & Render**](./railway-render.md) | PaaS Target | **Tier 2 — Community Supported** | Container image / Nixpacks build |

---

## Available Deployment Recipes

*   [**Generic Docker / VPS Deployment Guide**](./docker-vps.md): Canonical portable container baseline suitable for Ubuntu, Debian, AWS EC2, DigitalOcean, or Hetzner.
*   [**Google Cloud Run Deployment Guide**](./gcp-cloud-run.md): Fully managed serverless container target using Artifact Registry and Cloud SQL.
*   [**Vercel Deployment Guide**](./vercel.md): Serverless Node.js deployment target with serverless PostgreSQL connection pooling.
*   [**Railway & Render PaaS Guide**](./railway-render.md): Low-friction PaaS deployment targets with integrated database provisioning.
