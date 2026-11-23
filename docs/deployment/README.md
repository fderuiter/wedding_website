# Deployment Recipes & Hosting Guides

This directory contains provider-specific deployment recipes layered on top of the application's shared runtime contract.

---

## Shared Runtime Contract

All deployment targets consume the exact same application runtime contract, ensuring zero provider lock-in and seamless portability:

1.  **Node.js & Package Manager Specification**: Node.js v22.x LTS (`engines.node: "22.x"`, `devEngines.runtime: "^22.12.0"`) and `npm` `^10.9.0` (enforced via `engines` and `devEngines` in `package.json`), Next.js App Router standalone build (`output: 'standalone'`).
2.  **Database Engine & ORM**: PostgreSQL 15+ accessed via Prisma ORM v7.x (`@prisma/client`). `prisma.config.ts` binds `datasource.url` to `DATABASE_URL` (used by both runtime queries and `npx prisma migrate deploy`) and `datasource.shadowDatabaseUrl` to `POSTGRES_URL_NON_POOLING` (used by `prisma migrate dev`). When `DATABASE_URL` routes through a transaction-mode pooler like PgBouncer, `npx prisma migrate deploy` requires an explicit `DATABASE_URL` override pointing to a direct PostgreSQL connection.
3.  **Migration Mechanism**: Migrations run prior to application startup via offline `./node_modules/.bin/prisma migrate deploy` in the Docker Compose `migration` service, offline in the container entrypoint (`docker-entrypoint.sh` when `RUN_MIGRATIONS=true` or `RUN_MIGRATIONS=1`, backed by `/opt/prisma-cli`), or via `npx prisma migrate deploy` in PaaS release commands and CI/CD pipelines (`.github/workflows/db-migrate.yml`).
4.  **Environment Variable Validation**: Validated at startup by `src/env.ts` (Zod schema). Missing or invalid required production variables (`DATABASE_URL`, `ADMIN_PASSWORD`, `ALLOWED_HOSTS`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`) fail fast during initialization, and `E2E_TEST` must never be set to `true` in production.
5.  **Asset Storage Abstraction**: File uploads use local disk storage (`/app/public/uploads`, persisted via `uploads_data` in `docker-compose.yml` or a Render Persistent Disk and streamed dynamically at `/uploads/*` in standalone mode with `X-Content-Type-Options: nosniff`) or provider-agnostic S3-compatible object storage (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_PUBLIC_URL`). No provider-specific storage SDKs are included in core business logic.
6.  **Liveness, Readiness & Graceful Shutdown**: Process liveness endpoint at `/api/live` returning HTTP 200 `{ "status": "alive", "timestamp": "..." }` without querying PostgreSQL (for container `HEALTHCHECK` and Cloud Run liveness probes), startup/rollout health endpoint at `/api/health` returning HTTP 200 `{ "success": true, "data": { "status": "ok", "timestamp": "...", "database": "connected" } }` for deployment verification (and middleware-formatted HTTP 503 `{ "success": false, "error": "...", "referenceId": "<uuid>" }` in production with `status`, `database`, and `timestamp` stripped), unwrapped readiness endpoint at `/api/ready` (HTTP 200 / HTTP 503), and `stop_grace_period: 15s` (`--stop-timeout 15` on standalone `docker run`) covering Next.js request completion plus the `5000ms` Prisma pool drain.
7.  **Host Header Validation & Subdomain Scope**: Enforced via `ALLOWED_HOSTS` matching (`X-Forwarded-Host` checked before `Host` in `src/middleware.ts` and `src/lib/config.ts`), while stateless read-only (`GET` / `HEAD`) probes to `/api/live`, `/api/health`, and `/api/ready` enforce syntactic `Host` validation (`isHostSyntaxValid`) without requiring `ALLOWED_HOSTS` membership. When `MULTISITE_ENABLED=true`, subdomain routing switches `AppConfig` branding/profile rows only while `prisma/schema.prisma` shares the other 14 tables across subdomains without tenant row isolation.
8.  **Webhooks & Scheduled Broadcasts**: Stripe `payment_intent.succeeded` webhooks post to `/api/registry/webhook/stripe` (verified via `stripe-signature` and `STRIPE_WEBHOOK_SECRET` without requiring session cookies), and scheduled broadcasts trigger `/api/cron/broadcasts` with `Authorization: Bearer <CRON_SECRET>` (configured via `vercel.json` on Vercel or platform schedulers elsewhere).

---

## Support Tier Matrix

To distinguish officially verified deployment targets from community-maintained examples, hosting options are classified into support tiers:

| Target Platform | Category | Support Tier | Primary Artifact |
|---|---|---|---|
| [**Generic Docker / VPS**](./docker-vps.md) | Canonical Portable Baseline | **Tier 1 — Officially Tested** | Root `Dockerfile` & `docker-compose.yml` |
| [**Google Cloud Run**](./gcp-cloud-run.md) | Container / Serverless | **Tier 1 — Officially Tested** | `ghcr.io` digest image + `.github/workflows/deploy.yml` |
| [**Vercel**](./vercel.md) | Serverless Node / Edge | **Tier 1 — Officially Tested** | Next.js serverless runtime adapter |
| [**Railway & Render**](./railway-render.md) | PaaS Target | **Tier 2 — Community Supported** | Container image / Nixpacks build |
| [**GitHub Pages**](../../.github/workflows/ci.yml) | Unified Portal, Static Demo & Storybook | **Tier 1 — Officially Tested** | VitePress + `/demo/` + `/storybook/` via `.github/workflows/ci.yml` |

---

## Available Deployment Recipes

*   [**Generic Docker / VPS Deployment Guide**](./docker-vps.md): Canonical portable container baseline suitable for Ubuntu, Debian, AWS EC2, DigitalOcean, or Hetzner.
*   [**Google Cloud Run Deployment Guide**](./gcp-cloud-run.md): Fully managed serverless container target deploying immutable `ghcr.io` OCI digests to isolated Cloud Run services (`wedding-website-staging` and `wedding-website`, configurable via `CLOUD_RUN_SERVICE` / `CLOUD_RUN_REGION`) using Workload Identity Federation OIDC (or `GCP_SA_KEY` fallback), GCP Secret Manager, and Cloud SQL.
*   [**Vercel Deployment Guide**](./vercel.md): Serverless Node.js deployment target with serverless PostgreSQL connection pooling.
*   [**Railway & Render PaaS Guide**](./railway-render.md): Low-friction PaaS deployment targets with integrated database provisioning.
*   [**GitHub Pages Workflow**](../../.github/workflows/ci.yml): Automated workflow compiling the VitePress documentation portal (`/`), interactive static demo (`/demo/` via `static-export-build`), and Storybook component showcase (`/storybook/` via `storybook-build`) in parallel CI jobs and publishing a unified bundle via `deploy-docs`.

---

## GitHub Pages Deployment Prerequisites

To publish the unified documentation portal (`/`), interactive static demo (`/demo/`), and Storybook component showcase (`/storybook/`) to GitHub Pages using the automated workflow (`.github/workflows/ci.yml`), ensure the following repository settings are configured in GitHub:

1. **Enable GitHub Actions Pages Source**:
   - In GitHub, navigate to repository **Settings** > **Pages**.
   - Under **Build and deployment** > **Source**, select **GitHub Actions** (rather than "Deploy from a branch").
   - Both default repository subpaths (`/<repo>/`, `/<repo>/demo/`, `/<repo>/storybook/`) and custom domains (`/`, `/demo/`, `/storybook/`) are detected automatically via `actions/configure-pages` and `NEXT_PUBLIC_BASE_PATH`.
2. **Environment Configuration**:
   - Verify that the `github-pages` deployment environment is created or permitted under repository **Settings** > **Environments**.
   - Review or configure deployment branch rules and protection gates if needed (by default, `deploy-docs` runs on pushes to `main` and published releases after `verify`, `static-export-build`, `storybook-build`, and `static-demo-e2e` succeed, verifying `index.html`, `demo/index.html`, `storybook/index.html`, and `.nojekyll` before upload).
3. **Workflow Permissions**:
   - The `.github/workflows/ci.yml` workflow explicitly requires `contents: read`, `pages: write`, and `id-token: write` for the `deploy-docs` job.
   - Ensure repository settings under **Settings** > **Actions** > **General** > **Workflow permissions** permit workflows to read and write tokens.
