# Lightweight Threat Model: Wedding Website Template

## 1. System Overview & Asset Inventory

This application is a reusable, self-hostable wedding website template built on Next.js (App Router), Prisma, PostgreSQL/SQLite, and optional S3/R2 hybrid storage.

### Primary Assets
- **Administrative Access**: Admin session tokens, settings modification, content editing, database backups/restores, media uploads.
- **Guest Access & Privacy**: Guest RSVP data, registry contributions, invitation codes, hidden event details.
- **System Credentials & Secrets**: `ADMIN_PASSWORD` (scrypt hash), `GUEST_PASSCODE`, `DATABASE_URL`, S3/R2 access keys, HMAC signing secrets.
- **Server Resources & Network Integrity**: Server compute/memory, internal network access (SSRF target), public file storage.

---

## 2. Threat Actors & Attack Vectors

| Threat Actor | Motivation | Primary Attack Vectors |
| :--- | :--- | :--- |
| **Unauthenticated Internet User** | Automated exploitation, vandalism, scraping | Brute-forcing guest passcode / admin password, SSRF via registry link scraper, Host Header injection, file upload abuse. |
| **Authenticated Guest** | Accessing unreleased features, unauthorized edits | Privilege escalation to admin endpoints, tampering with registry items. |
| **Malicious Reverse Proxy / MITM** | Session hijacking, data interception | Man-in-the-Middle attacks, insecure HTTP redirect handling. |
| **Rogue Admin / Compromised Key** | Complete data exfiltration or wipeout | Bulk export/import abuse, version history wiping. |

---

## 3. Trust Boundaries & Security Controls

```
+-----------------------------------------------------------------------------------+
| UNTRUSTED INTERNET                                                                |
| (HTTP Requests, Guest Passcodes, Scraped URLs)                                   |
+-----------------------------------------------------------------------------------+
                                       |
                                       v
[Perimeter Control: Host Header Validation Middleware (isHostAllowed)]
                                       |
                                       v
[Authentication Gate: Middleware (isGuestRequest / isAdminRequest)]
                                       |
                                       v
[API Middleware: Rate Limiter (5 requests / 15m on Auth routes, 100/m general)]
                                       |
                                       v
[Authorization Check: withApiMiddleware (isAdminRequest on protected routes)]
                                       |
                                       v
[Egress Control: safeFetch & SSRF Guardrail (isPrivateUrl with DNS lookup all)]
                                       |
                                       v
+-----------------------------------------------------------------------------------+
| TRUSTED CORE SYSTEM                                                               |
| (Prisma DB, S3 Storage, Audit Log Snapshots)                                      |
+-----------------------------------------------------------------------------------+
```

### Active Security Controls

1. **Perimeter Host Validation**: All incoming requests are filtered against `ALLOWED_HOSTS` before routing, preventing HTTP Host Header poisoning and cache poisoning.
2. **Password & Token Security**:
   - `ADMIN_PASSWORD` hashed using native `scrypt` with random salt.
   - Admin and Guest session tokens signed via HMAC SHA-256 with constant-time signature verification (`timingSafeEqual`).
   - Constant-time comparison for guest passcode verification to eliminate timing side-channels.
3. **Strict Authorization**: All administrative API endpoints wrapped in `withApiMiddleware` requiring valid signed admin session tokens.
4. **Rate Limiting**: IP-based rate limiting applying strict throttles (5 attempts per 15 minutes) on both `/api/admin/login` and `/api/guest/login`.
5. **SSRF Protections**: Registry scraper uses `safeFetch` which resolves DNS hostnames with `{ all: true }`, blocking private IPv4, IPv6, loopback, CGNAT, link-local metadata (e.g. `169.254.169.254`), and reserved ranges across all redirect hops.
6. **File Upload Sanitization**: Uploaded images are passed through Sharp image processor sanitization, enforcing normalized file extensions and stripping dangerous metadata.
7. **Log Redaction**: Logger automatically redacts sensitive key patterns (`password`, `passcode`, `secret`, `cookie`, `authorization`, `token`) prior to console emission.
8. **Defense in Depth**: Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`) enforced on all responses.

---

## 4. Residual Risk Assessment & Operational Guidance

- **In-Memory Rate Limiting**: The built-in rate limiter uses in-memory storage suitable for single-instance deployments. For horizontally scaled multi-instance deployments behind a load balancer, deployers should configure rate limiting at the ingress layer (e.g., Cloudflare, Nginx, or AWS WAF).
- **Secret Rotation**: Deployers must set custom `GUEST_PASSCODE` and `ADMIN_PASSWORD` values in environment variables upon first deployment and rotate them if compromised.
