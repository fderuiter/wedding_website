# Deployment Recipe: Generic Docker / VPS (Canonical Portable Baseline)

**Support Tier**: Tier 1 — Officially Tested & Supported Adapter  
**Target Platform**: Any Virtual Private Server (VPS) / Virtual Machine (e.g., Ubuntu, Debian, AWS EC2, DigitalOcean Droplet, Hetzner, Linode) or bare-metal host running Docker & Docker Compose.

---

## Overview

The generic Docker/VPS deployment path serves as the **canonical portable baseline** for the application. It packages the application into a self-contained, multi-platform Docker container (`linux/amd64` and `linux/arm64`) with an entrypoint script that handles automated database migrations before serving traffic.

---

## 1. Database Provisioning & Connection

### Provisioning
You can run PostgreSQL either alongside the application via Docker Compose or connect to an external managed database (such as AWS RDS, DigitalOcean Managed Database, Neon, or Supabase).

*   **Docker Compose Co-location**: Uses the official `postgres:15-alpine` image with persistent host volume mounting (`db_data:/var/lib/postgresql/data`).
*   **External PostgreSQL**: Ensure PostgreSQL v15+ is running and accessible over port `5432` with SSL/TLS enabled if remote.

### Connection String Format
Configure `DATABASE_URL` as a standard PostgreSQL URI:
```env
DATABASE_URL="postgresql://wedding_user:secure_password@db_host:5432/wedding_db?schema=public&sslmode=prefer"
```
If connecting via connection poolers (e.g. PgBouncer), provide `POSTGRES_URL_NON_POOLING` for direct schema migrations:
```env
POSTGRES_URL_NON_POOLING="postgresql://wedding_user:secure_password@db_host:5432/wedding_db?schema=public&sslmode=require"
```

---

## 2. Required Environment Variables

Configure environment variables in a `.env` file on the VPS or pass them directly to the Docker container:

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `production` | Application execution environment (`production`). |
| `DATABASE_URL` | Yes | — | Connection string for PostgreSQL database. |
| `POSTGRES_URL_NON_POOLING` | No | — | Direct PostgreSQL connection string for Prisma migrations (if `DATABASE_URL` uses a pooler). |
| `ADMIN_PASSWORD` | Yes | — | Cryptographic hash of administrative password in `scrypt:[saltBase64]:[keyBase64]` format. Generate via `node scripts/generate-password-hash.mjs "password"`. |
| `ALLOWED_HOSTS` | Yes | — | Comma-separated list of trusted host domains (e.g., `wedding.mydomain.com,localhost`). |
| `GUEST_PASSCODE` | No | `wedding2026` | Passcode required for guest website access. |
| `HISTORY_VERSION_LIMIT` | No | `50` | Maximum history versions to retain per content entry. |
| `S3_BUCKET` | No | — | Bucket name for S3 / Cloudflare R2 asset storage. |
| `S3_REGION` | No | — | Region for S3 bucket (`us-east-1` or `auto` for Cloudflare R2). |
| `S3_ACCESS_KEY_ID` | No | — | S3/R2 API access key ID. |
| `S3_SECRET_ACCESS_KEY` | No | — | S3/R2 API secret access key. |
| `S3_ENDPOINT` | No | — | Custom S3 endpoint URL (required for Cloudflare R2). |
| `S3_PUBLIC_URL` | No | — | CDN / public URL prefix for serving uploaded assets. |

---

## 3. Migration Mechanism

Database migrations are executed automatically during container initialization via `docker-entrypoint.sh`:

1. When the container starts, `docker-entrypoint.sh` checks for `DATABASE_URL`.
2. It executes `npx -y prisma migrate deploy` to safely apply pending schema migrations to the target database.
3. Once migrations complete successfully, the container executes `node server.js` to begin serving requests.

To run migrations manually from outside the container:
```bash
docker compose exec app npx prisma migrate deploy
```

---

## 4. Asset Storage

*   **Local Disk Storage (Default)**: Uploaded files are written to `/app/public/uploads`. Mount a host directory or named volume to preserve files across container redeployments:
    ```yaml
    volumes:
      - ./uploads:/app/public/uploads
    ```
*   **S3 / Cloudflare R2 Object Storage (Recommended for Multi-Instance)**: Provide all four S3 environment variables (`S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). The application will stream uploads directly to S3/R2 and serve them via `S3_PUBLIC_URL`.

---

## 5. Custom Domain & TLS

Use a reverse proxy such as **Caddy** or **Nginx** with **Let's Encrypt** on the host.

### Option A: Caddy (Automatic TLS)
Create a `Caddyfile`:
```caddy
wedding.mydomain.com {
    reverse_proxy localhost:3000
}
```

### Option B: Nginx + Certbot
```nginx
server {
    server_name wedding.mydomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Obtain TLS certificate:
```bash
sudo certbot --nginx -d wedding.mydomain.com
```

---

## 6. Build & Deploy Commands

### Initial Build & Start
```bash
# Clone repository on host
git clone https://github.com/fderuiter/wedding_website.git /opt/wedding_website
cd /opt/wedding_website

# Create production environment configuration
cp .env.example .env
nano .env # Set DATABASE_URL, ADMIN_PASSWORD, ALLOWED_HOSTS

# Build and start services in detached mode
docker compose up -d --build
```

### Deployment Update
```bash
git pull origin main
docker compose build app
docker compose up -d app
```

---

## 7. Health Checks

The application provides a built-in health check endpoint at `/api/health`.

### Docker Compose Healthcheck Configuration
Add the health check probe to `docker-compose.yml`:
```yaml
  app:
    build: .
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD-SHELL", "wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 20s
```

The `/api/health` route tests database connectivity and returns HTTP `200 OK` with payload:
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

1. **Tag Image Builds**: Tag built images with git commit hashes or release tags during deployment:
   ```bash
   docker build -t myregistry/wedding-app:v1.1.0 .
   ```
2. **Container Rollback**: Revert `docker-compose.yml` image tag or re-run the previous tag:
   ```bash
   docker compose stop app
   docker run -d --name app-rollback --env-file .env myregistry/wedding-app:v1.0.9
   ```
3. **Database Schema Rollback**: Prisma migrations are forward-only by design. Keep database schema changes backward-compatible (e.g., expand-and-contract pattern) to ensure older container versions can operate alongside migrated schemas.

---

## 9. Provider-Specific Limitations

*   **Host Dependency**: Requires managing server OS patches, Docker engine updates, and firewall rules (ports 80, 443, 22).
*   **Disk Persistence**: If using local filesystem storage, host backups must include host upload volumes.
*   **Single-Node Availability**: Without an external load balancer or swarm/k8s cluster, host maintenance causes brief downtime.
