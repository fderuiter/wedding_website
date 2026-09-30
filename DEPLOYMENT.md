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
- `GUEST_PASSCODE`: Global passcode required for guest access to the website. *Required.*
  - **Security Requirement**: Must be explicitly defined in production environment settings. Never rely on default passcodes.
- `HISTORY_VERSION_LIMIT`: System limit for the number of history versions to keep for content entries (defaults to 50).
- `S3_BUCKET`: The name of the S3/R2 bucket to store uploaded assets. *Optional (required if other S3 variables are specified).*
- `S3_REGION`: The region of the S3 bucket (`us-east-1` or `auto` for Cloudflare R2). *Optional (required if other S3 variables are specified).*
- `S3_ACCESS_KEY_ID`: S3/R2 API access key ID. *Optional (required if other S3 variables are specified).*
- `S3_SECRET_ACCESS_KEY`: S3/R2 API secret access key. *Optional (required if other S3 variables are specified).*
- `S3_ENDPOINT`: S3-compatible custom endpoint URL (required for Cloudflare R2). *Optional.*
- `S3_PUBLIC_URL`: Public asset delivery URL or CDN prefix used to serve assets publicly. *Optional.*

---

## 🏗️ Architecture & Responsibilities

The automated release architecture consists of four distinct, modular workflows:

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
│ 3. Database Migration (db-migrate.yml)                    │
│    • Explicit release/deployment execution                │
│    • Pre-migration status check & validation              │
│    • Safe failure signaling & rollback guidance           │
└─────────────────────────────┬─────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────┐
│ 4. Provider Deployment (deploy-provider.yml)              │
│    • Consumes published release artifact (by SHA/tag)     │
│    • Isolated provider credentials (e.g. Cloud Run)       │
│    • Independent deployment evolution                     │
└───────────────────────────────────────────────────────────┘
```

The top-level **Release Pipeline (`deploy.yml`)** orchestrates steps 2, 3, and 4 in safe sequence for releases.

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
- **Permissions**: `packages: write` (for GitHub Container Registry).
- **Outputs**:
  - `image_uri`: Immutable URI (`ghcr.io/<owner>/<repo>:<sha>`).
  - `image_tag`: Immutable commit SHA or custom release tag.
  - `image_digest`: OCI image digest.

### 3. Database Migration (`db-migrate.yml`)
- **Triggers**: Release pipeline, manual `workflow_dispatch` with target environment (`production`, `staging`, `development`).
- **Secrets required**: `DATABASE_URL`.
- **Actions**:
  - Validates `DATABASE_URL` format and connectivity.
  - Executes `prisma migrate status` to audit pending migrations.
  - Executes `prisma migrate deploy` explicitly against target database.
  - Emits step summaries and diagnostic error signaling if migration fails.

### 4. Provider Deployment Adapter (`deploy-provider.yml`)
- **Triggers**: Release pipeline, manual `workflow_dispatch` with `image_tag` parameter.
- **Secrets required**: Provider credentials (e.g. `GCP_SA_KEY`, `DEPLOY_WEBHOOK_URL`).
- **Actions**:
  - Consumes a pre-built, tested release artifact tag.
  - Deploys the container to hosting provider (e.g. Google Cloud Run).

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

Automated linter checks (`npm run lint:migrations`) run during local builds, in PR CI workflows (`ci.yml`), and during deployment (`db-migrate.yml`). The linter scans SQL migrations in `prisma/migrations/` for destructive DDL operations.

If a destructive migration is intentionally required (e.g., during a contract cleanup phase after code removal), include an inline bypass annotation:

```sql
-- allow-destructive: Contract phase dropping deprecated legacy_column after code migration
ALTER TABLE "User" DROP COLUMN "legacy_column";
```

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
- **Forward-Only Migration Policy**: Prisma Migrate does not generate automatic `down` migrations or support automated rollbacks for applied migration files.
- **Handling Failed Migrations**:
  1. Do NOT manually edit or remove migration files that have already been executed in production.
  2. Create a compensating forward migration using `prisma migrate diff` or manual SQL to reverse desired changes safely.
  3. Mark failed migration states resolved if needed using `npx prisma migrate resolve --rolled-back [migration_name]`.

### Zero-Downtime Schema Expansion Guidance (Expand-Migrate-Contract)
For non-breaking production schema updates without service interruption, follow the **Expand-Migrate-Contract** pattern:
1. **Expand**:
   - Add new tables, nullable columns, or optional fields in a Prisma migration.
   - Do NOT drop columns, rename existing columns, or add non-null constraints without defaults in this phase.
2. **Migrate**:
   - Deploy application code that reads from/writes to both old and new schema fields (dual-writing).
   - Execute a data backfill script (`npm run db:seed` or custom backfill) to populate historic data into new fields.
3. **Contract**:
   - Once all running instances consume the new fields, deploy a subsequent migration that safely removes deprecated columns/tables.

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

## ⚠️ Safe Failure Semantics & Rollback Guidance

If a database migration fails during release execution:

1. **Pipeline Halts**: The `Release Pipeline` immediately aborts before reaching `Provider Deployment`. The existing live production container instances remain untouched and functional on the current schema.
2. **Diagnostic Signaling**: Review workflow output logs and `$GITHUB_STEP_SUMMARY` for Prisma SQL error codes or locked table status.
3. **Remediation & Rollback Commands**:
   - If a migration was partially applied or marked failed in `_prisma_migrations`, inspect the database state and use Prisma resolution CLI:
     ```bash
     # Mark a failed migration as rolled back in the database:
     npx prisma migrate resolve --rolled-back "<migration_name>"

     # OR mark a migration as applied if manually executed and verified:
     npx prisma migrate resolve --applied "<migration_name>"
     ```
4. **Re-triggering**: Re-run the `Database Migration` workflow after resolving schema or database lock issues.

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
- `GUEST_PASSCODE`: Global passcode required for guest access (default: `wedding2026`).
- `HISTORY_VERSION_LIMIT`: System limit for history retention (default: `50`).
- `S3_BUCKET`: Asset storage bucket name. *Optional.*
- `S3_REGION`: Bucket region. *Optional.*
- `S3_ACCESS_KEY_ID`: Bucket access key. *Optional.*
- `S3_SECRET_ACCESS_KEY`: Bucket secret key. *Optional.*
- `S3_ENDPOINT`: Custom S3/R2 endpoint. *Optional.*
- `S3_PUBLIC_URL`: CDN or public asset prefix. *Optional.*
