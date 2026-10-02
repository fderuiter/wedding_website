# Deployment Recipe: Railway & Render (Low-Friction PaaS Targets)

**Support Tier**: Tier 2 — Community Supported PaaS Adapters  
**Target Platforms**: Railway.app and Render.com

---

## Overview

Platform-as-a-Service (PaaS) providers like Railway and Render offer low-friction deployment paths with managed PostgreSQL add-ons, automated Git deployments, and built-in SSL. The application deploys seamlessly to either platform using either native buildpacks or the provided root `Dockerfile`.

---

## 1. Database Provisioning & Connection

### Railway Setup
1. In the Railway Dashboard, create a new Project and select **Provision PostgreSQL**.
2. Railway automatically sets `DATABASE_URL` as a shared environment variable in format:
   ```env
   DATABASE_URL="postgresql://postgres:password@postgres.railway.internal:5432/railway"
   ```

### Render Setup
1. Create a new **New PostgreSQL** database in the Render Dashboard.
2. Copy the **Internal Database URL** (for services running inside Render) or **External Database URL**:
   ```env
   DATABASE_URL="postgres://user:password@dpg-xxxx-a.render.com/wedding_db?ssl=true"
   ```

---

## 2. Required Environment Variables

Set environment variables in the platform dashboard (Railway: **Variables** tab; Render: **Environment** tab):

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV` | Yes | Set to `production`. |
| `DATABASE_URL` | Yes | Connection string for Railway or Render PostgreSQL. |
| `POSTGRES_URL_NON_POOLING` | No | Direct connection URL for migrations if using a pooler. |
| `ADMIN_PASSWORD` | Yes | Cryptographic password hash (`scrypt:[saltBase64]:[keyBase64]`). |
| `ALLOWED_HOSTS` | Yes | Comma-separated domain whitelist (e.g. `wedding.up.railway.app,wedding.onrender.com,wedding.mydomain.com`). |
| `GUEST_PASSCODE` | No | Passcode required for guest access (default `wedding2026`). |
| `HISTORY_VERSION_LIMIT` | No | History retention limit per content entry (default `50`). |
| `S3_BUCKET` | No* | Bucket name for S3 / Cloudflare R2 asset storage. |
| `S3_REGION` | No* | Bucket region (`us-east-1` or `auto`). |
| `S3_ACCESS_KEY_ID` | No* | S3 API access key ID. |
| `S3_SECRET_ACCESS_KEY` | No* | S3 API secret access key. |
| `S3_ENDPOINT` | No | Custom S3 endpoint URL (for Cloudflare R2). |
| `S3_PUBLIC_URL` | No | CDN prefix URL for serving uploaded assets. |

*\* Note: On Render, you can alternatively mount a Render Persistent Disk at `/app/public/uploads` for local storage.*

---

## 3. Migration Mechanism

Database migrations run automatically during the pre-deployment phase before new web service code goes live.

### Railway Migration Command
In Railway **Settings > Deploy > Custom Build / Pre-deploy Command**:
```bash
npx prisma migrate deploy
```

### Render Migration Command
In Render **Web Service Settings > Release Command**:
```bash
npx prisma migrate deploy
```

---

## 4. Asset Storage

### Option A: Render Persistent Disk (Render Only)
Render allows mounting a persistent disk to preserve uploads without external object storage:
1. In Render Web Service settings, navigate to **Disks**.
2. Click **Add Disk**: Name `wedding-uploads`, Mount Path `/app/public/uploads`, Size `10 GB`.

### Option B: S3 / Cloudflare R2 Storage (Recommended for Railway & Render)
Provide `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` environment variables. Uploads will be written directly to S3/R2 and served globally.

---

## 5. Custom Domain & TLS

Both Railway and Render provide automatic TLS certificates via Let's Encrypt.

### Railway Domain Setup
1. Navigate to **Settings > Networking > Custom Domains**.
2. Enter your custom domain (e.g., `wedding.mydomain.com`).
3. Point your DNS provider's `CNAME` record to the target assigned by Railway (e.g., `xxxx.up.railway.app`).

### Render Domain Setup
1. Navigate to **Web Service Settings > Custom Domains**.
2. Click **Add Custom Domain** and enter `wedding.mydomain.com`.
3. Configure your DNS provider with the specified `CNAME` or `A` record. SSL is provisioned automatically within minutes.

---

## 6. Build & Deploy Commands

### Railway Deployment (Docker or Nixpacks)
*   **Build Provider**: Select **Docker** to use the root `Dockerfile`, or **Nixpacks**.
*   **Build Command**: `npm run build`
*   **Start Command**: `npm start` (or automatically executed via `Dockerfile` entrypoint).

### Render Deployment
*   **Environment**: Docker (uses root `Dockerfile`).
*   **Build Command**: Handled by `Dockerfile`.
*   **Start Command**: Handled by `Dockerfile`.

---

## 7. Health Checks

Both platforms support HTTP health check probes to monitor container readiness and trigger zero-downtime rolling updates.

*   **Health Check Path**: `/api/health`
*   **Railway Configuration**: In **Settings > Healthcheck Path**, enter `/api/health`.
*   **Render Configuration**: In **Web Service Settings > Health Check Path**, enter `/api/health`.

When `/api/health` returns HTTP 200 `{"status": "ok", ...}`, the platform routes live user traffic to the newly deployed container instance.

---

## 8. Rollback Strategy

### Railway Rollback
1. Open the Railway project and navigate to the **Deployments** tab.
2. Select any previous successful deployment commit.
3. Click **Redeploy** to instantly roll back live traffic to that build version.

### Render Rollback
1. In the Render Dashboard, go to **Events** or **Deploys**.
2. Locate the last known good deployment.
3. Click **Rollback** to switch traffic back to the chosen release.

---

## 9. Provider-Specific Limitations

1.  **Railway Ephemeral Disks**: Containers on Railway use ephemeral local filesystems. Local uploads will be wiped on restart unless using external S3/R2 storage.
2.  **Render Free Tier Spin-Down**: Render free web services automatically sleep after 15 minutes of inactivity, causing a 30–50 second cold start delay on the next request. Remedy: Upgrade to a paid instance ($7/mo) for 24/7 uptime.
3.  **Build Timeout**: Render free builds have a 15-minute execution cap; ensure `npm ci` and Next.js builds remain efficient.
