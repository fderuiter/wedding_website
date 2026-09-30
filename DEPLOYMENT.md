# Pro-Grade Deployment Pipeline & Deployment Recipes

This repository includes a enterprise-grade, multi-cloud deployment architecture and multi-platform CI/CD pipeline built around a **shared runtime contract**.

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
- `ALLOWED_HOSTS`: Comma-separated list of trusted host domains or wildcard patterns allowed to access the application (e.g. `localhost,127.0.0.1,abbifred.com`). Wildcard DNS is not required for default single-site deployments. *Required.*
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

## GitHub Actions Workflows

We provide two pre-configured GitHub Actions workflows in `.github/workflows/`:

1. **CI Pipeline (`ci.yml`)**: Triggers on Pull Requests and pushes to `main`. It builds the application, runs documentation drift checks (`verify-env-docs.ts`, `generate-docs.ts`), executes unit tests, and runs end-to-end (e2e) Playwright tests.
2. **Deploy Pipeline (`deploy.yml`)**: Triggers on pushes to `main`. It automates database migrations (`npx prisma migrate deploy`) and builds multi-platform Docker container images (`linux/amd64` and `linux/arm64`).

---

## Database Migrations & Zero-Downtime Releases

Database migrations are run automatically using `npx prisma migrate deploy` in the `deploy.yml` workflow *before* the new application code goes live. Schema migrations are completely decoupled from application container boot (`docker-entrypoint.sh`), allowing application instances to start immediately without database lock contention during horizontal scaling. In local Docker Compose environments, a dedicated `migration` task service executes `npx prisma migrate deploy` before the application service starts. Before migrations are executed, a pre-migration backwards compatibility check (`npm run lint:migrations`) runs to verify zero-downtime safety.

### Expand-and-Contract Migration Strategy

Because schema migrations run before updated application container instances deploy, destructive SQL DDL operations (such as `DROP TABLE`, `DROP COLUMN`, `RENAME COLUMN`, or `DROP CONSTRAINT`) can break active application containers expecting the previous schema.

To ensure safe, zero-downtime releases, schema modifications must follow the **Expand-and-Contract** pattern across three phases:

1. **Expand Phase**: Add new tables, columns, or optional fields alongside existing ones without modifying or dropping active columns. Application code is deployed to begin writing to both old and new schema locations.
2. **Transition Phase**: Application code is updated to read from the new location while maintaining dual-writes or graceful fallbacks. Backfill historical data as necessary.
3. **Contract Phase**: Once all application instances are using the new schema and no active code references old columns or tables, a final contract migration is deployed to clean up unused database structures.

### Migration Backwards Compatibility Linter

Automated linter checks (`npm run lint:migrations`) run during local builds, in PR CI workflows (`ci.yml`), and during deployment (`deploy.yml`). The linter scans SQL migrations in `prisma/migrations/` for destructive DDL operations.

If a destructive migration is intentionally required (e.g., during a contract cleanup phase after code removal), include an inline bypass annotation:

```sql
-- allow-destructive: Contract phase dropping deprecated legacy_column after code migration
ALTER TABLE "User" DROP COLUMN "legacy_column";
```

## Multi-platform Builds

The included `Dockerfile` and `deploy.yml` are configured for multi-platform architectures (`linux/amd64` and `linux/arm64`). The build environment includes necessary system-level libraries (`openssl`) to support the application architecture safely across platforms.

## First-Run Bootstrap & Security

- **No Default Passwords:** The application does not ship with universal default admin credentials.
- **Credential Hashing:** Administrative access relies strictly on scrypt password hashing configured via `ADMIN_PASSWORD`.
- **First-Run Initialization:** When deployed with an uninitialized database, opening the app triggers the Setup Wizard. Accessing setup requires authenticating with the configured `ADMIN_PASSWORD`.
- **Replay Protection:** Once initial configuration (partner names, URL, venue, timezone) is persisted, `/api/admin/setup` rejects subsequent setup attempts from unauthenticated users with `403 Forbidden`.

## Health Checks & Liveness Probes

Containers and orchestrators query `/api/health` (returning HTTP 200 OK and database connectivity status) for liveness and readiness monitoring.

