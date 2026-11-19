# Pro-Grade Deployment Pipeline & Deployment Recipes

This repository implements a modular, enterprise-grade continuous integration and delivery architecture built around a **shared runtime contract**. Core CI, immutable release artifact publication, database schema migration, and provider-specific hosting deployment are separated into explicit responsibilities.

For the authoritative specification of container, database, environment variable, reverse proxy, health check, and lifecycle requirements, refer to the [Application Runtime Contract](./docs/runtime-contract.md). All hosting providers and deployment environments must satisfy this baseline contract.

## Deployment State & Optional Vercel Target

- **Current Deployment Architecture**: The primary deployment architecture is provider-neutral, utilizing standard containerized builds (`Dockerfile`) running on Node.js / Docker hosts such as Google Cloud Run or AWS.
- **Disconnected Vercel Connection**: The historical direct Vercel connection is disconnected. Core application code, environment validation, database access, and routing logic do not depend on Vercel-specific runtime environment variables or proprietary APIs.
- **Optional Vercel Support**: Vercel remains fully supported as an optional deployment target. Couples or developers who wish to deploy on Vercel can import the repository directly into Vercel or use `vercel deploy`, ensuring environment variables (`DATABASE_URL`, `ADMIN_PASSWORD`, `ALLOWED_HOSTS`) are provided in Vercel's project settings.

---

## Shared Runtime Contract

All hosting platforms consume the same unified application runtime contract, ensuring total portability and avoiding vendor lock-in:

1. **Node.js Runtime Specification**: Node.js v22.x LTS, Next.js App Router standalone build (`output: 'standalone'`).
2. **Database Engine & ORM**: PostgreSQL 15+ accessed via Prisma ORM v7.x (`@prisma/client`).
3. **Migration Mechanism**: Schema updates are managed via `npx prisma migrate deploy` executed prior to application start.
4. **Environment Variables**: Validated at startup by `src/env.ts` using Zod schema validation.
5. **Asset Storage Abstraction**: Local filesystem storage (`/app/public/uploads`) or S3-compatible object storage (Cloudflare R2, AWS S3).
6. **Health Check Probes**: Universal health probe endpoint at `/api/health` returning HTTP 200 JSON status.
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
The canonical portable baseline using the multi-platform `Dockerfile` and `docker-compose.yml`. Includes automated `docker-entrypoint.sh` migration execution, Nginx/Caddy reverse proxy configurations with Let's Encrypt TLS, container health probes via `/api/health`, and zero-downtime container updates.

### 2. [Google Cloud Run Deployment](./docs/deployment/gcp-cloud-run.md)
Managed serverless container target using Google Artifact Registry, GCP Secret Manager, and Cloud SQL PostgreSQL. Automated via `.github/workflows/deploy.yml` with pre-deployment schema migrations, S3/R2 asset storage, and instant revision traffic splitting for rollbacks.

### 3. [Vercel Deployment](./docs/deployment/vercel.md)
Optional serverless Node.js deployment target using serverless PostgreSQL connection pooling (Neon, Supabase, RDS Proxy). Supports Vercel automatic custom domain TLS, pre-deploy build migrations (`npx prisma migrate deploy && next build`), and instant deployment rollbacks.

### 4. [Railway & Render PaaS Deployment](./docs/deployment/railway-render.md)
Low-friction PaaS deployment path with managed PostgreSQL add-ons, pre-deploy release commands, persistent volume mounts or S3 asset storage, and automatic domain SSL provisioning.

---

## Environment Variables Reference

The application requires the following environment variables. These match the runtime validation schema in `src/env.ts` and the `.env.example` template:

- `NODE_ENV`: Defines the environment the application is running in (`development`, `test`, `production`).
- `DATABASE_URL`: Connection string to your production PostgreSQL database. *Required.*
- `POSTGRES_URL_NON_POOLING`: Connection string for the shadow database used by Prisma for migrations, without a connection pooler. *Optional.*
- `ADMIN_PASSWORD`: Cryptographic hash of the administrative password. *Required.*
  - **Format**: Must be an scrypt hash in the format `scrypt:[saltBase64]:[keyBase64]`.
  - **Generation**: Use a standard scrypt generator or the provided `scripts/generate-password-hash.mjs` to create this hash securely. Never store plain text passwords.
- `ALLOWED_HOSTS`: Comma-separated list of trusted host domains or wildcard patterns allowed to access the application (e.g. `localhost,127.0.0.1,wedding.example`). Wildcard DNS is not required for default single-site deployments. *Required.*
- `MULTISITE_ENABLED`: Set to `true` to enable multi-tenant/multi-profile configuration and subdomain-based site routing. Defaults to `false` (1 deployment = 1 wedding site). *Optional.*
- `RUN_MIGRATIONS`: Set to `true` to automatically execute database schema migrations on container startup in `docker-entrypoint.sh`. Defaults to `false`. *Optional.*
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

---

## 🏗️ Architecture & Responsibilities

The automated release architecture decouples continuous delivery across isolated staging and production environments using mandatory human approval gates and automated rollback safeguards:

```
┌───────────────────────────────────────────────────────────┐
│ 1. Continuous Integration (ci.yml)                         │
│    • Install deps, lint, typecheck                        │
│    • Unit & integration tests                             │
│    • Production build & Playwright E2E                    │
│    • Container build & container smoke test (No Secrets)  │
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
│    • Staging Database Migration (db-migrate.yml)          │
│    • Staging Provider Deployment (deploy-provider.yml)    │
│    • Staging Health Verification (/api/health probe)      │
│    • Automated test environment validation                │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│ 4. Mandatory Production Review Gate (GitHub Environment)  │
│    • Pre-flight schema status & SQL DDL summary generated │
│    • Step summary audit in $GITHUB_STEP_SUMMARY           │
│    • Mandatory human reviewer approval required           │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│ 5. Production Delivery Pipeline (environment: production) │
│    • Production Database Migration (db-migrate.yml)       │
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
  4. **Environment Secrets**:
     - `DATABASE_URL`: Connection string for the isolated staging PostgreSQL instance (e.g., `postgresql://wedding:staging_pass@staging-db.internal:5432/wedding_staging`).
     - `SERVICE_URL`: Base URL of the staging web service (e.g., `https://staging.wedding.example.com`).
     - Provider secrets (e.g., `GCP_SA_KEY` or `DEPLOY_WEBHOOK_URL` for staging Cloud Run/hosting service).

#### 2. Production Environment (`production`)
- **Purpose**: Live environment hosting attendee traffic, requiring explicit human reviewer approval before executing schema migrations or container updates.
- **Environment Setup**:
  1. Navigate to **Settings** > **Environments** in your GitHub repository.
  2. Click **New environment** and name it `production`.
  3. **Required Reviewers (Mandatory Gate)**:
     - Check the **Required reviewers** checkbox.
     - Specify designated maintainers, release managers, or team leads authorized to approve production releases.
     - Select **Prevent self-review** if team policy mandates dual-control sign-off.
  4. **Deployment Branches**: Restrict deployment to `main` branch or release tags (`v*`).
  5. **Environment Secrets**:
     - `DATABASE_URL`: Connection string for the isolated production PostgreSQL instance (e.g., `postgresql://wedding:prod_pass@prod-db.internal:5432/wedding_prod`).
     - `SERVICE_URL`: Base URL of the live production web service (e.g., `https://wedding.example.com`).
     - `ADMIN_PASSWORD`: Production scrypt hash for administrative login.
     - `GUEST_PASSCODE`: Production guest access passcode.
     - `GUEST_SESSION_SECRET`: Production secret for HMAC session token signing.
     - Provider secrets (`GCP_SA_KEY`, `GCP_PROJECT_ID`, or `DEPLOY_WEBHOOK_URL`).

#### 3. Strict Separation of Secrets & Database Credentials
- Staging and production **MUST NOT** share database credentials or database instances.
- Reusable workflows inherit secrets dynamically scoped to the target environment (`secrets: inherit` in `.github/workflows/deploy.yml`).
- Staging migrations execute strictly against the staging database; production migrations execute strictly against the production database following reviewer sign-off.

### 🔄 Staging Promotion & Approval Workflow

1. **Automated Staging Delivery on Merge**:
   - When a pull request is merged into `main`, GitHub Actions triggers `.github/workflows/deploy.yml`.
   - The workflow verifies N-1 schema backwards compatibility, builds and scans the immutable container artifact, signs OIDC build provenance attestations (`actions/attest-build-provenance`), and exports `image_digest` (`sha256:<64-hex>`).
   - `staging-deploy-provider` receives the attested `image_digest`, verifies OIDC provenance via `gh attestation verify` against the `oci://ghcr.io/<owner>/<repo>@sha256:<hex>` URI prior to rollout, deploys the digest-pinned container to `staging`, and validates `/api/health`.
2. **Pre-Flight Schema Status & DDL Review**:
   - The pipeline generates a detailed **Pre-Flight Schema Migration Status & SQL DDL Summary** in `$GITHUB_STEP_SUMMARY`.
   - The summary details target environment status, pending migration filenames, altered tables/columns, and complete SQL statements alongside the verified container digest and attestation status.
3. **Maintainer Review & Sign-Off**:
   - Maintainers navigate to the active workflow run in GitHub Actions.
   - Maintainers review the pre-flight schema summary, verify staging health check results, and click **Review deployments**.
   - Upon selecting the `production` environment and clicking **Approve and deploy**, GitHub Actions unblocks production deployment.
4. **Production Deployment & Automated Rollback Guard**:
   - Production database migrations execute via `.github/workflows/db-migrate.yml` with advisory locking and preflight verification.
   - `production-deploy-provider` promotes the exact `image_digest` attested in `publish-artifact.yml` (or an explicit `image_digest` supplied on manual production-only dispatches), re-verifies OIDC build provenance via `gh attestation verify` against `.github/workflows/publish-artifact.yml`, and deploys the immutable `@sha256:` URI via `.github/workflows/deploy-provider.yml`.
   - Post-deployment health probes verify `/api/health` with exponential backoff.
   - **Rollback Guarantee**: If the production health probe fails, `.github/workflows/rollback.yml` is automatically triggered to restore the previous validated container tag (`previous_tag`) **without requiring a second human approval step**.

---

## 📄 Workflows Overview

### 1. Continuous Integration (`ci.yml`)
- **Triggers**: Pull requests, pushes to `main`.
- **Secrets required**: *None* (runs entirely on isolated local containers).
- **Actions**:
  - Type checking (`npm run typecheck`) and linting (`npm run lint`).
  - Documentation and OpenAPI drift verification.
  - Unit and integration tests (`npm test`).
  - Production build (`npm run build`).
  - Playwright E2E and A11y tests.
  - Local container build and container Playwright smoke test using `docker compose up --build -d app`.

### 2. Artifact Publication (`publish-artifact.yml`)
- **Triggers**: Release pipeline, pushes to `main` or `v*` tags, manual `workflow_dispatch`.
- **Permissions**: `packages: write` (for GitHub Container Registry), `security-events: write` (for uploading SARIF scan results to GitHub Code Scanning), `id-token: write` and `attestations: write` (for OIDC cryptographic build provenance attestations).
- **Actions**:
  - Compiles local container image prior to registry publication.
  - Executes Trivy vulnerability scanning (`aquasecurity/trivy-action`) to block builds with `CRITICAL` or `HIGH` severity vulnerabilities.
  - Uploads SARIF vulnerability reports (`trivy-results.sarif`) to GitHub Code Scanning via `github/codeql-action/upload-sarif`.
  - Publishes multi-platform OCI container images (`linux/amd64`, `linux/arm64`) to registries upon scan success.
  - Generates signed OIDC build provenance attestations via `actions/attest-build-provenance`.
- **Outputs**:
  - `image_uri`: Immutable URI (`ghcr.io/<owner>/<repo>:<sha>`).
  - `image_tag`: Immutable commit SHA or custom release tag.
  - `image_digest`: Attested OCI image digest (`sha256:<64-hex>`) propagated to staging and production deployment jobs.

### 3. Database Migration (`db-migrate.yml`)
- **Triggers**: Release pipeline, manual `workflow_dispatch` with target environment (`production`, `staging`, `development`).
- **Secrets required**: `DATABASE_URL`.
- **Actions**:
  - Declares `environment: ${{ inputs.environment || 'production' }}`, enforcing GitHub Environment Protection Rules and reviewer sign-off for `production`.
  - Validates `DATABASE_URL` format and connectivity.
  - Executes pre-flight migration status audit (`prisma migrate status`) and emits SQL DDL summaries to `$GITHUB_STEP_SUMMARY`.
  - Executes `prisma migrate deploy` explicitly against target database with connection lock and statement timeouts.
  - Emits diagnostic error signaling and resolution guidance if migration fails.

### 4. Provider Deployment Adapter (`deploy-provider.yml`)
- **Triggers**: Release pipeline (`workflow_call`) with `image_digest`, or manual `workflow_dispatch` with an explicit `image_digest` (`sha256:<64-hex>`) or immutable release/commit `image_tag` (unpinned `latest` tags are rejected).
- **Permissions**: Top-level `contents: read`; deployment job scopes `packages: read` and `attestations: read` for registry inspection and OIDC provenance verification.
- **Secrets required**: Provider credentials (e.g. `GCP_SA_KEY`, `DEPLOY_WEBHOOK_URL`).
- **Inputs**:
  - `environment`: Target deployment environment (`production` or `staging`).
  - `image_digest`: Immutable OCI image digest (`sha256:<64-hex>`) to deploy directly.
  - `image_tag`: Immutable version tag or commit SHA (resolved to an immutable `sha256` digest via `docker buildx imagetools inspect` when `image_digest` is omitted).
  - `provider`: Hosting provider adapter (`google-cloud-run`, `docker-host`, or `generic-webhook`).
- **Outputs**:
  - `service_url`: Target deployment service URL.
  - `is_dry_run`: Boolean flag indicating if deployment executed in dry-run mode.
  - `image_digest`: Verified immutable `sha256` OCI image digest deployed.
  - `image_uri`: Full digest-pinned OCI image URI (`ghcr.io/<owner>/<repo>@sha256:<hex>`).
  - `attestation_status`: OIDC build provenance attestation verification status (`verified`).
- **Actions**:
  - Declares `environment: ${{ inputs.environment || 'production' }}`, enforcing GitHub Environment Protection Rules and reviewer sign-off for `production`.
  - Rejects unpinned `latest` tags, resolves tag-only manual dispatches to immutable `sha256` digests via `docker buildx imagetools inspect`, and validates digests against `^sha256:[a-f0-9]{64}$`.
  - Runs `gh attestation verify` against `oci://ghcr.io/<owner>/<repo>@sha256:<hex>` with `--owner` and `--signer-workflow <owner>/<repo>/.github/workflows/publish-artifact.yml` before invoking any provider adapter or dry-run step.
  - Deploys the digest-pinned `@sha256:` container URI to the hosting provider (e.g. Google Cloud Run or generic webhook) and records the verified digest, pinned URI, and attestation status in `$GITHUB_STEP_SUMMARY`.

### 5. Post-Deployment Verification & Automated Rollback (`deploy.yml` & `rollback.yml`)
- **Triggers**: Runs automatically in `deploy.yml` post-provider deployment for staging and production.
- **Actions**:
  - `verify-deployment` polls `/api/health` with configurable exponential backoff and a 2-minute maximum timeout.
  - Validates HTTP status code 200 and confirms JSON body `database == 'connected'` and `status == 'ok'`.
  - Automatically invokes `rollback.yml` if health probes fail or time out, restoring the previous stable OCI image tag without requiring a second manual approval step.

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
- **`DATABASE_URL`** (Required): The primary connection string used by the Next.js runtime application to connect to PostgreSQL.
  - **Standard URI Format**: `postgresql://[user]:[password]@[host]:[port]/[database]?sslmode=[mode]`
  - **Example (Local PostgreSQL)**: `postgresql://wedding:wedding123@localhost:5432/wedding`
  - **Example (Cloud Host with SSL)**: `postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/wedding?sslmode=require`
- **`POSTGRES_URL_NON_POOLING`** (Optional / Migration Shadow DB): The direct, unpooled connection string used for shadow database creation or direct schema migrations when a connection pooler is placed in front of `DATABASE_URL`.
  - **Example**: `postgresql://user:pass@ep-example-direct.us-east-1.aws.neon.tech/wedding_shadow?sslmode=require`

### SSL/TLS Configuration Behavior
- **Default Behavior**: Standard `pg.Pool` automatically interprets SSL parameters passed in the `DATABASE_URL` query string.
- **`sslmode` Options**:
  - `sslmode=require`: Mandatory for cloud-hosted database providers (e.g., AWS RDS, GCP Cloud SQL, Supabase, Neon, Railway, Azure DB for PostgreSQL).
  - `sslmode=prefer` / `sslmode=disable`: Typical for local Docker or development environments.
  - Custom TLS Certificates: If your host requires custom CA certificates, configure `NODE_EXTRA_CA_CERTS` or pass formatted SSL parameters according to node-postgres specifications.

### Connection Pooling vs. Direct Migration Connections
- **Application Runtime (`DATABASE_URL`)**:
  - Can connect through transaction-level or session-level connection poolers (e.g., PgBouncer, RDS Proxy, Supabase Pooler, Neon Connection Pooler).
  - Uses connection pooling managed by `pg.Pool` with `@prisma/adapter-pg` to minimize connection overhead during serverless / containerized scaling.
- **Prisma Migrations (`npx prisma migrate deploy` / `dev`)**:
  - **Requirement**: Schema migration commands require **advisory locks** and session-level state that transaction-mode connection poolers (like PgBouncer in transaction mode) do not support.
  - Always point migration runners or `POSTGRES_URL_NON_POOLING` directly to a direct/unpooled PostgreSQL endpoint or session-mode pooler port.

### Prisma Migration Lifecycle
1. **Local Development**:
   - Run `npm run migrate:dev` (`prisma migrate dev`) to generate new SQL migration files in `prisma/migrations/` and synchronize your development schema.
2. **Production Pipeline**:
   - Migrations are automatically run in CI/CD (`deploy.yml` or container entrypoint) via `npx prisma migrate deploy` *before* new application code goes live.
   - `prisma migrate deploy` checks applied migrations in the `_prisma_migrations` table and applies any pending migrations in sequential order.

### Migration Backwards Compatibility Linter

Automated linter checks (`npm run lint:migrations`) run during pre-commit hooks, local builds, PR CI workflows (`ci.yml`), migration executions (`db-migrate.yml`), releases (`deploy.yml`), and rollbacks (`rollback.yml`). The linter (`scripts/verify-migration-compatibility.ts`) tokenizes SQL migrations in `prisma/migrations/` into semicolon-delimited statements—including multi-line statements, comma-separated `ALTER TABLE` clauses, and inner SQL inside PL/pgSQL `DO $$ ... $$` blocks—and flags destructive or N-1 incompatible DDL operations:

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
     # Generate a compensating migration diff:
     npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script > fix.sql
     ```
4. **Re-triggering Release**:
   - After addressing the root cause and verifying local checks with `npm run lint:migrations` and `npm run test`, trigger the release pipeline again.

---

## Health Checks & Liveness Probes

Containers and orchestrators query `/api/health` (returning HTTP 200 OK and database connectivity status) for liveness and readiness monitoring.

---

## 🔑 Setup and Secrets

Configure the following secrets in GitHub Repository Settings (`Settings > Secrets and variables > Actions`):

| Secret | Description | Required By |
|---|---|---|
| `DATABASE_URL` | Production PostgreSQL connection string | `db-migrate.yml` |
| `GCP_SA_KEY` | Google Cloud Service Account JSON Key (optional for Cloud Run) | `deploy-provider.yml` |
| `DEPLOY_WEBHOOK_URL` | Deployment Webhook URL (optional for custom hosts) | `deploy-provider.yml` |
| `DOCKERHUB_USERNAME` | Docker Hub username (optional secondary registry) | `publish-artifact.yml` |
| `DOCKERHUB_TOKEN` | Docker Hub access token (optional secondary registry) | `publish-artifact.yml` |

---

## ⚙️ Environment Variables

The application requires the following environment variables in deployment environments (matching runtime validation in `src/env.ts` and `.env.example`):

- `NODE_ENV`: Application mode (`development`, `test`, `production`).
- `DATABASE_URL`: Connection string to production PostgreSQL database. *Required.*
- `POSTGRES_URL_NON_POOLING`: Connection string for shadow database without connection pooler. *Optional.*
- `ADMIN_PASSWORD`: Scrypt hash of admin password (`scrypt:[saltBase64]:[keyBase64]`). *Required.*
- `ALLOWED_HOSTS`: Comma-separated list of trusted host domains or wildcards. *Required.*
- `MULTISITE_ENABLED`: Set to `true` to enable multi-tenant/multi-profile configuration and subdomain routing (default: `false`).
- `RUN_MIGRATIONS`: Set to `true` to automatically execute database schema migrations on container startup in `docker-entrypoint.sh` (default: `false`). *Optional.*
- `GUEST_PASSCODE`: Global passcode required for guest access (default: `wedding2026`).
- `GUEST_SESSION_SECRET`: Dedicated server secret for signing and verifying guest invitation session tokens (min 32 characters, distinct from `GUEST_PASSCODE`; default: `default-guest-session-secret` in dev/test only). *Required in production.*
- `HISTORY_VERSION_LIMIT`: System limit for history retention (default: `50`).
- `CRON_SECRET`: Authorization secret for cron worker endpoints. *Optional.*
- `S3_BUCKET`: Asset storage bucket name. *Optional.*
- `S3_REGION`: Bucket region. *Optional.*
- `S3_ACCESS_KEY_ID`: Bucket access key. *Optional.*
- `S3_SECRET_ACCESS_KEY`: Bucket secret key. *Optional.*
- `S3_ENDPOINT`: Custom S3/R2 endpoint. *Optional.*
- `S3_PUBLIC_URL`: CDN or public asset prefix. *Optional.*
