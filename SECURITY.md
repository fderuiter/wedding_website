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
3. If hosting publicly, replace the security contact email below with your own contact address in your fork or deployment settings.

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
- **Personalized Invite-Only Endpoints & Stripe Webhook Verification:** `/api/guest/address` and `/api/rsvp` require a signed `guest_invite_session` cookie (`getGuestInviteSession`), while `POST /api/registry/webhook/stripe` bypasses the Edge cookie gate on `POST` only and verifies cryptographic `stripe-signature` headers against `STRIPE_WEBHOOK_SECRET`.
- **Public Address Collection Throttling & Honeypot Defense:** Unauthenticated `POST /api/guest/address/public` ([src/app/api/guest/address/public/route.ts](src/app/api/guest/address/public/route.ts#L12-L48)) enforces an IP rate limit of `10` requests per `15` minutes (`public_address_collect`), silently drops automated bot submissions populating honeypot fields (`website`, `honeypot`, `hp_field`, `confirm_email`), and quarantines submissions with `partyTags: ['address-collection']` pending admin review.
- **Upload & Export Path Containment:** Local asset reads, image uploads, and media archive exports validate filesystem paths through [src/utils/pathContainment.ts](src/utils/pathContainment.ts#L4-L333) (`resolveContainedExistingPath`, `resolveContainedWritePath`, `PathContainmentError`), enforcing lexical `path.relative` bounds, canonical `fs.promises.realpath` containment, and `fs.lstat` symlink-escape rejection.
- **Broadcast Provider & Secret Isolation:** Outbound email/SMS credentials are masked in `toAdminAppConfig` and stripped from `toPublicAppConfig` ([src/lib/config.ts](src/lib/config.ts#L438-L599)) and `sanitizeAppConfigForBackup` ([src/lib/backupPersistence.ts](src/lib/backupPersistence.ts#L165-L195)), `emailProvider = "smtp"` (`sendSmtpEmail` in [src/features/broadcast/providers/index.ts](src/features/broadcast/providers/index.ts#L957-L1014)) attempts live `node:net` / `node:tls` SMTP delivery when `smtpHost` is configured (returning `{ success: false }` when `smtpHost` is blank) while only `emailProvider = "none"` and `smsProvider = "none"` simulate delivery without network traffic, and `address-collection` leads and live `isSample: true` rows are excluded from broadcasts by default (see [Guest Broadcasts & Messaging](docs/BROADCASTS.md)).
