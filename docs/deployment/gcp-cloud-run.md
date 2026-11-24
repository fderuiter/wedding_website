# Deployment Recipe: Google Cloud Run (Container / Serverless Target)

**Support Tier**: Tier 1 — Officially Tested & Supported Adapter  
**Target Platform**: Google Cloud Run (Fully managed serverless container runtime) deploying immutable GitHub Container Registry (`ghcr.io`) OCI digests with GCP Secret Manager and Cloud SQL PostgreSQL (or external managed PostgreSQL).

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
*   **Cloud SQL Unix Socket Connection** (include `localhost` as the authority host so Prisma CLI and runtime validation resolve the `?host=/cloudsql/...` socket path cleanly; legacy empty-host `@/` socket URIs are automatically normalized to `@localhost` at runtime and in `prisma.config.ts`):
    ```env
    DATABASE_URL="postgresql://wedding_user:STRONG_PASSWORD@localhost/wedding_db?host=/cloudsql/YOUR_PROJECT_ID:us-central1:wedding-db"
    ```
*   **Direct TCP Connection (Neon / Supabase)**:
    ```env
    DATABASE_URL="postgresql://wedding_user:STRONG_PASSWORD@ep-example.us-east-1.aws.neon.tech/wedding_db?sslmode=require"
    ```

---

## 2. Cloud Run Secrets & Service Configuration

For the complete environment variable matrix, defaults, and persisted `prisma/schema.prisma` entity rules, refer to the [Application Runtime Contract](../runtime-contract.md). On Cloud Run, attach sensitive values from **GCP Secret Manager** (`--set-secrets`) and pass non-secret routing flags via `--set-env-vars`:

*   **GCP Secret Manager Secrets (`--set-secrets`)**:
    *   **Core Credentials**: `DATABASE_URL` (Cloud SQL socket or external PostgreSQL URL bound to `datasource.url` in `prisma.config.ts`), `ADMIN_PASSWORD` (`scrypt:[saltBase64]:[keyBase64]`), `GUEST_PASSCODE`, and `GUEST_SESSION_SECRET` (32+ characters, distinct from `GUEST_PASSCODE`). If `DATABASE_URL` routes through PgBouncer, store a direct PostgreSQL URL (`DATABASE_URL_DIRECT` or `POSTGRES_URL_NON_POOLING` per `prisma.config.ts`) to pass as an explicit `DATABASE_URL` override during `prisma migrate deploy`.
    *   **Object Storage (Required for Uploads)**: Because Cloud Run container filesystems are ephemeral and read-only, configure `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` (plus optional `S3_ENDPOINT` and `S3_PUBLIC_URL` for Cloudflare R2 or GCS S3 Interop).
    *   **Optional Integrations**: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (when enabling card checkout), and `CRON_SECRET` (when scheduling `/api/cron/broadcasts` via Cloud Scheduler).
*   **Cloud Run Service Environment Variables (`--set-env-vars`)**:
    *   Set `NODE_ENV=production`, `ALLOWED_HOSTS` (including your custom domain and `*.run.app`; read-only `GET` and `HEAD` probes to `/api/live`, `/api/health`, and `/api/ready` enforce syntactic `Host` validation only, so internal Cloud Run pod-IP probes require no extra `ALLOWED_HOSTS` entries), `TRUST_PROXY=2` (so rate limiting resolves client IPs across Google Cloud external load balancer and Cloud Run ingress hops), and optional `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` when paired with `STRIPE_SECRET_KEY`.

---

## 3. Migration Mechanism

Automated schema migrations are performed **before** traffic is shifted to new Cloud Run container revisions.

### Primary Migration Path: Automated GitHub Actions CI/CD Pipeline
In the release pipeline ([`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)), preflight checks (`ci-gate`, `schema-compatibility`) and container publication (`publish-artifact`) run without acquiring environment locks, and each environment stage is delegated to the reusable stage workflow ([`.github/workflows/deploy-stage.yml`](../../.github/workflows/deploy-stage.yml)). `deploy-stage.yml` holds a unified per-environment concurrency lock (`deploy-env-${{ inputs.environment }}` with `cancel-in-progress: false` and `queue: max`) across database migration ([`.github/workflows/db-migrate.yml`](../../.github/workflows/db-migrate.yml)), provider rollout ([`.github/workflows/deploy-provider.yml`](../../.github/workflows/deploy-provider.yml)), `/api/health` verification, and conditional rollback ([`.github/workflows/rollback.yml`](../../.github/workflows/rollback.yml)):

*   **Staging Tier (`staging` -> `deploy-stage.yml`)**: Acquires `deploy-env-staging` (`queue: max`) automatically after release artifacts are published (`publish-artifact`) and pre-deployment schema compatibility checks pass (`schema-compatibility`), without waiting on pending `production` reviewer approvals. Inside `deploy-stage.yml`, `database-migration` (`caller_holds_lock: true`) applies pending schema migrations to the isolated staging database before `deploy-provider` updates the staging Cloud Run container revision and `verify-deployment` runs automated health checks ([`.github/workflows/deploy-stage.yml`](../../.github/workflows/deploy-stage.yml)).
*   **Production Tier (`production` -> `deploy-stage.yml`)**: Acquires `deploy-env-production` (`queue: max`) and pauses at the mandatory GitHub Environment reviewer approval gate (`environment: production` in `.github/workflows/db-migrate.yml`) while queuing up to 100 subsequent runs in FIFO order without canceling superseded runs. Before approval, maintainers review the offline `git diff` SQL DDL summary generated by `schema-compatibility` (`NOT QUERIED`) and the live staging migration/health check results; once approved, `db-migrate.yml` (`caller_holds_lock: true`) queries live production `DATABASE_URL` via `npx tsx scripts/preflight-migration-summary.ts --require-db` (`npx prisma migrate status`) and executes `npx prisma migrate deploy` before `deploy-provider` shifts live traffic to the new Cloud Run revision ([`.github/workflows/deploy-stage.yml`](../../.github/workflows/deploy-stage.yml)).
*   **Unified Standalone & Rollback Serialization**: Standalone dispatches of `db-migrate.yml`, `deploy-provider.yml`, and `rollback.yml` (`caller_holds_lock: false`) acquire the same `deploy-env-<environment>` lock (`queue: max`) keyed on target `environment` rather than `rollback_environment`, ensuring manual `production-rollback` runs serialize against active `production` deployments while passing `caller_holds_lock: true` to nested workflows to avoid nested lock contention.

For full architectural diagrams and operational guidance, refer to the canonical release documentation in [DEPLOYMENT.md: Continuous Delivery Pipeline Architecture](../../DEPLOYMENT.md#-architecture--responsibilities) and [DEPLOYMENT.md: Staging Promotion & Approval Workflow](../../DEPLOYMENT.md#-staging-promotion--approval-workflow).

```yaml
# .github/workflows/deploy.yml — Stage caller jobs (preflight jobs run unlocked)
staging:
  name: Staging Deployment Stage
  permissions:
    actions: read
    contents: read
    packages: read
    attestations: read
    deployments: write
    id-token: write
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
    (needs.publish-artifact.result == 'success' || ((inputs.image_digest != '' || inputs.image_tag != '' || inputs.release_ref != '') && needs.publish-artifact.result == 'skipped'))
  uses: ./.github/workflows/deploy-stage.yml
  with:
    environment: 'staging'
    commit_sha: ${{ needs.ci-gate.outputs.target_sha }}
    image_digest: ${{ inputs.image_digest || needs.publish-artifact.outputs.image_digest }}
    image_tag: ${{ inputs.image_tag || needs.publish-artifact.outputs.image_tag || needs.ci-gate.outputs.target_sha }}
    previous_tag: ${{ inputs.previous_tag || '' }}
    provider: ${{ inputs.provider || 'google-cloud-run' }}
    cloud_run_service: ${{ inputs.cloud_run_service || '' }}
    cloud_run_region: ${{ inputs.cloud_run_region || '' }}
    rollback_environment: ${{ (github.event_name == 'workflow_call' && inputs.rollback_environment) || vars.STAGING_ROLLBACK_ENVIRONMENT || '' }}
    dry_run: ${{ inputs.dry_run || false }}
  secrets: inherit

production:
  name: Production Deployment Stage
  permissions:
    actions: read
    contents: read
    packages: read
    attestations: read
    deployments: write
    id-token: write
  needs: [ci-gate, publish-artifact, schema-compatibility, staging]
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
    (needs.publish-artifact.result == 'success' || ((inputs.image_digest != '' || inputs.image_tag != '' || inputs.release_ref != '') && needs.publish-artifact.result == 'skipped')) &&
    (inputs.environment == 'production' || needs.staging.result == 'success')
  uses: ./.github/workflows/deploy-stage.yml
  with:
    environment: 'production'
    commit_sha: ${{ needs.ci-gate.outputs.target_sha }}
    image_digest: ${{ inputs.image_digest || needs.publish-artifact.outputs.image_digest }}
    image_tag: ${{ inputs.image_tag || needs.publish-artifact.outputs.image_tag || needs.ci-gate.outputs.target_sha }}
    previous_tag: ${{ inputs.previous_tag || '' }}
    provider: ${{ inputs.provider || 'google-cloud-run' }}
    cloud_run_service: ${{ inputs.cloud_run_service || '' }}
    cloud_run_region: ${{ inputs.cloud_run_region || '' }}
    rollback_environment: ${{ (github.event_name == 'workflow_call' && inputs.rollback_environment) || vars.PRODUCTION_ROLLBACK_ENVIRONMENT || '' }}
    dry_run: ${{ inputs.dry_run || false }}
  secrets: inherit

# .github/workflows/deploy-stage.yml — Reusable per-environment lock & sequential jobs
concurrency:
  group: deploy-env-${{ inputs.environment }}
  cancel-in-progress: false
  queue: max

jobs:
  database-migration:
    uses: ./.github/workflows/db-migrate.yml
    with:
      environment: ${{ inputs.environment }}
      commit_sha: ${{ inputs.commit_sha }}
      confirm: true
      caller_holds_lock: true
    secrets: inherit

  deploy-provider:
    permissions:
      actions: read
      contents: read
      packages: read
      attestations: read
      deployments: write
      id-token: write
    needs: [database-migration]
    if: "!cancelled() && needs.database-migration.result == 'success'"
    uses: ./.github/workflows/deploy-provider.yml
    with:
      environment: ${{ inputs.environment }}
      commit_sha: ${{ inputs.commit_sha }}
      image_digest: ${{ inputs.image_digest }}
      image_tag: ${{ inputs.image_tag || inputs.commit_sha }}
      provider: ${{ inputs.provider || 'google-cloud-run' }}
      cloud_run_service: ${{ inputs.cloud_run_service || '' }}
      cloud_run_region: ${{ inputs.cloud_run_region || '' }}
      dry_run: ${{ inputs.dry_run || false }}
      caller_holds_lock: true
    secrets: inherit
```

#### Production Reviewer Approval Gate & Promotion
To safeguard live user traffic and database integrity, production database migrations and container deployments are gated by GitHub Environment protection rules, isolated Cloud Run targets, per-environment FIFO concurrency locks, and cryptographic OIDC provenance verification:
1. **Automated Staging Delivery & Preflight Gate**: Merging to `main` triggers schema backwards compatibility validation (`npm run lint:migrations`) and generates an offline `git diff` **Pre-Flight Schema Migration Status & SQL DDL Summary** (`NOT QUERIED`) from `prisma/migrations/` against `HEAD^1` in `$GITHUB_STEP_SUMMARY` (`schema-compatibility` runs `node --experimental-strip-types scripts/preflight-migration-summary.ts --offline` on Node.js 22 without `npm ci` or `DATABASE_URL`). `publish-artifact` builds and signs the multi-arch container image on `ghcr.io` (`queue: max`), and the `staging` stage (`deploy-stage.yml` holding `deploy-env-staging`) runs `database-migration` against staging `DATABASE_URL` and `deploy-provider` (verifying OIDC provenance via `gh attestation verify` against `.github/workflows/publish-artifact.yml` before deploying the immutable `ghcr.io/<owner>/<repo>@sha256:<hex>` digest to the isolated staging Cloud Run service `wedding-website-staging` by default, or `vars.CLOUD_RUN_SERVICE` in `vars.CLOUD_RUN_REGION`).
2. **Mandatory Human Sign-Off**: The `production` stage invokes `.github/workflows/deploy-stage.yml` (`deploy-env-production`, `queue: max`), whose `database-migration` job delegates to `.github/workflows/db-migrate.yml` configured with `environment: production`. GitHub Actions pauses the job before exposing production secrets without preventing subsequent merges from building or deploying to `staging`. Maintainers review the offline preflight DDL diff summary and live staging health check outcome before approving the deployment; after approval, `db-migrate.yml` audits live production `DATABASE_URL` (`npx tsx scripts/preflight-migration-summary.ts --require-db` running `npx prisma migrate status`), fails closed on connectivity errors, schema drift, or failed migrations, emits the live pending DDL summary, and runs `npx prisma migrate deploy`, after which `deploy-provider` re-verifies OIDC provenance for the exact `image_digest` validated in staging before updating the production Cloud Run service (`wedding-website` by default, or `vars.CLOUD_RUN_SERVICE` in `vars.CLOUD_RUN_REGION`).
3. **Automated Rollback Guarantee**: `.github/workflows/deploy.yml` and `.github/workflows/deploy-stage.yml` propagate `commit_sha` (`needs.ci-gate.outputs.target_sha`), `caller_holds_lock: true`, and job-scoped `actions: read` and `deployments: write` permissions to `.github/workflows/deploy-provider.yml` and `.github/workflows/rollback.yml`. Before updating the Cloud Run service, `.github/workflows/deploy-provider.yml` (`timeout-minutes: 10`) checks out `commit_sha` (`fetch-depth: 2`), verifies OIDC provenance and a passing `ci.yml` run for the signed `source_revision` (emitting `commit-sha=<source_revision>` Cloud Run labels ahead of `inputs.commit_sha`), and inspects the currently serving Cloud Run revision image in the resolved service and region (capturing `previous_image_digest` and extracting `previous_image_tag` from `@sha256:` revision OIDC provenance attestations, Cloud Run `commit-sha` / OCI `org.opencontainers.image.revision` labels, environment-isolated GitHub Deployments with `success` status, completed non-`dry_run` target-environment `deploy.yml` nested `deploy-stage.yml` / legacy jobs and `deploy-provider.yml` runs, or GHCR-published releases verified via `docker buildx imagetools inspect` and `HEAD^1` / commit parents relative to `commit_sha` while skipping unpublished `HEAD^1` commits). `deploy-provider.yml` creates each GitHub Deployment (`ref` and `payload.commit_sha` set to `source_revision` / `target_sha`) with `state: "in_progress"` (`auto_inactive: false`) before polling `${TARGET_URL}/api/health` (`curl --connect-timeout 5 --max-time 10`, resolving `vars.SERVICE_URL`, Cloud Run URL, and legacy `secrets.SERVICE_URL` in memory without leaking secrets to `$GITHUB_OUTPUT`), transitioning to `state: "success"` (`auto_inactive: true`) only after `/api/health` returns `HTTP 200` with `.data.status == "ok"` and `.data.database == "connected"` (or `state: "failure"` via `if: always()` on failure/cancellation). When `rollback_environment` is unset (`auto_rollback_on_failure: true`), `deploy-provider.yml` restores the prior attested image directly inside the approved job (`npm run lint:migrations` via `.nvmrc`, prior `success` deployment check, `/api/health` probe, `inline_rollback_completed=true`, and `exit 1`) without a second reviewer gate and `deploy-stage.yml` skips `rollback.yml`. When an unguarded `rollback_environment` (e.g., `production-rollback`, configured without Required Reviewers, setting `SERVICE_URL`, `CLOUD_RUN_SERVICE`, `CLOUD_RUN_REGION`, and Workload Identity Federation variables `GCP_WORKLOAD_IDENTITY_PROVIDER` / `GCP_SERVICE_ACCOUNT` via `vars.*`, or holding fallback `GCP_SA_KEY`, `GCP_PROJECT_ID`, `DEPLOY_WEBHOOK_URL`, and `DEPLOY_WEBHOOK_SECRET`) is configured, `.github/workflows/deploy-stage.yml` triggers `.github/workflows/rollback.yml` (`caller_holds_lock: true`) while continuing to hold `deploy-env-<environment>`. `rollback.yml` scopes `commit_sha` strictly to `preflight` (rejecting mutable `latest` or self-rollback against `commit_sha`, verifying a prior `success` deployment in `target_environment`, and running `npm run lint:migrations`), redeploys the previous image via `deploy-provider.yml` (`caller_holds_lock: true`, stamping the restored image's attested `source_revision`) **without requiring a second human approval gate**, and consumes `health_status` and `http_status` from `deploy-provider.yml` (with fallback `${SERVICE_URL}/api/health` polling for `HTTP 200`, `.data.status == "ok"`, `.data.database == "connected"`) without gating `verify` on `production` before reporting `SUCCESS`.

#### Workflow Parameters, Manual Dispatches & Preflight Checks
The release pipeline supports automated merges as well as manual triggers via GitHub Actions `workflow_dispatch`:

*   **Release Pipeline Manual Dispatches (`deploy.yml`)**:
    *   `environment`: Target deployment scope:
        *   `all` (default): Executes staging migration and deployment (`deploy-stage.yml` with `deploy-env-staging`), validates staging health, halts for the mandatory production reviewer approval gate (`deploy-stage.yml` with `deploy-env-production`), and promotes the identical `sha256` digest to production.
        *   `staging`: Dispatches only the `staging` stage (`deploy-stage.yml`), validating changes in the staging environment without promoting to production.
        *   `production`: Directly targets the `production` stage (`deploy-stage.yml`), bypassing staging and immediately routing to the mandatory production approval gate.
    *   `image_digest`: Optional immutable OCI image digest (`sha256:<64-hex>`) allowing production-only or manual runs to pin an existing attested artifact without rebuilding `main` `HEAD`. `ci-gate` verifies the digest's OIDC build provenance attestation (`gh attestation verify --format json` signed by `.github/workflows/publish-artifact.yml`, falling back to `org.opencontainers.image.revision` metadata) to resolve `target_sha` and checks out that exact release commit in `schema-compatibility` and `db-migrate.yml`.
    *   `image_tag`: Optional immutable release tag (`v*`, resolved to its `origin/main` `target_sha` commit for CI, `schema-compatibility`, and `db-migrate.yml` verification) or commit SHA allowing manual runs to promote an existing attested release tag without rebuilding `HEAD`.
    *   `release_ref`: Optional immutable `v*` release tag (e.g., `v0.1.0`) or 40-character commit SHA to promote after newer commits have landed on `main` (mutable `latest` is rejected; reusable `workflow_call` callers may also pass `commit_sha`). `ci-gate` resolves `release_ref` to its 40-character `target_sha` via the GitHub Commits API (verifying it matches `image_digest` provenance and `image_tag` if multiple promotion inputs are provided) so `ci-gate`, `schema-compatibility`, and `db-migrate.yml` execute against the exact tag commit rather than `main` `HEAD`.
    *   `provider`: Hosting provider adapter (defaults to `google-cloud-run`).
    *   `cloud_run_service` / `cloud_run_region`: Optional Cloud Run service and region overrides forwarded across `deploy-provider.yml` and `rollback.yml`.
    *   `previous_tag`: Optional immutable container image tag override for automated rollback if health checks fail (defaults to `previous_image_digest` / `previous_image_tag` captured before rollout by `deploy-provider.yml`; mutable `latest` and the failing `commit_sha` / `github.sha` are rejected outside explicit dry-run mode).
    *   `rollback_environment` (`workflow_call` only on `deploy.yml` and `deploy-provider.yml`; configured for automated/manual promotions via repository variables `PRODUCTION_ROLLBACK_ENVIRONMENT` / `STAGING_ROLLBACK_ENVIRONMENT` and accepted on `rollback.yml` `workflow_dispatch`): Optional unguarded GitHub Environment name (e.g., `production-rollback`) used by `rollback.yml` and `deploy-provider.yml` during `workflow_call` rollbacks to resolve provider secrets and `vars.SERVICE_URL` (`secrets.SERVICE_URL` legacy fallback) without pausing on `production` reviewer gates.
*   **Standalone Provider & Rollback Dispatches (`deploy-provider.yml` & `rollback.yml`)**:
    *   Accepts `image_digest` (`sha256:<64-hex>`) or an immutable release/commit `image_tag` (unpinned `latest` defaults are rejected), optional `source_ref` (`refs/heads/main` or `refs/tags/v*`), optional 40-character hexadecimal `commit_sha` (defaulting to `github.sha` when omitted on `workflow_dispatch`), optional `cloud_run_service`, `cloud_run_region`, and explicit `dry_run` (`false` by default; missing credentials fail closed rather than entering dry-run mode), with job-scoped `actions: read` and `deployments: write` permissions on deployment and caller jobs. Tag-only dispatches are resolved to an immutable `sha256` digest via `docker buildx imagetools inspect`, validated against `^sha256:[a-f0-9]{64}$`, and verified with `gh attestation verify` (`--owner`, `--signer-workflow`, and `--source-ref`) plus passing `ci.yml` status for the signed source revision and standalone live `origin/main` ancestry / target-environment `db-migrate.yml` checks prior to Cloud Run rollout (`rollback.yml` `preflight` also verifies that `previous_digest` / `previous_tag` does not match `CURRENT_SHA` and succeeded earlier in `target_environment` GitHub Deployments before `redeploy` starts).
    *   Exports `service_url`, `is_dry_run`, `previous_image_tag`, `previous_image_digest`, `image_digest`, `image_uri`, `attestation_status`, `cloud_run_service`, and `cloud_run_region` outputs and records them in `$GITHUB_STEP_SUMMARY` and GitHub Deployments.
*   **Standalone Database Migration Dispatches (`db-migrate.yml`)**:
    *   Operators can also invoke the reusable migration workflow directly if an out-of-band schema migration is required. Manual `workflow_dispatch` runs default `confirm` to `false` and abort immediately before touching PostgreSQL unless the operator explicitly sets `confirm: true` alongside `environment` (`production`, `staging`, or `development`).
*   **Workflow Secrets**:
    *   `DATABASE_URL` (Required by `db-migrate.yml`): Mandatory PostgreSQL connection string scoped to the respective GitHub Environment (`staging` or `production`). Must start with `postgres://` or `postgresql://`. Because `prisma.config.ts` binds `datasource.url` to `DATABASE_URL`, `npx prisma migrate deploy` always reads `DATABASE_URL`; when runtime traffic uses PgBouncer or Neon/Supabase transaction pooling, set the GitHub Environment `DATABASE_URL` secret to the direct, non-pooled PostgreSQL URL as an explicit `DATABASE_URL` override.
*   **Preflight Schema Compatibility Linting**:
    Executes `npm run lint:migrations` prior to running migrations. The linter validates all migration SQL in `prisma/migrations/` to prevent unannotated destructive operations (such as `DROP TABLE` or `DROP COLUMN`). Destructive DDL statements must be explicitly annotated with `-- allow-destructive: <reason>`.
*   **Database Status & Schema Drift Detection**:
    Runs `npx tsx scripts/preflight-migration-summary.ts --require-db` (`npx prisma migrate status`) against the target database after manual confirmation to check for unapplied migrations and fail closed with redacted diagnostics on connectivity errors (`P1001`), diverged history / schema drift, or failed migration records before applying new changes.
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
Alternatively, execute a single-use Cloud Run Job pinned to an immutable `ghcr.io` image digest before updating the `wedding-website` service revision:
```bash
IMAGE_DIGEST="sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

gcloud run jobs create wedding-migrate \
    --image="ghcr.io/fderuiter/wedding_website@${IMAGE_DIGEST}" \
    --args="./node_modules/.bin/prisma,migrate,deploy" \
    --set-cloudsql-instances=YOUR_PROJECT_ID:us-central1:wedding-db \
    --set-secrets="DATABASE_URL=DATABASE_URL_DIRECT:latest" \
    --region=us-central1

gcloud run jobs execute wedding-migrate --region=us-central1 --wait
```

*Note: Omitting `--command` preserves the container `ENTRYPOINT` (`/usr/bin/tini -s -- docker-entrypoint.sh`), which validates `DATABASE_URL`, normalizes and preserves non-empty `POSTGRES_URL_NON_POOLING` (unsetting blank values), and invokes `./node_modules/.bin/prisma migrate deploy` (`/usr/local/bin/prisma`) offline without `npx` or npm registry traffic. Attach `--set-cloudsql-instances` when connecting via Cloud SQL Auth Proxy Unix sockets (omit if using an external TCP PostgreSQL host), and bind `DATABASE_URL` in the Cloud Run Job to a direct, non-pooling PostgreSQL secret (`DATABASE_URL_DIRECT` or `DATABASE_URL` if already unpooled) as an explicit `DATABASE_URL` override to bypass PgBouncer.*

---

## 4. Asset Storage

Cloud Run containers have ephemeral, read-only root filesystems. Persistent asset storage **must** use S3-compatible object storage (Cloudflare R2, AWS S3, or Google Cloud Storage with S3 Interoperability enabled):

1. Create a Google Cloud Storage bucket, Cloudflare R2 bucket, or AWS S3 bucket.
2. Enable Cloud Storage S3 Interoperability (HMAC keys) or generate Cloudflare R2 / AWS S3 API credentials.
3. Configure the six `S3_*` variables (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, and `S3_PUBLIC_URL`) in GCP Secret Manager / Cloud Run environment settings:
   * **Google Cloud Storage (S3 Interoperability)**: Set `S3_BUCKET`, `S3_REGION=us-central1` (matching your bucket region), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://storage.googleapis.com`, and optional `S3_PUBLIC_URL`.
   * **Cloudflare R2**: Set `S3_BUCKET`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, and `S3_PUBLIC_URL=https://assets.wedding.mydomain.com` (an R2 Custom Domain or public `https://pub-<id>.r2.dev` URL; private `*.r2.cloudflarestorage.com` endpoints require `S3_PUBLIC_URL`).
   * **AWS S3**: Set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` (with `S3_ENDPOINT` omitted and `S3_PUBLIC_URL` optional for CloudFront).

---

## 5. Custom Domain & TLS

Google Cloud Run provides free, automatically managed TLS certificates for custom domains.

### Step-by-step Domain Setup
1. Navigate to **Cloud Run > Domain Mappings** in Google Cloud Console.
2. Click **Add Mapping**, select your Cloud Run service (`wedding-website`), and enter your domain (e.g. `wedding.mydomain.com`).
3. Add the generated `CNAME` or `A`/`AAAA` DNS records at your domain registrar.
4. Google automatically provisions and renews an SSL/TLS certificate via Let's Encrypt / Google Trust Services.

---

## 6. Build & Deploy Commands

### Automated Deployment via GitHub Actions
The repository includes `.github/workflows/deploy.yml`, `.github/workflows/deploy-stage.yml`, `.github/workflows/publish-artifact.yml`, `.github/workflows/db-migrate.yml`, `.github/workflows/deploy-provider.yml`, and `.github/workflows/rollback.yml`. Automated staging-to-production releases (`deploy.yml`) trigger via `workflow_run` after `CI` succeeds on `main` pushes (or via `workflow_dispatch` with optional `image_tag`, `release_ref`, or `image_digest`, resolving `target_sha` from the artifact's signed source revision or tag commit and aligning CI verification, `schema-compatibility`, and `db-migrate.yml` to that exact revision); pushing a `v*` tag triggers both `ci.yml` (queued in FIFO order via `queue: max` once per tag push without duplicate `release` triggers and skipping `deploy-docs` outside `main` pushes) and `publish-artifact.yml` (which verifies `origin/main` ancestry, polls active `ci.yml` runs, and requires passing `CI` before publishing `ghcr.io/<owner>/<repo>:<GITHUB_REF_NAME>` such as `:v0.1.0` alongside `ghcr.io/<owner>/<repo>:<sha>`, recording `org.opencontainers.image.revision` in the multi-platform OCI index before signing provenance, and updating `:latest` only when a stable SemVer tag equals or exceeds every stable repository version tag while omitting `:latest` on manual dispatches, `main` commit builds, pre-release tags, and `N-1` maintenance patches) without automatically invoking `deploy.yml`. Tagged artifacts can then be promoted via `deploy.yml` (`image_tag: v0.1.0`, `release_ref: v0.1.0`, or `image_digest`, resolving `target_sha` to the tag commit and running `schema-compatibility` and `db-migrate.yml` first before `deploy-provider.yml`), `deploy-provider.yml` (`image_tag: v0.1.0` after `db-migrate.yml`), or manual CLI deployment below:
*   **GitHub Environment Variables** (`staging`, `production`, and optional `production-rollback`):
    *   `SERVICE_URL`: Public base URL of the Cloud Run service for post-deploy and post-rollback `/api/health` verification (`vars.SERVICE_URL` primary so job outputs and deployment summaries remain unmasked; `secrets.SERVICE_URL` is supported as a legacy fallback during migration).
    *   `CLOUD_RUN_SERVICE`: Target Cloud Run service name for the environment (defaults to `wedding-website-staging` in `staging` and `wedding-website` in `production`, allowing isolated staging and production services within a single shared GCP project).
    *   `CLOUD_RUN_REGION`: Target Cloud Run region for revision capture and deployment (defaults to `us-central1`).
    *   `GCP_WORKLOAD_IDENTITY_PROVIDER`: Primary keyless OIDC **Workload Identity Federation** provider resource (`projects/<project-number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>`), used by `google-github-actions/auth` with job-scoped `id-token: write`.
    *   `GCP_SERVICE_ACCOUNT`: Google Cloud Service Account email (`<sa>@<project-id>.iam.gserviceaccount.com`) impersonated via Workload Identity Federation.
*   **GitHub Environment Secrets** (`staging`, `production`, and optional `production-rollback` without `DATABASE_URL`):
    *   `GCP_SA_KEY`: Optional legacy Google Cloud Service Account JSON Key fallback (`credentials_json`) when `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_SERVICE_ACCOUNT` are not configured. Live runs fail closed when neither Workload Identity Federation nor `GCP_SA_KEY` is present.
    *   `GCP_PROJECT_ID`: Optional Google Cloud Project ID override for `deploy-provider.yml` (automatically inferred from Workload Identity / `GCP_SERVICE_ACCOUNT` or `GCP_SA_KEY` when omitted).
    *   `DATABASE_URL`: Direct (non-pooled) PostgreSQL connection string required by `db-migrate.yml` in `staging` and `production`.
*   **GCP Secret Manager Runtime Secrets** (mounted onto the `wedding-website-staging` and `wedding-website` Cloud Run services, not stored in GitHub Actions):
    *   `DATABASE_URL`, `ADMIN_PASSWORD` (`scrypt:[saltBase64]:[keyBase64]`), `GUEST_PASSCODE` (unique non-default passcode), and `GUEST_SESSION_SECRET` (at least 32 characters and distinct from `GUEST_PASSCODE` per `src/env.ts`).

### Manual CLI Deployment
`.github/workflows/publish-artifact.yml` publishes multi-arch OCI images and OIDC build provenance attestations to `ghcr.io` (and `docker.io` when Docker Hub secrets are configured), and `.github/workflows/deploy-provider.yml` rejects mutable `:latest` tags while enforcing `--source-ref`, `ci.yml`, and `db-migrate.yml` status. Always deploy `wedding-website-staging` (staging) and `wedding-website` (production) using a verified immutable `ghcr.io` `@sha256:` digest and mount `GUEST_SESSION_SECRET` alongside the other production secrets:
```bash
# 1. Authenticate with GCP via interactive gcloud login (or service account key fallback GCP_SA_KEY)
gcloud auth activate-service-account --key-file="$GCP_SA_KEY"
gcloud config set project YOUR_PROJECT_ID

# 2. Resolve and verify the immutable ghcr.io OCI digest and OIDC source-ref for a release tag
RELEASE_TAG="v0.1.0"
IMAGE_DIGEST=$(docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "ghcr.io/fderuiter/wedding_website:${RELEASE_TAG}")
gh attestation verify "oci://ghcr.io/fderuiter/wedding_website@${IMAGE_DIGEST}" \
    --owner fderuiter \
    --signer-workflow fderuiter/wedding_website/.github/workflows/publish-artifact.yml \
    --source-ref "refs/tags/${RELEASE_TAG}"

# 3a. Deploy digest-pinned container revision to isolated staging Cloud Run service wedding-website-staging
#     Use gcloud custom delimiter syntax (`^|^`) so commas inside ALLOWED_HOSTS are not parsed as new env var keys
gcloud run deploy wedding-website-staging \
    --image="ghcr.io/fderuiter/wedding_website@${IMAGE_DIGEST}" \
    --platform=managed \
    --region=us-central1 \
    --allow-unauthenticated \
    --add-cloudsql-instances=YOUR_PROJECT_ID:us-central1:wedding-staging-db \
    --set-env-vars="^|^NODE_ENV=production|TRUST_PROXY=2|ALLOWED_HOSTS=staging.wedding.mydomain.com,*.run.app" \
    --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest,GUEST_PASSCODE=GUEST_PASSCODE:latest,GUEST_SESSION_SECRET=GUEST_SESSION_SECRET:latest" \
    --port=3000

# 3b. Promote verified digest-pinned container revision to production Cloud Run service wedding-website
gcloud run deploy wedding-website \
    --image="ghcr.io/fderuiter/wedding_website@${IMAGE_DIGEST}" \
    --platform=managed \
    --region=us-central1 \
    --allow-unauthenticated \
    --add-cloudsql-instances=YOUR_PROJECT_ID:us-central1:wedding-db \
    --set-env-vars="^|^NODE_ENV=production|TRUST_PROXY=2|ALLOWED_HOSTS=wedding.mydomain.com,*.run.app" \
    --set-secrets="DATABASE_URL=DATABASE_URL:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest,GUEST_PASSCODE=GUEST_PASSCODE:latest,GUEST_SESSION_SECRET=GUEST_SESSION_SECRET:latest" \
    --port=3000
```

---

## 7. Health Checks

Cloud Run separates startup readiness from ongoing process liveness so brief Cloud SQL blips do not restart warm instances.

### Cloud Run Probes Configuration
Configure the liveness probe via `gcloud` using the composite `--liveness-probe` flag targeting `/api/live` on port `3000`:
```bash
gcloud run services update wedding-website \
    --region=us-central1 \
    --liveness-probe=httpGet.path=/api/live,httpGet.port=3000,periodSeconds=30
```

To configure both the HTTP `startupProbe` (`/api/health`, verifying PostgreSQL connectivity before serving traffic) and `livenessProbe` (`/api/live`, process liveness decoupled from PostgreSQL) together, export and apply a Knative `Service` manifest (`service.yaml`) with `gcloud run services replace`:
```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: wedding-website
spec:
  template:
    spec:
      containers:
        - image: ghcr.io/fderuiter/wedding_website@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          ports:
            - containerPort: 3000
          startupProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
          livenessProbe:
            httpGet:
              path: /api/live
              port: 3000
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
```

```bash
gcloud run services replace service.yaml --region=us-central1
```

Read-only (`GET` and `HEAD`) probe requests to `/api/live`, `/api/health`, and `/api/ready` enforce syntactic `Host` validation only in `src/middleware.ts`, so Cloud Run's internal pod/link-local `Host` headers (e.g., `169.254.1.1:3000`) succeed without adding internal probe IPs to `ALLOWED_HOSTS`. The startup probe (and `.github/workflows/deploy.yml` / `.github/workflows/rollback.yml` rollout checks) verifies database query capability via `/api/health` before routing live user traffic to new instances, while `/api/live` returns HTTP 200 `{ "status": "alive", "timestamp": "..." }` without querying PostgreSQL so transient database blips do not trigger container restart loops.

---

## 8. Rollback Strategy

Cloud Run maintains an immutable history of service revisions.

### Instant Traffic Rollback
To immediately revert 100% of traffic on `wedding-website` to a previous healthy container revision:
```bash
# List all revisions
gcloud run revisions list --service=wedding-website --region=us-central1

# Route 100% traffic back to previous revision
gcloud run services update-traffic wedding-website \
    --to-revisions=wedding-website-00012-abc=100 \
    --region=us-central1
```

Rollbacks execute in under 2 seconds without rebuilding images.

---

## 9. Webhooks & Scheduled Background Jobs

### Stripe `payment_intent.succeeded` Webhook
1. Store `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (`whsec_...`) in **GCP Secret Manager** and set `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` on the Cloud Run service revision.
2. In **Stripe Dashboard > Developers > Webhooks**, add endpoint `https://wedding.mydomain.com/api/registry/webhook/stripe` (matching `ALLOWED_HOSTS`) subscribed to **`payment_intent.succeeded`**.
3. `src/middleware.ts` exempts `/api/registry/webhook/stripe` from session cookies while enforcing `ALLOWED_HOSTS`, and the route handler verifies `stripe-signature` against `STRIPE_WEBHOOK_SECRET`.

### Cloud Scheduler Broadcast Cron (`CRON_SECRET`)
1. Store `CRON_SECRET` in **GCP Secret Manager** and mount `--set-secrets="CRON_SECRET=CRON_SECRET:latest"` on `wedding-website`.
2. Create a **Google Cloud Scheduler** HTTP job that calls `/api/cron/broadcasts` with `Authorization: Bearer <CRON_SECRET>`:
   ```bash
   gcloud scheduler jobs create http wedding-broadcasts \
       --location=us-central1 \
       --schedule="*/5 * * * *" \
       --uri="https://wedding.mydomain.com/api/cron/broadcasts" \
       --http-method=POST \
       --headers="Authorization=Bearer YOUR_CRON_SECRET"
   ```

---

## 10. Provider-Specific Limitations

1.  **Cold Starts**: Initial HTTP requests to a scaled-to-zero instance incur 1.5–3.0s latency while container initializes. Remedy: Set `--min-instances=1`.
2.  **Stateless Filesystem**: Disk writes to `/tmp` are kept in container RAM and cleared when instances terminate. All persistent uploads must use S3/R2.
3.  **Database Connections**: High concurrency auto-scaling can exceed PostgreSQL connection limits (`max_connections`). Remedy: Enable Cloud SQL Auth Proxy connection pooling or use PgBouncer / Neon connection pooling.
4.  **Request Timeout**: Default Cloud Run request timeout is 5 minutes (configurable up to 60 minutes for bulk export/import tasks).
