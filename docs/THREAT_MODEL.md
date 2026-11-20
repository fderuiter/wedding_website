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
[Perimeter Control: Edge Middleware (`src/middleware.ts` — `isHostAllowed` Host Validation)]
                                       |
                                       v
[Scheduled Cron Gate: Edge Middleware (`/api/cron/*` `Authorization: Bearer <CRON_SECRET>`)]
                                       |
                                       v
[Authentication & Navigation Gate: Edge Middleware (`isGuestRequest` / `getGuestInviteSession` / `isAdminRequest`)]
                                       |
                                       v
[API Route Wrapper: `withApiMiddleware` (`src/utils/withApiMiddleware.ts`)]
  |-- 1. Rate Limiter (5 req / 15m auth lockout on login, setup, lookup & code check; 100/m general API; `session:` admin keys)
  |-- 2. Secondary Endpoint Guard (`POST /api/guest/address/public`: 10 req / 15m `public_address_collect` + honeypot)
  |-- 3. Authorization Check (`isAdminRequest` on protected API routes via `src/lib/routes.ts`)
                                       |
                                       v
[Filesystem, Egress & Content Controls]
  |-- 1. `safeFetch` & SSRF Guardrail (`validateAndResolveHost` + DNS-pinned dispatcher)
  |-- 2. `pathContainment.ts` (`resolveContainedExistingPath` / `resolveContainedWritePath` + `decodeUrlPathSafely`)
  |-- 3. Broadcast Sanitization (`escapeHtmlEntities`, `sanitizeEmailSubject`, `formatEmailHtmlBody`)
                                       |
                                       v
+-----------------------------------------------------------------------------------+
| TRUSTED CORE SYSTEM                                                               |
| (PostgreSQL Database via Prisma, S3/R2 Storage, Audit Log Snapshots)              |
+-----------------------------------------------------------------------------------+
```

### Active Security Controls

1. **Perimeter Host Validation**: All incoming requests are filtered against `ALLOWED_HOSTS` in Edge Middleware (`src/middleware.ts`) before routing, preventing HTTP Host Header poisoning and cache poisoning.
2. **Scheduled Cron Bearer Authentication**: Edge Middleware (`src/middleware.ts`) intercepts `/api/cron` and `/api/cron/*` routes prior to cookie authentication and validates `Authorization: Bearer <CRON_SECRET>` using constant-time byte comparison (`timingSafeEqualJS`), rejecting unauthorized requests with `401 Unauthorized` in production (allowing non-empty Bearer tokens without `CRON_SECRET` only in non-production environments).
3. **Password & Token Security**:
   - `ADMIN_PASSWORD` hashed using native `scrypt` with random salt.
   - `admin_auth`, `guest_auth`, and `guest_invite_session` tokens are signed and verified via `src/core/auth/tokenCookieHelpers.ts` using HMAC SHA-256 and constant-time signature comparison (`timingSafeEqualJS`).
   - `guest_auth` (`src/core/auth/guest.server.ts`) and `guest_invite_session` (`src/core/auth/guestInviteToken.ts`, re-exported via `src/core/auth/guestInviteSession.ts`) sign cookies with `GUEST_SESSION_SECRET`; both `src/env.ts` and the auth modules reject default values, secrets shorter than 32 characters in production, and secrets matching `GUEST_PASSCODE`.
   - Constant-time SHA-256 digest comparison (`crypto.timingSafeEqual`) for guest passcode verification in `/api/guest/login` to eliminate timing side-channels.
4. **Strict Authorization**: All administrative API endpoints (including `/api/admin/*`, `/api/media`, `/api/media/[id]`, `/api/media/export`, and write/scrape `/api/registry/*` routes configured in `src/lib/routes.ts`) are gated in `withApiMiddleware` and Edge Middleware requiring valid signed admin session tokens (`isAdminRequest`). Edge Middleware (`src/middleware.ts`) also performs clean `303 See Other` navigation redirects for protected UI pages.
5. **Rate Limiting, `TRUST_PROXY`, & Public Submission Throttling**:
   - **Auth & General Buckets**: `withApiMiddleware` ([src/utils/withApiMiddleware.ts](../src/utils/withApiMiddleware.ts#L22-L31)) and `isAuthLockoutRoute` ([src/utils/rateLimit.ts](../src/utils/rateLimit.ts#L101-L111)) isolate authentication and lookup lockouts (**5 attempts per 15 minutes** on `/api/admin/login`, `POST /api/admin/setup`, `/api/guest/login`, `/api/guest/lookup`, and `/api/registry/validate-code`) in a dedicated bounded store (`MAX_RATE_LIMIT_KEYS = 10000`), exempt `/api/health`, and normalize dynamic API paths under the standard throttle (**100 requests per minute**).
   - **Proxy IP Resolution & `127.0.0.1` Fallback Hazard**: `getClientIp` ([src/utils/rateLimit.ts](../src/utils/rateLimit.ts#L182-L214)) gates `X-Forwarded-For` / `X-Real-IP` behind `TRUST_PROXY` ([src/env.ts](../src/env.ts#L73-L84), `false` by default). When `TRUST_PROXY=false` and `NextRequest.ip` is absent (e.g., standalone Node containers behind Nginx, Caddy, Cloudflare, Cloud Run, Railway, or Render), all unauthenticated and guest requests collapse onto `'127.0.0.1'` and share a single lockout counter. Verified admin requests are keyed by `session:<adminCookie>` in `getSessionOrIp` ([src/utils/rateLimit.ts](../src/utils/rateLimit.ts#L216-L237)), protecting administrators from shared-IP lockouts.
   - **Public Address Collection Guard**: `POST /api/guest/address/public` ([src/app/api/guest/address/public/route.ts](../src/app/api/guest/address/public/route.ts#L14-L48)) layers a secondary `public_address_collect` rate limit (**10 requests per 15 minutes** per client IP) and a silent `website` honeypot field on top of `withApiMiddleware`.
6. **SSRF Protections**: Registry scraper uses `safeFetch` ([src/utils/safeFetch.ts](../src/utils/safeFetch.ts#L37-L110)) which resolves DNS hostnames with `{ all: true }`, pins outbound sockets to the validated IP, and blocks private IPv4, IPv6, loopback, CGNAT, link-local metadata (e.g. `169.254.169.254`), and reserved ranges across up to 5 redirect hops.
7. **File Upload Sanitization & Canonical Path Containment**: Uploaded images pass through Sharp image processor sanitization (enforcing normalized file extensions and stripping metadata), while local storage operations enforce lexical + symlink-resolved canonical root containment (`resolveContainedExistingPath`, `resolveContainedWritePath`, and `PathContainmentError` in [src/utils/pathContainment.ts](../src/utils/pathContainment.ts#L122-L312)) alongside iterative URL percent-decoding and traversal checks (`decodeUrlPathSafely`, `isSafeLocalPathUrl`, `isSafeConfigAssetUrl`, `isSafeMediaOrPhotoUrl` in [src/utils/validationPrimitives.ts](../src/utils/validationPrimitives.ts#L176-L327), re-exported via [src/utils/validation.ts](../src/utils/validation.ts#L28-L51)).
8. **Broadcast Template & HTML Sanitization**: Guest email and SMS broadcasts escape HTML entities across all interpolated guest/event placeholders (`escapeHtmlEntities` and `renderBroadcastTemplate` in [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L14-L86)), strip `\r`/`\n` header-injection characters from email subjects (`sanitizeEmailSubject`), and convert plain-text message lines into entity-safe HTML paragraphs (`formatEmailHtmlBody` in [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L17-L30)).
9. **Log Redaction & DTO Secret Masking**: Logger automatically redacts sensitive key patterns (`password`, `passcode`, `secret`, `cookie`, `authorization`, `token`) prior to console emission, while `toPublicAppConfig`, `toAdminAppConfig`, and `sanitizeAppConfigForBackup` ([src/lib/config.ts](../src/lib/config.ts#L281-L457)) strip raw email/SMS provider secrets from PostgreSQL `AppConfig` payloads and backups.
10. **Defense in Depth**: Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`) enforced on all responses.

---

## 4. Residual Risk Assessment & Operational Guidance

- **Reverse-Proxy `TRUST_PROXY` Configuration**: Operators running behind a reverse proxy must configure `TRUST_PROXY` (`1` or exact trusted proxy hop count behind append-only proxies, or `true` behind edge-overwritten headers) so `getClientIp` does not bucket all guests under `'127.0.0.1'`. Conversely, never enable `TRUST_PROXY=true` if the container port is directly reachable from the public internet without an upstream header-stripping proxy, as clients could spoof `X-Forwarded-For` to bypass IP rate limits.
- **In-Memory Rate Limiting**: The built-in rate limiter uses in-memory storage suitable for single-instance deployments. For horizontally scaled multi-instance deployments behind a load balancer, deployers should configure rate limiting at the ingress layer (e.g., Cloudflare, Nginx, or AWS WAF).
- **Secret Rotation**: Deployers must set custom `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, and `ADMIN_PASSWORD` values in environment variables upon first deployment and rotate them if compromised.
