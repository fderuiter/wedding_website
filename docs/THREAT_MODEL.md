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
[Cross-Origin Mutation Gate: Edge Middleware (`validateMutatingRequestOrigin` — `Sec-Fetch-Site` & `Origin`/`Referer`)]
                                       |
                                       v
[Authentication & Navigation Gate: Edge Middleware (`isGuestRequest` / `getSignedGuestInviteSession` / `isAdminRequest`)]
                                       |
                                       v
[SSR Page Revocation Gate: `RootLayout` (`enforceActiveGuestPageSession` -> Prisma `InvitationCode` check)]
                                       |
                                       v
[API Route Wrapper: `withApiMiddleware` (`src/utils/withApiMiddleware.ts`) & `createValidatedRoute`]
  |-- 0. Fetch Metadata & Canonical Origin Check (`validateMutatingRequestOrigin` -> HTTP 403 on cross-origin `POST`/`PUT`/`PATCH`/`DELETE`)
  |-- 1. Rate Limiter (5 failed attempts / 15m on login & `/api/guest/lookup`, 100/m general API)
  |-- 2. Authorization Check (`isAdminRequest` on protected API routes via `src/lib/routes.ts`)
  |-- 3. Invite Revocation Gate (`getGuestInviteSession` on non-excluded API routes; HTTP 401 + `maxAge: 0`)
  |-- 4. JSON Media-Type Gate (`assertJsonContentType` / `parseJsonRequestBody` -> HTTP 415 unless `Content-Type: application/json`)
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
3. **Password, `__Host-` Session Cookies, & Two-Tier Guest Session Revocation Security**:
   - `ADMIN_PASSWORD` hashed using native `scrypt` with random salt.
   - Over HTTPS in production (`resolveSessionCookieName` in `src/core/auth/tokenCookieHelpers.ts`), session cookies are issued with `__Host-` prefixes (`__Host-admin_auth`, `__Host-guest_auth`, `__Host-guest_invite_session`, and `__Host-guest_photo_session`), `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain` attribute so sibling subdomains cannot shadow or overwrite host-bound cookies. Plain HTTP local development and loopback test servers use unprefixed `admin_auth`, `guest_auth`, `guest_invite_session`, and `guest_photo_session` names because browsers reject `__Host-` cookies without `Secure`.
   - `admin_auth`, `guest_auth`, `guest_invite_session`, and `guest_photo_session` tokens are signed and verified via `src/core/auth/tokenCookieHelpers.ts` using HMAC SHA-256 and constant-time signature comparison (`timingSafeEqualJS`). Cookie readers (`readRequestCookieCandidates` and `findVerifiedRequestCookie` in `src/core/auth/tokenCookieHelpers.ts`, plus `getSessionOrIp` in `src/utils/rateLimit.ts`) prefer `__Host-` cookies and evaluate every matching `Cookie` header entry in order until HMAC verification succeeds, preventing cookie-tossing or path-shadowing DoS.
   - `guest_auth` (`src/core/auth/guest.server.ts`) and `guest_invite_session` (`src/core/auth/guestInviteToken.ts`) sign cookies with `GUEST_SESSION_SECRET`; both `src/env.ts` and the auth modules reject default values, secrets shorter than 32 characters in production, and secrets matching `GUEST_PASSCODE`.
   - `GET /api/registry/validate-code` is strictly read-only (returning invitation validity metadata without mutating `BroadcastRecipient` rows or emitting `Set-Cookie` headers), whereas same-origin `POST /api/registry/validate-code` (`src/app/api/registry/validate-code/route.ts`) mints the `guest_invite_session` (`__Host-guest_invite_session`) cookie and transitions `SENT` `BroadcastRecipient` rows to `VIEWED`.
   - **Tier 1 (Edge Perimeter HMAC Verification)**: `src/middleware.ts` calls `getSignedGuestInviteSession` (`src/core/auth/guestInviteToken.ts`) to verify the `guest_invite_session` / `__Host-guest_invite_session` HMAC signature and expiration without Prisma or Node-only dependencies, while exempting public crawlers and auth lifecycle endpoints (`GET /api/og`, `GET /api/admin/me`, `POST /api/admin/logout`, `/api/admin/login`, `/api/admin/setup`, `/api/guest/login`, `/api/guest/address/public`, `/api/registry/claim`, `/api/registry/validate-code`, `POST /api/registry/webhook/stripe`, `/api/uploads/*`, and health probes).
   - **Tier 2 (Database `InvitationCode` Revocation)**: In the Node.js runtime, `getGuestInviteSession` and `enforceActiveGuestPageSession` (`src/core/auth/guestInviteSession.ts`) confirm the signed code still matches an active, non-sample (`isSample: false`) `InvitationCode` row in PostgreSQL. On guest-gated SSR pages (`src/app/layout.tsx`), `enforceActiveGuestPageSession` redirects revoked or deleted invitation sessions to `/guest/login` with `303 See Other` when no valid `admin_auth` or `guest_auth` cookie is present; on non-excluded API routes (`isInviteRevocationExcludedApiPath` in `src/utils/withApiMiddleware.ts`), `withApiMiddleware` rejects revoked `guest_invite_session` cookies with HTTP `401` and clears `guest_invite_session` / `__Host-guest_invite_session` (`maxAge: 0`) when neither `admin_auth` nor `guest_auth` is valid.
   - Constant-time SHA-256 digest comparison (`crypto.timingSafeEqual`) for guest passcode verification in `/api/guest/login` to eliminate timing side-channels.
4. **Cross-Origin Mutation Defense, Media-Type Enforcement, & Strict Authorization**:
   - **Fetch Metadata & Canonical Origin Validation**: Edge Middleware (`src/middleware.ts`) and `withApiMiddleware` (`src/utils/withApiMiddleware.ts`) enforce `validateMutatingRequestOrigin` (`src/utils/hostValidation.ts`) on `POST`, `PUT`, `PATCH`, and `DELETE` requests, rejecting browser requests with HTTP `403` when `Sec-Fetch-Site` is present and equals neither `same-origin` nor `none`, or when `Origin` or `Referer` fails to match the validated canonical host. `POST /api/registry/webhook/stripe` and `/api/cron/*` are explicitly exempted because they authenticate via Stripe webhook HMAC signatures (`STRIPE_WEBHOOK_SECRET`) or `CRON_SECRET` Bearer tokens.
   - **JSON Media-Type Guard**: `createValidatedRoute` (`src/utils/createValidatedRoute.ts`) and direct JSON `POST`, `PUT`, and `PATCH` route handlers enforce `Content-Type: application/json` (`assertJsonContentType` / `parseJsonRequestBody` in `src/utils/contentType.ts`) before parsing JSON bodies, returning HTTP `415 Unsupported Media Type` for non-JSON requests such as `text/plain` form posts. Same-origin `multipart/form-data` uploads remain permitted on `/api/guest/photos/upload` (`/api/photos/upload`) and `/api/admin/upload`, and same-origin `application/x-www-form-urlencoded` form posts remain permitted on `/api/media/export` for streaming ZIP downloads.
   - **Route Authorization & Webhook Verification**: All administrative API endpoints (including `/api/admin/*` except public auth lifecycle routes `/api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me`, and `/api/admin/setup`; `/api/media`, `/api/media/[id]`, `/api/media/export`; and write/scrape `/api/registry/*` routes configured in `src/lib/routes.ts`) are gated in `withApiMiddleware` and Edge Middleware requiring valid signed admin session tokens (`isAdminRequest`). Personalized guest mutation routes (`/api/guest/address` and `/api/rsvp`) additionally require a database-verified `guest_invite_session` token (`getGuestInviteSession`), while `/api/registry/webhook/stripe` bypasses the Edge cookie gate exclusively on `POST` requests and verifies `stripe-signature` payloads via `stripe.webhooks.constructEvent` (`STRIPE_WEBHOOK_SECRET`). Edge Middleware (`src/middleware.ts`) also performs clean `303 See Other` navigation redirects for protected UI pages.
5. **Rate Limiting**: IP- and session-based rate limiting executed inside `withApiMiddleware` (`src/utils/withApiMiddleware.ts`), stamping verified TCP socket addresses at the HTTP server boundary while gating forwarded IP headers behind `TRUST_PROXY` (`false` by default), isolating verified `admin_auth`, `guest_invite_session`, and per-login `guest_auth` session buckets on general API routes, binding failed authentication and lookup lockouts strictly by client IP (`HTTP 401`, `403`, and `404` up to 5 failed attempts per 15 minutes on `/api/admin/login`, `POST /api/admin/setup`, `/api/guest/login`, `/api/guest/lookup`, and `/api/registry/validate-code`) synchronized across instances via HMAC-SHA256 hashed keys in PostgreSQL (`AuthLockout`) with bounded local memory fail-open fallback alongside an IP-bound 100-requests-per-minute burst cap, exempting `/api/health` and `/api/live`, and normalizing dynamic API paths under the standard throttle (100 requests per minute).
6. **SSRF Protections**: Registry scraper uses `safeFetch` which resolves DNS hostnames with `{ all: true }`, blocking private IPv4, IPv6, loopback, CGNAT, link-local metadata (e.g. `169.254.169.254`), and reserved ranges across all redirect hops.
7. **File Upload Sanitization**: Uploaded images are passed through Sharp image processor sanitization, enforcing normalized file extensions and stripping dangerous metadata.
8. **Log Redaction, Broadcast Safeguards, & DTO Secret Masking**: Logger automatically redacts sensitive key patterns (`password`, `passcode`, `secret`, `cookie`, `authorization`, `token`) prior to console emission, while `toPublicAppConfig`, `sanitizeAppConfigForBackup`, and `toAdminAppConfig` ([src/lib/config.ts](../src/lib/config.ts#L435-L586)) strip raw email/SMS provider secrets from PostgreSQL `AppConfig` payloads. Broadcast dispatchers sanitize CRLF headers, HTML-escape template variables, exclude `address-collection` leads unless explicitly targeted, and keep default `smtp` / `none` providers inert without live API keys (see [Guest Broadcasts & Messaging](./BROADCASTS.md)).
9. **Defense in Depth & Least-Privilege Container Runtime**: Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`) enforced on all responses, production `/api/ready` responses mask internal database error details, and OCI/Compose containers enforce `root:root` immutable `/app` code ownership, stripped setuid/setgid bits, `read_only: true` root filesystems (`tmpfs` for `/tmp` and `/app/.next/cache`), `cap_drop: [ALL]`, and `no-new-privileges:true`.

---

## 4. Residual Risk Assessment & Operational Guidance

- **General In-Memory Rate Limiting**: While failed authentication lockouts synchronize across instances via PostgreSQL (`AuthLockout`), high-frequency general API browsing quotas (100 requests per minute) remain stored in bounded per-instance memory. For volumetric DDoS protection across scaled deployments, deployers should pair application limits with edge/ingress rate limiting (e.g., Cloudflare, Nginx, or AWS WAF).
- **Secret Rotation**: Deployers must set custom `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, and `ADMIN_PASSWORD` values in environment variables upon first deployment and rotate them if compromised.
