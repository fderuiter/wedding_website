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
| `GUEST_PASSCODE` | No | Secret Manager | Guest passcode (default `wedding2026`). |
| `HISTORY_VERSION_LIMIT` | No | Cloud Run Env Var | Retained history limit (e.g. `50`). |
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
In `.github/workflows/deploy.yml`, migrations run directly against `DATABASE_URL` prior to building and deploying the container image:
```yaml
- name: Run Prisma Database Migrations
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
  run: npx prisma migrate deploy
```

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
