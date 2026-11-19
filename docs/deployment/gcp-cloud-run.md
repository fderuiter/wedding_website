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
| `GUEST_SESSION_SECRET` | Yes | Secret Manager | Dedicated server secret for guest invitation session signing (min 32 characters, distinct from `GUEST_PASSCODE`). |
| `HISTORY_VERSION_LIMIT` | No | Cloud Run Env Var | Retained history limit (e.g. `50`). |
| `CRON_SECRET` | No | Secret Manager | Authorization key for background cron triggers. |
| `S3_BUCKET` | Yes* | Secret Manager | Object storage bucket name for uploads. |
| `S3_REGION` | Yes* | Secret Manager | Bucket region (`us-central1` or `auto`). |
| `S3_ACCESS_KEY_ID` | Yes* | Secret Manager | HMAC / S3 API access key. |
| `S3_SECRET_ACCESS_KEY` | Yes* | Secret Manager | HMAC / S3 API secret key. |
| `S3_ENDPOINT` | No | Secret Manager | Custom endpoint for Cloudflare R2 / GCS S3 API. |
| `S3_PUBLIC_URL` | No | Secret Manager | CDN URL prefix for asset delivery. |
| `STRIPE_SECRET_KEY` | No | Secret Manager | Server-side Stripe secret key (`sk_...` / `rk_...`), paired with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` for card checkout. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | Cloud Run Env Var | Client-side Stripe publishable key (`pk_...`), paired with `STRIPE_SECRET_KEY` for card checkout. |
| `STRIPE_WEBHOOK_SECRET` | No | Secret Manager | Stripe webhook signing secret (`whsec_...`) for `/api/registry/webhook/stripe`. |

*\* Note: Cloud Run container filesystems are read-only and ephemeral; S3/R2 storage variables are strictly required for file uploads.*

---

## 3. Migration Mechanism

Automated schema migrations are performed **before** traffic is shifted to new Cloud Run container revisions.

### Primary Migration Path: Automated GitHub Actions CI/CD Pipeline
In the release pipeline ([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)), database migrations do not run inline. Instead, the release pipeline implements a two-tier staged release architecture that isolates **staging** and **production** database environments. Database migrations are delegated to a reusable workflow ([`.github/workflows/db-migrate.yml`](../../.github/workflows/db-migrate.yml)) executed prior to deploying application container revisions to Google Cloud Run in each respective tier:

*   **Staging Tier (`staging-database-migration`)**: Executes automatically after release artifacts are published (`publish-artifact`) and pre-deployment schema compatibility checks pass (`schema-compatibility`). It applies pending schema migrations to the isolated staging database before `staging-deploy-provider` updates the staging Cloud Run container revision and runs automated health checks ([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)).
*   **Production Tier (`production-database-migration`)**: Protected by a mandatory GitHub Environment reviewer approval gate (`environment: production`). Once designated maintainers review the pre-flight schema migration status and verify staging health check results, the migration executes against the live production database before `production-deploy-provider` shifts live traffic to the new Cloud Run revision ([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)).

For full architectural diagrams and operational guidance, refer to the canonical release documentation in [DEPLOYMENT.md: Continuous Delivery Pipeline Architecture](../../DEPLOYMENT.md#continuous-delivery-pipeline-architecture) and [DEPLOYMENT.md: Staging Promotion & Approval Workflow](../../DEPLOYMENT.md#staging-promotion--approval-workflow).

```yaml
# Staging Environment Pipeline (Automated via workflow_run after CI succeeds on main push)
staging-database-migration:
  name: Staging Database Migration
  needs: [ci-gate, publish-artifact, schema-compatibility]
  if: |
    !cancelled() &&
    (
      (
        github.event_name == 'workflow_run' &&
        github.event.workflow_run.conclusion == 'success' &&
        github.event.workflow_run.event == 'push' &&
        github.event.workflow_run.head_repository.full_name == github.repository
      ) ||
      (
        (github.event_name == 'workflow_dispatch' || github.event_name == 'workflow_call') &&
        (inputs.environment == 'all' || inputs.environment == 'staging' || inputs.environment == '')
      )
    ) &&
    (needs.ci-gate.result == 'success') &&
    (needs.schema-compatibility.result == 'success') &&
    (needs.publish-artifact.result == 'success' || (inputs.image_digest != '' && needs.publish-artifact.result == 'skipped'))
  uses: ./.github/workflows/db-migrate.yml
  with:
    environment: 'staging'
    commit_sha: ${{ needs.ci-gate.outputs.target_sha }}
  secrets: inherit

staging-deploy-provider:
  name: Staging Provider Deployment
  permissions:
    contents: read
    packages: read
    attestations: read
  needs: [ci-gate, publish-artifact, staging-database-migration]
  if: |
    !cancelled() &&
    (
      (
        github.event_name == 'workflow_run' &&
        github.event.workflow_run.conclusion == 'success' &&
        github.event.workflow_run.event == 'push' &&
        github.event.workflow_run.head_repository.full_name == github.repository
      ) ||
      (
        (github.event_name == 'workflow_dispatch' || github.event_name == 'workflow_call') &&
        (inputs.environment == 'all' || inputs.environment == 'staging' || inputs.environment == '')
      )
    ) &&
    (needs.ci-gate.result == 'success') &&
    (needs.staging-database-migration.result == 'success') &&
    (needs.publish-artifact.result == 'success' || (inputs.image_digest != '' && needs.publish-artifact.result == 'skipped'))
  uses: ./.github/workflows/deploy-provider.yml
  with:
    environment: 'staging'
    image_digest: ${{ inputs.image_digest || needs.publish-artifact.outputs.image_digest }}
    image_tag: ${{ needs.publish-artifact.outputs.image_tag || needs.ci-gate.outputs.target_sha }}
    provider: ${{ inputs.provider || 'google-cloud-run' }}
  secrets: inherit

# Production Environment Pipeline (Mandatory Reviewer Gate & Promotion)
production-database-migration:
  name: Production Database Migration
  needs: [ci-gate, publish-artifact, schema-compatibility, staging-verify-deployment]
  if: |
    !cancelled() &&
    (
      (
        github.event_name == 'workflow_run' &&
        github.event.workflow_run.conclusion == 'success' &&
        github.event.workflow_run.event == 'push' &&
        github.event.workflow_run.head_repository.full_name == github.repository
      ) ||
      (
        (github.event_name == 'workflow_dispatch' || github.event_name == 'workflow_call') &&
        (inputs.environment == 'all' || inputs.environment == 'production' || inputs.environment == '')
      )
    ) &&
    (needs.ci-gate.result == 'success') &&
    (needs.schema-compatibility.result == 'success') &&
    (needs.publish-artifact.result == 'success' || (inputs.image_digest != '' && needs.publish-artifact.result == 'skipped')) &&
    (inputs.environment == 'production' || needs.staging-verify-deployment.result == 'success')
  uses: ./.github/workflows/db-migrate.yml
  with:
    environment: 'production'
    commit_sha: ${{ needs.ci-gate.outputs.target_sha }}
  secrets: inherit

production-deploy-provider:
  name: Production Provider Deployment
  permissions:
    contents: read
    packages: read
    attestations: read
  needs: [ci-gate, publish-artifact, staging-verify-deployment, production-database-migration]
  if: |
    !cancelled() &&
    (
      (
        github.event_name == 'workflow_run' &&
        github.event.workflow_run.conclusion == 'success' &&
        github.event.workflow_run.event == 'push' &&
        github.event.workflow_run.head_repository.full_name == github.repository
      ) ||
      (
        (github.event_name == 'workflow_dispatch' || github.event_name == 'workflow_call') &&
        (inputs.environment == 'all' || inputs.environment == 'production' || inputs.environment == '')
      )
    ) &&
    (needs.ci-gate.result == 'success') &&
    (needs.publish-artifact.result == 'success' || (inputs.image_digest != '' && needs.publish-artifact.result == 'skipped')) &&
    (needs.production-database-migration.result == 'success') &&
    (inputs.environment == 'production' || needs.staging-verify-deployment.result == 'success')
  uses: ./.github/workflows/deploy-provider.yml
  with:
    environment: 'production'
    image_digest: ${{ inputs.image_digest || needs.publish-artifact.outputs.image_digest }}
    image_tag: ${{ needs.publish-artifact.outputs.image_tag || needs.ci-gate.outputs.target_sha }}
    provider: ${{ inputs.provider || 'google-cloud-run' }}
  secrets: inherit
```

#### Production Reviewer Approval Gate & Promotion
To safeguard live user traffic and database integrity, production database migrations and container deployments are gated by GitHub Environment protection rules and cryptographic OIDC provenance verification:
1. **Automated Staging Delivery & Preflight Gate**: Merging to `main` triggers schema backwards compatibility validation (`npm run lint:migrations`) and generates a **Pre-Flight Schema Migration Status & SQL DDL Summary** in `$GITHUB_STEP_SUMMARY`. `publish-artifact` builds and signs the multi-arch container image, and `staging-deploy-provider` verifies OIDC provenance via `gh attestation verify` against `.github/workflows/publish-artifact.yml` before deploying the immutable `ghcr.io/<owner>/<repo>@sha256:<hex>` digest to Cloud Run.
2. **Mandatory Human Sign-Off**: The `production-database-migration` job delegates to `.github/workflows/db-migrate.yml` configured with `environment: production`. GitHub Actions pauses the pipeline and notifies designated maintainers. Maintainers review the preflight schema summary, altered tables/columns, and staging health check outcome before approving the deployment, after which `production-deploy-provider` re-verifies OIDC provenance for the exact `image_digest` validated in staging before updating the production Cloud Run service.
3. **Automated Rollback Guarantee**: Before updating the Cloud Run service, `.github/workflows/deploy-provider.yml` inspects the currently serving Cloud Run revision image (capturing `previous_image_digest` and `previous_image_tag`, falling back to the last successful release commit SHA). If the staging or production post-deployment health check (`/api/health`) fails after deployment, `.github/workflows/deploy.yml` automatically triggers `.github/workflows/rollback.yml` with the captured `previous_image_digest`, `previous_image_tag`, `provider`, and optional unguarded `rollback_environment` (e.g., `production-rollback`, configured without Required Reviewers and holding `GCP_SA_KEY`, `GCP_PROJECT_ID`, `DEPLOY_WEBHOOK_URL`, and `SERVICE_URL`). `rollback.yml` rejects mutable `latest` or the failing `github.sha`, verifies `npm run lint:migrations`, redeploys the previous image via `deploy-provider.yml` (including OIDC provenance verification) **without requiring a second human approval gate**, and polls `${SERVICE_URL}/api/health` (`HTTP 200`, `status == "ok"`, `database == "connected"`) before reporting `SUCCESS`.

#### Workflow Parameters, Manual Dispatches & Preflight Checks
The release pipeline supports automated merges as well as manual triggers via GitHub Actions `workflow_dispatch`:

*   **Release Pipeline Manual Dispatches (`deploy.yml`)**:
    *   `environment`: Target deployment scope:
        *   `all` (default): Executes staging migration and deployment, validates staging health, halts for the mandatory production reviewer approval gate, and promotes the identical `sha256` digest to production.
        *   `staging`: Dispatches only `staging-database-migration` and `staging-deploy-provider`, validating changes in the staging environment without promoting to production.
        *   `production`: Directly targets `production-database-migration` and `production-deploy-provider`, bypassing staging and immediately routing to the mandatory production approval gate.
    *   `image_digest`: Optional immutable OCI image digest (`sha256:<64-hex>`) allowing production-only or manual runs to pin an existing attested artifact without rebuilding HEAD.
    *   `provider`: Hosting provider adapter (defaults to `google-cloud-run`).
    *   `previous_tag`: Optional immutable container image tag override for automated rollback if health checks fail (defaults to `previous_image_digest` / `previous_image_tag` captured before rollout by `deploy-provider.yml`; mutable `latest` and the failing `github.sha` are rejected outside explicit dry-run mode).
    *   `rollback_environment`: Optional unguarded GitHub Environment name (e.g., `production-rollback`, or configured via repository variable `PRODUCTION_ROLLBACK_ENVIRONMENT`) used by `rollback.yml` and `deploy-provider.yml` to resolve provider and `SERVICE_URL` secrets without pausing on `production` reviewer gates.
*   **Standalone Provider Dispatches (`deploy-provider.yml`)**:
    *   Accepts `image_digest` (`sha256:<64-hex>`) or an immutable release/commit `image_tag` (unpinned `latest` defaults are rejected). Tag-only dispatches are resolved to an immutable `sha256` digest via `docker buildx imagetools inspect`, validated against `^sha256:[a-f0-9]{64}$`, and verified with `gh attestation verify` (`--owner` and `--signer-workflow`) prior to Cloud Run rollout.
    *   Exports `service_url`, `is_dry_run`, `previous_image_tag`, `previous_image_digest`, `image_digest`, `image_uri`, and `attestation_status` outputs and records them in `$GITHUB_STEP_SUMMARY`.
*   **Standalone Database Migration Dispatches (`db-migrate.yml`)**:
    *   Operators can also invoke the reusable migration workflow directly if an out-of-band schema migration is required. It accepts `environment` (`production`, `staging`, or `development`) and execution confirmation (`confirm: true`).
*   **Workflow Secrets**:
    *   `DATABASE_URL` (Required): Mandatory PostgreSQL connection string scoped to the respective GitHub Environment (`staging` or `production`). Must start with `postgres://` or `postgresql://`. When using connection poolers (such as PgBouncer or Neon pooling), configure direct, non-pooling connection strings for migration operations.
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
