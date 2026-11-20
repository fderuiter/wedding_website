# Security Policy

## Threat Model & Architecture
For a detailed analysis of trust boundaries, asset inventory, threat vectors, and active security controls in this codebase, please review the [Lightweight Threat Model](docs/THREAT_MODEL.md).

## Supported Versions

We maintain security updates on the default `main` branch.

| Version          | Supported          | Notes                                      |
| ---------------- | ------------------ | ------------------------------------------ |
| `main` Branch    | :white_check_mark: | Actively supported release branch.          |
| Older Commits    | :x:                | Upstream fixes should be merged to `main`. |

## Template Deployers & Self-Hosters

If you are deploying this template for your own event, please ensure:
1. You generate unique credentials for `ADMIN_PASSWORD` (using `scripts/generate-password-hash.mjs`), a unique `GUEST_PASSCODE`, and a distinct `GUEST_SESSION_SECRET` of at least 32 characters for signing `guest_auth` and `guest_invite_session` cookies. Runtime validation in `src/env.ts` rejects default fallback values (`wedding2026` and `default-guest-session-secret`), `GUEST_SESSION_SECRET` values shorter than 32 characters, and values matching `GUEST_PASSCODE` in production.
2. You configure `ALLOWED_HOSTS` to match your actual domain name(s) (and configure `CRON_SECRET` if scheduling `/api/cron/*` broadcast jobs).
3. If deploying behind a reverse proxy, CDN, or container ingress (such as Nginx, Caddy, Cloudflare, Google Cloud Run, Railway, or Render) where `NextRequest.ip` is absent, configure `TRUST_PROXY` ([src/env.ts](src/env.ts#L14-L31), [src/env.ts](src/env.ts#L73-L84))—set an integer hop count (e.g., `TRUST_PROXY=1`) behind append-only proxies so `getClientIp` ([src/utils/rateLimit.ts](src/utils/rateLimit.ts#L182-L214)) extracts the trusted hop from `X-Forwarded-For`, or `TRUST_PROXY=true` only when the edge overwrites `X-Real-IP` / `X-Forwarded-For`. Leaving `TRUST_PROXY=false` (the default) causes `getClientIp` to fall back to `'127.0.0.1'` for all unauthenticated and guest traffic, sharing a single IP rate-limit bucket across every visitor and risking site-wide `429 Too Many Requests` lockouts on login/lookup endpoints (verified administrators are isolated under `session:<adminCookie>` keys via `getSessionOrIp` in [src/utils/rateLimit.ts](src/utils/rateLimit.ts#L216-L237)).
4. If hosting publicly, replace the security contact email below with your own contact address in your fork or deployment settings.

## Reporting a Vulnerability

Found a security issue or vulnerability? We appreciate responsible disclosure to help keep the project safe.

**How to Report:**

* Please email details to `fpderuiter@gmail.com`. **Please do not open public GitHub issues for security vulnerabilities.**
* Include steps to reproduce, potential impact assessment, and any relevant code snippets or proof of concept.

**What Happens Next:**

* We aim to acknowledge reports within 48 hours.
* We will investigate the issue and communicate target resolution timelines within 7 business days.
* Once a fix is verified and deployed, security updates will be documented on the main branch.

Thanks for helping keep this project secure!

## Core Security Controls

- **No Default Passwords:** The system never ships with universal default administrative passwords.
- **Password Hashing:** Admin passwords use scrypt key derivation function (`scrypt:[saltBase64]:[keyBase64]`).
- **First-Run Bootstrap Protection:** First-run initialization requires validating against `ADMIN_PASSWORD`. Once initialized, setup endpoints reject unauthorized replay attempts (`403 Forbidden`).
- **Session-Isolated & Tiered Rate Limiting:** `withApiMiddleware` ([src/utils/withApiMiddleware.ts](src/utils/withApiMiddleware.ts#L22-L31)) enforces a 5-attempt / 15-minute lockout bucket (`auth`) on `/api/admin/login`, `POST /api/admin/setup`, `/api/guest/login`, `/api/guest/lookup`, and `/api/registry/validate-code`, a 100-request / minute general API bucket, and `session:<adminCookie>` keying for verified admin sessions (`getSessionOrIp` in [src/utils/rateLimit.ts](src/utils/rateLimit.ts#L216-L237)). Public guest address submission (`POST /api/guest/address/public` in [src/app/api/guest/address/public/route.ts](src/app/api/guest/address/public/route.ts#L14-L48)) enforces an additional `public_address_collect` throttle (10 requests per 15 minutes per client IP) plus a hidden `website` honeypot check.
- **Canonical Path Containment & URL Traversal Guards:** Local upload reads, writes, and deletions validate both lexical containment and symlink-resolved canonical paths (`fs.promises.realpath` / `fs.promises.lstat`) via `resolveContainedExistingPath`, `resolveContainedWritePath`, and `PathContainmentError` in [src/utils/pathContainment.ts](src/utils/pathContainment.ts#L122-L312), paired with iterative percent-decoding (`decodeUrlPathSafely`, `isSafeLocalPathUrl`, `isSafeConfigAssetUrl`, `isSafeMediaOrPhotoUrl`) in [src/utils/validationPrimitives.ts](src/utils/validationPrimitives.ts#L176-L327) (re-exported via [src/utils/validation.ts](src/utils/validation.ts#L28-L51)).
- **Broadcast Template & Email HTML Sanitization:** Outbound guest broadcasts escape HTML entities on interpolated template variables (`escapeHtmlEntities` and `renderBroadcastTemplate`), strip CR/LF header-injection characters from subjects (`sanitizeEmailSubject` in [src/features/broadcast/template.ts](src/features/broadcast/template.ts#L14-L86)), and convert plain-text bodies into entity-safe `<p>`/`<br />` markup (`formatEmailHtmlBody` in [src/features/broadcast/providers/index.ts](src/features/broadcast/providers/index.ts#L17-L30)).
