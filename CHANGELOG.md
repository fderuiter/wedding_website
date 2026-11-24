# Changelog

All notable changes to the `wedding_website` project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

Release entries distinguish between:
- **🚀 Application Changes**
- **🗄️ Schema Changes**
- **⚙️ Configuration Changes**
- **🐳 Deployment & Infrastructure Changes**
- **⚠️ Breaking Changes & Migration Guide**

---

## [Unreleased]

> **Adopter Action Required**: Yes (Database schema migrations, production 64-byte scrypt and session secret hardening, and Docker Compose `:?` secret guards required)

### 🚀 Application Changes
- Implemented comprehensive downstream upgrade strategy ([`docs/upgrading.md`](./docs/upgrading.md)) covering Docker Compose, standalone Docker, and host Node.js workflows, alongside semantic versioning and release governance ([`docs/versioning.md`](./docs/versioning.md)).
- Added a read-only local environment preflight CLI ([`scripts/preflight-env.ts`](./scripts/preflight-env.ts), `npm run preflight:env`) that validates operator `.env` secrets against production validators and Docker Compose `:?` secret guards without printing raw secret values.
- Upgraded full-database JSON backups via `BACKUP_SCHEMA_VERSION` in [`src/app/api/admin/maintenance/export/route.ts`](./src/app/api/admin/maintenance/export/route.ts) to `schemaVersion: "2.0"` (`BACKUP_SCHEMA_VERSION = '2.0'`), streaming cursor-chunked exports across all 15 domain Prisma models (excluding ephemeral `AuthLockout` rows) while redacting raw messaging/server secrets and preserving backward-compatible `1.0` backup imports.
- Hardened authentication rate limiting and proxy-scoped client IP extraction (`src/utils/rateLimit.ts`, `src/utils/withApiMiddleware.ts`), synchronizing failed-attempt-only auth lockouts in PostgreSQL (`AuthLockout` with HMAC-SHA256 hashed IP keys and fail-open memory fallback) while isolating general API quotas per verified session.
- Added the five-step first-run `SetupWizard`, starter sample-data archetypes (`isSample` tracking), CSV guest-list import wizard, interactive drag-and-drop seating chart, multi-event access matrix and JSONB meal/custom-question RSVPs, RSVP deadline locking, QR-scoped guest photo upload sessions (`guest_photo_session`) with print-ready QR modal and live gallery auto-approval (`/api/admin/photos/qr`), cash funds with Stripe Elements checkout and fee coverage (`/api/registry/webhook/stripe`), shipping/order/refund lifecycle tracking, and scheduled email/SMS guest broadcasts (`/api/cron/broadcasts`).

### 🗄️ Schema Changes
- Applied post-`0.1.0` Prisma migrations in [`prisma/migrations/`](./prisma/migrations/) (through `20261123020000_add_plus_one_seat_numbers`), expanding [`prisma/schema.prisma`](./prisma/schema.prisma) and `AppConfig`:
  - **New Models**: `SeatingTable` (`20261007000000_add_seating_table`), `SubEvent`, `SubEventAccess`, and `SubEventRsvp` (`20261019000000_add_sub_event_access_matrix`, `20261120020000_add_rsvp_meals_and_questions_jsonb`), `BroadcastMessage` and `BroadcastRecipient` (`20261023000000_add_broadcast_messaging`, `20261027000000_add_broadcast_scheduled_for`), plus `AuthLockout` (`20261123000000_add_auth_lockout`).
  - **`AppConfig` Additions**: Added `contactEmail`, `photoAlbumUrl`, guest photo QR and moderation controls (`autoApproveGuestPhotos`, `guestPhotoQrTokenVersion` in `20261123000000_add_guest_photo_qr_and_auto_approve`), theme and brand media tokens (`themePreset`, `themeTokens`, `brandMonogram`, `brandLogoUrl`, `brandLogoAlt`, `heroImageUrl`, `heroImageAlt`, `brandWatermarkUrl`, `brandWatermarkAlt`, `badgeGraphicUrl`, `badgeGraphicAlt`), layout tokens (`layoutContainerMaxWidth`, `layoutGridGap`, `layoutCardPadding`, `layoutBorderRadius`), persisted feature `modules` JSON (`20261120010000_add_appconfig_modules`), RSVP lock settings (`rsvpOpen`, `rsvpDeadlineDate`, `rsvpGracePeriodHours`, `rsvpClosedMessage` in `20261119000000_add_rsvp_deadline_and_lock`), outbound email/SMS delivery settings (`emailProvider`, `smtp*`, `resend*`, `sendgrid*`, `smsProvider`, `twilio*`, `broadcastBatchSize`, `broadcastBatchDelayMs`), registry shipping address fields (`shipping*` in `20261121000000_add_registry_shipping_and_order_tracking`), default cash-fund payment handles (`defaultPaymentHandleType`, `defaultPaymentHandle`), and resumable onboarding setup completion state (`setupCompleted` in `20261123010000_add_appconfig_setup_completed`).
  - **Guest, Registry & Logistics Additions**: Added `WeddingPartySide` enum and `side` on `WeddingPartyMember`; hotel block fields (`promoCode`, `bookingUrl`, `roomRate`, `cutoffDate`, `shuttleInfo`) on `Attraction`; postal address, plus-one names, `householdName`, `partyGroup`, GIN-indexed `partyTags`, `extraFields`, and seating assignment (`tableId`, `seatNumber`, `plusOneSeatNumbers` in `20261123020000_add_plus_one_seat_numbers`) on `InvitationCode`; cash-fund `itemType`/`paymentHandle*`, `isMostWanted`, `displayOrder`, and required `imageId` foreign key (`20261122010000_reconcile_schema_migration_drift`, `20261123000000_reconcile_schema_drift_and_registry_media_contract`) on `RegistryItem`; thank-you tracking, contributor postal address & thank-you email timestamp (`20261123000000_add_contributor_address_and_email_sent_at`), `message`, `coverFee`/`feeAmount`, unique `stripePaymentIntentId`/`stripeChargeId`/`transactionTimestamp` (`20261116000000_add_stripe_transaction_fields`, `20261120000000_unique_stripe_payment_intent_id`), notification timestamps, order/carrier tracking, and `refundedAmount`/`status` (`20261122000000_add_contributor_lifecycle_and_refunds`) on `Contributor`; `isSample` flags across sample-capable models; and composite/foreign-key indexes (`20261116010000_add_composite_and_fk_indexes`, `20261122010000_add_content_node_type_created_at_index` on `ContentNode(type, createdAt DESC)`).

### ⚙️ Configuration Changes
- Added **7 environment variables** to `envSchema` in [`src/env.ts`](./src/env.ts) (21 runtime schema keys total, documented in [`.env.example`](./.env.example)):
  - `GUEST_SESSION_SECRET`: Dedicated HMAC-SHA256 signing secret for `guest_auth` cookies (required in production, minimum 32 characters, distinct from `GUEST_PASSCODE`).
  - `RUN_MIGRATIONS`: Boolean container startup flag (default `false`) instructing [`docker-entrypoint.sh`](./docker-entrypoint.sh) to execute `prisma migrate deploy` for standalone `docker run` deployments.
  - `TRUST_PROXY`: Boolean or non-negative proxy hop count (default `false`; `1` for single-hop Caddy/Nginx/Vercel/Railway/Render, `2` for two-hop Cloud Run/CDN+LB) enabling trusted `X-Forwarded-For` / `X-Real-IP` rate-limit client IP extraction.
  - `CRON_SECRET`: Optional bearer secret authenticating scheduled `/api/cron/broadcasts` requests.
  - `STRIPE_SECRET_KEY`: Conditional server-side Stripe secret/restricted key (`sk_...` or `rk_...`), required whenever `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is set.
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`: Conditional client-side Stripe publishable key (`pk_...`), required whenever `STRIPE_SECRET_KEY` is set.
  - `STRIPE_WEBHOOK_SECRET`: Optional Stripe webhook signing secret (`whsec_...`) for `/api/registry/webhook/stripe`.
- Enforced strict production secret format validators in [`src/env.ts`](./src/env.ts):
  - `ADMIN_PASSWORD` must use strict `scrypt:[16-byte saltBase64]:[64-byte keyBase64]` format generated via `node scripts/generate-password-hash.mjs` (rejecting plaintext passwords, legacy non-64-byte scrypt hashes, build placeholders, and E2E test hashes when `NODE_ENV=production`).
  - `GUEST_PASSCODE` rejects the development fallback (`wedding2026`), `.env.example` placeholders, and E2E test passcodes when `NODE_ENV=production`.
  - `GUEST_SESSION_SECRET` rejects defaults, placeholders, E2E test secrets, values shorter than 32 characters, and values matching `GUEST_PASSCODE`.
  - `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` must be paired together and reject mock placeholder keys outside `test`, while `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` remain an all-or-nothing credential group.
- Updated `ModuleConfigSchema` in [`src/lib/modules.ts`](./src/lib/modules.ts) to persist **9 feature toggles** (`registry`, `groupGifting`, `weather`, `weddingParty`, `attractions`, `gallery`, `countdown`, `addToCalendar`, `interactive3D`) in `AppConfig.modules`, retiring the legacy `guestPasscode` toggle so guest authentication is enforced consistently via `GUEST_PASSCODE` and `GUEST_SESSION_SECRET`.

### 🐳 Deployment & Infrastructure Changes
- Hardened [`docker-compose.yml`](./docker-compose.yml) for production VPS self-hosting:
  - Enforced mandatory `:?` Compose secret guards with zero fallback defaults for `DB_PASSWORD`, `ADMIN_PASSWORD`, `GUEST_PASSCODE`, and `GUEST_SESSION_SECRET` (isolating disposable CI defaults inside `.env.ci` and `docker-compose.ci.yml`).
  - Added a dedicated one-shot `migration` service executing `./node_modules/.bin/prisma migrate deploy` offline (`restart: "no"`) before `app` starts (`condition: service_completed_successfully`), scoping container PostgreSQL overrides via `${CONTAINER_DATABASE_URL:-...}` so host `@localhost:5432` `DATABASE_URL` values never leak into containers, and setting `NODE_ENV: production`, `RUN_MIGRATIONS: ${RUN_MIGRATIONS:-false}`, `E2E_TEST: ${E2E_TEST:-false}`, and `HOSTNAME: "0.0.0.0"` on `app` alongside full 21-variable runtime forwarding.
  - Enforced `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `init: true`, writable `tmpfs` mounts (`/tmp` and `/app/.next/cache`), loopback host port bindings (`127.0.0.1:${DB_PORT:-5432}:5432` and `127.0.0.1:${PORT:-3000}:3000`), built-in `/api/live` container `healthcheck`, and persistent named volumes `db_data` and `uploads_data` (`/app/public/uploads`).
- Updated [`Dockerfile`](./Dockerfile) (`node:22-bookworm-slim` digest-pinned build stages and minimal `debian:bookworm-slim` digest-pinned runner with stripped `node` and zero `npm`/`npx`/`corepack`/`yarn`) and [`docker-entrypoint.sh`](./docker-entrypoint.sh) with an isolated `/opt/prisma-cli` stage linked to `/app/node_modules/.bin/prisma`, `/usr/bin/tini` PID 1 entrypoint, `/api/live` `HEALTHCHECK`, `DATABASE_URL` URI normalization, and opt-in `RUN_MIGRATIONS=true` startup migrations for standalone containers.
- Extended [`scripts/verify-deployment-runbooks.ts`](./scripts/verify-deployment-runbooks.ts) (`npm run check:runbooks` in `.github/workflows/ci.yml` and `scripts/check-quality.ts`) to fail pull requests with actionable remediation hints when schema migrations, `src/env.ts` keys, module toggles, backup schema versions, or Docker Compose guards drift from `CHANGELOG.md` and `docs/upgrading.md`.
- Updated PR template (`.github/pull_request_template.md`) and contributing guide (`.github/CONTRIBUTING.md`) with release categorization and adopter action tracking.
- Exempted stateless read-only (`GET` and `HEAD`) probe requests to `/api/live`, `/api/health`, and `/api/ready` in [`src/middleware.ts`](./src/middleware.ts) from `ALLOWED_HOSTS` domain matching while enforcing syntactic `Host` validation (`isHostSyntaxValid` in [`src/utils/hostValidation.ts`](./src/utils/hostValidation.ts)) and `Cache-Control: no-store`, simplifying loopback container `/api/live` healthchecks across [`Dockerfile`](./Dockerfile), [`docker-compose.yml`](./docker-compose.yml), and [`docker-compose.rollout.yml`](./docker-compose.rollout.yml).

### ⚠️ Breaking Changes & Migration Guide
1. **Back Up Data & Tag Rollback Image**:
   - Export a full-database JSON backup from `/admin/dashboard/maintenance` (**Export All Data**, `schemaVersion: "2.0"` — legacy `"1.0"` exports also remain importable) and/or run `pg_dump` against PostgreSQL.
   - On container hosts, tag the currently running image before pulling or rebuilding: `docker tag wedding-website:latest wedding-website:previous`.
2. **Populate Mandatory Production & Compose Secrets in `.env`**:
   - Regenerate `ADMIN_PASSWORD` if using a plaintext value or legacy non-64-byte scrypt hash: `node scripts/generate-password-hash.mjs "your-strong-password"`.
   - Set non-placeholder values for `GUEST_PASSCODE` (cannot be `wedding2026`) and `GUEST_SESSION_SECRET` (at least 32 characters and distinct from `GUEST_PASSCODE`, e.g., `openssl rand -hex 32`).
   - Set `DB_PASSWORD` in `.env` when using `docker-compose.yml` (`DB_PASSWORD`, `ADMIN_PASSWORD`, `GUEST_PASSCODE`, and `GUEST_SESSION_SECRET` enforce mandatory `${VAR:?...}` guards).
   - If enabling Stripe card checkout, configure both `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` together (plus `STRIPE_WEBHOOK_SECRET` for `/api/registry/webhook/stripe`); set `TRUST_PROXY=true` when running behind Caddy or Nginx.
3. **Remove Retired `guestPasscode` Module Override Keys**:
   - If you customized `AppConfig.modules` JSON manually, remove any obsolete `guestPasscode` boolean property (`ModuleConfigSchema` now persists the 9 supported feature toggles and strips unknown keys).
4. **Run Local `.env` Preflight Before Restarting**:
   - Run `npm run preflight:env` (`npx tsx scripts/preflight-env.ts --env-file .env`, or add `--no-compose` for non-Compose host/standalone `.env` files) and resolve any reported secret or guard issues.
5. **Apply Forward-Only Migrations & Restart**:
   - **Docker Compose**: Run `docker compose up -d --build` (preserves `db_data` and `uploads_data` named volumes while running the one-shot `migration` service before `app`; never run `docker compose down -v` in production).
   - **Standalone Docker**: Run with `-e RUN_MIGRATIONS=true` (or execute `./node_modules/.bin/prisma migrate deploy` one-shot first) and mount persistent `/app/public/uploads` storage.
   - **Host Node.js**: Run `npm ci && npm run migrate:deploy && npm run prisma:generate && npm run build`, then restart `npm start` (see [`docs/upgrading.md`](./docs/upgrading.md) for full track-by-track commands and rollback steps).

---

## [0.1.0] - 2026-09-15

> **Adopter Action Required**: Yes (Initial setup and database migration)

### 🚀 Application Changes
- Initial release of the customizable wedding website template with App Router UI, interactive 3D heart scene, registry management, RSVP system, and admin dashboard.

### 🗄️ Schema Changes
- Created initial Prisma database schema (`prisma/schema.prisma`) including `AppConfig`, `Media`, `WeddingPartyMember`, `Attraction`, `RegistryItem`, `Contributor`, `InvitationCode`, `ContentNode`, and `SnapshotVersion`.

### ⚙️ Configuration Changes
- Added central Zod `AppConfigSchema` and environment variable validation schema (`src/env.ts`).

### 🐳 Deployment & Infrastructure Changes
- Containerized setup with `Dockerfile`, `docker-compose.yml`, and `docker-entrypoint.sh`.
