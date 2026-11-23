# Pro-Grade Deployment Pipeline & Deployment Recipes

This repository implements a modular, enterprise-grade continuous integration and delivery architecture built around a **shared runtime contract**. Core CI, immutable release artifact publication, database schema migration, and provider-specific hosting deployment are separated into explicit responsibilities.

For the authoritative specification of container, database, environment variable, reverse proxy, health check, and lifecycle requirements, refer to the [Application Runtime Contract](./docs/runtime-contract.md). All hosting providers and deployment environments must satisfy this baseline contract.

## Deployment State & Optional Vercel Target

- **Current Deployment Architecture**: The primary deployment architecture is provider-neutral, utilizing standard containerized builds (`Dockerfile`) running on Node.js / Docker hosts such as Google Cloud Run or AWS.
- **Disconnected Vercel Connection**: The historical direct Vercel connection is disconnected. Core application code, environment validation, database access, and routing logic do not depend on Vercel-specific runtime environment variables or proprietary APIs.
- **Optional Vercel Support**: Vercel remains fully supported as an optional deployment target. Couples or developers who wish to deploy on Vercel can import the repository directly into Vercel or use `vercel deploy`, ensuring required production environment variables (`DATABASE_URL`, `ADMIN_PASSWORD`, `ALLOWED_HOSTS`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`) are provided in Vercel's project settings.
- **Static Showcase & Documentation Targets**: For database-free static HTML previews, `npm run build:export` (`scripts/build-export.mjs` with `STATIC_EXPORT=true`) builds a static showcase using `STATIC_MOCK_CONFIG`. Component showcases and architectural documentation portals are built via `npm run build-storybook` (`storybook-build` in `ci.yml` and `storybook.yml`) and `npm run docs:build` (`deploy-docs` in `ci.yml` publishing to GitHub Pages).

---

## Shared Runtime Contract

All hosting platforms consume the same unified application runtime contract, ensuring total portability and avoiding vendor lock-in:

1. **Node.js Runtime Specification**: Node.js v22.x LTS, Next.js App Router standalone build (`output: 'standalone'`).
2. **Database Engine & ORM**: PostgreSQL 15+ accessed via Prisma ORM v7.x (`@prisma/client`).
3. **Migration Mechanism**: Schema updates are managed via `npx prisma migrate deploy` executed prior to application start.
4. **Environment Variables**: Validated at startup by `src/env.ts` using Zod schema validation.
5. **Asset Storage Abstraction**: Local filesystem storage (`/app/public/uploads`) or S3-compatible object storage (Cloudflare R2, AWS S3).
6. **Liveness & Readiness Probes**: Unauthenticated process liveness probe at `/api/live` (`HTTP 200` `{ "status": "alive", "timestamp": "..." }` without database coupling), startup/rollout verification probe at `/api/health` (`HTTP 200` `{ "success": true, "data": { "status": "ok", "database": "connected", ... } }`), and unwrapped readiness probe at `/api/ready`.
7. **Host Domain Security**: Host header validation enforced via `ALLOWED_HOSTS`.

---

## Support Tier Matrix

To distinguish officially verified deployment targets from community-maintained examples, hosting options are classified into support tiers:

| Target Platform | Category | Support Tier | Detailed Guide |
|---|---|---|---|
| **Generic Docker / VPS** | Portable Baseline | **Tier 1 — Officially Tested** | [Docker / VPS Guide](./docs/deployment/docker-vps.md) |
| **Google Cloud Run** | Container / Serverless | **Tier 1 — Officially Tested** | [Cloud Run Guide](./docs/deployment/gcp-cloud-run.md) |
| **Vercel** | Serverless Node / Edge | **Tier 1 — Officially Tested** | [Vercel Guide](./docs/deployment/vercel.md) |
| **Railway & Render** | PaaS Target | **Tier 2 — Community Supported** | [Railway & Render Guide](./docs/deployment/railway-render.md) |

---

## Deployment Recipes Summary

### 1. [Generic Docker / VPS Deployment](./docs/deployment/docker-vps.md)
The canonical portable baseline using the multi-platform `Dockerfile` (`tini` PID 1, `root:root` static `/app` ownership, setuid/setgid stripping) and hardened `docker-compose.yml` (`read_only: true`, `cap_drop: [ALL]`, `no-new-privileges:true`, `shm_size: "256mb"` on `db`, bounded `json-file` `10m` x `3` log rotation, `pids_limit`, `mem_limit`, explicit `stop_grace_period`, and `tmpfs` mounts at `/tmp` and `/app/.next/cache`, with automated test overrides isolated in `.env.ci` and `docker-compose.ci.yml`). Consolidates image builds under `app` (`pull_policy: never` on `migration` and `app-standby`), orchestrates `db` bound to `127.0.0.1:${DB_PORT:-5432}:5432` with mandatory operator secrets, runs a dedicated one-shot `migration` service (`./node_modules/.bin/prisma migrate deploy` before `app` starts with `RUN_MIGRATIONS="false"`, plus optional offline `RUN_MIGRATIONS=true` in `docker-entrypoint.sh` for standalone containers), pins `NODE_ENV: production` and scopes container `DATABASE_URL` via `${CONTAINER_DATABASE_URL:-...}`, forwards all 21 runtime variables plus all 32 trimmed/blank-safe `SITE_*` overrides, preserves `E2E_TEST=false` default production onboarding, and provides zero-downtime standby loopback rollouts (`docker-compose.rollout.yml` + `./scripts/rollout-vps.sh`) behind dual-upstream Nginx/Caddy reverse proxies alongside networked port-mapped rollbacks.

### 2. [Google Cloud Run Deployment](./docs/deployment/gcp-cloud-run.md)
Managed serverless container target deploying attested `ghcr.io` immutable container digests to isolated Cloud Run services (`wedding-website-staging` for staging and `wedding-website` for production by default, or parameterized via `vars.CLOUD_RUN_SERVICE` and `vars.CLOUD_RUN_REGION`) using keyless Workload Identity Federation OIDC (`vars.GCP_WORKLOAD_IDENTITY_PROVIDER` and `vars.GCP_SERVICE_ACCOUNT`, with `secrets.GCP_SA_KEY` fallback), GCP Secret Manager, and Cloud SQL PostgreSQL. Automated via `.github/workflows/deploy.yml` with pre-deployment schema migrations, S3/R2 asset storage, and instant revision traffic splitting for rollbacks.

### 3. [Vercel Deployment](./docs/deployment/vercel.md)
Optional serverless Node.js deployment target using serverless PostgreSQL connection pooling (Neon, Supabase, RDS Proxy). Supports Vercel automatic custom domain TLS, pre-deploy build migrations (`DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy && next build`), and instant deployment rollbacks.

### 4. [Railway & Render PaaS Deployment](./docs/deployment/railway-render.md)
Low-friction PaaS deployment path with managed PostgreSQL add-ons, pre-deploy release commands, persistent volume mounts or S3 asset storage, and automatic domain SSL provisioning.

---

## Environment Variables Reference

The application requires the following environment variables. These match the runtime validation schema in `src/env.ts` and the `.env.example` template:

- `NODE_ENV`: Defines the environment the application is running in (`development`, `test`, `production`).
- `DATABASE_URL`: Primary connection string to your PostgreSQL database (`datasource.url` in `prisma.config.ts`, used by both the Next.js runtime and `npx prisma migrate deploy`). *Required.*
- `POSTGRES_URL_NON_POOLING`: Connection string bound to `datasource.shadowDatabaseUrl` in `prisma.config.ts` for local `prisma migrate dev` shadow database creation without a connection pooler; can also store a direct PostgreSQL URL passed via an explicit `DATABASE_URL` override when bypassing PgBouncer during `npx prisma migrate deploy`. *Optional.*
- `ADMIN_PASSWORD`: Cryptographic hash of the administrative password. *Required.*
  - **Format**: Must be an scrypt hash in the format `scrypt:[16-byte saltBase64]:[64-byte keyBase64]` (64-byte derived key, 16-byte salt; placeholder hashes are rejected in production, and admin session cookies use a domain-separated key derived from the decoded hash).
  - **Generation**: Use a standard scrypt generator or the provided `scripts/generate-password-hash.mjs` to create this hash securely. Never store plain text passwords.
- `ALLOWED_HOSTS`: Comma-separated list of trusted host domains or wildcard patterns allowed to access the application (e.g. `localhost,127.0.0.1,wedding.example`). Wildcard DNS is not required for default single-site deployments. *Required.*
- `MULTISITE_ENABLED`: Set to `true` to enable subdomain-based `AppConfig` branding/profile routing (`X-Forwarded-Host` checked before `Host` in `src/lib/config.ts`). Defaults to `false` (1 deployment = 1 wedding site). Switches `AppConfig` rows only; `prisma/schema.prisma` shares the other 14 tables across subdomains without tenant row isolation. *Optional.*
- `RUN_MIGRATIONS`: Set to `true` to automatically execute database schema migrations on container startup in `docker-entrypoint.sh`. Defaults to `false`. *Optional.*
- `TRUST_PROXY`: Set to `true` (or a positive integer hop count such as `1` or `2`) when running behind a trusted reverse proxy or ingress controller so rate limiting reads `X-Forwarded-For` / `X-Real-IP`. Defaults to `false` (ignores forwarded IP headers on direct hosts). *Optional.*
- `GUEST_PASSCODE`: Global passcode required for guest access to the website. *Required.*
  - **Security Requirement**: Must be explicitly defined in production environment settings. Never rely on default passcodes.
- `GUEST_SESSION_SECRET`: Dedicated server secret for signing and verifying guest invitation session tokens (HMAC-SHA256). *Required.*
  - **Security Requirement**: Must be explicitly defined in production environment settings with a minimum length of 32 characters and kept strictly confidential on the server. Default fallbacks are rejected at production boot. Never use the value of `GUEST_PASSCODE` or disclose it to attendees.
- `HISTORY_VERSION_LIMIT`: System limit for the number of history versions to keep for content entries (defaults to 50).
- `CRON_SECRET`: Secret authorization token for background cron job triggers (e.g., `/api/cron/broadcasts`). *Optional (recommended).*
- `S3_BUCKET`: The name of the S3/R2 bucket to store uploaded assets. *Optional (required if other S3 variables are specified).*
- `S3_REGION`: The region of the S3 bucket (`us-east-1` or `auto` for Cloudflare R2). *Optional (required if other S3 variables are specified).*
- `S3_ACCESS_KEY_ID`: S3/R2 API access key ID. *Optional (required if other S3 variables are specified).*
- `S3_SECRET_ACCESS_KEY`: S3/R2 API secret access key. *Optional (required if other S3 variables are specified).*
- `S3_ENDPOINT`: S3-compatible custom endpoint URL (required for Cloudflare R2). *Optional.*
- `S3_PUBLIC_URL`: Public asset delivery URL or CDN prefix used to serve assets publicly. *Optional.*
- `STRIPE_SECRET_KEY`: Server-side Stripe secret key (`sk_...` or `rk_...`) for online card checkout on registry funds. *Optional (required if `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is specified; placeholder keys are rejected).*
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: Client-side Stripe publishable key (`pk_...`) for Stripe Elements card checkout on registry funds. *Optional (required if `STRIPE_SECRET_KEY` is specified; placeholder keys are rejected).*
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret (`whsec_...`) for verifying `/api/registry/webhook/stripe` deliveries (`payment_intent.succeeded`). *Optional.*

---

## Webhooks & Scheduled Background Jobs

### 1. Stripe Registry Webhook (`payment_intent.succeeded`)
When online card checkout is enabled (`STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`), configure Stripe to deliver webhook events to your public deployment:
1. In the **Stripe Dashboard > Developers > Webhooks**, click **Add endpoint**.
2. Set the **Endpoint URL** to `https://<your-domain>/api/registry/webhook/stripe` and ensure `<your-domain>` is listed in `ALLOWED_HOSTS`.
3. Subscribe to the **`payment_intent.succeeded`** event.
4. Copy the endpoint's **Signing secret** (`whsec_...`) and set `STRIPE_WEBHOOK_SECRET` in your hosting provider's runtime environment.
5. `src/middleware.ts` validates `ALLOWED_HOSTS` and exempts `/api/registry/webhook/stripe` from guest/admin session cookies so Stripe deliveries reach `src/features/registry/api/webhook.ts`, which verifies the `stripe-signature` header against `STRIPE_WEBHOOK_SECRET` before recording paid contributions.

### 2. Scheduled Broadcast Cron (`/api/cron/broadcasts`)
Scheduled guest broadcasts (`ScheduledBroadcast` entries) are processed by calling `/api/cron/broadcasts`:
1. Generate a high-entropy secret (e.g., `openssl rand -hex 32`) and set `CRON_SECRET` in your hosting provider's runtime environment.
2. Configure your platform scheduler to issue periodic `GET` or `POST` requests (every 1–5 minutes, or daily on Vercel Hobby via `vercel.json`) to `https://<your-domain>/api/cron/broadcasts` with header:
   ```http
   Authorization: Bearer <CRON_SECRET>
   ```
3. On **Vercel**, the repository's root `vercel.json` schedules `/api/cron/broadcasts` (`0 14 * * *`) and Vercel automatically injects `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured in Vercel Environment Variables. On **Docker/VPS**, **Google Cloud Run**, **Railway**, and **Render**, configure host `crontab`, Cloud Scheduler, or a platform Cron service as documented in each provider recipe under [`docs/deployment/`](./docs/deployment/README.md).

---

## 🏗️ Architecture & Responsibilities

The automated release architecture decouples continuous delivery across isolated staging and production environments using mandatory human approval gates and automated rollback safeguards:

```
┌───────────────────────────────────────────────────────────┐
│ 1. Continuous Integration (ci.yml & storybook.yml)        │
│    • Static gates, lint, typecheck, VitePress docs:build  │
│    • Unit & integration tests, Storybook (storybook-build)│
│    • Production build, container tar & Playwright E2E     │
│    • GitHub Pages portal deployment (deploy-docs on main) │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│ 2. Artifact Publication (publish-artifact.yml)            │
│    • Multi-arch OCI Docker build                          │
│    • Tagged by immutable commit SHA & version             │
│    • Published to GHCR (default) & Docker Hub (optional) │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│ 3. Automated Staging Delivery (environment: staging)      │
│    • Static SQL DDL inventory (schema-compatibility)      │
│    • Staging Database Migration (db-migrate.yml)          │
│    • Staging Provider Deployment (deploy-provider.yml)    │
│    • Staging Health Verification (/api/health probe)      │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│ 4. Mandatory Production Review Gate (environment: prod)   │
│    • Reviewers inspect file-only DDL summary & staging    │
│    • Pauses db-migrate.yml before accessing prod secrets  │
│    • Mandatory human reviewer approval required           │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│ 5. Production Delivery Pipeline (environment: production) │
│    • Post-approval live prisma migrate status & deploy    │
│    • Production Provider Deployment (deploy-provider.yml) │
│    • Production Health Verification (/api/health probe)   │
└─────────────────────────────┬─────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │                   │
               [Success]            [Failure]
                    │                   │
                    ▼                   ▼
┌───────────────────────┐   ┌──────────────────────────────┐
│ Release Complete      │   │ 6. Automated Rollback        │
│ High Availability     │   │    • Calls rollback.yml      │
│ Preserved             │   │    • Restores previous tag   │
│ Live Traffic Healthy  │   │    • NO second approval gate │
└───────────────────────┘   └──────────────────────────────┘
```

The top-level **Release Pipeline (`deploy.yml`)** orchestrates steps 2 through 6 in safe sequence for releases.

### 🛡️ GitHub Environment Setup & Reviewer Configuration

To protect production database integrity and application availability, the deployment architecture requires two distinct GitHub repository environments with isolated credentials:

#### 1. Staging Environment (`staging`)
- **Purpose**: Automated pre-production integration testing, database schema migration verification, and container deployment validation on every merge to `main`.
- **Environment Setup**:
  1. Navigate to **Settings** > **Environments** in your GitHub repository.
  2. Click **New environment** and name it `staging`.
  3. **Protection Rules**: Leave "Required reviewers" unconfigured to permit unblocked, automated continuous delivery on every merge.
  4. **Environment Variables** (non-secret targets & Workload Identity Federation identifiers):
     - `SERVICE_URL`: Public base URL of the staging web service for `/api/health` probes (e.g., `https://staging.wedding.example.com`). Configure `SERVICE_URL` as a GitHub Environment variable (`vars.SERVICE_URL`) so cross-job `service_url` outputs and `$GITHUB_STEP_SUMMARY` diagnostics remain unmasked (`secrets.SERVICE_URL` is supported as a legacy fallback during migration).
     - `CLOUD_RUN_SERVICE`: Optional Cloud Run service name override for staging (defaults to `wedding-website-staging` so staging promotions never overwrite production `wedding-website`).
     - `CLOUD_RUN_REGION`: Optional Cloud Run region override for staging (defaults to `us-central1`).
     - `GCP_WORKLOAD_IDENTITY_PROVIDER`: Primary keyless OIDC Workload Identity Provider resource name (`projects/<project-number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`).
     - `GCP_SERVICE_ACCOUNT`: Service account email impersonated via Workload Identity Federation (`<sa-name>@<project-id>.iam.gserviceaccount.com`).
  5. **Environment Secrets**:
     - `DATABASE_URL`: Connection string for the isolated staging PostgreSQL instance (e.g., `postgresql://wedding:staging_pass@staging-db.internal:5432/wedding_staging`).
     - Provider secrets (`GCP_SA_KEY` fallback when Workload Identity Federation variables are unset, optional `GCP_PROJECT_ID`, or `DEPLOY_WEBHOOK_URL` + `DEPLOY_WEBHOOK_SECRET` for webhook/Docker host adapters). Because `staging` has no required reviewers, automated staging rollbacks can resolve variables and secrets directly from `staging` (or an optional `STAGING_ROLLBACK_ENVIRONMENT`).

#### 2. Production Environment (`production`)
- **Purpose**: Live environment hosting attendee traffic, requiring explicit human reviewer approval before executing schema migrations or container updates.
- **Environment Setup**:
  1. Navigate to **Settings** > **Environments** in your GitHub repository.
  2. Click **New environment** and name it `production`.
  3. **Required Reviewers (Mandatory Gate)**:
     - Check the **Required reviewers** checkbox.
     - Specify designated maintainers, release managers, or team leads authorized to approve production releases.
     - Select **Prevent self-review** if team policy mandates dual-control sign-off.
  4. **Deployment Branches**: Restrict deployment to `main` branch (and optionally release tags `v*` if promoting tagged releases via `deploy-provider.yml` with `image_tag` or `deploy.yml` with `release_ref` / `image_digest`; automated `deploy.yml` runs trigger on `main` after `CI` succeeds).
  5. **Environment Variables** (non-secret targets & Workload Identity Federation identifiers):
     - `SERVICE_URL`: Public base URL of the live production web service for `/api/health` probes (e.g., `https://wedding.example.com`). Configure `SERVICE_URL` as a GitHub Environment variable (`vars.SERVICE_URL`) so cross-job `service_url` outputs and `$GITHUB_STEP_SUMMARY` diagnostics remain unmasked (`secrets.SERVICE_URL` is supported as a legacy fallback during migration).
     - `CLOUD_RUN_SERVICE`: Optional Cloud Run service name override for production (defaults to `wedding-website`).
     - `CLOUD_RUN_REGION`: Optional Cloud Run region override for production (defaults to `us-central1`).
     - `GCP_WORKLOAD_IDENTITY_PROVIDER`: Primary keyless OIDC Workload Identity Provider resource name for production deployments.
     - `GCP_SERVICE_ACCOUNT`: Production service account email impersonated via Workload Identity Federation.
  6. **Environment Secrets** (workflow-consumed credentials only):
     - `DATABASE_URL`: Direct (non-pooled) connection string for the isolated production PostgreSQL instance used by `db-migrate.yml` (e.g., `postgresql://wedding:prod_pass@prod-db.internal:5432/wedding_prod`).
     - Provider secrets (`GCP_SA_KEY` fallback when OIDC variables are unset, optional `GCP_PROJECT_ID`, or `DEPLOY_WEBHOOK_URL` + `DEPLOY_WEBHOOK_SECRET` for signed webhook/Docker host deployments).
     - *Note*: Application runtime secrets (`ADMIN_PASSWORD`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, `S3_*`, `STRIPE_*`) are not read by GitHub Actions workflows and must be configured in your target hosting platform's secret store (such as GCP Secret Manager, Vercel Environment Variables, or VPS `.env`).

#### 3. Unguarded Production Rollback Environment (`production-rollback`)
- **Purpose**: Enables unattended container restoration when `/api/health` fails after a reviewer-approved production rollout, resolving environment-scoped provider credentials without pausing behind `production`'s human reviewer gate.
- **Environment Setup**:
  1. Navigate to **Settings** > **Environments** and click **New environment** named `production-rollback`.
  2. **Protection Rules**: Leave **Required reviewers** **unchecked** so emergency rollbacks execute immediately within the 60-second recovery target. Restrict **Deployment branches** to `main` and release tags (`v*`).
  3. **Environment Variables & Secrets**: Set `SERVICE_URL` (`vars.SERVICE_URL`, with `secrets.SERVICE_URL` supported as a legacy fallback), optional Cloud Run target/OIDC variables (`CLOUD_RUN_SERVICE`, `CLOUD_RUN_REGION`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`), and copy only the container deployment secrets required by `.github/workflows/rollback.yml` and `.github/workflows/deploy-provider.yml` (`GCP_SA_KEY`, `GCP_PROJECT_ID`, `DEPLOY_WEBHOOK_URL`, and `DEPLOY_WEBHOOK_SECRET` — `DATABASE_URL` is not needed because rollbacks preserve forward-only N-1 compatible schemas).
  4. **Pipeline Binding**: Set repository variable `PRODUCTION_ROLLBACK_ENVIRONMENT=production-rollback` under **Settings** > **Secrets and variables** > **Actions** > **Variables** (or pass `rollback_environment: production-rollback` during `workflow_dispatch`). When `rollback_environment` is omitted, `rollback.yml` falls back to `target_environment`.

#### 4. Strict Separation of Secrets & Database Credentials
- Staging and production **MUST NOT** share database credentials or database instances.
- Reusable workflows inherit secrets dynamically (`secrets: inherit` in `.github/workflows/deploy.yml` and `.github/workflows/rollback.yml`) and resolve environment-scoped secrets from `environment` / `rollback_environment`.
- Staging migrations execute strictly against the staging database; production migrations execute strictly against the production database following reviewer sign-off.

### 🔄 Staging Promotion & Approval Workflow

1. **Automated Staging Delivery on Merge & Tag Promotion SHA Resolution**:
   - When a pull request is merged into `main`, `.github/workflows/ci.yml` (`CI`) executes static checks, unit tests, container smoke tests, and Playwright E2E tests first. Once `CI` completes with `success` on the `main` push, GitHub Actions triggers `.github/workflows/deploy.yml` via `workflow_run` for `github.event.workflow_run.head_sha`. On manual `workflow_dispatch` or reusable `workflow_call` runs, `ci-gate` resolves `target_sha` from `image_tag` (verifying `origin/main` ancestry), from `release_ref` (dereferencing `v*` tags or commit SHAs via the GitHub Commits API), from the OIDC build provenance attestation and OCI `org.opencontainers.image.revision` metadata of `image_digest` (`gh attestation verify --format json` signed by `.github/workflows/publish-artifact.yml`), or from `github.sha` when no promotion input is supplied (failing closed if multiple promotion inputs resolve to different commits), and verifies a completed successful `CI` run for `target_sha`.
   - `schema-compatibility` aligns its git checkout to `target_sha` (`git checkout --detach`) on `workflow_run`, `image_tag`, `release_ref`, and `image_digest` runs (`npm run lint:migrations` and `scripts/preflight-migration-summary.ts --offline`), and both `staging-database-migration` and `production-database-migration` pass `commit_sha: target_sha` to `.github/workflows/db-migrate.yml` so `v*` tag or digest promotions execute `npm run lint:migrations` and `npx prisma migrate deploy` at the exact release commit rather than `main` `HEAD`. When `image_digest`, `image_tag`, and `release_ref` are omitted, `.github/workflows/publish-artifact.yml` runs once via `workflow_call` at `target_sha` to confirm passing `CI`, natively build (`ubuntu-latest` for `linux/amd64` and `ubuntu-24.04-arm` for `linux/arm64` without QEMU emulation, `provenance: false`, `sbom: false`), load `wedding-website:latest` via `skopeo`, Trivy-scan (`CRITICAL`/`HIGH`), smoke-test (`scripts/test-container.mjs`), and export `zstd`-compressed OCI archives without registry credentials in `build`, then re-verifies archive digests (`skopeo inspect`) and pushes architecture manifests (`skopeo copy --preserve-digests`), merges the multi-platform OCI index (`docker buildx imagetools create`) with `org.opencontainers.image.revision` metadata, signs OIDC build provenance attestations (`actions/attest-build-provenance` on `ghcr.io` and conditional `docker.io/`), and exports `image_digest` (`sha256:<64-hex>`).
   - `staging-deploy-provider` receives `commit_sha` (`needs.ci-gate.outputs.target_sha`) and the attested `image_digest` with job-scoped `deployments: read` and `actions: read`, checks out `commit_sha` (`fetch-depth: 2`), verifies OIDC provenance via `gh attestation verify` against the `oci://ghcr.io/<owner>/<repo>@sha256:<hex>` URI and confirms a passing `ci.yml` run for the signed source revision prior to rollout, captures the prior staging release (`previous_image_digest` and `previous_image_tag`: from the active Cloud Run revision and `staging` GitHub Deployments with `success` status when Cloud Run serves a digest-only `@sha256:` URI, or from completed non-dry-run `staging` workflow runs and GHCR-verified releases via `docker buildx imagetools inspect` / `HEAD^1` and commit parents of `commit_sha` for `docker-host` and `generic-webhook`) before deploying the digest-pinned container to `staging`, and validates `/api/health`.
2. **Pre-Flight Schema Compatibility & Offline Git Diff DDL Summary (Pre-Approval)**:
   - Prior to the `production` gate, `schema-compatibility` in `.github/workflows/deploy.yml` runs `npm run lint:migrations` and invokes `npx tsx scripts/preflight-migration-summary.ts --offline` **without** `DATABASE_URL`, diffing `prisma/migrations/` against `HEAD^1` (`NOT QUERIED` database status) and emitting changed SQL DDL summaries to `$GITHUB_STEP_SUMMARY` without claiming live pending migrations.
   - Simultaneously, `staging-database-migration` (`db-migrate.yml` against `staging` `DATABASE_URL`) and `staging-verify-deployment` validate live migration execution and `/api/health` in staging.
3. **Maintainer Review & Sign-Off (`production` Gate)**:
   - `production-database-migration` invokes `.github/workflows/db-migrate.yml` with `environment: production` declared on the `migrate` job, so GitHub Actions pauses the job **before** exposing production `DATABASE_URL` or querying the live production database.
   - Maintainers inspect the offline `git diff` SQL DDL summary from `schema-compatibility`, the attested `image_digest`, and the live staging migration/health results, then click **Review deployments** > `production` > **Approve and deploy**.
4. **Post-Approval Live Production DDL Check, Deployment & Automated Rollback Guard**:
   - Once approved, `.github/workflows/db-migrate.yml` unlocks `production` secrets, verifies `npm run lint:migrations`, queries live production `DATABASE_URL` via `npx prisma migrate status` (`npx tsx scripts/preflight-migration-summary.ts --require-db`) to audit pending/failed migrations, schema drift, and connectivity (redacting database URLs on failure) and emit the live DDL summary, and runs `npx prisma migrate deploy` with lock and statement timeouts.
   - `production-deploy-provider` passes `commit_sha` (`needs.ci-gate.outputs.target_sha`), job-scoped `deployments: read` and `actions: read`, and the exact `image_digest` attested in `publish-artifact.yml` (or an explicit `image_digest` / `release_ref` supplied on manual dispatches), checks out `commit_sha` (`fetch-depth: 2`), re-verifies OIDC build provenance via `gh attestation verify` against `.github/workflows/publish-artifact.yml` and confirms a passing `ci.yml` run for the signed source revision, captures the currently serving `production` container image (`previous_image_digest` and `previous_image_tag`: from the active Cloud Run revision and `production` GitHub Deployments with `success` status when Cloud Run serves a digest-only `@sha256:` URI so concurrent `staging` rollouts never pollute `production` rollback tags, or from completed non-dry-run `production` workflow runs / GHCR-published releases verified via `docker buildx imagetools inspect` and `HEAD^1` / commit parents relative to `commit_sha` while skipping `staging`, `dry_run`, and unpublished `HEAD^1` commits) before rollout, and deploys the immutable `@sha256:` URI via `.github/workflows/deploy-provider.yml`.
   - Post-deployment health probes verify `/api/health` with exponential backoff.
   - **Rollback Guarantee**: If the staging or production health probe fails, `.github/workflows/deploy.yml` depends on `ci-gate` and passes `commit_sha` (`needs.ci-gate.outputs.target_sha`), the captured `previous_image_digest`, `previous_image_tag`, `provider`, and unguarded `rollback_environment` to `.github/workflows/rollback.yml` instead of mutable `latest`. `rollback.yml` validates 40-character hexadecimal `commit_sha` (defaulting to `github.sha` on manual dispatch), rejects `latest` and the failing `commit_sha` / `github.sha`, checks out `commit_sha` to verify `npm run lint:migrations` without `main` drift, delegates redeployment (including OIDC provenance verification) to `.github/workflows/deploy-provider.yml` **without requiring a second human approval step**, and polls `${SERVICE_URL}/api/health` (`HTTP 200`, `.data.status == "ok"`, `.data.database == "connected"`) before reporting `SUCCESS`.

---

## 📄 Workflows Overview

### 1. Continuous Integration (`ci.yml`) & Storybook Showcase (`storybook.yml`)
- **Triggers**:
  - `ci.yml`: Pull requests, pushes to `main`, `v*` version tag pushes (running full verification without deploying GitHub Pages docs from non-default branches), and published releases (`release: [published]`).
  - `storybook.yml` (`Storybook Static Showcase`): Manual `workflow_dispatch` (on-demand artifact build; pushes to `main` compile Storybook once in `ci.yml`).
- **Secrets required**: *None* (runs entirely on isolated local containers and GitHub OIDC Pages tokens).
- **Jobs & Actions**:
  - `verify` (`ci.yml`): Environment, runbook, and setup guide checks (`check:env-docs`, `check:runbooks`, `check:setup-guides`), identifier isolation (`check:identifiers`), action SHA & `# v...` version comment pinning with upstream commit verification (`npm run check:action-pins -- --verify-upstream`), container digest & standalone portability (`check:standalone`), relative link validation (`check:links`), specification route & symbol contracts (`check:spec-contracts`), Prisma schema validation (`check:prisma`), TypeScript type checking (`npm run typecheck`), ESLint (`npm run lint`), Knip (`npm run lint:unused`), migration compatibility (`npm run lint:migrations`), OpenAPI/architecture sync, and VitePress portal compilation (`npm run docs:build`).
  - `unit-test` (`ci.yml`): Jest unit and integration tests (`npm test`) against `postgres:15-alpine`, uploading coverage and `jest-a11y-violations` artifacts.
  - `build` (`ci.yml`): Hydrates persisted `amd64` BuildKit cache mounts (`/var/cache/apt`, `/var/lib/apt`, `/root/.npm`, `/app/.next/cache`) via `actions/cache`, builds Next.js once inside `wedding-website:latest` (`linux/amd64`) using `app-amd64` BuildKit layer cache (exporting `mode=max` cache layers only on non-`pull_request` runs), scans `wedding-website:latest` with `aquasecurity/trivy-action` (`CRITICAL` and `HIGH` severities, `exit-code: 1`, zero secrets), extracts standalone output from `wedding-website:latest` into `.next/standalone` for post-build standalone portability and execution checks (`npm run check:standalone -- --require-standalone`, `npm run test:standalone`) and `next-build-artifact`, runs production dependency audit (`npm run check:audit`) and OCI container & clean database smoke tests (`npm run test:container` with `SKIP_IMAGE_BUILD=true` and `GHA_CACHE_SCOPE=app-amd64`), and exports `wedding-website:latest` as a `zstd`-compressed archive (`wedding-website-image.tar.zst` inside the `wedding-website-container` artifact; database-free static HTML exports are also supported locally/in custom pipelines via `npm run build:export`).
  - `container-arm64` (`ci.yml`): Parallel native `linux/arm64` OCI container build (hydrating persisted `arm64` BuildKit cache mounts via `actions/cache`, reading `app-arm64` BuildKit layer cache, and skipping `mode=max` writes on `pull_request` events), `aquasecurity/trivy-action` `CRITICAL`/`HIGH` container vulnerability scan (`exit-code: 1`, zero secrets), clean-database Prisma migration check, and HTTP probe smoke test (`scripts/test-container.mjs` with `SKIP_IMAGE_BUILD=true`) on `ubuntu-24.04-arm` (GitHub-hosted `ubuntu-24.04-arm` runners run free on public repositories, whereas private forks may require paid runner quotas).
  - `storybook-build` (`ci.yml`) & `build` (`storybook.yml`): Compiles the static Storybook component showcase (`npm run build-storybook`) with matching `actions/cache` steps for `node_modules/.cache/webpack` and `node_modules/.cache/storybook` (`storybook.yml` runs on manual `workflow_dispatch` and uploads the `storybook-static` artifact).
  - `e2e-test` (`ci.yml`): Depends only on `build` (`contents: read`), runs the full standalone Playwright E2E and WCAG accessibility suite (`npx playwright test`) against `next-build-artifact`, and uploads `playwright-a11y-violations` (`test-results/playwright-a11y-violations.json`) with `if: always()`.
  - `container-e2e-smoke` (`ci.yml`): Runs in parallel after `build` (`contents: read`), decompresses and loads `wedding-website-image.tar.zst` (`zstd -dc ... | docker load`) from `wedding-website-container`, starts `db`, `migration`, and `app` via `docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml up -d app`, polls `http://localhost:3000/api/ready` (`curl -sf`), seeds the container database (`npm run db:seed`), and runs fast targeted `@smoke` Playwright specs (`TEST_CONTAINER=true npm run test:e2e:smoke` across `e2e/guest-callback-url.spec.ts`, `e2e/meta.spec.ts`, and `e2e/skip-link.spec.ts`).
  - `a11y-report` (`ci.yml`): Runs after `unit-test` and `e2e-test` with `if: '!cancelled()'` (`pull-requests: write`, `issues: write`), downloads `jest-a11y-violations` and `playwright-a11y-violations` artifacts, generates `test-results/a11y-summary.md` via `node scripts/a11y-report.mjs` (marking any missing suite artifact as incomplete), and updates the `<!-- a11y-report -->` pull request comment and `$GITHUB_STEP_SUMMARY` even when violations exit non-zero.
  - `deploy-docs` (`ci.yml`): On pushes to `main` or published releases, builds `docs-portal/.vitepress/dist` via `npm run docs:build` and publishes the static documentation portal to the `github-pages` environment via `actions/deploy-pages`.

### 2. Artifact Publication (`publish-artifact.yml`)
- **Triggers & Concurrency**: Reusable `workflow_call` from `deploy.yml` (after `CI` succeeds on `main`), pushes to `v*` tags, and manual `workflow_dispatch`, serialized inside a single shared `publish-artifact-release` concurrency group (`cancel-in-progress: false`) so parallel `v*` tag and `main` runs never race on `:latest` or BuildKit caches. Pushing a `v*` tag triggers both `ci.yml` and `publish-artifact.yml`: `publish-artifact.yml` verifies `origin/main` ancestry, polls active `ci.yml` runs, and requires a passing `CI` result for the target commit before building or signing images, publishes both `ghcr.io/<owner>/<repo>:<GITHUB_REF_NAME>` (such as `:v0.1.0`) and `ghcr.io/<owner>/<repo>:<sha>`, and updates `:latest` identically across GHCR and optional Docker Hub **only** when a pushed stable SemVer tag (`vMAJOR.MINOR.PATCH`) equals or exceeds every stable repository version tag (ignoring pre-release tags such as `v2.2.0-rc.1`, while manual `workflow_dispatch` / `commit_sha` / custom `tag_name` runs, default-branch non-tag builds, and `N-1` maintenance patch tags such as `v1.4.3` below `v2.0.0` never overwrite `:latest`) without automatically invoking `deploy.yml`; operators can promote a tagged release via `deploy.yml` (`workflow_dispatch` with `image_tag: v0.1.0`, `release_ref: v0.1.0`, or `image_digest`, resolving `target_sha` to the tag's source commit before executing `schema-compatibility` and `db-migrate.yml`) or `deploy-provider.yml` (`image_tag: v0.1.0` after `db-migrate.yml`).
- **Runner Quotas**: Native `linux/amd64` and `linux/arm64` matrix builds run on GitHub-hosted `ubuntu-latest` and `ubuntu-24.04-arm` runners, which run free on public repositories (private forks may require paid runner quotas or runner overrides).
- **Permissions**: Top-level `contents: read`; `preflight` scopes `contents: read` and `actions: read` (for `origin/main` ancestry and `ci.yml` status verification), `build` retains strictly `contents: read` and `security-events: write` (for uploading Trivy SARIF scan results to GitHub Code Scanning, with zero registry write permissions or registry credentials), and the isolated `publish` job scopes `contents: read`, `packages: write` (for GitHub Container Registry), `id-token: write`, and `attestations: write` (for OIDC cryptographic build provenance attestations, dropping unused `security-events: write`; caller `deploy.yml` retains the union of callee-required scopes).
- **Actions**:
  - Runs a `preflight` gate before building that fetches `origin/main`, verifies the 40-character target commit (`inputs.commit_sha` or `github.sha`) is an ancestor of `origin/main` (`git merge-base --is-ancestor`), polls any in-progress `ci.yml` workflow runs for that revision, and blocks image builds, registry uploads, and provenance signing unless a completed successful `ci.yml` run exists.
  - Builds native `linux/amd64` (`ubuntu-latest`) and `linux/arm64` (`ubuntu-24.04-arm`) container images once per architecture as local OCI archives (`outputs: type=oci,dest=/tmp/oci-<arch>.tar`, `provenance: false`, `sbom: false`) in parallel (`build` matrix job, `needs: [preflight]`) without QEMU emulation, hydrating and persisting per-architecture BuildKit cache mounts (`/var/cache/apt`, `/var/lib/apt`, `/root/.npm`, `/app/.next/cache`) via `actions/cache` while sharing unified per-architecture BuildKit GitHub Actions cache scopes (`app-amd64` and `app-arm64`) with `docker-compose.ci.yml` and `ci.yml`.
  - Loads `wedding-website:latest` directly from each exported OCI archive into the local Docker daemon via `skopeo copy` and executes Trivy vulnerability scanning (`aquasecurity/trivy-action`) on **both** `linux/amd64` and `linux/arm64` native images, failing the workflow before archive handoff whenever either architecture contains `CRITICAL` or `HIGH` severity vulnerabilities.
  - Uploads per-architecture SARIF vulnerability reports (`trivy-results-amd64.sarif` and `trivy-results-arm64.sarif`, categories `trivy-amd64` and `trivy-arm64`) to GitHub Code Scanning via `github/codeql-action/upload-sarif`.
  - Runs native container & clean-database migration smoke tests (`scripts/test-container.mjs` with `SKIP_IMAGE_BUILD=true`) against that exact loaded image on both `ubuntu-latest` and `ubuntu-24.04-arm` hosts, then compresses each verified OCI archive with `zstd` and uploads the archive and its inspected `sha256` manifest digest as workflow artifacts (`oci-archive-amd64` and `oci-archive-arm64`).
  - Checks out full repository tag history (`fetch-depth: 0`) in the isolated `publish` job to evaluate SemVer 2.0.0 `:latest` eligibility, decompresses the artifacts, re-verifies both `linux/amd64` and `linux/arm64` archive manifest digests via `skopeo inspect` before any external registry upload, pushes each verified archive via `skopeo copy --preserve-digests` to `ghcr.io` (and optional `docker.io`), and merges them into multi-platform OCI indexes via `docker buildx imagetools create` with `index:org.opencontainers.image.revision` metadata (verifying both `linux/amd64` and `linux/arm64` manifests plus `org.opencontainers.image.revision` via `docker buildx imagetools inspect` and tagging `GITHUB_REF_NAME`, the commit SHA, and SemVer-gated `:latest` identically across GHCR and optional Docker Hub).
  - Generates signed OIDC build provenance attestations via `actions/attest-build-provenance` (`# v4.2.2`) on the merged `ghcr.io` multi-platform index digest (compatible with `gh attestation verify` in `deploy-provider.yml` and `deploy.yml`) and conditionally signs the secondary `docker.io/` multi-platform index digest (`create-storage-record: false`) when Docker Hub credentials are configured.
- **Outputs**:
  - `image_uri`: Primary OCI URI (`ghcr.io/<owner>/<repo>:<sha>` on `main` / `workflow_call`, or `ghcr.io/<owner>/<repo>:v*` on `v*` tag pushes alongside `:<sha>`).
  - `image_tag`: Resolved version tag (`GITHUB_REF_NAME` on `v*` tag pushes) or immutable commit SHA.
  - `image_digest`: Attested OCI image digest (`sha256:<64-hex>`) propagated to staging and production deployment jobs.

### 3. Database Migration (`db-migrate.yml`)
- **Triggers**: Release pipeline (`workflow_call`, where `confirm` defaults to `true`), manual `workflow_dispatch` with target environment (`production`, `staging`, `development`) and explicit confirmation (`confirm` defaults to `false`).
- **Secrets required**: `DATABASE_URL` (direct/unpooled connection string).
- **Actions**:
  - Declares `environment: ${{ inputs.environment || 'production' }}` on the `migrate` job, enforcing GitHub Environment Protection Rules and pausing for human reviewer sign-off **before** exposing `production` secrets.
  - Verifies `inputs.confirm == true` first (`Verify Manual Migration Confirmation`) and halts immediately with a non-zero exit code before repository checkout or `npx prisma migrate deploy` when manual dispatches leave `confirm: false`.
  - After environment unlock and confirmation, runs `npm run lint:migrations` and validates `DATABASE_URL` format.
  - Queries the live target `DATABASE_URL` via `npx prisma migrate status` (`npx tsx scripts/preflight-migration-summary.ts --require-db`) after the `confirm` gate to emit pending migration SQL DDL summaries and fail closed with redacted diagnostics on connectivity errors, schema drift, or failed migrations in `$GITHUB_STEP_SUMMARY`.
  - Executes `npx prisma migrate deploy` against `DATABASE_URL` with `PGOPTIONS="-c lock_timeout=5000ms -c statement_timeout=30000ms"`.
  - Emits diagnostic error signaling and resolution guidance if migration fails.

### 4. Provider Deployment Adapter (`deploy-provider.yml`)
- **Triggers**: Release pipeline (`workflow_call`) with `image_digest`, rollback pipeline (`workflow_call`) with `image_digest` / `image_tag` and optional `rollback_environment`, or manual `workflow_dispatch` with an explicit `image_digest` (`sha256:<64-hex>`) or immutable release/commit `image_tag` (unpinned `latest` tags are rejected).
- **Permissions**: Top-level `contents: read`; deployment job (and reusable workflow caller jobs) scopes `packages: read`, `attestations: read`, `id-token: write`, `deployments: read`, and `actions: read` for registry inspection, OIDC provenance verification, signed-revision `ci.yml` / `db-migrate.yml` workflow verification, Google Cloud Workload Identity Federation, and environment-filtered GitHub Deployments status queries.
- **Secrets & Variables**:
  - **Environment Variables**: `SERVICE_URL` (`vars.SERVICE_URL` primary, with `secrets.SERVICE_URL` supported as a legacy fallback), `CLOUD_RUN_SERVICE` (defaults to `wedding-website-staging` for `staging` and `wedding-website` for `production`), `CLOUD_RUN_REGION` (defaults to `us-central1`), and primary keyless OIDC authentication variables `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT`.
  - **Environment Secrets**: Static fallback `GCP_SA_KEY` and optional `GCP_PROJECT_ID` for `google-cloud-run`, or `DEPLOY_WEBHOOK_URL` and mandatory HMAC signing secret `DEPLOY_WEBHOOK_SECRET` for `generic-webhook` and `docker-host`.
- **Inputs**:
  - `environment`: Target deployment environment (`production` or `staging`).
  - `rollback_environment`: Optional unguarded GitHub Environment override for rollback secret resolution.
  - `commit_sha`: Optional 40-character hexadecimal commit SHA checked out (`fetch-depth: 2`) and assigned to `CURRENT_SHA` for rollback history guards (defaults to `github.sha` when omitted on `workflow_dispatch`).
  - `image_digest`: Immutable OCI image digest (`sha256:<64-hex>`) to deploy directly.
  - `image_tag`: Immutable version tag (`v*`, verifying `--source-ref refs/tags/<image_tag>`) or commit SHA (verifying `--source-ref refs/heads/main`, resolved to an immutable `sha256` digest via `docker buildx imagetools inspect` when `image_digest` is omitted).
  - `source_ref`: Optional expected OIDC provenance source ref override (`refs/heads/main` or `refs/tags/v*`; digest-only and SHA rollouts also accept `refs/tags/v*`-attested release artifacts).
  - `provider`: Hosting provider adapter (`google-cloud-run`, `docker-host`, or `generic-webhook`).
  - `cloud_run_service` / `cloud_run_region`: Optional Cloud Run target overrides resolved ahead of `vars.CLOUD_RUN_SERVICE` / `vars.CLOUD_RUN_REGION` and environment defaults.
  - `dry_run`: Explicit dry-run validation flag (`false` by default; `is_dry_run` is never coerced to `true` when secrets are missing).
- **Outputs**:
  - `service_url`: Target deployment service URL.
  - `is_dry_run`: Boolean flag indicating if deployment executed in explicit dry-run mode (`inputs.dry_run == true`).
  - `previous_image_tag`: Prior immutable container image tag or GHCR-verified release SHA captured before rollout.
  - `previous_image_digest`: Prior immutable `sha256` OCI image digest captured before rollout (from the serving Cloud Run revision for `google-cloud-run`, or resolved via `docker buildx imagetools inspect` from the last non-dry-run target-environment release for `docker-host` and `generic-webhook`).
  - `image_digest`: Verified immutable `sha256` OCI image digest deployed.
  - `image_uri`: Full digest-pinned OCI image URI (`ghcr.io/<owner>/<repo>@sha256:<hex>`).
  - `attestation_status`: OIDC build provenance attestation verification status (`verified`).
- **Actions**:
  - Declares `environment: ${{ inputs.rollback_environment || inputs.environment || 'production' }}`, enforcing GitHub Environment Protection Rules and reviewer sign-off for forward `production` releases while supporting unguarded rollback environments.
  - Rejects unpinned `latest` tags, resolves tag-only manual or rollback dispatches to immutable `sha256` digests via `docker buildx imagetools inspect`, and validates digests against `^sha256:[a-f0-9]{64}$`.
  - Runs `gh attestation verify` against `oci://ghcr.io/<owner>/<repo>@sha256:<hex>` with `--owner`, `--signer-workflow <owner>/<repo>/.github/workflows/publish-artifact.yml`, and `--source-ref` (`refs/tags/<image_tag>` for `v*` tags or `refs/heads/main`), resolves the signed 40-character source revision from the OCI index `org.opencontainers.image.revision` annotation (with SLSA / OIDC certificate provenance fallback), and confirms a completed passing `ci.yml` run for that revision before invoking any provider adapter or dry-run step.
  - On standalone live promotions (`workflow_dispatch` with `!inputs.dry_run`), resolves the target commit SHA (from `image_tag` or verified OIDC attestation `sourceRepositoryDigest`), verifies `origin/main` ancestry, and confirms completed successful `ci.yml` and `db-migrate.yml` runs before touching provider credentials or deploying.
  - Fails closed on live runs (`!inputs.dry_run`) in `Verify Selected Provider Credentials` when required adapter credentials are absent (requiring `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT` or fallback `GCP_SA_KEY` for `google-cloud-run`, and both `DEPLOY_WEBHOOK_URL` + `DEPLOY_WEBHOOK_SECRET` for `generic-webhook` / `docker-host`).
  - Captures `previous_image_digest` and `previous_image_tag` before rollout: `google-cloud-run` inspects the currently serving Cloud Run revision in the resolved service and region (querying environment-scoped GitHub Deployments via `deployments: read` for the newest prior 40-character commit SHA with `success` status when Cloud Run serves a digest-only `@sha256:` URI), while `docker-host`, `generic-webhook`, and fallback paths filter completed `deploy.yml` and `deploy-provider.yml` runs to target-environment (`staging` or `production`) successes without `dry_run`, verify fallback candidate tags in GHCR via `docker buildx imagetools inspect` (skipping unpublished `HEAD^1` commits), and fall back to `HEAD^1` and commit parents relative to the pinned `CURRENT_SHA` (`inputs.commit_sha || github.sha`).
  - Deploys the digest-pinned `@sha256:` container URI to the hosting provider (Google Cloud Run via Workload Identity Federation OIDC or `GCP_SA_KEY` fallback, or stateless webhook `POST` for `docker-host` and `generic-webhook` to `DEPLOY_WEBHOOK_URL` signed with HMAC-SHA256 headers `X-Hub-Signature-256`, `X-Deploy-Timestamp`, and `X-Deploy-Signature-256` plus `--fail-with-body` HTTP error enforcement) and records the verified digest, pinned URI, attestation status, and pre-rollout tag/digest in `$GITHUB_STEP_SUMMARY`.
- **Signed Webhook Wire Contract (`docker-host` & `generic-webhook`)**:
  - **Endpoint & Secrets**: Sends an authenticated `POST` request (`Content-Type: application/json`, 10s connect timeout, 30s max runtime) to `secrets.DEPLOY_WEBHOOK_URL` signed with `secrets.DEPLOY_WEBHOOK_SECRET`.
  - **JSON Payload (`{image, digest, environment}`) & Multi-Line Raw-Byte Formatting**: Constructs `PAYLOAD` via `jq -n` (without `-c`), producing pretty-printed multi-line UTF-8 JSON with 2-space indentation and internal `\n` newlines (trailing newline stripped by command substitution; `digest` is omitted only when empty):
    ```json
    {
      "image": "ghcr.io/<owner>/<repo>@sha256:<64-hex>",
      "digest": "sha256:<64-hex>",
      "environment": "production"
    }
    ```
    Stateless webhook listeners **must** compute HMAC digests over the **exact raw HTTP request body bytes** (`PAYLOAD`) before parsing JSON — re-serializing with `JSON.stringify(body)` changes whitespace and invalidates both signatures.
  - **Dual-HMAC & Replay Headers**:
    - `X-Deploy-Timestamp: <unix-seconds>` — UTC epoch timestamp (`date -u +%s`). Receivers should enforce a replay window (recommended `±300` seconds) before pulling containers.
    - `X-Hub-Signature-256: sha256=<64-hex>` — `HMAC-SHA256(DEPLOY_WEBHOOK_SECRET, PAYLOAD)` computed over the raw `PAYLOAD` bytes.
    - `X-Deploy-Signature-256: sha256=<64-hex>` — `HMAC-SHA256(DEPLOY_WEBHOOK_SECRET, "${X-Deploy-Timestamp}.${PAYLOAD}")` computed over `${X-Deploy-Timestamp}.${PAYLOAD}`, cryptographically binding the timestamp and raw payload against replay attacks.

### 5. Post-Deployment Verification & Automated Rollback (`deploy.yml` & `rollback.yml`)
- **Triggers**: `deploy.yml` triggers via `workflow_run` after `CI` completes successfully on `main` pushes (or via `workflow_dispatch` / `workflow_call` with optional `image_tag`, `release_ref`, or `image_digest`, resolving `v*` release tags or attested digests via OCI `org.opencontainers.image.revision` / SLSA provenance to `target_sha` and confirming a successful `CI` run for `target_sha` before executing `schema-compatibility`, `db-migrate.yml`, and `deploy-provider.yml`), running health verification automatically post-provider deployment for staging and production (`rollback.yml` can also be invoked manually via `workflow_dispatch` with optional 40-character `commit_sha`, defaulting to `github.sha`).
- **Actions**:
  - `verify-deployment` polls `/api/health` with configurable exponential backoff and a 2-minute maximum timeout.
  - Validates HTTP status code 200 and confirms wrapped JSON body `.data.database == "connected"` and `.data.status == "ok"`.
  - Automatically invokes `rollback.yml` (with `ci-gate` `commit_sha`, `previous_image_digest`, `previous_image_tag`, `provider`, and job-scoped `deployments: read` and `actions: read`) if health probes fail or time out, rejecting mutable `latest` or the failing `CURRENT_SHA` (`inputs.commit_sha || github.sha`) outside explicit dry-run mode.
  - `rollback.yml` checks out the pinned `commit_sha` (rather than drifted `HEAD`) to run `npm run lint:migrations`, calls `deploy-provider.yml` using the unguarded `rollback_environment`, polls `${SERVICE_URL}/api/health` (`.data.status == "ok"` and `.data.database == "connected"`) to confirm restoration, and gates `$GITHUB_STEP_SUMMARY` status reporting so any failed stage logs `FAILED` and exits non-zero.

---

## 🚀 Rollout Sequence & Zero-Downtime Migration Expectations

To ensure zero downtime and prevent application outages:

1. **Schema Changes Must Be Backward-Compatible**:
   - Use the **expand-contract** migration pattern.
   - Adding new columns/tables: Must be nullable or have default values.
   - Deleting or renaming columns/tables: Must be performed in a subsequent release after application code no longer queries old schema elements.
2. **Execution Order**:
   - Step 1: CI verifies codebase integrity and container runtime.
   - Step 2: Artifact Publication builds and pushes immutable image tagged by SHA.
   - Step 3: Database Migration applies non-breaking migrations to production database.
   - Step 4: Provider Deployment updates container instances to the new image SHA.
3. **Container Entrypoint**:
   - Application containers default to skipping automatic migrations (`RUN_MIGRATIONS=false`).
   - Migrations are managed explicitly via `db-migrate.yml` or dedicated release jobs to prevent concurrent migration race conditions across multi-replica deployments.

## Database Migrations & Portable PostgreSQL Contract

The application defines a strict **PostgreSQL Database Contract**. It depends solely on standard PostgreSQL capabilities and is completely portable across database providers and self-hosted environments.

Database migrations are run automatically using `npx prisma migrate deploy` in the `db-migrate.yml` workflow *before* the new application code goes live. Schema migrations are completely decoupled from application container boot (`docker-entrypoint.sh`), allowing application instances to start immediately without database lock contention during horizontal scaling. In local Docker Compose environments, a dedicated `migration` task service executes `npx prisma migrate deploy` before the application service starts. Before migrations are executed, a pre-migration backwards compatibility check (`npm run lint:migrations`) runs to verify zero-downtime safety.

### Minimum Supported Database Specification
- **Supported Database**: PostgreSQL 14 or higher (the CI test suite and standard container setup use `postgres:15-alpine`).
- **ORM / Client**: Prisma ORM with `@prisma/adapter-pg` driver adapter and `pg` pool.

### Connection String Expectations
- **`DATABASE_URL`** (Required — `datasource.url` in `prisma.config.ts`): The primary connection string read by both the Next.js runtime application and `npx prisma migrate deploy`.
  - **Standard URI Format**: `postgresql://[user]:[password]@[host]:[port]/[database]?sslmode=[mode]`
  - **Example (Local PostgreSQL)**: `postgresql://wedding:wedding123@localhost:5432/wedding`
  - **Example (Cloud Host with SSL)**: `postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/wedding?sslmode=require`
  - **Example (Cloud SQL / Unix Domain Socket)**: `postgresql://wedding_user:STRONG_PASSWORD@localhost/wedding_db?host=/cloudsql/YOUR_PROJECT_ID:us-central1:wedding-db` *(specify `@localhost` in the authority segment for Prisma CLI compatibility; legacy empty-host `@/` socket URIs with a valid `?host=/...` path are normalized to `@localhost` automatically)*
  - **URI Schema, Pool & Timeout Flags**: Runtime `pg.Pool` and `@prisma/adapter-pg` honor `?schema=` (default `public`), `?connection_limit=` (default `max=5`, keeping three instances safely below `db-f1-micro`'s `max_connections=25`), `?connect_timeout=` / `?pool_timeout=` in seconds (default `10s` / `10000ms` to tolerate serverless cold wakes), `?socket_timeout=` in seconds, and `?statement_timeout=` in milliseconds.
- **`POSTGRES_URL_NON_POOLING`** (Optional — `datasource.shadowDatabaseUrl` in `prisma.config.ts`): Direct, unpooled connection string used by Prisma for shadow database creation during local `prisma migrate dev`. It is **not** read automatically by `prisma migrate deploy`, though operators can store a direct PostgreSQL URL in `POSTGRES_URL_NON_POOLING` and pass it via an explicit `DATABASE_URL` override when running `prisma migrate deploy`.
  - **Example**: `postgresql://user:pass@ep-example-direct.us-east-1.aws.neon.tech/wedding_shadow?sslmode=require`

### SSL/TLS Configuration Behavior
- **libpq-Compatible Resolution**: Runtime `src/lib/prisma.ts` resolves `sslmode` and `ssl` query parameters according to standard PostgreSQL `libpq` semantics rather than aliasing `prefer`/`require` to `verify-full`.
- **Supported TLS Modes**:
  - `sslmode=disable` (or `ssl=false` / `ssl=0`): Connects over plaintext TCP or Unix domain sockets without TLS negotiation.
  - `sslmode=prefer`: Attempts TLS encryption first and automatically falls back to plaintext when connecting to a PostgreSQL server without SSL enabled (such as local `postgres:15-alpine` containers).
  - `sslmode=require` or `ssl=true`: Enforces encrypted TLS transport and accepts self-signed server certificates unless `sslrootcert` is explicitly configured. Recommended for managed cloud databases (Neon, Supabase, Render, Railway).
  - `sslmode=verify-ca`: Enforces strict CA certificate chain verification against `sslrootcert` (or the system trust store) without hostname matching.
  - `sslmode=verify-full`: Enforces both strict CA certificate chain validation (`sslrootcert` or system trust store) and server hostname/SAN verification.

### Connection Pooling vs. Direct Migration Connections
- **Application Runtime (`DATABASE_URL`)**:
  - Can connect through transaction-level or session-level connection poolers (e.g., PgBouncer, RDS Proxy, Supabase Pooler, Neon Connection Pooler).
  - Uses connection pooling managed by `pg.Pool` with `@prisma/adapter-pg` to minimize connection overhead during serverless / containerized scaling.
- **Prisma Migrations (`npx prisma migrate deploy` / `dev`)**:
  - **Requirement**: Schema migration commands require **advisory locks** and session-level state that transaction-mode connection poolers (like PgBouncer in transaction mode) do not support.
  - Because `prisma.config.ts` binds `datasource.url` to `DATABASE_URL` and `datasource.shadowDatabaseUrl` to `POSTGRES_URL_NON_POOLING`, `npx prisma migrate deploy` always reads `DATABASE_URL` and rejects identical `url` and `shadowDatabaseUrl` values (`P3025`). When runtime `DATABASE_URL` points to PgBouncer, pass an explicit `DATABASE_URL` override while unsetting `POSTGRES_URL_NON_POOLING` for the migration subprocess (`DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy`, or a direct `DATABASE_URL` secret in `db-migrate.yml`).

### Prisma Migration Lifecycle
1. **Local Development**:
   - Run `npm run migrate:dev` (`prisma migrate dev`) to generate new SQL migration files in `prisma/migrations/` and synchronize your development schema.
2. **Production Pipeline**:
   - Migrations are automatically run in CI/CD (`deploy.yml` or container entrypoint) via `npx prisma migrate deploy` *before* new application code goes live.
   - `prisma migrate deploy` checks applied migrations in the `_prisma_migrations` table and applies any pending migrations in sequential order.

### Migration Backwards Compatibility Linter

Automated linter checks (`npm run lint:migrations`) run during pre-push hooks, local builds, PR CI workflows (`ci.yml`), migration executions (`db-migrate.yml`), releases (`deploy.yml`), and rollbacks (`rollback.yml`). The linter (`scripts/verify-migration-compatibility.ts`) tokenizes SQL migrations in `prisma/migrations/` into semicolon-delimited statements—including multi-line statements, comma-separated `ALTER TABLE` clauses, and inner SQL inside PL/pgSQL `DO $$ ... $$` blocks—and flags destructive or N-1 incompatible DDL operations:

- **Destructive DDL**: `DROP TABLE`, `DROP COLUMN`, `RENAME COLUMN`, `RENAME TO`, `DROP CONSTRAINT`, `DROP TYPE`, and `TRUNCATE`
- **Breaking Column Constraints & Type Mutations**: `ADD COLUMN` with `NOT NULL` lacking `DEFAULT`, `SET NOT NULL`, and `SET DATA TYPE`

If a breaking change is intentionally required (e.g., during a contract cleanup phase after code removal), annotate that specific statement with `-- allow-destructive: <reason>` including a mandatory non-empty `<reason>`:

```sql
-- allow-destructive: Contract phase dropping deprecated legacy_column after code migration
ALTER TABLE "User" DROP COLUMN "legacy_column";
```

Each `-- allow-destructive: <reason>` directive scopes strictly to the single statement that immediately follows or contains it (or an outer `DO` block / individual inner statement inside a `DO` block) and resets after that statement. Annotations missing `<reason>` text, or appearing inside block comments (`/* ... */`) or string literals, are ignored.

### Backup & Restore Guidelines
Before applying schema migrations to production, always perform a database snapshot or logical backup:
- **Logical Dump (`pg_dump`)**:
  ```bash
  pg_dump -h [host] -U [user] -d [dbname] -F c -b -v -f backup_$(date +%Y%m%d_%H%M%S).dump
  ```
- **Logical Restore (`pg_restore`)**:
  ```bash
  pg_restore -h [host] -U [user] -d [dbname] -v -c backup_YYYYMMDD_HHMMSS.dump
  ```

### Rollback Limitations & Compensating Migrations
- **Forward-Only Migration Policy**: Prisma Migrate does not generate automatic `down` migrations or support automated rollbacks for applied migration files. Production databases must always move forward to maintain transactional integrity and prevent catastrophic data loss.
- **Handling Failed Migrations**:
  1. Do NOT manually edit or remove migration files that have already been executed in production.
  2. Create a compensating forward migration using `prisma migrate diff` or manual SQL to reverse desired changes safely.
  3. Mark failed migration states resolved if needed using `npx prisma migrate resolve --rolled-back [migration_name]`.

### Zero-Downtime Schema Expansion Guidance (Expand-Migrate-Contract)
To maintain zero database downtime and support continuous delivery, all database mutations must strictly adhere to the three-phase **Expand-Migrate-Contract** pattern across releases:

1. **Phase 1: Expand**
   - **Permitted Changes**: Add new tables, nullable columns (`NULL`), or optional fields, or drop `NOT NULL` constraints (`DROP NOT NULL`). Non-null columns (`NOT NULL`) on existing tables are permitted **ONLY** when accompanied by an explicit `DEFAULT` value (e.g., `ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'GUEST';`).
   - **Prohibitions**: Never drop tables (`DROP TABLE`), drop columns (`DROP COLUMN`), drop constraints (`DROP CONSTRAINT`), drop types (`DROP TYPE`), truncate tables (`TRUNCATE`), rename tables (`RENAME TO`) or columns (`RENAME COLUMN`), alter column types (`SET DATA TYPE`), tighten nullability (`SET NOT NULL`), or add `NOT NULL` columns without default values.
   - **Automated Pre-Deployment Verification**: Preflight CI/CD linting (`npm run lint:migrations` executing `scripts/verify-migration-compatibility.ts`) inspects every SQL migration in `prisma/migrations/`. Any non-backwards-compatible statement immediately blocks the pipeline in PR checks (`ci.yml`), migration executions (`db-migrate.yml`), and deployment pipelines (`deploy.yml`).

2. **Phase 2: Migrate**
   - **Dual-Reading & Dual-Writing**: Deploy application code that reads from both the old and new schema fields and writes to both (or writes to the new field while gracefully falling back to the old).
   - **N-1 Safe Deployment**: Older application container versions (N-1) can run alongside or be restored against the newly expanded schema without experiencing runtime crashes or SQL constraint violations.
   - **Data Backfill**: Execute asynchronous data backfill scripts (`npm run db:seed` or targeted data migration scripts) to populate historic rows with appropriate new data representations.

3. **Phase 3: Contract**
   - **Multi-Release Coordination**: Only after all running application instances have migrated to the new schema and no active container version queries the obsolete columns or tables, deploy a subsequent release that safely removes the deprecated structures.
   - **Explicit Statement-Scoped Bypass Annotation**: Breaking DDL operations (`DROP TABLE`, `DROP COLUMN`, `RENAME COLUMN`, `RENAME TO`, `DROP CONSTRAINT`, `DROP TYPE`, `TRUNCATE`, `SET NOT NULL`, `SET DATA TYPE`, and `ADD COLUMN ... NOT NULL` without `DEFAULT`) in this phase require an explicit statement-scoped `-- allow-destructive: <reason>` annotation with a non-empty `<reason>` above or on each breaking statement to pass the migration compatibility linter.

### N-1 Application Container Compatibility Requirements
Continuous deployment and automated rollback architectures depend on **N-1 compatibility**:
- **Backward Compatibility Guarantee**: Application containers from the previous release (`N-1`) must operate reliably against database schemas from the subsequent release (`N`).
- **Additive Schema Guardrail**: Because previous application containers cannot anticipate new mandatory table columns, any `NOT NULL` column added without a `DEFAULT` constraint causes existing `INSERT` queries from `N-1` containers to fail with `NOT NULL constraint violation`.
- **Preflight Enforcer**: Both `.github/workflows/db-migrate.yml` and `.github/workflows/deploy.yml` enforce backwards compatibility rules as a mandatory safety gate before executing schema mutations or routing production traffic.

### Automated Rollback Safety Protocols & Guarantees
When a post-deployment health check (`/api/health`) fails in `.github/workflows/deploy.yml`, automated rollback procedures activate immediately:
- **Fast Container Restoration**: The rollback workflow (`.github/workflows/rollback.yml`) restores the previous validated container image (`previous_tag`) in under 60 seconds without taking the database offline.
- **Zero Schema Reversal Needed**: Because the applied database migrations comply with Expand-Migrate-Contract rules and N-1 backwards compatibility, the database schema remains fully compatible with the restored container image. No destructive database rollback or down-migration is executed.
- **Pre-Rollback Database Safety Gate**: Prior to container redeployment, `.github/workflows/rollback.yml` executes `npm run lint:migrations` to verify that all applied migrations comply with N-1 safety standards.
- **Diagnostic Visibility**: The rollback workflow outputs comprehensive diagnostics to `$GITHUB_STEP_SUMMARY`, detailing the target environment, restored tag, failure cause, database compatibility status, and follow-up remediation instructions.

### Portable Provider Examples
The application works with any standard PostgreSQL server. Examples of compatible managed providers and hosting options include (labeled as examples):
- **Local PostgreSQL**: Docker container (`postgres:15-alpine`), native installation.
- **Neon**: Serverless PostgreSQL with pooling and direct connection strings.
- **Supabase**: Managed PostgreSQL with direct port 5432 and pooled port 6543 endpoints.
- **Railway**: Containerized PostgreSQL service.
- **Amazon RDS / Aurora PostgreSQL**: Enterprise managed database.
- **Google Cloud SQL for PostgreSQL**: Managed Cloud Run compatible database.
- **Azure Database for PostgreSQL**: Flexible server deployment.

---

## ⚠️ Safe Failure Semantics & Emergency Resolution Runbook

If a deployment or database migration fails during release execution, follow this operational runbook:

1. **Pipeline Halts & Rollback Triggering**:
   - If migration preflight checks fail, `Release Pipeline` aborts before container deployment begins. The live production container instances remain untouched on the existing healthy database.
   - If post-deployment container verification fails, `verify-deployment` automatically triggers `rollback.yml`, restoring `previous_tag` while keeping the compatible database schema intact.

2. **Diagnostic Triage**:
   - Review workflow logs and `$GITHUB_STEP_SUMMARY` in GitHub Actions.
   - For migration linter failures, identify whether a migration SQL statement introduced a destructive operation (`DROP TABLE`, `DROP COLUMN`) or an additive breaking change (`ADD COLUMN ... NOT NULL` without `DEFAULT`).
   - For runtime probe failures, check `/api/health` status, database connection pool limits, and container error logs.

3. **Remediation & Resolution Commands**:
   - If a migration failed mid-execution and was marked failed in `_prisma_migrations`, inspect the database state and resolve using Prisma CLI:
     ```bash
     # Mark a failed migration as rolled back in the database metadata table:
     npx prisma migrate resolve --rolled-back "<migration_name>"

     # OR mark a migration as applied if changes were manually verified:
     npx prisma migrate resolve --applied "<migration_name>"
     ```
   - If a forward schema fix is required, author a compensating migration rather than rolling back:
     ```bash
     # Generate a compensating migration diff under Prisma 7 (reads DATABASE_URL via prisma.config.ts):
     npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > fix.sql
     ```
4. **Re-triggering Release**:
   - After addressing the root cause and verifying local checks with `npm run lint:migrations` and `npm run test`, trigger the release pipeline again.

---

## Health Checks & Liveness Probes

Containers and orchestrators query `/api/health` (returning HTTP 200 OK and database connectivity status) for liveness and readiness monitoring.

---

## 🔑 Setup and Secrets

Configure the following workflow-consumed secrets in GitHub Settings (**Settings > Environments** for `staging`, `production`, and `production-rollback`, or **Settings > Secrets and variables > Actions** for repository-wide registry credentials):

| Secret | Description | Required By |
|---|---|---|
| `DATABASE_URL` | Direct (non-pooled) production/staging PostgreSQL connection string | `db-migrate.yml` |
| `GCP_SA_KEY` | Google Cloud Service Account JSON Key (legacy static fallback when Workload Identity Federation variables are not set for `provider: google-cloud-run`) | `deploy-provider.yml`, `rollback.yml` |
| `GCP_PROJECT_ID` | Google Cloud Project ID (optional override when `provider: google-cloud-run`) | `deploy-provider.yml`, `rollback.yml` |
| `DEPLOY_WEBHOOK_URL` | Deployment Webhook URL (required when `provider: generic-webhook` or `docker-host`) | `deploy-provider.yml`, `rollback.yml` |
| `DEPLOY_WEBHOOK_SECRET` | HMAC-SHA256 signing secret required to authenticate `generic-webhook` and `docker-host` payloads | `deploy-provider.yml`, `rollback.yml` |
| `DOCKERHUB_USERNAME` | Docker Hub username (optional secondary registry) | `publish-artifact.yml` |
| `DOCKERHUB_TOKEN` | Docker Hub access token (optional secondary registry) | `publish-artifact.yml` |

Configure the following GitHub Environment and repository **Variables** (**Settings > Environments** for environment-scoped target URLs, Cloud Run topology, and Workload Identity Federation providers, and **Settings > Secrets and variables > Actions > Variables** for optional rollback environment bindings):

| Variable | Description | Consumed By |
|---|---|---|
| `SERVICE_URL` | Public base URL of the target web service for `/api/health` probes (`vars.SERVICE_URL` primary; `secrets.SERVICE_URL` supported as a legacy fallback without cross-job `$GITHUB_OUTPUT` export) | `deploy.yml`, `deploy-provider.yml`, `rollback.yml` |
| `CLOUD_RUN_SERVICE` | Target Google Cloud Run service name (defaults to `wedding-website-staging` for `staging` and `wedding-website` for `production`) | `deploy-provider.yml` |
| `CLOUD_RUN_REGION` | Target Google Cloud Run region (defaults to `us-central1`) | `deploy-provider.yml` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Google Cloud Workload Identity Provider resource name for keyless OIDC authentication (`id-token: write`) | `deploy-provider.yml` |
| `GCP_SERVICE_ACCOUNT` | Google Cloud Service Account email impersonated via Workload Identity Federation | `deploy-provider.yml` |
| `PRODUCTION_ROLLBACK_ENVIRONMENT` | Optional unguarded GitHub Environment name (e.g., `production-rollback`) for automated production rollback credential resolution | `deploy.yml` |
| `STAGING_ROLLBACK_ENVIRONMENT` | Optional unguarded GitHub Environment name for automated staging rollback credential resolution | `deploy.yml` |

Application runtime secrets (`ADMIN_PASSWORD`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, `S3_*`, `STRIPE_*`) are configured directly in the target hosting provider rather than GitHub Actions.
