# Deployment Recipe: Google Cloud Run (Container / Serverless Target)

**Support Tier**: Tier 1 — Officially Tested & Supported Adapter  
**Target Platform**: Google Cloud Run (Fully managed serverless container runtime) with Artifact Registry, Secret Manager, and Cloud SQL PostgreSQL (or external managed PostgreSQL).

---

## Overview

Google Cloud Run provides a managed, serverless execution environment for containerized Next.js applications. It automatically scales containers from zero to handle incoming traffic, integrates natively with GCP Secret Manager, and connects securely to Cloud SQL via unix domain sockets or TCP.

---

## 1. Database Provisioning & Connection

### Provisioning Options
1.  **Google Cloud SQL (PostgreSQL 15+)**:
    Create a Cloud SQL instance in the same GCP region:
    ```bash
    gcloud sql instances create wedding-db \
        --database-version=POSTGRES_15 \
        --tier=db-f1-micro \
        --region=us-central1
    
    gcloud sql databases create wedding_db --instance=wedding-db
    gcloud sql users create wedding_user --instance=wedding-db --password="STRONG_PASSWORD"
    ```
2.  **External Managed Database (Neon / Supabase)**:
    Create a database instance on Neon or Supabase and enable connection pooling.

### Connection String Format
*   **Cloud SQL Unix Socket Connection**:
    ```env
    DATABASE_URL="postgresql://wedding_user:STRONG_PASSWORD@/wedding_db?host=/cloudsql/YOUR_PROJECT_ID:us-central1:wedding-db"
    ```
*   **Direct TCP Connection (Neon / Supabase)**:
    ```env
    DATABASE_URL="postgresql://wedding_user:STRONG_PASSWORD@ep-example.us-east-1.aws.neon.tech/wedding_db?sslmode=require"
    ```

---

## 2. Required Environment Variables

All sensitive values must be stored in **GCP Secret Manager** and attached to the Cloud Run service revision.

| Variable | Required | Source / Storage | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | Cloud Run Env Var | Set to `production`. |
| `DATABASE_URL` | Yes | Secret Manager | Connection string for Cloud SQL or external PostgreSQL. |
| `POSTGRES_URL_NON_POOLING` | No | Secret Manager | Direct connection URL for migrations when using poolers. |
| `ADMIN_PASSWORD` | Yes | Secret Manager | `scrypt:[saltBase64]:[keyBase64]` hash. |
| `ALLOWED_HOSTS` | Yes | Cloud Run Env Var | Custom domain and Cloud Run default host (e.g. `wedding.mydomain.com,*.run.app`). |
| `MULTISITE_ENABLED` | No | Cloud Run Env Var | Enable multi-tenant/multi-profile site routing (`false`). |
| `RUN_MIGRATIONS` | No | Cloud Run Env Var | Automatically run database migrations on container startup (`false`). |
| `GUEST_PASSCODE` | No | Secret Manager | Guest passcode (default `wedding2026`). |
| `HISTORY_VERSION_LIMIT` | No | Cloud Run Env Var | Retained history limit (e.g. `50`). |
| `CRON_SECRET` | No | Secret Manager | Authorization key for background cron triggers. |
| `S3_BUCKET` | Yes* | Secret Manager | Object storage bucket name for uploads. |
| `S3_REGION` | Yes* | Secret Manager | Bucket region (`us-central1` or `auto`). |
| `S3_ACCESS_KEY_ID` | Yes* | Secret Manager | HMAC / S3 API access key. |
| `S3_SECRET_ACCESS_KEY` | Yes* | Secret Manager | HMAC / S3 API secret key. |
| `S3_ENDPOINT` | No | Secret Manager | Custom endpoint for Cloudflare R2 / GCS S3 API. |
| `S3_PUBLIC_URL` | No | Secret Manager | CDN URL prefix for asset delivery. |

*\* Note: Cloud Run container filesystems are read-only and ephemeral; S3/R2 storage variables are strictly required for file uploads.*

---

## 3. Migration Mechanism

Automated schema migrations are performed **before** traffic is shifted to new Cloud Run container revisions.

### Primary Migration Path: Automated GitHub Actions CI/CD Pipeline
In the release pipeline ([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)), database migrations do not run inline. Instead, migrations are delegated to a reusable workflow ([`.github/workflows/db-migrate.yml`](../../.github/workflows/db-migrate.yml)) that executes after release artifacts are published (`publish-artifact`) and before the application container is deployed to Google Cloud Run (`deploy-provider`):

```yaml
database-migration:
  name: Execute Database Migration
  needs: publish-artifact
  uses: ./.github/workflows/db-migrate.yml
  with:
    environment: ${{ inputs.environment || 'production' }}
  secrets: inherit
```

#### Workflow Parameters & Preflight Checks
The reusable database migration workflow enforces strict preflight validation and safety controls before executing schema changes:

*   **Workflow Inputs**:
    *   `environment`: Target deployment environment (`production`, `staging`, or `development`; defaults to `'production'`).
*   **Workflow Secrets**:
    *   `DATABASE_URL` (Required): Mandatory PostgreSQL connection string. Must start with `postgres://` or `postgresql://`. When using connection poolers (such as PgBouncer or Neon pooling), configure direct, non-pooling connection strings for migration operations.
*   **Preflight Schema Compatibility Linting**:
    Executes `npm run lint:migrations` prior to running migrations. The linter validates all migration SQL in `prisma/migrations/` to prevent unannotated destructive operations (such as `DROP TABLE` or `DROP COLUMN`). Destructive DDL statements must be explicitly annotated with `-- allow-destructive: <reason>`.
*   **Database Status & Schema Drift Detection**:
    Runs `npx prisma migrate status` against the target database to check for unapplied migrations and identify schema drift before applying new changes.
*   **Execution Timeouts**:
    Executes `npx prisma migrate deploy` with guarded session options (`PGOPTIONS: "-c lock_timeout=5000ms -c statement_timeout=30000ms"`) to prevent long lock acquisition or stalled transactions from blocking deployment pipelines.

#### Migration Failure Diagnostic & Recovery Procedures
If the migration step fails during preflight linting or DDL execution, the deployment pipeline halts immediately to prevent deploying application code against an inconsistent database schema.

**Diagnostic Steps**:
1.  **Preflight Linter Failure (`lint:migrations`)**: Inspect workflow logs for destructive schema changes. If the schema change is intentional, annotate the migration SQL file in `prisma/migrations/` with `-- allow-destructive: <reason>`.
2.  **Database Connectivity & Status Failure**: Check target database network connectivity, verify that `DATABASE_URL` matches the required `postgres(ql)://` URI scheme, and check `npx prisma migrate status` output for schema drift or failed migration records.
3.  **Deploy & Timeout Failures**: Review execution logs for Prisma error codes, PostgreSQL statement timeout (`30000ms`), or table lock timeout (`5000ms`) failures caused by concurrent database traffic.

**Remediation & Rollback Commands**:
When a migration fails midway or becomes marked as failed in the database:
1.  Inspect the `_prisma_migrations` table in your target PostgreSQL database to identify the failed migration record.
2.  Resolve the migration state using the Prisma CLI from your administrative environment:
    ```bash
    # Mark a failed migration as rolled back:
    npx prisma migrate resolve --rolled-back "<failed_migration_name>"

    # OR mark a migration as applied if changes were manually verified:
    npx prisma migrate resolve --applied "<failed_migration_name>"
    ```
    *Note: The migration name must match the exact directory name recorded in the `_prisma_migrations` tracking table (e.g. `20260101000000_init`).*
3.  Re-run the database migration workflow or deployment pipeline only after confirming that the database state is healthy.
4.  Do **not** bypass migration errors or force-deploy the Cloud Run service revision while the schema is in a failed state.

### Secondary Migration Path: Cloud Run Job
Alternatively, execute a single-use Cloud Run Job before updating the service revision:
```bash
gcloud run jobs create wedding-migrate \
    --image=us-central1-docker.pkg.dev/YOUR_PROJECT/wedding-repo/app:latest \
    --command="npx" \
    --args="prisma,migrate,deploy" \
    --set-secrets=DATABASE_URL=DATABASE_URL:latest \
    --region=us-central1

gcloud run jobs execute wedding-migrate --region=us-central1 --wait
```

*Note: Operators running manual CLI migrations using Cloud Run Jobs must pass the direct (non-pooling) `DATABASE_URL` secret so Prisma can manage schema locks and migration table state directly.*

---

## 4. Asset Storage

Cloud Run containers have ephemeral, read-only root filesystems. Persistent asset storage **must** use S3-compatible object storage (Cloudflare R2, AWS S3, or Google Cloud Storage with S3 Interoperability enabled):

1. Create a Google Cloud Storage bucket or Cloudflare R2 bucket.
2. Enable Cloud Storage S3 Interoperability or obtain Cloudflare R2 API tokens.
3. Pass `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_PUBLIC_URL` as Cloud Run environment secrets.

---

## 5. Custom Domain & TLS

Google Cloud Run provides free, automatically managed TLS certificates for custom domains.

### Step-by-step Domain Setup
1. Navigate to **Cloud Run > Domain Mappings** in Google Cloud Console.
2. Click **Add Mapping**, select your Cloud Run service (`wedding-service`), and enter your domain (e.g. `wedding.mydomain.com`).
3. Add the generated `CNAME` or `A`/`AAAA` DNS records at your domain registrar.
4. Google automatically provisions and renews an SSL/TLS certificate via Let's Encrypt / Google Trust Services.

---

## 6. Build & Deploy Commands

### Automated Deployment via GitHub Actions
The repository includes `.github/workflows/deploy.yml`. Set up the following GitHub Secrets:
*   `GCP_SA_KEY`: Google Cloud Service Account JSON Key (or configure Workload Identity Federation).
*   `DATABASE_URL`: Connection string.
*   `ADMIN_PASSWORD`: Administrative password hash.

### Manual CLI Deployment
```bash
# 1. Authenticate with GCP
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# 2. Build and push container to Google Artifact Registry
gcloud builds submit --tag us-central1-docker.pkg.dev/YOUR_PROJECT_ID/wedding-repo/app:latest .

# 3. Deploy container revision to Cloud Run
gcloud run deploy wedding-service \
    --image=us-central1-docker.pkg.dev/YOUR_PROJECT_ID/wedding-repo/app:latest \
    --platform=managed \
    --region=us-central1 \
    --allow-unauthenticated \
    --add-cloudsql-instances=YOUR_PROJECT_ID:us-central1:wedding-db \
    --set-env-vars="NODE_ENV=production,ALLOWED_HOSTS=wedding.mydomain.com,*.run.app" \
    --set-secrets="DATABASE_URL=DATABASE_URL:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest" \
    --port=3000
```

---

## 7. Health Checks

Cloud Run monitors container health via startup and liveness HTTP probes.

### Cloud Run Probes Configuration
Configure the HTTP probe to query `/api/health` on port `3000`:
```bash
gcloud run services update wedding-service \
    --region=us-central1 \
    --startup-probe-type=http \
    --startup-probe-request-path=/api/health \
    --startup-probe-port=3000 \
    --startup-probe-initial-delay=5s \
    --startup-probe-period=10s \
    --liveness-probe-type=http \
    --liveness-probe-request-path=/api/health \
    --liveness-probe-port=3000 \
    --liveness-probe-period=30s
```

The probe verifies database query capability and returns HTTP 200 before routing live user traffic to new instances.

---

## 8. Rollback Strategy

Cloud Run maintains an immutable history of service revisions.

### Instant Traffic Rollback
To immediately revert 100% of traffic to a previous healthy container revision:
```bash
# List all revisions
gcloud run revisions list --service=wedding-service --region=us-central1

# Route 100% traffic back to previous revision
gcloud run services update-traffic wedding-service \
    --to-revisions=wedding-service-00012-abc=100 \
    --region=us-central1
```

Rollbacks execute in under 2 seconds without rebuilding images.

---

## 9. Provider-Specific Limitations

1.  **Cold Starts**: Initial HTTP requests to a scaled-to-zero instance incur 1.5–3.0s latency while container initializes. Remedy: Set `--min-instances=1`.
2.  **Stateless Filesystem**: Disk writes to `/tmp` are kept in container RAM and cleared when instances terminate. All persistent uploads must use S3/R2.
3.  **Database Connections**: High concurrency auto-scaling can exceed PostgreSQL connection limits (`max_connections`). Remedy: Enable Cloud SQL Auth Proxy connection pooling or use PgBouncer / Neon connection pooling.
4.  **Request Timeout**: Default Cloud Run request timeout is 5 minutes (configurable up to 60 minutes for bulk export/import tasks).
