# Application Runtime Contract

This document defines the authoritative, provider-neutral runtime contract for the wedding website application. Any supported hosting infrastructure—including Docker containers, cloud container services (e.g., Google Cloud Run, AWS App Runner/ECS, Azure Container Apps), serverless hosting (e.g., Vercel), or bare-metal/VM local production environments—must satisfy the specifications described here.

---

## 1. Node.js & Next.js Standalone Runtime

- **Target Architecture**: Next.js App Router configured for standalone bundle generation (`output: 'standalone'` in `next.config.ts`).
- **Node.js Version Requirement**: Node.js **v22.x LTS** runtime (minimum v20.x, recommended v22+).
- **OCI Container Support**:
  - The official `Dockerfile` produces a multi-platform OCI image based on `node:22-bookworm-slim`.
  - Application assets and server entry point are packaged at `/app/server.js` (or `.next/standalone/server.js`).
  - Runtime container runs under a non-root system user (`nextjs:nodejs`, UID/GID 1001).

---

## 2. Network Interface, Listening Port & Host Binding

- **Listening Port**:
  - Configured via the `PORT` environment variable (defaults to `3000`).
  - The standalone server binds to all available network interfaces (`0.0.0.0`).
- **Protocol**: HTTP/1.1 or HTTP/2 unencrypted traffic internally, expecting TLS termination at the ingress/reverse-proxy layer.

---

## 3. Database Specification & PostgreSQL Policy

- **Engine**: PostgreSQL version **15.0 or higher** (tested with PostgreSQL 15-alpine and Neon serverless Postgres).
- **Driver / ORM**: Prisma ORM with `@prisma/adapter-pg` or direct TCP connections (`pg` driver).
- **Connection Strings**:
  - `DATABASE_URL`: Primary connection string used for runtime operations. Supports connection poolers (e.g., PgBouncer, Neon Connection Pooling, Supabase Pooler) or direct TCP connections.
  - `POSTGRES_URL_NON_POOLING` *(Optional)*: Direct, non-pooled connection URL used specifically during schema migration runs (`prisma migrate deploy`) when transaction/session connection pooling prevents migration locks or DDL operations.
- **Provider Neutrality**: No database-vendor specific features or proprietary extensions are required. Standard relational PostgreSQL features (tables, foreign keys, indexes, JSONB) are used.

---

## 4. Environment Variable Matrix

All runtime configuration is supplied via environment variables. The runtime validates environment variables on startup using `src/env.ts` (Zod schema).

### Mandatory Runtime Variables
| Variable | Description | Validation / Format Requirements |
|---|---|---|
| `DATABASE_URL` | Primary PostgreSQL connection URL | Must be a valid `postgresql://` or `postgres://` connection string. |
| `ADMIN_PASSWORD` | Scrypt hash for admin authentication | Must match format `scrypt:[saltBase64]:[keyBase64]` (generated via `scripts/generate-password-hash.mjs`). Plaintext passwords are rejected. |
| `ALLOWED_HOSTS` | Whitelisted host domains for request header validation | Comma-separated list of valid domain names or wildcard patterns (e.g. `localhost,127.0.0.1,abbifred.com,*.abbifred.com`). |

### Optional Infrastructure & Feature Variables
| Variable | Default Value | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime mode (`production`, `development`, `test`). Automatically set to `production` in container environments. |
| `POSTGRES_URL_NON_POOLING` | *None* | Direct non-pooled database connection string for Prisma migrations. |
| `GUEST_PASSCODE` | `wedding2026` | Passcode required for guest website access. |
| `HISTORY_VERSION_LIMIT` | `50` | Maximum version history entries retained per content item. |

### Optional Object Storage Variables (S3-Compatible)
When storing uploaded media assets externally, all core S3 credential variables must be supplied as a coherent group:
| Variable | Requirement | Description |
|---|---|---|
| `S3_BUCKET` | Required if using S3 | Target bucket name. |
| `S3_REGION` | Required if using S3 | S3 region (e.g. `us-east-1` or `auto` for Cloudflare R2). |
| `S3_ACCESS_KEY_ID` | Required if using S3 | AWS/S3 access key ID. |
| `S3_SECRET_ACCESS_KEY` | Required if using S3 | AWS/S3 secret access key. |
| `S3_ENDPOINT` | Optional | Custom S3 API endpoint URL (e.g., Cloudflare R2 endpoint or MinIO). |
| `S3_PUBLIC_URL` | Optional | Custom CDN or public asset delivery URL prefix. |

*Note: Supplying partial S3 credentials will cause startup environment validation to fail.*

---

## 5. Statelessness & Filesystem Expectations

- **Stateless Application Layer**: The application process is fully stateless and ephemeral.
- **Local Filesystem**: Any write operations to local disk (e.g., `/tmp` or `.next`) are temporary and must not be relied upon for state persistence across container restarts or horizontal scaling.
- **Data & Media Persistence**:
  - Application state, registry items, contributors, and content configurations are stored in PostgreSQL.
  - Uploaded media files are stored in S3-compatible object storage when configured.

---

## 6. Reverse Proxy & Forwarded Header Handling

The application expects to be deployed behind an HTTP reverse proxy, load balancer, or cloud ingress controller (e.g., NGINX, Cloudflare, Google Cloud Run Ingress, AWS ALB).

- **Host Header Forwarding**:
  - Proxies must pass the original requested host via the `Host` or `X-Forwarded-Host` header.
  - `middleware.ts` validates `X-Forwarded-Host` (first IP/host if comma-separated) or `Host` against `ALLOWED_HOSTS`. Requests with invalid or unapproved host headers are rejected with `HTTP 400 Bad Request`.
- **Protocol Header Forwarding**:
  - Proxies should forward `X-Forwarded-Proto` (`https` or `http`) to enable accurate canonical URL generation.

---

## 7. HTTPS Assumptions & Security Policy

- **Transport Security**: Production deployments assume HTTPS termination at the reverse proxy/ingress layer.
- **Security Headers**: Standard security headers are automatically injected on all responses via `next.config.ts`:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Frame-Options: SAMEORIGIN`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`

---

## 8. Application Lifecycle & Probes

```
 +------------------+     +-----------------------+     +-------------------+     +---------------------+
 |   Build Phase    | --> |    Migration Phase    | --> |    Start Phase    | --> |  Readiness Probes   |
 | npm run build    |     | prisma migrate deploy |     | node server.js    |     | GET /api/health     |
 +------------------+     +-----------------------+     +-------------------+     +---------------------+
```

1. **Build Phase (`npm run build`)**:
   - Executes TypeScript type checking, Prisma Client generation (`prisma generate`), and Next.js standalone build.
   - Does **not** require an active database connection. Safe for CI/CD build environments.
2. **Migration Phase (`npx prisma migrate deploy`)**:
   - Runs before application startup (executed automatically in `docker-entrypoint.sh` or deployment pipeline).
   - Applies pending database migrations safely without data loss.
3. **Start Phase (`node server.js`)**:
   - Initializes the Next.js standalone HTTP server, listens on `PORT` (`0.0.0.0`), and validates environment variables.
4. **Health & Readiness Probes**:
   - Endpoint: `GET /api/health`
   - Response: `HTTP 200 OK` with JSON `{ "status": "ok", "timestamp": "...", "database": "connected" }`.
   - Bypasses guest/admin authentication checks in `middleware.ts` to allow load balancers and orchestrators to perform probes without credentials.
5. **Graceful Shutdown**:
   - On receiving `SIGTERM` or `SIGINT`, the process stops accepting new HTTP connections, waits for ongoing requests to finish, disconnects Prisma database client instances, and exits cleanly.
