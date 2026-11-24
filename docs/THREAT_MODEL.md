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
[Authentication & Navigation Gate: Edge Middleware (`isGuestRequest` / `getSignedGuestInviteSession` / `isAdminRequest`)]
                                       |
                                       v
[SSR Page Revocation Gate: `RootLayout` (`enforceActiveGuestPageSession` -> Prisma `InvitationCode` check)]
                                       |
                                       v
[API Route Wrapper: `withApiMiddleware` (`src/utils/withApiMiddleware.ts`)]
  |-- 1. Rate Limiter (5 failed attempts / 15m on login & `/api/guest/lookup`, 100/m general API)
  |-- 2. Authorization Check (`isAdminRequest` on protected API routes via `src/lib/routes.ts`)
  |-- 3. Invite Revocation Gate (`getGuestInviteSession` on non-excluded API routes; HTTP 401 + `maxAge: 0`)
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
3. **Password, Token, & Two-Tier Guest Session Revocation Security**:
   - `ADMIN_PASSWORD` hashed using native `scrypt` with random salt.
   - `admin_auth`, `guest_auth`, and `guest_invite_session` tokens are signed and verified via `src/core/auth/tokenCookieHelpers.ts` using HMAC SHA-256 and constant-time signature comparison (`timingSafeEqualJS`).
   - `guest_auth` (`src/core/auth/guest.server.ts`) and `guest_invite_session` (`src/core/auth/guestInviteToken.ts`) sign cookies with `GUEST_SESSION_SECRET`; both `src/env.ts` and the auth modules reject default values, secrets shorter than 32 characters in production, and secrets matching `GUEST_PASSCODE`.
   - **Tier 1 (Edge Perimeter HMAC Verification)**: `src/middleware.ts` calls `getSignedGuestInviteSession` (`src/core/auth/guestInviteToken.ts`) to verify the `guest_invite_session` HMAC signature and expiration without Prisma or Node-only dependencies, gating `/uploads/photos/*` (and `photos/` subpaths on `/api/uploads/[...path]`) directly with HTTP `401 Unauthorized` when no valid `admin_auth`, `guest_auth`, signed `guest_invite_session`, or active `guest_photo_session` cookie is present, while exempting public crawlers, non-photo `/uploads/*` / `/api/uploads/*` routes (delegated to `src/app/api/uploads/[...path]/route.ts`), and auth lifecycle endpoints (`GET /api/og`, `GET /api/admin/me`, `POST /api/admin/logout`, `/api/admin/login`, `/api/admin/setup`, `/api/guest/login`, `/api/guest/address/public`, `/api/registry/claim`, `/api/registry/validate-code`, `POST /api/registry/webhook/stripe`, and health probes).
   - **Upload Serving Session, Moderation, & Private Cache Gate**: `src/app/api/uploads/[...path]/route.ts` verifies `admin_auth`, `guest_auth`, database-active `guest_invite_session`, or (for `/uploads/photos/*`) active `guest_photo_session` cookies, permitting unauthenticated reads exclusively when the normalized path matches `AppConfig.ogImageUrl` or `AppConfig.faviconUrl` and returning HTTP `401` otherwise. Non-admin requests check PostgreSQL moderation and asset records—returning HTTP `404` for `PENDING`, `REJECTED`, hidden, or orphaned uploads—and `POST /api/guest/photos/upload` withholds `url` from `PENDING` responses. Authorized local and S3 object streams emit `Cache-Control: private, no-cache` and `Vary: Cookie` (`Cache-Control: private, no-store` for `PENDING` admin moderation previews).
   - **Tier 2 (Database `InvitationCode` Revocation)**: In the Node.js runtime, `getGuestInviteSession` and `enforceActiveGuestPageSession` (`src/core/auth/guestInviteSession.ts`) confirm the signed code still matches an active, non-sample (`isSample: false`) `InvitationCode` row in PostgreSQL. On guest-gated SSR pages (`src/app/layout.tsx`), `enforceActiveGuestPageSession` redirects revoked or deleted invitation sessions to `/guest/login` with `303 See Other` when no valid `admin_auth` or `guest_auth` cookie is present; on non-excluded API routes (`isInviteRevocationExcludedApiPath` in `src/utils/withApiMiddleware.ts`), `withApiMiddleware` rejects revoked `guest_invite_session` cookies with HTTP `401` and clears `guest_invite_session` (`maxAge: 0`) when neither `admin_auth` nor `guest_auth` is valid.
   - Constant-time SHA-256 digest comparison (`crypto.timingSafeEqual`) for guest passcode verification in `/api/guest/login` to eliminate timing side-channels.
4. **Strict Authorization & Webhook Verification**: All administrative API endpoints (including `/api/admin/*` except public auth lifecycle routes `/api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`, and `/api/admin/setup`; `/api/media`, `/api/media/[id]`, `/api/media/export`; and write/scrape `/api/registry/*` routes configured in `src/lib/routes.ts`) are gated in `withApiMiddleware` and Edge Middleware requiring valid signed admin session tokens (`isAdminRequest`). Personalized guest mutation routes (`/api/guest/address` and `/api/rsvp`) additionally require a database-verified `guest_invite_session` token (`getGuestInviteSession`), while `/api/registry/webhook/stripe` bypasses the Edge cookie gate exclusively on `POST` requests and verifies `stripe-signature` payloads via `stripe.webhooks.constructEvent` (`STRIPE_WEBHOOK_SECRET`). Edge Middleware (`src/middleware.ts`) also performs clean `303 See Other` navigation redirects for protected UI pages.
5. **Rate Limiting & Bot Honeypot Defenses**: IP- and session-based rate limiting executed inside `withApiMiddleware` (`src/utils/withApiMiddleware.ts`), stamping verified TCP socket addresses at the HTTP server boundary while gating forwarded IP headers behind `TRUST_PROXY` (`false` by default), isolating verified `admin_auth`, `guest_invite_session`, and per-login `guest_auth` session buckets on general API routes, binding failed authentication and lookup lockouts strictly by client IP (`HTTP 401`, `403`, and `404` up to 5 failed attempts per 15 minutes on `/api/admin/login`, `POST /api/admin/setup`, `/api/guest/login`, `/api/guest/lookup`, and `/api/registry/validate-code`) synchronized across instances via HMAC-SHA256 hashed keys in PostgreSQL (`AuthLockout`) with bounded local memory fail-open fallback alongside an IP-bound 100-requests-per-minute burst cap, enforcing an IP rate limit of `10` requests per `15` minutes (`public_address_collect`) plus honeypot field checks (`website`, `honeypot`, `hp_field`, `confirm_email`) on unauthenticated `POST /api/guest/address/public` ([src/app/api/guest/address/public/route.ts](../src/app/api/guest/address/public/route.ts#L12-L48)), exempting `/api/health` and `/api/live`, and normalizing dynamic API paths under the standard throttle (100 requests per minute).
6. **SSRF Protections**: Registry scraper uses `safeFetch` which resolves DNS hostnames with `{ all: true }`, blocking private IPv4, IPv6, loopback, CGNAT, link-local metadata (e.g. `169.254.169.254`), and reserved ranges across all redirect hops.
7. **File Upload Sanitization & Path Containment**: Uploaded images are passed through Sharp image processor sanitization, enforcing normalized file extensions and stripping dangerous metadata, while local asset reads, image writes, and media archive exports validate filesystem paths through [src/utils/pathContainment.ts](../src/utils/pathContainment.ts#L4-L333) (`resolveContainedExistingPath`, `resolveContainedWritePath`, `PathContainmentError`) to enforce lexical `path.relative` bounds, canonical `fs.promises.realpath` containment, and `fs.lstat` symlink-escape rejection.
8. **Log Redaction, Broadcast Safeguards, & DTO Secret Masking**: Logger automatically redacts sensitive key patterns (`password`, `passcode`, `secret`, `cookie`, `authorization`, `token`) prior to console emission, while `toPublicAppConfig` and `toAdminAppConfig` ([src/lib/config.ts](../src/lib/config.ts#L438-L590)) and `sanitizeAppConfigForBackup` ([src/lib/backupPersistence.ts](../src/lib/backupPersistence.ts#L165-L195)) strip raw email/SMS provider secrets from PostgreSQL `AppConfig` payloads. Broadcast dispatchers strip CR, LF, and angle-bracket characters from email subjects, HTML-escape template variables in HTML email bodies, exclude `address-collection` leads unless explicitly targeted, exclude `isSample: true` rows in live server execution, and restrict network-free simulation mode strictly to `emailProvider = "none"` and `smsProvider = "none"`—whereas default `emailProvider = "smtp"` (`sendSmtpEmail` in [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L957-L1014)) attempts live `node:net` / `node:tls` SMTP delivery when `smtpHost` is configured and fails closed (`{ success: false }`) when `smtpHost` is empty (see [Guest Broadcasts & Messaging](./BROADCASTS.md)).
9. **Defense in Depth & Least-Privilege Container Runtime**: Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`) enforced on all responses, production `/api/ready` responses mask internal database error details, and OCI/Compose containers enforce `root:root` immutable `/app` code ownership, stripped setuid/setgid bits, `read_only: true` root filesystems (`tmpfs` for `/tmp` and `/app/.next/cache`), `cap_drop: [ALL]`, and `no-new-privileges:true`.

---

## 4. Residual Risk Assessment & Operational Guidance

- **General In-Memory Rate Limiting**: While failed authentication lockouts synchronize across instances via PostgreSQL (`AuthLockout`), high-frequency general API browsing quotas (100 requests per minute) remain stored in bounded per-instance memory. For volumetric DDoS protection across scaled deployments, deployers should pair application limits with edge/ingress rate limiting (e.g., Cloudflare, Nginx, or AWS WAF).
- **Secret Rotation**: Deployers must set custom `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, and `ADMIN_PASSWORD` values in environment variables upon first deployment and rotate them if compromised.
