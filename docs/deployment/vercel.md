# Deployment Recipe: Vercel (Optional Target)

**Support Tier**: Tier 1 — Officially Tested & Supported Adapter  
**Target Platform**: Vercel Serverless Edge Platform (Node.js runtime)

---

## Overview

Vercel provides a low-friction deployment target for Next.js applications. The application architecture treats Vercel as an **optional adapter** rather than an architectural default: all core business logic, ORM access, validation, and storage mechanisms remain provider-agnostic and avoid vendor lock-in.

---

## 1. Database Provisioning & Connection

Serverless environments require connection pooling to prevent exhausting PostgreSQL client connection limits.

### Recommended Providers
*   **Neon Serverless PostgreSQL**: Provides native connection pooling (`@neondatabase/serverless` or PgBouncer mode).
*   **Supabase PostgreSQL**: Use Supabase Transaction Pooler (port `6543`).
*   **AWS Aurora Serverless v2 / RDS Proxy**: Configure RDS Proxy for connection pooling.

### Connection Configuration
Provide both pooled and direct connection strings in Vercel Environment Variables:

1.  `DATABASE_URL` (Pooled Connection for Serverless Lambdas):
    ```env
    DATABASE_URL="postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/wedding_db?sslmode=require&pgbouncer=true"
    ```
2.  `POSTGRES_URL_NON_POOLING` (Direct Connection for Schema Migrations):
    ```env
    POSTGRES_URL_NON_POOLING="postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/wedding_db?sslmode=require"
    ```

---

## 2. Required Environment Variables

Set environment variables in **Vercel Project Settings > Environment Variables** (applied to `Production`, `Preview`, and `Development` environments as appropriate):

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Automatically set by Vercel to `production`. |
| `DATABASE_URL` | Yes | Connection string to pooled PostgreSQL database. |
| `POSTGRES_URL_NON_POOLING` | Yes | Direct connection string for Prisma migrations. |
| `ADMIN_PASSWORD` | Yes | Cryptographic password hash (`scrypt:[saltBase64]:[keyBase64]`). |
| `ALLOWED_HOSTS` | Yes | Comma-separated domain whitelist (e.g. `wedding.mydomain.com,*.vercel.app`). |
| `GUEST_PASSCODE` | No | Passcode required for guest access (default `wedding2026`). |
| `HISTORY_VERSION_LIMIT` | No | History retention limit per content entry (default `50`). |
| `S3_BUCKET` | Yes* | Bucket name for cloud asset storage. |
| `S3_REGION` | Yes* | Bucket region (`us-east-1` or `auto` for Cloudflare R2). |
| `S3_ACCESS_KEY_ID` | Yes* | S3 API access key ID. |
| `S3_SECRET_ACCESS_KEY` | Yes* | S3 API secret access key. |
| `S3_ENDPOINT` | No | Custom endpoint URL (for Cloudflare R2 / MinIO). |
| `S3_PUBLIC_URL` | No | Public CDN URL for serving uploaded assets. |

*\* Note: Serverless functions cannot write to local disk. S3/R2 storage variables are strictly required for file upload features.*

---

## 3. Migration Mechanism

Because Vercel serverless functions do not execute container entrypoint scripts, migrations are run during the Vercel deployment build step or via a pre-deployment GitHub Actions step.

### Build Command Migration Setup
In Vercel **Project Settings > Build & Development Settings**, configure the custom **Build Command**:
```bash
npx prisma migrate deploy && next build
```
When `POSTGRES_URL_NON_POOLING` is present in the environment, Prisma uses the direct connection for migrations to bypass PgBouncer limitations during schema updates.

---

## 4. Asset Storage

Serverless execution environments have ephemeral local storage (`/tmp` only). All persistent media uploads are handled via the provider-agnostic S3 storage client (`@aws-sdk/client-s3`).

1. Provision a bucket on **Cloudflare R2** or **AWS S3**.
2. Configure `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_PUBLIC_URL` in Vercel Project Settings.
3. Uploads streaming through `/api/admin/upload` write directly to S3/R2 and generate public CDN URLs.

---

## 5. Custom Domain & TLS

Vercel provides automated global CDN edge routing and SSL/TLS certificate management via Let's Encrypt / DigiCert.

1. Go to **Vercel Dashboard > Project > Settings > Domains**.
2. Add your custom domain (e.g., `wedding.mydomain.com`).
3. Set the DNS record at your domain registrar:
   *   For apex domains: `A` record pointing to `76.76.21.21`.
   *   For subdomains: `CNAME` record pointing to `cname.vercel-dns.com`.
4. Vercel issues SSL certificates automatically upon DNS verification.

---

## 6. Build & Deploy Commands

### Automated Deployments via Git Integration
Connect your GitHub repository to Vercel. Pushes to the `main` branch trigger production builds automatically.

### Manual Deployment via Vercel CLI
```bash
# Install Vercel CLI
npm install -g vercel

# Authenticate and link project
vercel login
vercel link

# Pull environment variables locally for testing
vercel env pull .env.production.local

# Deploy to production
vercel --prod
```

---

## 7. Health Checks

Vercel Serverless Functions respond to HTTP requests routed to the `/api/health` endpoint.

*   **Endpoint Path**: `https://wedding.mydomain.com/api/health`
*   **Probe Mechanism**: Use external uptime monitors (BetterStack, Datadog, Healthchecks.io, or UptimeRobot) to send periodic GET requests.
*   **Expected Payload**:
    ```json
    {
      "status": "ok",
      "timestamp": "2026-09-30T14:30:00.000Z",
      "services": {
        "database": "healthy"
      }
    }
    ```

---

## 8. Rollback Strategy

Vercel stores all historical deployment artifacts indefinitely.

### Instant Rollback Procedure
1. Navigate to **Vercel Dashboard > Deployments**.
2. Locate the last known good deployment.
3. Click the `...` context menu and select **Promote to Production**.
4. Traffic is instantly switched to the selected build artifact in under 1 second.

Alternatively, execute via Vercel CLI:
```bash
vercel rollback [DEPLOYMENT_ID]
```

---

## 9. Provider-Specific Limitations

1.  **Function Execution Timeout**: Serverless functions have execution timeout limits (10s on Free, 60s on Pro, 300s on Enterprise). Long-running scraper jobs or bulk exports must finish within these bounds.
2.  **Connection Exhaustion**: Connecting directly to PostgreSQL without connection poolers (PgBouncer/Neon) will quickly exhaust database connections under concurrent traffic. Always set up connection pooling.
3.  **No Local State**: File uploads, sessions, or in-memory caches are not shared across serverless function invocations.
4.  **Vendor Isolation Policy**: To maintain vendor independence, do not import `@vercel/postgres` or `@vercel/blob` SDKs in core business code; consume the shared standard Prisma and AWS S3 SDK abstractions instead.
