# Pro-Grade Deployment Pipeline & Deployment Recipes

This repository implements a modular, enterprise-grade continuous integration and delivery architecture built around a **shared runtime contract**. Core CI, immutable release artifact publication, database schema migration, and provider-specific hosting deployment are separated into explicit responsibilities.

For the authoritative specification of container, database, environment variable, reverse proxy, health check, and lifecycle requirements, refer to the [Application Runtime Contract](./docs/runtime-contract.md). All hosting providers and deployment environments must satisfy this baseline contract.

## Deployment State & Optional Vercel Target

- **Current Deployment Architecture**: The primary deployment architecture is provider-neutral, utilizing standard containerized builds (`Dockerfile`) running on Node.js / Docker hosts such as Google Cloud Run or AWS.
- **Disconnected Vercel Connection**: The historical direct Vercel connection is disconnected. Core application code, environment validation, database access, and routing logic do not depend on Vercel-specific runtime environment variables or proprietary APIs.
- **Optional Vercel Support**: Vercel remains fully supported as an optional deployment target. Couples or developers who wish to deploy on Vercel can import the repository directly into Vercel or use `vercel deploy`, ensuring required production environment variables (`DATABASE_URL`, `ADMIN_PASSWORD`, `ALLOWED_HOSTS`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`) are provided in Vercel's project settings.
- **Static Showcase & Documentation Targets**: For database-free static HTML previews, `npm run build:export` (`scripts/build-export.mjs` with `STATIC_EXPORT=true` and `trailingSlash: true`, verified in parallel by `static-export-build` in `ci.yml`) builds a static showcase inside an isolated staged workspace using `STATIC_MOCK_CONFIG`, deterministic archetype datasets from `buildArchetypeSeedData` in [`src/lib/sampleData/builder.ts`](./src/lib/sampleData/builder.ts), and `.next-export` build caching. At runtime in the browser, `RootLayoutClient` ([`src/components/layout/RootLayoutClient.tsx`](./src/components/layout/RootLayoutClient.tsx)) mounts `DemoProvider` ([`src/components/demo/DemoContext.tsx`](./src/components/demo/DemoContext.tsx)) and `DemoToolbar` ([`src/components/demo/DemoToolbar.tsx`](./src/components/demo/DemoToolbar.tsx)), hydrating `wedding_showcase_demo_v1` `localStorage` state via `hydrateDemoStateFromStorage` in [`src/lib/demo/demoStore.ts`](./src/lib/demo/demoStore.ts), intercepting `/api/*` and `/api/admin/*` mutations client-side via `installDemoFetchInterceptor` in [`src/lib/demo/demoApiHandler.ts`](./src/lib/demo/demoApiHandler.ts), simulating non-charging registry card payments via `SimulatedCardCheckout` (`SIMULATED_TEST_CARDS`) in [`src/features/registry/components/SimulatedCardCheckout.tsx`](./src/features/registry/components/SimulatedCardCheckout.tsx), and exposing the interactive `<SetupWizard />` preview on `/admin/setup` via `AdminSetupPage` in [`src/app/admin/setup/page.tsx`](./src/app/admin/setup/page.tsx). Component showcases and architectural documentation portals are built via `npm run build-storybook` (`storybook-build` in `ci.yml` and `storybook.yml`) and `npm run docs:build` (`verify` in `ci.yml` uploading `docs-portal-static`, merged with `/demo/` and `/storybook/` and browser-verified via `npm run pages:verify` in `pages-verify` before `deploy-docs` publishes the unified GitHub Pages bundle with subpath-safe return links resolved via `resolveShowcasePath` in [`src/lib/basePath.ts`](./src/lib/basePath.ts)).

---

## Shared Runtime Contract

All hosting platforms consume the same unified application runtime contract, ensuring total portability and avoiding vendor lock-in:

1. **Node.js & Package Manager Specification**: Node.js v22.x LTS (`>=22.22.1 <23.0.0` across `engines.node` and `devEngines.runtime`) and `npm` `^10.9.0` (enforced via `engines` and `devEngines` in `package.json`), Next.js App Router standalone build (`output: 'standalone'`).
2. **Database Engine & ORM**: PostgreSQL 15+ accessed via Prisma ORM v7.x (`@prisma/client`).
3. **Migration Mechanism**: Schema updates run prior to application start via offline `./node_modules/.bin/prisma migrate deploy` in the Docker Compose `migration` service and `docker-entrypoint.sh` (when `RUN_MIGRATIONS=true` or `RUN_MIGRATIONS=1`), or `npx prisma migrate deploy` in CI/CD (`.github/workflows/db-migrate.yml`) and PaaS release hooks.
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
The canonical portable baseline using the multi-platform `Dockerfile` (`tini` PID 1, `/opt/prisma-cli` outside `/app`, `root:root` static `/app` ownership, setuid/setgid stripping) and hardened `docker-compose.yml` (`read_only: true`, `cap_drop: [ALL]`, `no-new-privileges:true`, `shm_size: "256mb"` on `db`, bounded `json-file` `10m` x `3` log rotation, `pids_limit`, `mem_limit`, `stop_grace_period: 15s`, and `tmpfs` mounts at `/tmp` and `/app/.next/cache`, with automated test overrides isolated in `.env.ci` and `docker-compose.ci.yml`). Consolidates image builds under `app` (`pull_policy: never` on `migration` and `app-standby`), orchestrates `db` bound to `127.0.0.1:${DB_PORT:-5432}:5432` with mandatory operator secrets, runs a dedicated one-shot `migration` service (`./node_modules/.bin/prisma migrate deploy` before `app` starts with `RUN_MIGRATIONS="false"`, plus optional offline `RUN_MIGRATIONS=true` or `RUN_MIGRATIONS=1` in `docker-entrypoint.sh` for standalone containers), pins `NODE_ENV: production` and scopes container `DATABASE_URL` via `${CONTAINER_DATABASE_URL:-...}`, forwards all 21 runtime variables plus all 32 trimmed/blank-safe `SITE_*` overrides, preserves `E2E_TEST=false` default production onboarding, configures built-in Compose liveness healthchecks via `/api/live` (with rollout/readiness verification via `/api/health` and `/api/ready`) and graceful `SIGTERM` `pg.Pool` draining (`5000ms` timer inside the `15s` grace period), and provides zero-downtime standby loopback rollouts (`docker-compose.rollout.yml` + `./scripts/rollout-vps.sh`) behind dual-upstream Nginx/Caddy reverse proxies alongside networked port-mapped rollbacks (`--stop-timeout 15`).

### 2. [Google Cloud Run Deployment](./docs/deployment/gcp-cloud-run.md)
Managed serverless container target deploying attested `ghcr.io` immutable container digests to isolated Cloud Run services (`wedding-website-staging` for staging and `wedding-website` for production by default, or parameterized via `vars.CLOUD_RUN_SERVICE` and `vars.CLOUD_RUN_REGION`) using keyless Workload Identity Federation OIDC (`vars.GCP_WORKLOAD_IDENTITY_PROVIDER` and `vars.GCP_SERVICE_ACCOUNT`, with `secrets.GCP_SA_KEY` fallback), GCP Secret Manager, and Cloud SQL PostgreSQL. Automated via `.github/workflows/deploy.yml` with pre-deployment schema migrations, S3/R2 asset storage, and instant revision traffic splitting for rollbacks.

### 3. [Vercel Deployment](./docs/deployment/vercel.md)
Optional serverless Node.js deployment target using serverless PostgreSQL connection pooling (Neon, Supabase, RDS Proxy). Supports Vercel automatic custom domain TLS, pre-deploy build migrations (`DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy && next build`), and instant deployment rollbacks.

### 4. [Railway & Render PaaS Deployment](./docs/deployment/railway-render.md)
Low-friction PaaS deployment path with managed PostgreSQL add-ons, pre-deploy release commands, persistent volume mounts or S3 asset storage, and automatic domain SSL provisioning.

---

## Runtime Configuration & Production Secrets

Startup validation (`src/env.ts`) requires every production deployment (`NODE_ENV=production`) to configure non-default values for `DATABASE_URL`, `ADMIN_PASSWORD` (64-byte scrypt hash generated via `scripts/generate-password-hash.mjs`), `ALLOWED_HOSTS`, `GUEST_PASSCODE`, and `GUEST_SESSION_SECRET` (32+ characters, distinct from `GUEST_PASSCODE`).

For the canonical **Environment Variable Matrix**—including defaults, `TRUST_PROXY` hop counts (`1` or `2` behind trusted reverse proxies), optional `S3_*` object storage credentials, `STRIPE_*` checkout keys, `CRON_SECRET`, `RUN_MIGRATIONS` (`true` or `1`), `POSTGRES_URL_NON_POOLING` (`prisma.config.ts` shadow database / migration overrides), `SITE_*` overrides, `E2E_TEST` production blocklist warnings (never set `E2E_TEST=true` in production), and `prisma/schema.prisma` persisted entity and `MULTISITE_ENABLED` isolation rules—see the **[Application Runtime Contract](./docs/runtime-contract.md)** and [`.env.example`](./.env.example).

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
│    • Static HTML showcase export (static-export-build)    │
│    • Production build, container smoke & Playwright E2E   │
│    • Unified Pages verification & deploy (pages-verify)   │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│ 2. Artifact Publication (publish-artifact.yml)            │
│    • Multi-arch OCI Docker build (FIFO queue: max)        │
│    • Tagged by immutable commit SHA & version             │
│    • Published to GHCR (default) & Docker Hub (optional) │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│ 3. Automated Staging Stage (deploy-stage.yml: staging)    │
│    • Lock: deploy-env-staging (FIFO queue: max)           │
│    • Staging Database Migration (db-migrate.yml)          │
│    • Staging Provider Deployment (deploy-provider.yml)    │
│    • Staging Verification (/api/health & /api/ready)      │
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
│ 5. Production Delivery Stage (deploy-stage.yml: prod)     │
│    • Lock: deploy-env-production (FIFO queue: max)        │
│    • Post-approval live prisma migrate status & deploy    │
│    • Production Provider Deployment (deploy-provider.yml) │
│    • Production Verification (/api/health & /api/ready)   │
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

The top-level **Release Pipeline (`deploy.yml`)** executes `ci-gate`, `schema-compatibility`, and `publish-artifact` without acquiring environment locks, then delegates `staging` and `production` delivery to the reusable **Deploy Stage (`deploy-stage.yml`)** workflow so automated `staging` deployments never queue behind unapproved `production` reviewer gates. Each environment stage acquires a unified `deploy-env-${{ inputs.environment }}` concurrency group (`cancel-in-progress: false`, `queue: max`) across database migration, provider rollout, `/api/health` and `/api/ready` verification, and automated rollback, queuing up to 100 runs in FIFO order without canceling superseded runs mid-flight.

### 🛡️ GitHub Environment Setup & Reviewer Configuration

To protect production database integrity and application availability, the deployment architecture requires two distinct GitHub repository environments with isolated credentials:

#### 1. Staging Environment (`staging`)
- **Purpose**: Automated pre-production integration testing, database schema migration verification, and container deployment validation on every merge to `main`.
- **Environment Setup**:
  1. Navigate to **Settings** > **Environments** in your GitHub repository.
  2. Click **New environment** and name it `staging`.
  3. **Protection Rules**: Leave "Required reviewers" unconfigured to permit unblocked, automated continuous delivery on every merge.
  4. **Environment Variables** (non-secret targets & Workload Identity Federation identifiers):
     - `SERVICE_URL`: Public base URL of the staging web service for `/api/health` and `/api/ready` probes (e.g., `https://staging.wedding.example.com`). Configure `SERVICE_URL` as a GitHub Environment variable (`vars.SERVICE_URL`) so cross-job `service_url` outputs and `$GITHUB_STEP_SUMMARY` diagnostics remain unmasked (`secrets.SERVICE_URL` is supported as a legacy fallback during migration).
     - `CLOUD_RUN_SERVICE`: Optional Cloud Run service name override for staging (defaults to `wedding-website-staging` so staging promotions never overwrite production `wedding-website`).
     - `CLOUD_RUN_REGION`: Optional Cloud Run region override for staging (defaults to `us-central1`).
     - `GCP_WORKLOAD_IDENTITY_PROVIDER`: Primary keyless OIDC Workload Identity Provider resource name (`projects/<project-number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`).
     - `GCP_SERVICE_ACCOUNT`: Service account email impersonated via Workload Identity Federation (`<sa-name>@<project-id>.iam.gserviceaccount.com`).
  5. **Environment Secrets**:
     - `DATABASE_URL`: Connection string for the isolated staging PostgreSQL instance (e.g., `postgresql://wedding:staging_pass@staging-db.internal:5432/wedding_staging`), plus optional `POSTGRES_URL_NON_POOLING` when `DATABASE_URL` connects through a PgBouncer pooler.
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
     - `SERVICE_URL`: Public base URL of the live production web service for `/api/health` and `/api/ready` probes (e.g., `https://wedding.example.com`). Configure `SERVICE_URL` as a GitHub Environment variable (`vars.SERVICE_URL`) so cross-job `service_url` outputs and `$GITHUB_STEP_SUMMARY` diagnostics remain unmasked (`secrets.SERVICE_URL` is supported as a legacy fallback during migration).
     - `CLOUD_RUN_SERVICE`: Optional Cloud Run service name override for production (defaults to `wedding-website`).
     - `CLOUD_RUN_REGION`: Optional Cloud Run region override for production (defaults to `us-central1`).
     - `GCP_WORKLOAD_IDENTITY_PROVIDER`: Primary keyless OIDC Workload Identity Provider resource name for production deployments.
     - `GCP_SERVICE_ACCOUNT`: Production service account email impersonated via Workload Identity Federation.
  6. **Environment Secrets** (workflow-consumed credentials only):
     - `DATABASE_URL`: Connection string for the isolated production PostgreSQL instance used by `db-migrate.yml` (e.g., `postgresql://wedding:prod_pass@prod-db.internal:5432/wedding_prod`), plus optional `POSTGRES_URL_NON_POOLING` direct connection secret when `DATABASE_URL` uses a PgBouncer pooler.
     - Provider secrets (`GCP_SA_KEY` fallback when OIDC variables are unset, optional `GCP_PROJECT_ID`, or `DEPLOY_WEBHOOK_URL` + `DEPLOY_WEBHOOK_SECRET` for signed webhook/Docker host deployments).
     - *Note*: Application runtime secrets (`ADMIN_PASSWORD`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, `S3_*`, `STRIPE_*`) are not read by GitHub Actions workflows and must be configured in your target hosting platform's secret store (such as GCP Secret Manager, Vercel Environment Variables, or VPS `.env`).

#### 3. Unguarded Production Rollback Environment (`production-rollback`)
- **Purpose**: Enables unattended container restoration when `/api/health` or `/api/ready` fails after a reviewer-approved production rollout, resolving environment-scoped provider credentials without pausing behind `production`'s human reviewer gate.
- **Environment Setup**:
  1. Navigate to **Settings** > **Environments** and click **New environment** named `production-rollback`.
  2. **Protection Rules**: Leave **Required reviewers** **unchecked** so emergency rollbacks execute immediately within the 60-second recovery target. Restrict **Deployment branches** to `main` and release tags (`v*`).
  3. **Environment Variables & Secrets**: Set `SERVICE_URL` (`vars.SERVICE_URL`, with `secrets.SERVICE_URL` supported as a legacy fallback), optional Cloud Run target/OIDC variables (`CLOUD_RUN_SERVICE`, `CLOUD_RUN_REGION`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`), and copy only the container deployment secrets required by `.github/workflows/rollback.yml` and `.github/workflows/deploy-provider.yml` (`GCP_SA_KEY`, `GCP_PROJECT_ID`, `DEPLOY_WEBHOOK_URL`, and `DEPLOY_WEBHOOK_SECRET` — `DATABASE_URL` is not needed because rollbacks preserve forward-only N-1 compatible schemas).
  4. **Pipeline Binding**: Set repository variable `PRODUCTION_ROLLBACK_ENVIRONMENT=production-rollback` under **Settings** > **Secrets and variables** > **Actions** > **Variables** (or pass `rollback_environment: production-rollback` when manually invoking `rollback.yml` via `workflow_dispatch`; `deploy.yml` and `deploy-provider.yml` accept `rollback_environment` strictly on `workflow_call` so manual forward promotions always honor `production` protection rules). When `rollback_environment` is omitted, `rollback.yml` falls back to `target_environment`.

#### 4. Strict Separation of Secrets, Database Credentials & Environment Locks
- Staging and production **MUST NOT** share database credentials or database instances.
- Reusable workflows inherit secrets dynamically (`secrets: inherit` in `.github/workflows/deploy.yml`, `.github/workflows/deploy-stage.yml`, and `.github/workflows/rollback.yml`) and resolve environment-scoped secrets from `environment` / `rollback_environment`.
- Staging migrations execute strictly against the staging database (`deploy-env-staging`); production migrations execute strictly against the production database (`deploy-env-production`) following reviewer sign-off.
- Concurrency groups in `.github/workflows/deploy-stage.yml`, `.github/workflows/db-migrate.yml`, `.github/workflows/deploy-provider.yml`, and `.github/workflows/rollback.yml` are keyed strictly on target `environment` (`deploy-env-staging` or `deploy-env-production`) rather than `rollback_environment`, ensuring manual dispatches and unguarded `production-rollback` runs serialize against active `production` deployments while passing `caller_holds_lock: true` to nested workflows to avoid nested lock contention.

### 🔄 Staging Promotion & Approval Workflow

1. **Automated Staging Delivery on Merge & Tag Promotion SHA Resolution**:
   - When a pull request is merged into `main`, `.github/workflows/ci.yml` (`CI`) executes static checks, unit tests, container smoke tests, and Playwright E2E tests first. Once `CI` completes with `success` on the `main` push, GitHub Actions triggers `.github/workflows/deploy.yml` via `workflow_run` for `github.event.workflow_run.head_sha`. On manual `workflow_dispatch` or reusable `workflow_call` runs, `ci-gate` resolves `target_sha` from `image_digest` OIDC build provenance attestation (`gh attestation verify --format json` signed by `.github/workflows/publish-artifact.yml` and OCI `org.opencontainers.image.revision` metadata), `image_tag` (verifying `origin/main` ancestry), `release_ref` (dereferencing `v*` tags or commit SHAs via the GitHub Commits API), or `commit_sha` before defaulting to `github.sha` (failing closed if multiple promotion inputs resolve to different commits), and verifies a completed successful `CI` run for `target_sha`. Because `deploy.yml` omits root-level `concurrency`, `ci-gate`, `schema-compatibility`, and `publish-artifact` execute immediately on every merge without waiting on pending `production` approvals.
   - `schema-compatibility` aligns its git checkout to `target_sha` (`git checkout --detach`) on `workflow_run`, `image_tag`, `release_ref`, and `image_digest` runs (`npm run lint:migrations` and `node --experimental-strip-types scripts/preflight-migration-summary.ts --offline` on Node.js 22 without `npm ci`), and both the `staging` and `production` stage jobs pass `commit_sha: target_sha` through `.github/workflows/deploy-stage.yml` to `.github/workflows/db-migrate.yml` so `v*` tag or digest promotions execute `npm run lint:migrations` and `npx prisma migrate deploy` at the exact release commit rather than `main` `HEAD`. When `image_digest`, `image_tag`, and `release_ref` are omitted, `.github/workflows/publish-artifact.yml` runs once via `workflow_call` (`concurrency: publish-artifact-release`, `cancel-in-progress: false`, `queue: max`) at `target_sha` to confirm passing `CI`, natively build (`ubuntu-latest` for `linux/amd64` and `ubuntu-24.04-arm` for `linux/arm64` without QEMU emulation, `provenance: false`, `sbom: false`), stamp `org.opencontainers.image.revision` labels and manifest annotations, load `wedding-website:latest` via `skopeo`, Trivy-scan (`CRITICAL`/`HIGH`/`MEDIUM`) and generate SPDX JSON SBOMs (`aquasecurity/trivy-action`), smoke-test (`scripts/test-container.mjs`), and export `zstd`-compressed OCI archives without registry credentials in `build`, then re-verifies archive digests (`skopeo inspect`) and SPDX SBOMs, pushes architecture manifests (`skopeo copy --preserve-digests`), merges the multi-platform OCI index (`docker buildx imagetools create` with `index:org.opencontainers.image.revision`), synthesizes the multi-platform index SPDX SBOM, signs OIDC build provenance (`actions/attest-build-provenance`) and SPDX SBOM (`actions/attest`) attestations across both per-architecture (`amd64`, `arm64`) and merged index digests on `ghcr.io` (and conditional `docker.io/`), and exports `image_digest` (`sha256:<64-hex>`).
   - The `staging` job in `deploy.yml` invokes `.github/workflows/deploy-stage.yml` (`environment: 'staging'`), acquiring `deploy-env-staging` (`cancel-in-progress: false`, `queue: max`). Inside `deploy-stage.yml`, `deploy-provider` (`caller_holds_lock: true`) receives `commit_sha` (`needs.ci-gate.outputs.target_sha`), the attested `image_digest`, and optional `cloud_run_service` / `cloud_run_region` overrides with job-scoped `actions: read` and `deployments: write`, checks out `commit_sha` (`fetch-depth: 2`), verifies OIDC provenance via `gh attestation verify` against the `oci://ghcr.io/<owner>/<repo>@sha256:<hex>` URI and confirms a passing `ci.yml` run for the signed source revision prior to rollout, captures the prior staging release (`previous_image_digest` and `previous_image_tag`: from the active Cloud Run `@sha256:` revision OIDC provenance attestation / `commit-sha` and OCI revision labels, environment-filtered `staging` GitHub Deployments with `success` status, completed non-`dry_run` `staging` `deploy.yml` / `deploy-provider.yml` workflow runs, or GHCR-verified `HEAD^1` / commit parents of `commit_sha` via `docker buildx imagetools inspect`) before deploying the digest-pinned container to `staging`, records environment deployment state in GitHub Deployments, and `verify-deployment` validates `/api/health`.
2. **Pre-Flight Schema Compatibility & Offline Git Diff DDL Summary (Pre-Approval)**:
   - Prior to the `production` gate, `schema-compatibility` in `.github/workflows/deploy.yml` runs `npm run lint:migrations` and invokes `node --experimental-strip-types scripts/preflight-migration-summary.ts --offline` on Node.js 22 **without** `npm ci` or `DATABASE_URL`, diffing `prisma/migrations/` against `HEAD^1` (`NOT QUERIED` database status) and emitting changed SQL DDL summaries to `$GITHUB_STEP_SUMMARY` without claiming live pending migrations.
   - Simultaneously, the `staging` stage (`deploy-stage.yml` running `database-migration` via `db-migrate.yml` against `staging` `DATABASE_URL` and `verify-deployment`) validates live migration execution and `/api/health` in staging without waiting on any `production` lock.
3. **Maintainer Review & Sign-Off (`production` Gate)**:
   - Once `staging` succeeds, the `production` job in `deploy.yml` invokes `.github/workflows/deploy-stage.yml` (`environment: 'production'`), acquiring `deploy-env-production` (`cancel-in-progress: false`, `queue: max`) and calling `.github/workflows/db-migrate.yml` (`caller_holds_lock: true`) with `environment: production` declared on the `migrate` job, so GitHub Actions pauses the job **before** exposing production `DATABASE_URL` or querying the live production database while subsequent `production` promotions queue safely in FIFO order (up to 100 runs).
   - Maintainers inspect the offline `git diff` SQL DDL summary from `schema-compatibility`, the attested `image_digest`, and the live staging migration/health results, then click **Review deployments** > `production` > **Approve and deploy**.
4. **Post-Approval Live Production DDL Check, Deployment & Automated Rollback Guard**:
   - Once approved, `.github/workflows/db-migrate.yml` unlocks `production` secrets, verifies `npm run lint:migrations`, queries live production `DATABASE_URL` via `npx prisma migrate status` (`npx tsx scripts/preflight-migration-summary.ts --require-db`) to audit pending/failed migrations, schema drift, and connectivity (redacting database URLs on failure) and emit the live DDL summary, and runs `npx prisma migrate deploy` with lock and statement timeouts.
   - Inside `deploy-stage.yml`, `deploy-provider` (`caller_holds_lock: true`) passes `commit_sha` (`needs.ci-gate.outputs.target_sha`), job-scoped `actions: read` and `deployments: write`, and the exact `image_digest` attested in `publish-artifact.yml` (or an explicit `image_digest` / `release_ref` / `image_tag` supplied on manual dispatches, with `target_sha` resolved from provenance or tag commit so newer `HEAD` migrations are never applied prematurely), checks out `commit_sha` (`fetch-depth: 2`), re-verifies OIDC build provenance via `gh attestation verify` against `.github/workflows/publish-artifact.yml` and confirms a passing `ci.yml` run for the signed source revision, captures the currently serving `production` container image (`previous_image_digest` and `previous_image_tag`: from Cloud Run `@sha256:` revision attestations/labels, environment-isolated `production` GitHub Deployments with `success` status so concurrent `staging` rollouts never pollute `production` rollback tags, completed non-`dry_run` `production` workflow runs, or GHCR-published releases verified via `docker buildx imagetools inspect` and `HEAD^1` / commit parents relative to `commit_sha` while skipping `staging`, `dry_run`, and unpublished `HEAD^1` commits) before rollout, deploys the immutable `@sha256:` URI via `.github/workflows/deploy-provider.yml`, and records the deployment in GitHub Deployments.
   - Post-deployment health and readiness probes (`Verify Provider Service Health` in `deploy-provider.yml`, `timeout-minutes: 4` inside a `timeout-minutes: 20` provider job budget alongside bounded rollout step timeouts of `timeout-minutes: 5` for Cloud Run and `timeout-minutes: 2` for webhook adapters, with stage summary consumption in `verify-deployment` of `deploy-stage.yml`, `timeout-minutes: 5`) verify `/api/health` and `/api/ready` with bounded socket timeouts (`curl --connect-timeout 5 --max-time 10`) and exponential backoff while still holding `deploy-env-<environment>`. GitHub Deployments are created in `in_progress` state (`auto_inactive: false`) before probing `/api/health` and `/api/ready` and transition to `success` (`auto_inactive: true`) only after `/api/health` returns `HTTP 200` with `.data.status == "ok"` and `.data.database == "connected"` and `/api/ready` returns `HTTP 200` with `status == "ready"` and `database == "connected"` (or `failure` via `if: always()` when `/api/health` or `/api/ready` fails or cancels).
   - **Rollback Guarantee**: When `PRODUCTION_ROLLBACK_ENVIRONMENT` / `STAGING_ROLLBACK_ENVIRONMENT` is unset (`rollback_environment == ''`), `.github/workflows/deploy-provider.yml` (`auto_rollback_on_failure: true`, reserving headroom inside its 20-minute job budget after bounded forward rollout and probe step timeouts) marks the failed deployment `failure` and executes automatic in-job fallback recovery inside the already-approved provider job (`npm run lint:migrations` via `actions/setup-node` `.nvmrc`, prior `success` GitHub Deployment verification, `gh attestation verify` OIDC provenance check resolving attested OCI `org.opencontainers.image.revision` and SLSA `inputs.commit_sha` ahead of OIDC `GITHUB_SHA` digests via `scripts/resolve-oci-provenance.sh` and failing closed on conflicts, digest-pinned container restoration stamped with the attested `source_revision`, `/api/health` and `/api/ready` verification, restored GitHub Deployment recording, `inline_rollback_completed=true`, and `exit 1`), skipping `rollback.yml` so recovery finishes without a second human reviewer prompt. When an unguarded `rollback_environment` (e.g., `production-rollback`) is configured, when a stage run is cancelled after `rollout_executed == 'true'` (`inline_rollback_completed != 'true'`), or on standalone `rollback.yml` dispatches, `.github/workflows/deploy-stage.yml` invokes `.github/workflows/rollback.yml` (`caller_holds_lock: true`) with `commit_sha` (`needs.ci-gate.outputs.target_sha` scoped to `preflight`), `previous_image_digest`, `previous_image_tag`, `provider`, `cloud_run_service`, `cloud_run_region`, and `rollback_environment`. `rollback.yml` evaluates `if: always()` with upstream job and step outcome guards across `preflight`, `redeploy`, `verify`, and `report` so cancelled runs never skip recovery, validates 40-character hexadecimal `commit_sha` (defaulting to `github.sha` on manual dispatch), accepts digest-pinned rollbacks (`previous_digest` with empty `previous_tag`), rejects `latest`, verifies in `preflight` (checking attested OCI `org.opencontainers.image.revision` and SLSA `inputs.commit_sha` ahead of OIDC `GITHUB_SHA` digests only after `gh attestation verify` succeeds) that `previous_digest` / `previous_tag` does not match `CURRENT_SHA` (`commit_sha || github.sha`) and succeeded earlier in `target_environment` GitHub Deployments before `redeploy` starts, checks out `commit_sha` (`persist-credentials: false`) to verify `npm run lint:migrations` without `main` drift, delegates redeployment (`caller_holds_lock: true`, `is_rollback: true`, omitting the failing `commit_sha` so `deploy-provider.yml` stamps the restored artifact's attested `source_revision` onto Cloud Run and GitHub Deployments) to `.github/workflows/deploy-provider.yml` **without requiring a second human approval step**, and consumes `health_status` and `http_status` from `deploy-provider.yml` (with fallback `${SERVICE_URL}/api/health` polling for `HTTP 200`, `.data.status == "ok"`, `.data.database == "connected"` and `${SERVICE_URL}/api/ready` polling for `HTTP 200`, `status == "ready"`, `database == "connected"`) without gating `verify` on `production` or leaking environment `secrets.SERVICE_URL` before releasing `deploy-env-<environment>` and reporting `SUCCESS`.

---

## 📄 Workflows Overview

### 1. Continuous Integration (`ci.yml`) & Storybook Showcase (`storybook.yml`)
- **Triggers & Concurrency**:
  - `ci.yml`: Pull requests, `merge_group` merge queue checks, and pushes to `main` (omitting `v*` version tag pushes because tagged commits must already be verified ancestors of `origin/main` with a passing `ci.yml` run enforced by `publish-artifact.yml`), configured with `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: ${{ github.event_name == 'pull_request' || github.event_name == 'merge_group' }}, queue: max }` so open pull requests and superseded `merge_group` runs on the same queue ref cancel in-progress runs immediately while `main` pushes queue up to 100 pending runs in FIFO order without evicting commits.
  - `storybook.yml` (`Storybook Static Showcase`): Manual `workflow_dispatch` (on-demand artifact build serialized via `concurrency: { group: storybook, cancel-in-progress: false, queue: max }` with `timeout-minutes: 15` on `build`; pushes to `main` compile Storybook once in `ci.yml`).
- **Execution Bounds & AST Policy**: Every `runs-on` runner job across `.github/workflows/` declares an explicit integer `timeout-minutes` (`1`–`60`) enforced statically by `npm run check:action-pins` (while exempting reusable `uses:` caller jobs without `runs-on`) and pairs external API, registry, attestation, browser install, and GitHub Pages steps with step-level `timeout-minutes` strictly below the enclosing job budget so hung steps never hold `queue: max` FIFO locks for 6 hours (`ci.yml` budgets: `verify: 15`, `doc-drift-comment: 5`, `unit-test: 20`, `build: 30`, `container-arm64: 30`, `storybook-build: 15`, `static-export-build: 25`, `e2e-test: 25`, `a11y-report: 5`, `a11y-report-comment: 5`, `pages-verify: 15`, `ci-complete: 5`, `deploy-docs: 20`).
- **Secrets required**: *None* (runs entirely on isolated local containers and GitHub OIDC Pages tokens).
- **Jobs & Actions**:
  - `verify` (`ci.yml`): Read-only (`contents: read`, `persist-credentials: false` across all workflow checkouts) unified static guardrail bundle (`npm run check:static -- --skip-doc-sync --skip-action-pins`, running `check:env-docs`, `check:runbooks`, `check:setup-guides`, `check:identifiers`, `check:links`, `check:spec-contracts`, `check:prisma`, `lint:migrations`, and `check:standalone`), root and isolated Prisma CLI `moderate`-severity dependency audit (`npm run check:audit`), single-pass YAML 1.2 AST policy, SHA & `# v...` version comment pinning, and upstream commit verification (`npm run check:action-pins -- --verify-upstream`), verified `services.db` digest export (`outputs.db_image`), `actions/cache` persistence of content-hashed `.eslintcache` (`--cache-strategy content`) and all five incremental `*.tsbuildinfo` files (touching exact hits to current time and backdating partial `restore-keys` hits to `2000-01-01T00:00:00Z`), TypeScript type checking (`npm run typecheck`, reusing `next typegen` output from `postinstall`), ESLint (`npm run lint`), Knip (`npm run lint:unused`), OpenAPI/architecture sync (uploading `doc-drift-status` artifact), and VitePress portal compilation (`SKIP_DOC_SYNC=true npm run docs:build`, uploading `docs-portal/.vitepress/dist/` as `docs-portal-static`).
  - `doc-drift-comment` (`ci.yml`): Isolated downstream PR comment job (`needs: verify`, `pull-requests: write`, `issues: write`, zero `actions/checkout` and zero `npm ci`) that downloads `doc-drift-status` on pull requests and creates or updates the `<!-- doc-drift-comment -->` PR comment without exposing write-scoped tokens to `package.json` scripts.
  - `unit-test` (`ci.yml`): Installs dependencies with `SKIP_NEXT_TYPEGEN=true npm ci`, restores and persists `node_modules/.cache/jest` (`cacheDirectory` in `jest.config.mjs`) via `actions/cache`, and runs Prisma migration parity verification (`Verify Prisma Migration Sync`) and Jest unit and integration tests (`npm run test:cov`) against the verified `postgres:15-alpine` digest exported by `verify`, uploading coverage and `jest-a11y-violations` artifacts.
  - `build` (`ci.yml`): Installs dependencies with `SKIP_NEXT_TYPEGEN=true npm ci`, hydrates and persists non-empty `amd64` BuildKit cache mounts (`/var/cache/apt`, `/var/lib/apt`, `/root/.npm`, `/app/.next/cache` validated via `validate_cache_archive`, extracted with `--no-same-owner --no-same-permissions`, and exported via `scripts/persist-buildkit-mounts.sh`) via `actions/cache`, guards `crazy-max/ghaction-github-runtime` with `if: github.event_name != 'pull_request'`, builds Next.js once inside `wedding-website:latest` (`linux/amd64`) using `app-amd64` BuildKit layer cache (exporting `mode=max` cache layers only on non-`pull_request` runs), scans `wedding-website:latest` with `aquasecurity/trivy-action` (`CRITICAL`, `HIGH`, and `MEDIUM` severities matching `publish-artifact.yml`, `ignore-unfixed: true`, `exit-code: 1`, zero secrets), extracts standalone output from `wedding-website:latest` into `.next/standalone` for post-build standalone portability and execution checks (`npm run check:standalone -- --standalone-only`, `npm run test:standalone`), runs OCI container & clean database smoke tests (`npm run test:container -- --container-migration` with `SKIP_IMAGE_BUILD=true` and `GHA_CACHE_SCOPE=app-amd64`), and uploads `next-build-artifact` (`.next/`, `public/`, `prisma/`, `node_modules/.prisma`, and `node_modules/@prisma`).
  - `container-arm64` (`ci.yml`): Parallel native `linux/arm64` OCI container build (hydrating and persisting non-empty `arm64` BuildKit cache mounts via `actions/cache` with `validate_cache_archive`, `--no-same-owner --no-same-permissions`, and `scripts/persist-buildkit-mounts.sh`, guarding `crazy-max/ghaction-github-runtime` with `if: github.event_name != 'pull_request'`, reading `app-arm64` BuildKit layer cache, and skipping `mode=max` writes on `pull_request` events), `aquasecurity/trivy-action` `CRITICAL`/`HIGH`/`MEDIUM` container vulnerability scan (`ignore-unfixed: true`, `exit-code: 1`, zero secrets), clean-database Prisma migration check, and HTTP probe smoke test (`scripts/test-container.mjs` with `SKIP_IMAGE_BUILD=true`) on `ubuntu-24.04-arm` (GitHub-hosted `ubuntu-24.04-arm` runners run free on public repositories, whereas private forks may require paid runner quotas).
  - `storybook-build` (`ci.yml`) & `build` (`storybook.yml`): Installs dependencies via `npm ci --ignore-scripts`, compiles the static Storybook component showcase (`npm run build-storybook`) with matching `actions/cache` steps for `node_modules/.cache/webpack` and `node_modules/.cache/storybook`, and uploads the `storybook-static` artifact (`retention-days: 7`) in both `ci.yml` (on pull requests, `merge_group` runs, and `main` pushes) and `storybook.yml` (on manual `workflow_dispatch`).
  - `static-export-build` (`ci.yml`): Runs in parallel after `verify` (`contents: read`) without PostgreSQL services or secrets, installs dependencies with `SKIP_NEXT_TYPEGEN=true npm ci`, resolves the GitHub Pages base path automatically for repository subpaths (`/<repo>/demo`) or custom domains (`/demo`), stages sources without `src/app/api`, caches `.next-export/cache`, compiles the database-free static HTML showcase via `npm run build:export` (`scripts/build-export.mjs` with `NEXT_PUBLIC_BASE_PATH` and `trailingSlash: true`, skipping root `next typegen` during `STATIC_EXPORT=true`) with zero `[PageQueryError]` logs, verifies `out/index.html` and route HTML files, executes the standalone Playwright static showcase runtime & light/dark WCAG 2.2 AA audit (`npm run test:e2e:static` via `playwright.static.config.ts` with `outputDir: 'test-results/playwright-static'` and `trace: 'retain-on-failure'` plus `scripts/serve-static-export.mjs`), uploads `static-a11y-violations` (`test-results/static-a11y-violations.json`) with `if: always()`, uploads `playwright-static-traces` (`test-results/playwright-static/`, `retention-days: 7`) on `if: failure()`, and uploads the `demo-static` artifact (`retention-days: 7`).
  - `e2e-test` (`ci.yml`): Depends on `verify` and `build` (`contents: read`), installs dependencies via `npm ci --ignore-scripts`, restores `.next/`, `public/`, `prisma/`, `node_modules/.prisma`, and `node_modules/@prisma` from `next-build-artifact`, runs the standalone Playwright E2E and WCAG accessibility suite (`npx playwright test`, ignoring `e2e/pages-showcase.spec.ts` unless invoked explicitly via `npm run pages:verify` and retaining failure traces under `test-results/playwright/` via `trace: 'retain-on-failure'`) against the verified `postgres:15-alpine` digest, uploads `playwright-a11y-violations` (`test-results/playwright-a11y-violations.json`) with `if: always()`, and uploads `playwright-traces` (`test-results/playwright/`, `retention-days: 7`) on `if: failure()`.
  - `a11y-report` (`ci.yml`): Read-only (`contents: read`) job that runs after `unit-test`, `e2e-test`, and `static-export-build` with `if: always() && !cancelled()`, downloads `jest-a11y-violations`, `playwright-a11y-violations`, and `static-a11y-violations` artifacts, generates sanitized `test-results/a11y-summary.md` via `node scripts/a11y-report.mjs --include-static --require-complete` (escaping HTML, Markdown links, backticks, and newlines in violation fields and exiting `1` after writing `test-results/a11y-summary.md` whenever violations exist, expected suite artifacts are missing, or JSON parsing fails), uploads `a11y-summary` on pull requests, writes `$GITHUB_STEP_SUMMARY` on `if: always() && !cancelled()`, and fails whenever any upstream job (`unit-test`, `e2e-test`, or `static-export-build`) does not succeed.
  - `a11y-report-comment` (`ci.yml`): Isolated downstream PR comment job (`needs: [a11y-report]`, `pull-requests: write`, `issues: write`, zero `actions/checkout` and zero `npm ci`) that downloads `a11y-summary` on same-repository pull requests, validates lines against a strict allowlist, and creates or updates the `<!-- a11y-report -->` PR comment without exposing write-scoped tokens to branch code.
  - `pages-verify` (`ci.yml`): Depends on `verify`, `static-export-build`, and `storybook-build` (`contents: read`), installs dependencies via `npm ci --ignore-scripts`, merges `docs-portal-static` (`docs-portal/.vitepress/dist`), `demo-static` (`docs-portal/.vitepress/dist/demo`), and `storybook-static` (`docs-portal/.vitepress/dist/storybook`) with `.nojekyll`, executes all 4 unified bundle Playwright smoke and cross-app navigation tests in `e2e/pages-showcase.spec.ts` via `npm run pages:verify` with zero skips, and uploads the verified `pages-bundle` artifact (`include-hidden-files: true`, `retention-days: 7`).
  - `ci-complete` (`ci.yml`): Terminal read-only (`contents: read`, `timeout-minutes: 5`, zero `actions/checkout` and zero `npm ci`) branch-protection, merge queue, and release gate (`if: always() && !cancelled()`) that skips cleanly when a workflow run is cancelled and otherwise depends on and verifies `result == 'success'` across all 9 verification jobs (`verify`, `unit-test`, `build`, `container-arm64`, `storybook-build`, `static-export-build`, `e2e-test`, `a11y-report`, and `pages-verify`).
  - `deploy-docs` (`ci.yml`): Depends on `ci-complete`, `static-export-build`, `storybook-build`, and `pages-verify` strictly on pushes to `main` (`concurrency: { group: github-pages, cancel-in-progress: false, queue: max }`), gating GitHub Pages releases on all 9 verification jobs via `ci-complete` while preserving `needs.static-export-build.outputs.demo_base_path`; fetches `origin/main` to verify `github.sha` matches `origin/main` `HEAD` and skips stale burst commits or reruns cleanly, then configures GitHub Pages (`actions/configure-pages`), deploys the pre-verified `pages-bundle` artifact directly without `actions/setup-node` or `npm ci` when the Pages base path matches `/wedding_website/`, or falls back to rebuilding `docs-portal/.vitepress/dist` with `SKIP_DOC_SYNC=true npm run docs:build` (aligning `NEXT_PUBLIC_BASE_PATH` if the Pages base path differs) on custom domains or fork subpaths, verifies `index.html`, `demo/index.html`, `storybook/index.html`, and `.nojekyll` exist, and publishes the unified static showcase bundle to the `github-pages` environment via `actions/deploy-pages`.

### 2. Artifact Publication (`publish-artifact.yml`)
- **Triggers & Concurrency**: Reusable `workflow_call` from `deploy.yml` (after `CI` succeeds on `main`), pushes to `v*` tags, and manual `workflow_dispatch`, serialized inside a single shared `publish-artifact-release` concurrency group (`cancel-in-progress: false`, `queue: max`) so parallel `v*` tag and `main` runs queue in FIFO order (up to 100 runs) and never race on `:latest` or BuildKit caches. Pushing a `v*` tag triggers `publish-artifact.yml` directly (without re-running `ci.yml`): `publish-artifact.yml` verifies `origin/main` ancestry, polls any active `ci.yml` runs, requires a passing `CI` result for the target commit, promotes the already-published `ghcr.io/<owner>/<repo>:<sha>` multi-platform artifact directly via `scripts/ghcr-release-promotion.sh` when both `linux/amd64` and `linux/arm64` manifests plus OIDC SLSA provenance and SPDX SBOM attestations verify cleanly (falling back automatically to native matrix builds if `:<sha>` is absent or incomplete), publishes both `ghcr.io/<owner>/<repo>:<GITHUB_REF_NAME>` (such as `:v0.1.0`) and `ghcr.io/<owner>/<repo>:<sha>`, and updates `:latest` identically across GHCR and optional Docker Hub **only** when a pushed stable SemVer tag (`vMAJOR.MINOR.PATCH`) equals or exceeds every stable repository version tag (ignoring pre-release tags such as `v2.2.0-rc.1`, while manual `workflow_dispatch` / `commit_sha` / custom `tag_name` runs, default-branch non-tag builds, and `N-1` maintenance patch tags such as `v1.4.3` below `v2.0.0` never overwrite `:latest`) without automatically invoking `deploy.yml`; operators can promote a tagged release via `deploy.yml` (`workflow_dispatch` with `image_tag: v0.1.0`, `release_ref: v0.1.0`, or `image_digest`, resolving `target_sha` to the tag's source commit before executing `schema-compatibility` and `db-migrate.yml`) or `deploy-provider.yml` (`image_tag: v0.1.0` after `db-migrate.yml`).
- **Runner Quotas & Timeouts**: When `build` is not skipped via attested GHCR promotion, native `linux/amd64` and `linux/arm64` matrix builds run on GitHub-hosted `ubuntu-latest` and `ubuntu-24.04-arm` runners, which run free on public repositories (private forks may require paid runner quotas or runner overrides). Jobs enforce explicit `timeout-minutes` budgets (`preflight: 45` covering the 2400-second / `42m`-bounded `verify-ci` polling loop and `5m` GHCR attestation inspection, `build: 35` with `20m` BuildKit and `5m` cache-persist/Trivy/SBOM/SARIF step bounds, and `publish: 20` with `2m` registry login, `5m` SBOM verification/archive push/index merge, and `3m` per-step OIDC provenance and SPDX SBOM attestation bounds) so `publish-artifact-release` FIFO locks cannot stall for 6 hours.
- **Permissions**: Top-level `contents: read`; `preflight` scopes `contents: read`, `actions: read`, `packages: read`, and `attestations: read` (for `origin/main` ancestry, `ci.yml` status verification, and read-only GHCR manifest + OIDC attestation inspection), `build` retains strictly `contents: read` and `security-events: write` (for uploading Trivy SARIF scan results to GitHub Code Scanning, with zero registry write permissions or registry credentials), and the isolated `publish` job scopes `contents: read`, `packages: write` (for GitHub Container Registry), `id-token: write`, and `attestations: write` (for OIDC cryptographic build provenance attestations, dropping unused `security-events: write`; caller `deploy.yml` retains the union of callee-required scopes).
- **Actions**:
  - Runs a `preflight` gate before building that fetches `origin/main`, verifies the 40-character target commit (`inputs.commit_sha` or `github.sha`) is an ancestor of `origin/main` (`git merge-base --is-ancestor`), polls any in-progress `ci.yml` workflow runs for that revision, blocks image builds, registry uploads, and provenance signing unless a completed successful `ci.yml` run exists, and—on `push` (`v*` tags) and `workflow_dispatch` runs—inspects `ghcr.io/<owner>/<repo>:<resolved_sha>` (`scripts/ghcr-release-promotion.sh inspect-preflight`) to verify both `linux/amd64` and `linux/arm64` manifests, `org.opencontainers.image.revision`, and OIDC SLSA provenance + SPDX SBOM attestations signed by `.github/workflows/publish-artifact.yml` (`outputs.promote_existing`).
  - When `promote_existing != 'true'` (on `deploy.yml` `workflow_call` runs after `main` merges or whenever no complete attested `:<sha>` artifact exists yet), builds native `linux/amd64` (`ubuntu-latest`) and `linux/arm64` (`ubuntu-24.04-arm`) container images once per architecture as local OCI archives (`outputs: type=oci,dest=/tmp/oci-<arch>.tar`, `provenance: false`, `sbom: false`, stamped with `org.opencontainers.image.revision` labels and `manifest:org.opencontainers.image.revision` annotations) in parallel (`build` matrix job, `needs: [preflight]`) without QEMU emulation, hydrating and persisting non-empty per-architecture BuildKit cache mounts (`/var/cache/apt`, `/var/lib/apt`, `/root/.npm`, `/app/.next/cache`) via hash-locked `release-buildkit-deps-*` and `release-buildkit-next-*` `actions/cache` keys (omitting prefix `restore-keys`, extracting validated archives with `--no-same-owner --no-same-permissions`, and exporting via `scripts/persist-buildkit-mounts.sh`) while isolating release BuildKit GitHub Actions cache scopes (`release-app-amd64` and `release-app-arm64`, including `GHA_CACHE_SCOPE` for `docker-compose.ci.yml` smoke tests) from `ci.yml` (`app-amd64` and `app-arm64`).
  - Loads `wedding-website:latest` directly from each exported OCI archive into the local Docker daemon via `skopeo copy`, executes Trivy vulnerability scanning (`aquasecurity/trivy-action`) on **both** `linux/amd64` and `linux/arm64` native images—failing the workflow before archive handoff whenever either architecture contains fixable `CRITICAL`, `HIGH`, or `MEDIUM` severity vulnerabilities (`ignore-unfixed: true`) or embedded secrets—and generates per-architecture SPDX JSON SBOMs (`sbom-amd64.spdx.json` and `sbom-arm64.spdx.json`).
  - Uploads per-architecture SARIF vulnerability reports (`trivy-results-amd64.sarif` and `trivy-results-arm64.sarif`, categories `trivy-amd64` and `trivy-arm64`) to GitHub Code Scanning via `github/codeql-action/upload-sarif`.
  - Runs native container & clean-database migration smoke tests (`scripts/test-container.mjs` with `SKIP_IMAGE_BUILD=true`) against that exact loaded image on both `ubuntu-latest` and `ubuntu-24.04-arm` hosts, then compresses each verified OCI archive with `zstd` and uploads the archive, its inspected `sha256` manifest digest, and its validated SPDX SBOM as workflow artifacts (`oci-archive-amd64` and `oci-archive-arm64`).
  - Checks out full repository tag history (`fetch-depth: 0`, `persist-credentials: false`) in the isolated `publish` job to evaluate SemVer 2.0.0 `:latest` eligibility: when `promote_existing == 'true'`, skips `build` and `actions/download-artifact`, re-verifies OIDC SLSA provenance and extracts validated per-architecture SPDX SBOM predicates from `ghcr.io` attestations (`scripts/ghcr-release-promotion.sh`), re-verifies the promoted index's `amd64`/`arm64` digests and `org.opencontainers.image.revision` via `docker buildx imagetools inspect`, and mirrors verified digests to optional `docker.io` via `skopeo copy --preserve-digests`; otherwise verifies downloaded SPDX SBOM artifacts, decompresses the archives, re-verifies both `linux/amd64` and `linux/arm64` archive manifest digests via `skopeo inspect` before any external registry upload, and pushes each verified archive via `skopeo copy --preserve-digests` to `ghcr.io` (and optional `docker.io`). In both paths, `publish` merges the verified digests into multi-platform OCI indexes via `docker buildx imagetools create` (stamping `index:org.opencontainers.image.revision`, verifying both `linux/amd64` and `linux/arm64` manifests plus `org.opencontainers.image.revision` via `docker buildx imagetools inspect`, and tagging `GITHUB_REF_NAME`, the commit SHA, and SemVer-gated `:latest` identically across GHCR and optional Docker Hub), and synthesizes a combined multi-platform index SPDX 2.3 SBOM (`sbom-index.spdx.json`).
  - Generates signed OIDC SLSA build provenance (`actions/attest-build-provenance` `# v4.2.2`) and SPDX SBOM (`actions/attest` `# v4.2.2`) attestations across **both** per-architecture (`amd64`, `arm64`) and merged multi-platform index digests on `ghcr.io` (compatible with `gh attestation verify` in `deploy-provider.yml`, `deploy.yml`, and `rollback.yml`) and conditionally signs per-architecture and index provenance + SPDX SBOM attestations on `docker.io/` (`create-storage-record: false`) when Docker Hub credentials are configured.
- **Outputs**:
  - `image_uri`: Primary OCI URI (`ghcr.io/<owner>/<repo>:<sha>` on `main` / `workflow_call`, or `ghcr.io/<owner>/<repo>:v*` on `v*` tag pushes alongside `:<sha>`).
  - `image_tag`: Resolved version tag (`GITHUB_REF_NAME` on `v*` tag pushes) or immutable commit SHA.
  - `image_digest`: Attested OCI image digest (`sha256:<64-hex>`) propagated to staging and production deployment jobs.

### 3. Database Migration (`db-migrate.yml`)
- **Triggers**: Reusable `workflow_call` from `deploy-stage.yml` (`confirm` defaults to `true`, `caller_holds_lock: true`), or standalone manual `workflow_dispatch` with target environment (`production`, `staging`, `development`) and explicit confirmation (`confirm` defaults to `false`).
- **Concurrency**: Acquires `deploy-env-${{ inputs.environment || 'production' }}` (`cancel-in-progress: false`, `queue: max`) on standalone runs (`caller_holds_lock: false`), or scopes to `caller-db-migrate-<environment>-${{ github.run_id }}-${{ github.run_attempt }}` when `caller_holds_lock: true` so nested stage runs avoid nested lock contention against `deploy-stage.yml`.
- **Secrets required**: `DATABASE_URL` (plus optional `POSTGRES_URL_NON_POOLING` direct connection URL when `DATABASE_URL` uses PgBouncer).
- **Timeouts**: `migrate` enforces `timeout-minutes: 10` at the job level with `timeout-minutes: 5` on `status_check` (`Pre-flight schema migration check and summary`) and `migrate` (`Run Prisma Migrate Deploy`).
- **Actions**:
  - Declares `environment: ${{ inputs.environment || 'production' }}` on the `migrate` job, enforcing GitHub Environment Protection Rules and pausing for human reviewer sign-off **before** exposing `production` secrets.
  - Verifies `inputs.confirm == true` first (`Verify Manual Migration Confirmation`) and halts immediately with a non-zero exit code before repository checkout or `npx prisma migrate deploy` when manual dispatches leave `confirm: false`.
  - After environment unlock and confirmation, runs `npm run lint:migrations` and validates `DATABASE_URL` (and non-empty `POSTGRES_URL_NON_POOLING`) format.
  - Queries the live target database via `npx prisma migrate status` (`npx tsx scripts/preflight-migration-summary.ts --require-db`, preserving normalized `POSTGRES_URL_NON_POOLING` for `prisma.config.ts` and verifying libpq TLS handshakes via `verifyPostgresTlsHandshake` against the effective migration target URL first) after the `confirm` gate to emit pending migration SQL DDL summaries and fail closed with redacted diagnostics on TLS errors, connectivity errors, schema drift, or failed migrations in `$GITHUB_STEP_SUMMARY`.
  - Verifies libpq TLS handshakes (`verifyPostgresTlsHandshake`) on the effective migration endpoint and executes `npx prisma migrate deploy` against `DATABASE_URL` (and optional `POSTGRES_URL_NON_POOLING` via `prisma.config.ts`) with `PGOPTIONS="-c lock_timeout=5000ms -c statement_timeout=30000ms"`.
  - Emits diagnostic error signaling and resolution guidance if migration fails.

### 4. Provider Deployment Adapter (`deploy-provider.yml`)
- **Triggers**: Reusable `workflow_call` from `deploy-stage.yml` with `image_digest` and `caller_holds_lock: true`, rollback pipeline (`workflow_call` from `rollback.yml`) with `image_digest` / `image_tag`, optional `rollback_environment`, and `caller_holds_lock: true`, or standalone manual `workflow_dispatch` with an explicit `image_digest` (`sha256:<64-hex>`) or immutable release/commit `image_tag` (unpinned `latest` tags are rejected).
- **Concurrency**: Acquires `deploy-env-${{ inputs.environment || 'production' }}` (`cancel-in-progress: false`, `queue: max`) when `caller_holds_lock` is `false` (keyed on target `environment`, never `rollback_environment`), or scopes to `caller-deploy-provider-<environment>-${{ github.run_id }}-${{ github.run_attempt }}` when `caller_holds_lock` is `true`.
- **Permissions**: Top-level `contents: read`; deployment job (and reusable workflow caller jobs) scopes `actions: read`, `contents: read`, `packages: read`, `attestations: read`, `deployments: write`, and `id-token: write` for signed-revision `ci.yml` / `db-migrate.yml` / `deploy.yml` workflow verification, registry inspection, OIDC provenance verification, environment-filtered GitHub Deployments state tracking, and Google Cloud Workload Identity Federation.
- **Secrets & Variables**:
  - **Environment Variables**: `SERVICE_URL` (`vars.SERVICE_URL` primary, with `secrets.SERVICE_URL` supported as a legacy fallback), `CLOUD_RUN_SERVICE` (defaults to `wedding-website-staging` for `staging` and `wedding-website` for `production`), `CLOUD_RUN_REGION` (defaults to `us-central1`), and primary keyless OIDC authentication variables `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT`.
  - **Environment Secrets**: Static fallback `GCP_SA_KEY` and optional `GCP_PROJECT_ID` for `google-cloud-run`, or `DEPLOY_WEBHOOK_URL` and mandatory HMAC signing secret `DEPLOY_WEBHOOK_SECRET` for `generic-webhook` and `docker-host`.
- **Inputs**:
  - `environment`: Target deployment environment (`production` or `staging`).
  - `rollback_environment`: Optional unguarded GitHub Environment override (`workflow_call` only) for rollback secret resolution when invoked by `rollback.yml`.
  - `commit_sha`: Optional 40-character hexadecimal commit SHA checked out (`fetch-depth: 2`), stamped onto Cloud Run `commit-sha` labels, and assigned to `CURRENT_SHA` for rollback history guards and GitHub Deployments tracking (defaults to `github.sha` when omitted on `workflow_dispatch`).
  - `image_digest`: Immutable OCI image digest (`sha256:<64-hex>`) to deploy directly.
  - `image_tag`: Immutable version tag (`v*`, verifying `--source-ref refs/tags/<image_tag>`) or commit SHA (verifying `--source-ref refs/heads/main`, resolved to an immutable `sha256` digest via `docker buildx imagetools inspect` when `image_digest` is omitted).
  - `source_ref`: Optional expected OIDC provenance source ref override (`refs/heads/main` or `refs/tags/v*`; digest-only and SHA rollouts also accept `refs/tags/v*`-attested release artifacts).
  - `provider`: Hosting provider adapter (`google-cloud-run`, `docker-host`, or `generic-webhook`).
  - `cloud_run_service` / `cloud_run_region`: Optional Cloud Run target overrides resolved ahead of `vars.CLOUD_RUN_SERVICE` / `vars.CLOUD_RUN_REGION` and environment defaults.
  - `dry_run`: Explicit dry-run validation flag (`false` by default; `is_dry_run` is never coerced to `true` when secrets are missing).
  - `caller_holds_lock`: Boolean (`false` by default) indicating whether the parent workflow (`deploy-stage.yml` or `rollback.yml`) already holds `deploy-env-<environment>`.
  - `auto_rollback_on_failure` / `previous_tag` / `is_rollback`: Optional `workflow_call` inputs enabling automatic in-job fallback restoration inside `deploy-provider.yml` when `/api/health` or `/api/ready` fails or times out and `rollback_environment` is empty, and marking cancellation-safe rollback redeployments invoked by `rollback.yml`.
- **Outputs**:
  - `service_url`: Target deployment service URL (`secrets.SERVICE_URL` values are redacted from `$GITHUB_OUTPUT` and `$GITHUB_STEP_SUMMARY`).
  - `is_dry_run`: Boolean flag indicating if deployment executed in explicit dry-run mode (`inputs.dry_run == true`).
  - `previous_image_tag`: Prior immutable container image tag or GHCR-verified release SHA captured before rollout.
  - `previous_image_digest`: Prior immutable `sha256` OCI image digest captured before rollout (from the serving Cloud Run revision for `google-cloud-run`, or resolved via `docker buildx imagetools inspect` from the last non-dry-run target-environment release for `docker-host` and `generic-webhook`).
  - `image_digest`: Verified immutable `sha256` OCI image digest deployed.
  - `image_uri`: Full digest-pinned OCI image URI (`ghcr.io/<owner>/<repo>@sha256:<hex>`).
  - `attestation_status`: OIDC build provenance attestation verification status (`verified`).
  - `cloud_run_service` / `cloud_run_region`: Resolved Cloud Run service name and region forwarded to downstream rollback jobs.
  - `health_status` / `http_status`: Bounded `/api/health` and `/api/ready` probe outcome (`healthy` / `unhealthy`) and HTTP status code consumed by `deploy-stage.yml` and `rollback.yml`.
  - `rollout_executed` / `inline_rollback_completed`: Provider rollout and automatic in-job fallback rollback completion flags consumed by `deploy-stage.yml`.
- **Actions**:
  - Declares `if: always()`, `environment: ${{ (github.event_name == 'workflow_call' && inputs.rollback_environment) || inputs.environment || 'production' }}`, and `timeout-minutes: 20` (with step-level `timeout-minutes` of `2`–`5` minutes across registry resolution, OIDC provenance verification, GCP auth, active revision capture, Cloud Run / webhook rollout, GitHub Deployments API updates, `120s` `/api/health` + `/api/ready` polling, and inline fallback rollback, plus cancellation-safe prior-step outcome guards via `steps.validate-sha.outputs.is_rollback_call` on rollback paths), enforcing GitHub Environment Protection Rules and reviewer sign-off for all `workflow_dispatch` and forward `production` releases while supporting unguarded rollback environments and cancelled-run recovery exclusively during `workflow_call` rollbacks.
  - Aligns repository checkout to `commit_sha` (`fetch-depth: 2`, `persist-credentials: false`), rejects unpinned `latest` tags, resolves tag-only manual or rollback dispatches to immutable `sha256` digests via `docker buildx imagetools inspect`, and validates digests against `^sha256:[a-f0-9]{64}$`.
  - Runs `gh attestation verify` against `oci://ghcr.io/<owner>/<repo>@sha256:<hex>` with `--owner`, `--signer-workflow <owner>/<repo>/.github/workflows/publish-artifact.yml`, and `--source-ref` (`refs/tags/<image_tag>` for `v*` tags or `refs/heads/main`), resolves the signed 40-character `source_revision` via `scripts/resolve-oci-provenance.sh` from attested OCI `org.opencontainers.image.revision` metadata and SLSA `inputs.commit_sha` ahead of OIDC `GITHUB_SHA` digests (failing closed if OCI index `org.opencontainers.image.revision` conflicts with SLSA `inputs.commit_sha`), emits `cloud_run_labels` (`commit-sha=<source_revision>`) ahead of `inputs.commit_sha`, and confirms a completed passing `ci.yml` run for that revision before invoking any provider adapter or dry-run step.
  - On standalone live promotions (`workflow_dispatch` with `!inputs.dry_run`), resolves the target commit SHA (from `image_tag` or verified OIDC attestation reading OCI `org.opencontainers.image.revision` and SLSA `inputs.commit_sha` ahead of `sourceRepositoryDigest`), verifies `origin/main` ancestry, and confirms completed successful `ci.yml` and `db-migrate.yml` runs matching **both** `TARGET_SHA` and `TARGET_ENV` before touching provider credentials or deploying.
  - Fails closed on live runs (`!inputs.dry_run`) in `Verify Selected Provider Credentials` when required adapter credentials are absent (requiring `GCP_WORKLOAD_IDENTITY_PROVIDER` + `GCP_SERVICE_ACCOUNT` or fallback `GCP_SA_KEY` for `google-cloud-run`, and both `DEPLOY_WEBHOOK_URL` + `DEPLOY_WEBHOOK_SECRET` for `generic-webhook` / `docker-host`).
  - Captures `previous_image_digest` and `previous_image_tag` before rollout: `google-cloud-run` inspects the currently serving Cloud Run revision in the resolved service and region (extracting `previous_image_tag` on `@sha256:` serving revisions from OIDC provenance attestations, Cloud Run `commit-sha` / OCI `org.opencontainers.image.revision` labels, or image tags), falling back across all providers (`google-cloud-run`, `docker-host`, and `generic-webhook`) to environment-scoped GitHub Deployments (`deployments: write`) with `success` status, completed non-`dry_run` target-environment (`staging` or `production`) `deploy.yml` (matching both nested `deploy-stage.yml` job prefixes `Staging Deployment Stage / Provider Deployment (staging)` / `Production Deployment Stage / Provider Deployment (production)` and legacy job names) and `deploy-provider.yml` workflow runs, GHCR-published candidate tags verified via `docker buildx imagetools inspect` (skipping unpublished `HEAD^1` commits), and `HEAD^1` / commit parents relative to the pinned `CURRENT_SHA` (`inputs.commit_sha || github.sha`).
  - Deploys the digest-pinned `@sha256:` container URI to the hosting provider (Google Cloud Run via Workload Identity Federation OIDC or `GCP_SA_KEY` fallback with attested `source_revision` `commit-sha` revision labels, or stateless webhook `POST` for `docker-host` and `generic-webhook` to `DEPLOY_WEBHOOK_URL` signed with HMAC-SHA256 headers `X-Hub-Signature-256`, `X-Deploy-Timestamp`, and `X-Deploy-Signature-256` plus `--fail-with-body` HTTP error enforcement), creates the GitHub Deployment (`ref` and `payload.commit_sha` set from `source_revision` / `target_sha`) with `state: "in_progress"` (`auto_inactive: false`), polls `${TARGET_URL}/api/health` and `${TARGET_URL}/api/ready` (`curl --connect-timeout 5 --max-time 10`, resolving `vars.SERVICE_URL`, Cloud Run URL, and legacy `secrets.SERVICE_URL` in memory), posts `state: "success"` (`auto_inactive: true`) only after `/api/health` and `/api/ready` succeed (or `state: "failure"` via `if: always()` on failure/cancellation), runs automatic in-job fallback restoration when `auto_rollback_on_failure: true` and `rollback_environment` is empty, and writes the deployment summary to `$GITHUB_STEP_SUMMARY`.
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

### 5. Stage Orchestration, Post-Deployment Verification & Automated Rollback (`deploy.yml`, `deploy-stage.yml` & `rollback.yml`)
- **Triggers**: `deploy.yml` triggers via `workflow_run` after `CI` completes successfully on `main` pushes (or via `workflow_dispatch` / `workflow_call` with optional `image_tag`, `release_ref`, `image_digest`, or `workflow_call` `commit_sha`, resolving `v*` release tags and attested `image_digest` provenance via OCI `org.opencontainers.image.revision` / SLSA provenance to `target_sha` and confirming a successful `CI` run for `target_sha` before executing `schema-compatibility` and delegating `staging` / `production` stages to `.github/workflows/deploy-stage.yml`), running health verification automatically post-provider deployment (`rollback.yml` can also be invoked manually via `workflow_dispatch` with `previous_digest` and/or `previous_tag` and optional 40-character `commit_sha`, defaulting to `github.sha`).
- **Stage Concurrency, FIFO Queuing & Timeouts**:
  - `deploy.yml` defines no root-level `concurrency` block so preflight gates (`ci-gate` and `schema-compatibility`, each bounded at `timeout-minutes: 10` with `3m`–`5m` step bounds on SHA/provenance resolution, CI status verification, and commit alignment) and `publish-artifact` start immediately.
  - `deploy-stage.yml` holds `concurrency: { group: deploy-env-${{ inputs.environment }}, cancel-in-progress: false, queue: max }` across the full sequential stage lifecycle (`database-migration` -> `deploy-provider` -> `verify-deployment` -> conditional `rollback`), passes `caller_holds_lock: true` + `secrets: inherit` to child workflows, and bounds `verify-deployment` at `timeout-minutes: 5` (with `timeout-minutes: 3` on the `120s` health/readiness probe step).
  - Standalone `rollback.yml` dispatches (`caller_holds_lock: false`) acquire `deploy-env-${{ inputs.target_environment || 'production' }}` (`cancel-in-progress: false`, `queue: max`) keyed on `target_environment` (never `rollback_environment`), pass `caller_holds_lock: true` from `redeploy` to `deploy-provider.yml` so manual `production-rollback` runs serialize cleanly against active `production` promotions, and cap all three runner jobs (`preflight`, `verify`, and `report`) at `timeout-minutes: 5` (with `timeout-minutes: 3` on `Verify Rollback Digest Deployment History` and `timeout-minutes: 2` on `Poll Restored Service Health`) so hung API or registry calls abort quickly and release `deploy-env-<environment>`.
- **Actions**:
  - `verify-deployment` (`deploy-stage.yml`) enforces `timeout-minutes: 5` and consumes `health_status` and `http_status` from `deploy-provider.yml` (with fallback `/api/health` and `/api/ready` polling using `curl --connect-timeout 5 --max-time 10`, exponential backoff, and a 2-minute loop timeout).
  - Validates HTTP status code 200 on `/api/health` (`.data.database == "connected"` and `.data.status == "ok"`) and `/api/ready` (`status == "ready"` and `database == "connected"`).
  - Automatically invokes `rollback.yml` (with `caller_holds_lock: true`, `commit_sha`, `previous_image_digest`, `previous_image_tag`, `provider`, `cloud_run_service`, `cloud_run_region`, and job-scoped `actions: read` and `deployments: write`) if health or readiness probes fail or are cancelled (`failure() || cancelled()`), accepting digest-pinned rollbacks while rejecting mutable `latest` or the failing `CURRENT_SHA` (`inputs.commit_sha || github.sha`) outside explicit dry-run mode.
  - `rollback.yml` verifies in `preflight` (`deployments: read`, `packages: read`, `attestations: read`) that `previous_digest` / `previous_tag` does not match `CURRENT_SHA` and succeeded earlier in `target_environment` GitHub Deployments before `redeploy` starts, checks out the pinned `commit_sha` (`persist-credentials: false`, rather than drifted `HEAD`) to run `npm run lint:migrations`, calls `deploy-provider.yml` (`caller_holds_lock: true`) using the unguarded `rollback_environment`, consumes `health_status` and `http_status` from `deploy-provider.yml` (with fallback `${SERVICE_URL}/api/health` polling for `.data.status == "ok"` and `.data.database == "connected"` and `${SERVICE_URL}/api/ready` polling for `status == "ready"` and `database == "connected"`) without a duplicate `production` environment gate on `verify`, and gates `$GITHUB_STEP_SUMMARY` status reporting so any failed stage logs `FAILED` and exits non-zero.

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

Database migrations are run automatically using `npx prisma migrate deploy` in the `db-migrate.yml` workflow *before* the new application code goes live. Schema migrations are completely decoupled from application container boot (`docker-entrypoint.sh`), allowing application instances to start immediately without database lock contention during horizontal scaling. In local Docker Compose environments, a dedicated `migration` task service executes `./node_modules/.bin/prisma migrate deploy` offline before the application service starts (and standalone containers setting `RUN_MIGRATIONS=true` or `RUN_MIGRATIONS=1` run `/usr/local/bin/prisma migrate deploy` offline via `/opt/prisma-cli`). Before migrations are executed, a pre-migration backwards compatibility check (`npm run lint:migrations`) runs to verify zero-downtime safety.

### Minimum Supported Database Specification
- **Supported Database**: PostgreSQL 15 or higher (`PostgreSQL 15+`; the CI test suite and standard container setup use `postgres:15-alpine`).
- **ORM / Client**: Prisma ORM with `@prisma/adapter-pg` driver adapter and `pg` pool.

### Connection String Expectations
- **`DATABASE_URL`** (Required — `datasource.url` in `prisma.config.ts`): The primary connection string read by both the Next.js runtime application and `npx prisma migrate deploy`.
  - **Standard URI Format**: `postgresql://[user]:[password]@[host]:[port]/[database]?sslmode=[mode]`
  - **Example (Local PostgreSQL)**: `postgresql://wedding:wedding123@localhost:5432/wedding`
  - **Example (Cloud Host with SSL)**: `postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/wedding?sslmode=require`
  - **Example (Cloud SQL / Unix Domain Socket)**: `postgresql://wedding_user:STRONG_PASSWORD@localhost/wedding_db?host=/cloudsql/YOUR_PROJECT_ID:us-central1:wedding-db` *(specify `@localhost` in the authority segment for Prisma CLI compatibility; legacy empty-host `@/` socket URIs with a valid `?host=/...` path are normalized to `@localhost` automatically)*
  - **URI Schema, Pool & Timeout Flags**: Runtime `pg.Pool` and `@prisma/adapter-pg` honor `?schema=` (default `public`; validated as a 1–63 byte PostgreSQL identifier `/^[A-Za-z_][A-Za-z0-9_$]*$/`, double-quoted across `/api/ready`, `AuthLockout`, and all raw SQL `$queryRaw` / `$executeRaw` queries, and bound via `-c search_path` on direct non-pooled `pg.Pool` connections while omitting startup `options` on PgBouncer/transaction poolers), `?connection_limit=` (default `max=5`, keeping three instances safely below `db-f1-micro`'s `max_connections=25`), `?connect_timeout=` / `?pool_timeout=` in seconds (default `10s` / `10000ms` to tolerate serverless cold wakes), `?socket_timeout=` in seconds (default client `query_timeout=10000ms` on `pg.Pool` so hung PostgreSQL queries never block `/api/health` indefinitely), and `?statement_timeout=` in milliseconds.
- **`POSTGRES_URL_NON_POOLING`** (Optional — inspected by `resolvePrismaDatasourceUrl` and `resolvePrismaShadowDatabaseUrl` in `prisma.config.ts`): Direct, unpooled connection string. When `DATABASE_URL` uses a PgBouncer pooler (`isPooledPostgresUrl`) and `POSTGRES_URL_NON_POOLING` is an unpooled PostgreSQL URL targeting the same database and schema, `resolvePrismaDatasourceUrl` in `prisma.config.ts` promotes `POSTGRES_URL_NON_POOLING` as `datasource.url` for `prisma migrate deploy`, `status`, and `resolve` while keeping `datasource.shadowDatabaseUrl` `undefined` outside `dev`, `reset`, and `diff` (preventing Prisma `P3025` collisions); during local `prisma migrate dev`, a distinct `wedding_shadow` URL in `POSTGRES_URL_NON_POOLING` is bound to `datasource.shadowDatabaseUrl`.
  - **Example (Direct Migration Endpoint)**: `postgresql://user:pass@ep-example-direct.us-east-1.aws.neon.tech/wedding?sslmode=require`
  - **Example (Dedicated Dev Shadow DB)**: `postgresql://user:pass@ep-example-direct.us-east-1.aws.neon.tech/wedding_shadow?sslmode=require`

### SSL/TLS Configuration Behavior
- **Endpoint-Aware Strict Resolution**: `parsePostgresUrl` (`src/lib/postgres-url.js`) and runtime `src/lib/postgresPool.ts` (`src/lib/prisma.ts`) default omitted `sslmode` / `ssl` parameters to `verify-full` on non-loopback TCP hosts and `disable` only on loopback addresses (`localhost`, `*.localhost`, `127.0.0.0/8`, `::1`, `::ffff:127.0.0.0/8`) and local Unix domain sockets (`?host=/...`). In `NODE_ENV=production`, `src/env.ts` blocks `disable`, `allow`, `prefer`, and `no-verify` on remote `DATABASE_URL` and `POSTGRES_URL_NON_POOLING` endpoints (preserving explicit `?sslmode=disable` on internal Docker Compose `@db:5432` containers).
- **Supported TLS Modes**:
  - `sslmode=disable` (or `ssl=false` / `ssl=0`): Connects over plaintext TCP or Unix domain sockets without TLS negotiation (permitted in production only for loopback sockets/hosts and internal Compose `@db:5432?sslmode=disable`).
  - `sslmode=allow`: Non-production fallback mode that attempts plaintext TCP first and upgrades to TLS if required by the server (blocked on remote hosts in production).
  - `sslmode=prefer`: Non-production fallback mode that attempts TLS encryption first and falls back to plaintext if SSL is unavailable (blocked on remote hosts in production).
  - `sslmode=no-verify` (or `ssl=no-verify`): Non-production encrypted TLS mode without CA verification (blocked on remote hosts in production).
  - `sslmode=require` or `ssl=true` (`ssl=1`): Enforces encrypted TLS transport with strict CA certificate chain validation (`rejectUnauthorized: true` against `sslrootcert` or the system trust store) and server hostname/SAN verification. Recommended alongside `verify-full` for managed cloud databases (Neon, Supabase, Render, Railway).
  - `sslmode=verify-ca`: Enforces strict CA certificate chain verification against `sslrootcert` (or the system trust store) without hostname matching.
  - `sslmode=verify-full` (default for remote TCP hosts when `sslmode`/`ssl` are omitted, or explicit `sslmode=verify-full` / `sslrootcert=system`): Enforces both strict CA certificate chain validation (`sslrootcert` or system trust store) and server hostname/SAN verification.
- **Prisma CLI Normalization & Pre-Migration TLS Gate**: `prisma.config.ts` (`rewritePostgresUrlForPrismaCli`) translates omitted-`sslmode` remote defaults, `ssl=` flags, and `sslmode` / `sslrootcert` parameters into Prisma Schema Engine equivalents (`sslaccept=strict` / `sslaccept=accept_invalid_certs`), failing closed if simultaneous `sslrootcert` and `sslcert` parameters collide, while `verifyPostgresTlsHandshake` (`src/lib/postgres-url.js`) performs a zero-dependency Node `tls` handshake verification against the effective migration target URL (`resolveDirectMigrationPostgresUrl`) before `prisma migrate` runs in `docker-entrypoint.sh`, `scripts/preflight-migration-summary.ts`, and `db-migrate.yml`.

### Connection Pooling vs. Direct Migration Connections
- **Application Runtime (`DATABASE_URL`)**:
  - Can connect through transaction-level or session-level connection poolers (e.g., PgBouncer, RDS Proxy, Supabase Pooler, Neon Connection Pooler).
  - Uses connection pooling managed by `pg.Pool` with `@prisma/adapter-pg` to minimize connection overhead during serverless / containerized scaling.
- **Prisma Migrations (`npx prisma migrate deploy` / `dev`)**:
  - **Requirement**: Schema migration commands require **advisory locks** and session-level state that transaction-mode connection poolers (like PgBouncer in transaction mode) do not support.
  - When `DATABASE_URL` points to a PgBouncer pooler (`isPooledPostgresUrl`) and `POSTGRES_URL_NON_POOLING` (or `CONTAINER_POSTGRES_URL_NON_POOLING` in Docker Compose) provides an unpooled URL targeting the same database and schema, `resolvePrismaDatasourceUrl` in `prisma.config.ts` promotes `POSTGRES_URL_NON_POOLING` as `datasource.url` while `resolvePrismaShadowDatabaseUrl` returns `undefined` outside `dev`, `reset`, and `diff` so Prisma 7 never triggers `P3025`. Operators overriding `DATABASE_URL` manually on the CLI should still unset `POSTGRES_URL_NON_POOLING` (`DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy`).

### Prisma Migration Lifecycle
1. **Local Development**:
   - Run `npm run migrate:dev` (`prisma migrate dev`) to generate new SQL migration files in `prisma/migrations/` and synchronize your development schema.
2. **Production Pipeline**:
   - Migrations are automatically run in CI/CD (`db-migrate.yml` invoked by `deploy.yml`) via `npx prisma migrate deploy`—or offline in containers via `./node_modules/.bin/prisma migrate deploy` (`docker-compose.yml` `migration` service or `docker-entrypoint.sh` when `RUN_MIGRATIONS=true` / `RUN_MIGRATIONS=1`)—*before* new application code goes live.
   - `prisma migrate deploy` checks applied migrations in the `_prisma_migrations` table and applies any pending migrations in sequential order.

### Migration Backwards Compatibility Linter

Automated linter checks (`npm run lint:migrations`) run during pre-commit and pre-push hooks, local quality gates (`npm run quality`), PR CI workflows (`ci.yml`), migration executions (`db-migrate.yml`), releases (`deploy.yml`), and zero-install rollbacks (`rollback.yml`). The linter (`scripts/verify-migration-compatibility.ts`) tokenizes SQL migrations in `prisma/migrations/` into semicolon-delimited statements—including multi-line statements, comma-separated `ALTER TABLE` clauses, PL/pgSQL `DO` blocks (dollar-quoted and single-quoted, including `CASE` headers), `CREATE FUNCTION` / `CREATE PROCEDURE` bodies, and dynamic `EXECUTE` statements (joining `||` string literals, parsing `format()` `%` placeholders, and rejecting unannotated variable `EXECUTE`)—and blocks destructive, locking, or `N-1`-incompatible SQL:

- **Destructive DDL & DML**: `DROP TABLE`, `DROP COLUMN`, `DROP CONSTRAINT`, `DROP TYPE`, `DROP SCHEMA`, `DROP VIEW`, `DROP MATERIALIZED VIEW`, `DROP TRIGGER`, `DROP FUNCTION`, `DROP PROCEDURE`, `DROP SEQUENCE`, `TRUNCATE`, and `DELETE FROM`
- **Breaking Renames, Column Defaults & Type Mutations**: `RENAME COLUMN`, `RENAME TO`, `RENAME VALUE`, `ADD COLUMN` with `NOT NULL` lacking `DEFAULT`, `ADD COLUMN ... PRIMARY KEY`, `ADD GENERATED ALWAYS`, `DROP DEFAULT`, `SET NOT NULL`, and `SET DATA TYPE`
- **Zero-Downtime Index & Constraint Locking Rules**: Requires `CONCURRENTLY` on `CREATE INDEX` and `DROP INDEX` for pre-existing tables—each isolated in a dedicated single-statement `migration.sql` file without `BEGIN` so Prisma Migrate never triggers PostgreSQL error `25001` under `lock_timeout=5000ms`—and requires `NOT VALID` on `CHECK` and `FOREIGN KEY` constraints referencing pre-existing tables (followed by `VALIDATE CONSTRAINT`) and `USING INDEX` on `UNIQUE` constraints (exempting newly created tables in the same migration file and the frozen historical baseline).

If an intentional breaking cleanup is required in a dedicated contract release after code removal, see [`docs/versioning.md`](./docs/versioning.md) for the statement-scoped annotation contract enforced by `scripts/verify-migration-compatibility.ts`.

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
To maintain zero database downtime and preserve `N-1` rollback compatibility across releases, all database mutations follow the three-phase **Expand-Migrate-Contract** policy enforced in CI, migration, and deployment workflows via `npm run lint:migrations` (`ci.yml`, `db-migrate.yml`, `deploy.yml`):

- **Additive Releases by Default**: Minor and patch deployments keep `prisma/migrations/` strictly additive (new tables, nullable columns, `DROP NOT NULL`, or `NOT NULL` columns accompanied by an explicit `DEFAULT`) while dual-reading/dual-writing and backfilling data before any legacy structure is retired.
- **Canonical Phase & Linter Policy**: See [`docs/versioning.md`](./docs/versioning.md) for the authoritative three-phase **Expand-Migrate-Contract** rules, deprecation windows, and destructive SQL annotation requirements.

### N-1 Application Container Compatibility Requirements
Continuous deployment and automated rollback architectures depend on **N-1 compatibility**:
- **Backward Compatibility Guarantee**: Application containers from the previous release (`N-1`) must operate reliably against database schemas from the subsequent release (`N`).
- **Additive Schema Guardrail**: Because previous application containers cannot anticipate new mandatory table columns, any `NOT NULL` column added without a `DEFAULT` constraint causes existing `INSERT` queries from `N-1` containers to fail with `NOT NULL constraint violation`.
- **Preflight Enforcer**: Both `.github/workflows/db-migrate.yml` and `.github/workflows/deploy.yml` enforce backwards compatibility rules as a mandatory safety gate before executing schema mutations or routing production traffic.

### Automated Rollback Safety Protocols & Guarantees
When a post-deployment verification probe (`/api/health` or `/api/ready`) fails in `.github/workflows/deploy-stage.yml` (called by `.github/workflows/deploy.yml`), automated rollback procedures activate immediately:
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
   - For runtime probe failures, check `/api/health` and `/api/ready` status, database connection pool limits, and container error logs.

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

- **Container Liveness Probe (`GET /api/live`)**: Targeted by the `Dockerfile` `HEALTHCHECK`, `docker-compose.yml` `app` `healthcheck`, and Google Cloud Run `--liveness-probe=httpGet.path=/api/live,httpGet.port=3000,periodSeconds=30` (or Knative `livenessProbe`). Returns `HTTP 200 OK` with `{ "status": "alive", "timestamp": "<ISO-8601>" }` (`Cache-Control: no-store`) without querying PostgreSQL so transient database blips never trigger container restart loops.
- **Startup & Rollout Health Probe (`GET /api/health`)**: Targeted by Cloud Run Knative `startupProbe` (`httpGet.path: /api/health`, `port: 3000`) and paired with `/api/ready` in `.github/workflows/deploy-stage.yml` / `.github/workflows/rollback.yml`. Wrapped in `withApiMiddleware` (`isHealthProbe: true` in `src/utils/withApiMiddleware.ts`), returning `HTTP 200 OK` (`Cache-Control: no-store`) with `{ "success": true, "data": { "status": "ok", "timestamp": "<ISO-8601>", "database": "connected" } }` when PostgreSQL responds to `SELECT 1`. When PostgreSQL is unreachable (`HTTP 503 Service Unavailable`, `Cache-Control: no-store`), `withApiMiddleware` (`isHealthProbe: true`) preserves diagnostic probe fields `{ "success": false, "status": "degraded", "database": "disconnected", "timestamp": "<ISO-8601>", "error": "Database connection failed" }` with sanitized error text in `NODE_ENV=production`.
- **Readiness Probe (`GET /api/ready`)**: Unwrapped Route Handler (`Cache-Control: no-store`) polled alongside `/api/health` in `.github/workflows/deploy-stage.yml`, `.github/workflows/rollback.yml`, and `./scripts/rollout-vps.sh`, verifying PostgreSQL connectivity, all 16 persisted `prisma/schema.prisma` tables (`REQUIRED_SCHEMA_TABLES` in `src/lib/readinessManifest.ts`), and all 47 committed migrations in `_prisma_migrations` (`REQUIRED_MIGRATION_NAMES` in `src/lib/readinessManifest.ts`, allowing extra forward `N+1` migrations during `N-1` rollbacks and `_prisma_migrations`-less `prisma db push` schemas when all 16 tables exist) without requiring seeded `AppConfig` rows; returns `HTTP 200 OK` with `{ "status": "ready", "database": "connected", "timestamp": "<ISO-8601>" }`, or `HTTP 503 Service Unavailable` with `{ "status": "unhealthy", "database": "connected", "error": "Database schema is not ready", "timestamp": "<ISO-8601>" }` on missing tables/migrations or `{ "status": "unhealthy", "database": "disconnected", "error": "Database connection failed", "timestamp": "<ISO-8601>" }` when PostgreSQL is unreachable. Read-only (`GET` and `HEAD`) requests to `/api/live`, `/api/health`, and `/api/ready` enforce syntactic `Host` validation (`isHostSyntaxValid`) without requiring `ALLOWED_HOSTS` membership.
- **Graceful Shutdown Timeout (`15s`)**: `docker-compose.yml` configures `stop_grace_period: 15s` on `app` (pass `--stop-timeout 15` on standalone `docker run`) so Next.js finishes active HTTP requests before `src/lib/prisma.ts` drains `pg.Pool` within its `5000ms` shutdown safety timer (`exit` code `130` on `SIGINT`, `143` on `SIGTERM`).

---

## 🔑 Setup and Secrets

Configure the following workflow-consumed secrets in GitHub Settings (**Settings > Environments** for `staging`, `production`, and `production-rollback`, or **Settings > Secrets and variables > Actions** for repository-wide registry credentials):

| Secret | Description | Required By |
|---|---|---|
| `DATABASE_URL` | Production/staging PostgreSQL connection string (direct or pooled when paired with `POSTGRES_URL_NON_POOLING`) | `db-migrate.yml` |
| `POSTGRES_URL_NON_POOLING` | Optional direct (non-pooled) PostgreSQL connection string promoted by `prisma.config.ts` when `DATABASE_URL` uses PgBouncer | `db-migrate.yml` |
| `GCP_SA_KEY` | Google Cloud Service Account JSON Key (legacy static fallback when Workload Identity Federation variables are not set for `provider: google-cloud-run`) | `deploy-provider.yml`, `rollback.yml` |
| `GCP_PROJECT_ID` | Google Cloud Project ID (optional override when `provider: google-cloud-run`) | `deploy-provider.yml`, `rollback.yml` |
| `DEPLOY_WEBHOOK_URL` | Deployment Webhook URL (required when `provider: generic-webhook` or `docker-host`) | `deploy-provider.yml`, `rollback.yml` |
| `DEPLOY_WEBHOOK_SECRET` | HMAC-SHA256 signing secret required to authenticate `generic-webhook` and `docker-host` payloads | `deploy-provider.yml`, `rollback.yml` |
| `DOCKERHUB_USERNAME` | Docker Hub username (optional secondary registry) | `publish-artifact.yml` |
| `DOCKERHUB_TOKEN` | Docker Hub access token (optional secondary registry) | `publish-artifact.yml` |

Configure the following GitHub Environment and repository **Variables** (**Settings > Environments** for environment-scoped target URLs, Cloud Run topology, and Workload Identity Federation providers, and **Settings > Secrets and variables > Actions > Variables** for optional rollback environment bindings):

| Variable | Description | Consumed By |
|---|---|---|
| `SERVICE_URL` | Public base URL of the target web service for `/api/health` and `/api/ready` probes (`vars.SERVICE_URL` primary; `secrets.SERVICE_URL` supported as a legacy fallback without cross-job `$GITHUB_OUTPUT` export) | `deploy-stage.yml`, `deploy-provider.yml`, `rollback.yml` |
| `CLOUD_RUN_SERVICE` | Target Google Cloud Run service name (defaults to `wedding-website-staging` for `staging` and `wedding-website` for `production`) | `deploy-provider.yml` |
| `CLOUD_RUN_REGION` | Target Google Cloud Run region (defaults to `us-central1`) | `deploy-provider.yml` |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | Google Cloud Workload Identity Provider resource name for keyless OIDC authentication (`id-token: write`) | `deploy-provider.yml` |
| `GCP_SERVICE_ACCOUNT` | Google Cloud Service Account email impersonated via Workload Identity Federation | `deploy-provider.yml` |
| `PRODUCTION_ROLLBACK_ENVIRONMENT` | Optional unguarded GitHub Environment name (e.g., `production-rollback`) for automated production rollback credential resolution | `deploy.yml` |
| `STAGING_ROLLBACK_ENVIRONMENT` | Optional unguarded GitHub Environment name for automated staging rollback credential resolution | `deploy.yml` |

Application runtime secrets (`ADMIN_PASSWORD`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, `S3_*`, `STRIPE_*`) are configured directly in the target hosting provider rather than GitHub Actions.
