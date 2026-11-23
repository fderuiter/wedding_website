# Lightweight Threat Model: Wedding Website Template

## 1. System Overview & Asset Inventory

This application is a reusable, self-hostable wedding website template built on Next.js (App Router), Prisma, PostgreSQL, and optional S3/R2 hybrid storage.

### Primary Assets
- **Administrative Access**: Admin session tokens, settings modification, content editing, database backups/restores, media uploads.
- **Guest Access & Privacy**: Guest RSVP data, registry contributions, invitation codes, hidden event details.
- **System Credentials & Secrets**: `ADMIN_PASSWORD` (scrypt hash), `GUEST_PASSCODE`, `GUEST_SESSION_SECRET` (distinct >= 32-character cookie signing secret in production), `CRON_SECRET` (scheduled job Bearer token), `DATABASE_URL` (PostgreSQL connection string), S3/R2 access keys, and provider API secrets.
- **Server Resources & Network Integrity**: Server compute/memory, internal network access (SSRF target), public file storage.

---

## 2. Threat Actors & Attack Vectors

| Threat Actor | Motivation | Primary Attack Vectors |
| :--- | :--- | :--- |
| **Unauthenticated Internet User** | Automated exploitation, vandalism, scraping | Brute-forcing guest passcode / admin password / guest invitation lookup, unauthorized `/api/cron/*` invocation, SSRF via registry link scraper, Host Header injection, file upload abuse. |
| **Authenticated Guest** | Accessing unreleased features, unauthorized edits | Privilege escalation to admin endpoints (including `/api/media` and `/api/media/[id]`), tampering with registry items. |
| **Malicious Attendee** | Forging session tokens to view or mutate other guests' private details | Attempting HMAC signature forgery using public guest passcode. Stopped by dedicated server-side session secret (`GUEST_SESSION_SECRET`, enforced >= 32 chars and `!== GUEST_PASSCODE`). |
| **Malicious Reverse Proxy / MITM** | Session hijacking, data interception | Man-in-the-Middle attacks, insecure HTTP redirect handling. |
| **Rogue Admin / Compromised Key** | Complete data exfiltration or wipeout | Bulk export/import abuse, version history wiping. |

---

## 3. Trust Boundaries & Security Controls

```
+-----------------------------------------------------------------------------------+
| UNTRUSTED INTERNET                                                                |
| (HTTP Requests, Guest Passcodes, Invitation Lookups, Cron Triggers, Scraped URLs) |
+-----------------------------------------------------------------------------------+
                                       |
                                       v
[Perimeter Control: Edge Middleware (`src/middleware.ts` — `isHostAllowed` & Probe `isHostSyntaxValid`)]
                                       |
                                       v
[Scheduled Cron Gate: Edge Middleware (`/api/cron/*` `Authorization: Bearer <CRON_SECRET>`)]
                                       |
                                       v
[Authentication & Navigation Gate: Edge Middleware (`isGuestRequest` / `getGuestInviteSession` / `isAdminRequest`)]
                                       |
                                       v
[API Route Wrapper: `withApiMiddleware` (`src/utils/withApiMiddleware.ts`)]
  |-- 1. Rate Limiter (5 requests / 15m on login & `/api/guest/lookup`, 20 / 15m on `/api/registry/validate-code`, 100/m general API)
  |-- 2. Authorization Check (`isAdminRequest` on protected API routes via `src/lib/routes.ts`)
                                       |
                                       v
[Egress Control: `safeFetch` & SSRF Guardrail (`isPrivateUrl` with DNS lookup all)]
                                       |
                                       v
+-----------------------------------------------------------------------------------+
| TRUSTED CORE SYSTEM                                                               |
| (PostgreSQL Database via Prisma, S3/R2 Storage, Audit Log Snapshots)              |
+-----------------------------------------------------------------------------------+
```

### Active Security Controls

1. **Perimeter Host Validation**: Incoming requests to all application routes, webhooks, scheduled cron endpoints, uploads, and non-read-only probe methods are filtered against `ALLOWED_HOSTS` (`isHostAllowed` in `src/utils/hostValidation.ts`) in Edge Middleware (`src/middleware.ts`) before routing, preventing HTTP Host Header poisoning and cache poisoning. Stateless read-only (`GET` and `HEAD`) health probes (`/api/live`, `/api/health`, and `/api/ready`, which never read `Host` or construct URLs and return `Cache-Control: no-store`) enforce syntactic `Host` validation (`isHostSyntaxValid`) to block empty, whitespace, comma-separated, CRLF, and invalid-port headers while permitting orchestrator/internal probe hosts (e.g., `healthcheck.railway.app`, pod IPs, and loopback).
2. **Scheduled Cron Bearer Authentication**: Edge Middleware (`src/middleware.ts`) intercepts `/api/cron` and `/api/cron/*` routes prior to cookie authentication and validates `Authorization: Bearer <CRON_SECRET>` using constant-time byte comparison (`timingSafeEqualJS`), rejecting unauthorized requests with `401 Unauthorized` in production (allowing non-empty Bearer tokens without `CRON_SECRET` only in non-production environments).
3. **Password & Token Security**:
   - `ADMIN_PASSWORD` hashed using native `scrypt` with random salt.
   - `admin_auth`, `guest_auth`, and `guest_invite_session` tokens are signed and verified via `src/core/auth/tokenCookieHelpers.ts` using HMAC SHA-256 and constant-time signature comparison (`timingSafeEqualJS`).
   - `guest_auth` (`src/core/auth/guest.server.ts`) and `guest_invite_session` (`src/core/auth/guestInviteSession.ts`) sign cookies with `GUEST_SESSION_SECRET`; both `src/env.ts` and the auth modules reject default values, secrets shorter than 32 characters in production, and secrets matching `GUEST_PASSCODE`.
   - Constant-time SHA-256 digest comparison (`crypto.timingSafeEqual`) for guest passcode verification in `/api/guest/login` to eliminate timing side-channels.
4. **Strict Authorization & Webhook Verification**: All administrative API endpoints (including `/api/admin/*`, `/api/media`, `/api/media/[id]`, `/api/media/export`, and write/scrape `/api/registry/*` routes configured in `src/lib/routes.ts`) are gated in `withApiMiddleware` and Edge Middleware requiring valid signed admin session tokens (`isAdminRequest`). Personalized guest mutation routes (`/api/guest/address` and `/api/rsvp`) additionally require a valid `guest_invite_session` token (`getGuestInviteSession`), while `/api/registry/webhook/stripe` bypasses the Edge cookie gate exclusively on `POST` requests and verifies `stripe-signature` payloads via `stripe.webhooks.constructEvent` (`STRIPE_WEBHOOK_SECRET`). Edge Middleware (`src/middleware.ts`) also performs clean `303 See Other` navigation redirects for protected UI pages.
5. **Rate Limiting**: IP- and session-based rate limiting executed inside `withApiMiddleware` (`src/utils/withApiMiddleware.ts`), stamping verified TCP socket addresses at the HTTP server boundary while gating forwarded IP headers behind `TRUST_PROXY` (`false` by default), isolating verified `admin_auth`, `guest_invite_session`, and per-login `guest_auth` session buckets on general API routes, binding failed authentication lockouts strictly by client IP (`HTTP 401`, `403`, and `404` up to 5 failed attempts per 15 minutes on `/api/admin/login`, `POST /api/admin/setup`, `/api/guest/login`, and `/api/guest/lookup`) synchronized across instances via HMAC-SHA256 hashed keys in PostgreSQL (`AuthLockout`) with bounded local memory fail-open fallback alongside an IP-bound 100-requests-per-minute burst cap, isolating registry invitation code lookups in a dedicated bounded `lookup` store (20 requests per 15 minutes by client IP on `/api/registry/validate-code`), exempting `/api/health` and `/api/live`, and normalizing dynamic API paths under the standard throttle (100 requests per minute).
6. **SSRF Protections**: Registry scraper uses `safeFetch` which resolves DNS hostnames with `{ all: true }`, blocking private IPv4, IPv6, loopback, CGNAT, link-local metadata (e.g. `169.254.169.254`), and reserved ranges across all redirect hops.
7. **File Upload Sanitization**: Uploaded images are passed through Sharp image processor sanitization, enforcing normalized file extensions and stripping dangerous metadata.
8. **Log Redaction, Broadcast Safeguards, & DTO Secret Masking**: Logger automatically redacts sensitive key patterns (`password`, `passcode`, `secret`, `cookie`, `authorization`, `token`) prior to console emission, while `toPublicAppConfig`, `sanitizeAppConfigForBackup`, and `toAdminAppConfig` ([src/lib/config.ts](../src/lib/config.ts#L436-L587)) strip raw email/SMS provider secrets from PostgreSQL `AppConfig` payloads. Broadcast dispatchers sanitize CRLF headers, HTML-escape template variables, exclude `address-collection` leads unless explicitly targeted, and keep default `smtp` / `none` providers inert without live API keys (see [Guest Broadcasts & Messaging](./BROADCASTS.md)).
9. **Defense in Depth & Least-Privilege Container Runtime**: Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`) enforced on all responses, production `/api/ready` responses mask internal database error details, and OCI/Compose containers enforce `root:root` immutable `/app` code ownership, stripped setuid/setgid bits, `read_only: true` root filesystems (`tmpfs` for `/tmp` and `/app/.next/cache`), `cap_drop: [ALL]`, and `no-new-privileges:true`.

---

## 4. Residual Risk Assessment & Operational Guidance

- **General In-Memory Rate Limiting**: While failed authentication lockouts synchronize across instances via PostgreSQL (`AuthLockout`), high-frequency general API browsing quotas (100 requests per minute) remain stored in bounded per-instance memory. For volumetric DDoS protection across scaled deployments, deployers should pair application limits with edge/ingress rate limiting (e.g., Cloudflare, Nginx, or AWS WAF).
- **Secret Rotation**: Deployers must set custom `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, and `ADMIN_PASSWORD` values in environment variables upon first deployment and rotate them if compromised.
