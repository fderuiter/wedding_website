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
In `prisma.config.ts`, `datasource.url` is bound to `DATABASE_URL` and `datasource.shadowDatabaseUrl` is bound to `POSTGRES_URL_NON_POOLING` (used by local `prisma migrate dev`). Because `npx prisma migrate deploy` always reads `DATABASE_URL`, store both pooled and direct connection strings in Vercel Environment Variables so the build command can explicitly override `DATABASE_URL` during schema migrations:

1.  `DATABASE_URL` (Pooled Connection for Serverless Runtime):
    ```env
    DATABASE_URL="postgresql://user:pass@ep-example.us-east-1.aws.neon.tech/wedding_db?sslmode=require&pgbouncer=true"
    ```
2.  `POSTGRES_URL_NON_POOLING` (Direct Connection for Shadow DB & Explicit `DATABASE_URL` Migration Override):
    ```env
    POSTGRES_URL_NON_POOLING="postgresql://user:pass@ep-example-direct.us-east-1.aws.neon.tech/wedding_db?sslmode=require"
    ```

---

## 2. Required Environment Variables

Set environment variables in **Vercel Project Settings > Environment Variables** (applied to `Production`, `Preview`, and `Development` environments as appropriate):

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Automatically set by Vercel to `production`. |
| `DATABASE_URL` | Yes | Connection string to pooled PostgreSQL database (`datasource.url` in `prisma.config.ts`). |
| `POSTGRES_URL_NON_POOLING` | No* | Optional shadow database URL (`datasource.shadowDatabaseUrl` in `prisma.config.ts`); recommended when `DATABASE_URL` uses PgBouncer so the build command can override `DATABASE_URL` for `prisma migrate deploy`. |
| `ADMIN_PASSWORD` | Yes | Cryptographic password hash (`scrypt:[saltBase64]:[keyBase64]`). |
| `ALLOWED_HOSTS` | Yes | Comma-separated domain whitelist (e.g. `wedding.mydomain.com,*.vercel.app`). |
| `MULTISITE_ENABLED` | No | Enable subdomain-based `AppConfig` branding/profile routing (`false`). Switches `AppConfig` rows only; `prisma/schema.prisma` shares the other 14 tables across subdomains without tenant row isolation. |
| `RUN_MIGRATIONS` | No | Automatically run database migrations on container startup (`false`). |
| `TRUST_PROXY` | No | Trust `X-Forwarded-For` / `X-Real-IP` from Vercel edge ingress (`true` or hop count; default `false`). |
| `GUEST_PASSCODE` | Yes | Unique passcode required for guest access (default `wedding2026` is rejected in production). |
| `GUEST_SESSION_SECRET` | Yes | Dedicated secret for guest invitation session signing (min 32 characters, distinct from `GUEST_PASSCODE`). |
| `HISTORY_VERSION_LIMIT` | No | History retention limit per content entry (default `50`). |
| `CRON_SECRET` | No | Secret token used by Vercel Cron (`vercel.json`) to send `Authorization: Bearer <CRON_SECRET>` to `/api/cron/broadcasts`. |
| `S3_BUCKET` | Yes** | Bucket name for cloud asset storage. |
| `S3_REGION` | Yes** | Bucket region (`us-east-1` or `auto` for Cloudflare R2). |
| `S3_ACCESS_KEY_ID` | Yes** | S3 API access key ID. |
| `S3_SECRET_ACCESS_KEY` | Yes** | S3 API secret access key. |
| `S3_ENDPOINT` | No | Custom endpoint URL (for Cloudflare R2 / MinIO). |
| `S3_PUBLIC_URL` | No | Public CDN URL for serving uploaded assets. |
| `STRIPE_SECRET_KEY` | No | Server-side Stripe secret key (`sk_...` / `rk_...`), paired with `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` for card checkout. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | No | Client-side Stripe publishable key (`pk_...`), paired with `STRIPE_SECRET_KEY` for card checkout. |
| `STRIPE_WEBHOOK_SECRET` | No | Stripe webhook signing secret (`whsec_...`) for `/api/registry/webhook/stripe`. |

*\* Note: Required in practice on Vercel whenever `DATABASE_URL` uses a transaction-mode pooler (`pgbouncer=true`) so the build step can pass an explicit direct `DATABASE_URL` override to `prisma migrate deploy`.*  
*\*\* Note: Serverless functions cannot write to local disk. S3/R2 storage variables are strictly required for file upload features.*

---

## 3. Migration Mechanism

Because Vercel serverless functions do not execute container entrypoint scripts, migrations are run during the Vercel deployment build step or via a pre-deployment GitHub Actions step.

### Build Command Migration Setup
In `prisma.config.ts`, `prisma migrate deploy` reads `DATABASE_URL` (`datasource.url`), while `POSTGRES_URL_NON_POOLING` is bound to `datasource.shadowDatabaseUrl` (and Prisma 7 raises `P3025` if both resolve to the same database URL). To bypass transaction-mode PgBouncer advisory lock limitations during schema updates, pass an explicit `DATABASE_URL` override and unset `POSTGRES_URL_NON_POOLING` for the migration subprocess in Vercel **Project Settings > Build & Development Settings > Build Command**:
```bash
DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy && next build
```
Supplying `DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING` routes `prisma migrate deploy` directly to the unpooled PostgreSQL endpoint (while falling back to `prisma.config.ts`'s placeholder shadow URL) and leaves the pooled `DATABASE_URL` intact for `next build` and serverless runtime invocations.

---

## 4. Asset Storage

Serverless execution environments have ephemeral local storage (`/tmp` only). All persistent media uploads are handled via the provider-agnostic S3 storage client (`@aws-sdk/client-s3`).

1. Provision a bucket on **Cloudflare R2**, **Google Cloud Storage** (with S3 Interoperability enabled), or **AWS S3**.
2. Configure the six `S3_*` environment variables (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, and `S3_PUBLIC_URL`) in Vercel Project Settings:
   *   **Cloudflare R2**: Set `S3_BUCKET`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, and `S3_PUBLIC_URL=https://assets.wedding.mydomain.com` (an R2 Custom Domain or public `https://pub-<id>.r2.dev` URL; private `*.r2.cloudflarestorage.com` endpoints require `S3_PUBLIC_URL`).
   *   **Google Cloud Storage (S3 Interoperability)**: Enable Cloud Storage HMAC keys and set `S3_BUCKET`, `S3_REGION=us-central1` (matching your bucket region), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT=https://storage.googleapis.com`, and optional `S3_PUBLIC_URL`.
   *   **AWS S3**: Set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` (with `S3_ENDPOINT` omitted and `S3_PUBLIC_URL` optional for CloudFront).
3. Uploads streaming through `/api/admin/upload` and `/api/guest/photos/upload` write directly to object storage and generate public CDN URLs.

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
      "success": true,
      "data": {
        "status": "ok",
        "timestamp": "2026-09-30T14:30:00.000Z",
        "database": "connected"
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

## 9. Webhooks & Scheduled Background Jobs

### Stripe `payment_intent.succeeded` Webhook
1. Configure `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET` (`whsec_...`) in **Vercel Project Settings > Environment Variables**.
2. In **Stripe Dashboard > Developers > Webhooks**, register `https://wedding.mydomain.com/api/registry/webhook/stripe` (matching `ALLOWED_HOSTS`) and subscribe to **`payment_intent.succeeded`**.
3. `src/middleware.ts` exempts `/api/registry/webhook/stripe` from session cookies while enforcing `ALLOWED_HOSTS`, and the webhook handler verifies `stripe-signature` against `STRIPE_WEBHOOK_SECRET`.

### Vercel Cron for Scheduled Broadcasts (`vercel.json` & `CRON_SECRET`)
The repository includes a root [`vercel.json`](../../vercel.json) configuring Vercel Cron to invoke `/api/cron/broadcasts`:
```json
{
  "crons": [
    {
      "path": "/api/cron/broadcasts",
      "schedule": "0 14 * * *"
    }
  ]
}
```
1. Set `CRON_SECRET` (at least 16 random characters) in **Vercel Project Settings > Environment Variables** (`Production`). Vercel Cron automatically attaches `Authorization: Bearer <CRON_SECRET>` on scheduled `GET /api/cron/broadcasts` invocations, which `src/app/api/cron/broadcasts/route.ts` verifies with constant-time comparison.
2. Ensure your primary Vercel production domain (and `*.vercel.app` if applicable) is listed in `ALLOWED_HOSTS` so `src/middleware.ts` permits incoming Vercel Cron requests.
3. The default `0 14 * * *` (14:00 UTC daily) schedule is compatible with **Vercel Hobby** accounts (which cap cron frequency to once per day); **Vercel Pro / Enterprise** deployments can tighten `schedule` in `vercel.json` (e.g., `*/5 * * * *`) for near-real-time broadcast dispatch.

---

## 10. Provider-Specific Limitations

1.  **Function Execution Timeout**: Serverless functions have execution timeout limits (10s on Free, 60s on Pro, 300s on Enterprise). Long-running scraper jobs or bulk exports must finish within these bounds.
2.  **Connection Exhaustion**: Connecting directly to PostgreSQL without connection poolers (PgBouncer/Neon) will quickly exhaust database connections under concurrent traffic. Always set up connection pooling.
3.  **No Local State**: File uploads, sessions, or in-memory caches are not shared across serverless function invocations.
4.  **Vendor Isolation Policy**: To maintain vendor independence, do not import `@vercel/postgres` or `@vercel/blob` SDKs in core business code; consume the shared standard Prisma and AWS S3 SDK abstractions instead.
