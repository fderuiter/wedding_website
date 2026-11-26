# Downstream Upgrade Guide

This guide explains how adopters who have cloned, forked, or containerized the `wedding_website` repository can maintain upstream compatibility, validate local `.env` secrets, apply forward-only database migrations, preserve persistent volumes, and roll back safely across **Docker Compose**, **Standalone Docker**, and **Host Node.js** deployments without losing guest data or uploaded media.

---

## 1. Upstream Strategy & Architectural Principles

To ensure a smooth upgrade path for downstream adopters, the template adheres to the following architectural principle:

> **Personal content and deployment configuration must remain outside frequently modified application internals.**

### Personal Content Isolation

- **Database-Driven Content**: Personal details (e.g., couple's names, wedding date, venue details, story text, hero titles, theme colors, FAQs, wedding party members, attractions, registry items, guest invitations, seating tables, sub-events, RSVPs, broadcasts, and audit snapshots) are stored in PostgreSQL records across the 15 domain Prisma models (`AppConfig`, `ContentNode`, `Media`, `SeatingTable`, `InvitationCode`, `WeddingPartyMember`, `Attraction`, `RegistryItem`, `Contributor`, `SubEvent`, `SubEventAccess`, `SubEventRsvp`, `BroadcastMessage`, `BroadcastRecipient`, `SnapshotVersion`), while ephemeral brute-force lockout counters in `AuthLockout` (16 Prisma models total) are managed automatically at runtime.
- **Avoid Hardcoding Details**: Do not hardcode couple names, dates, or custom copy inside core React components (`src/app/` or `src/features/`). Modify content through the **Admin Dashboard** (`/admin/dashboard`) or database seeds rather than core source code files.
- **Media Storage**: Upload custom images through the Admin Dashboard (persisted under `/app/public/uploads` via the `uploads_data` Docker volume or in S3/Cloudflare R2) or store static assets in `public/` using custom file names to avoid upstream merge conflicts.

### Deployment Isolation

- **Environment Variables**: Server configuration, credentials, and deployment flags are injected strictly through environment variables (`DB_PASSWORD`, `DATABASE_URL`, `CONTAINER_DATABASE_URL`, `ADMIN_PASSWORD`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, `TRUST_PROXY`, `STRIPE_*`, `S3_*`, etc.).
- **Containerization**: Deployments use hardened, provider-neutral container setups ([`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml), [`docker-entrypoint.sh`](../docker-entrypoint.sh)) aligned with [`docs/deployment/docker-vps.md`](./deployment/docker-vps.md) or standard Node.js v22.x LTS host environments.

---

## 2. Downstream Upgrade Procedure

Follow these step-by-step instructions whenever a new upstream release or update is published.

### Step 1: Configure Upstream Remote (One-Time Setup)

In your local or VPS repository clone, add the official repository as the `upstream` remote:

```bash
git remote add upstream https://github.com/fderuiter/wedding_website.git
```

Verify that the remote was added:

```bash
git remote -v
```

### Step 2: Back Up Data & Tag Current Container Image for Rollback

Before pulling upstream code or applying schema migrations:

1. **Export Unified JSON Backup**: In `/admin/dashboard/maintenance`, click **Export All Data** to download a `schemaVersion: "2.0"` full-database JSON export covering all 15 domain Prisma models (excluding ephemeral `AuthLockout` rows).
2. **Tag Running Container Image (Docker Compose & Standalone Docker)**: Preserve the known-good image as `wedding-website:previous` so you can roll back immediately if needed:
   ```bash
   docker tag wedding-website:latest wedding-website:previous
   ```
3. **Snapshot PostgreSQL (Recommended for Major Upgrades)**:
   ```bash
   # Docker Compose co-located PostgreSQL snapshot
   docker compose exec -T db pg_dump -U "${DB_USER:-wedding}" "${DB_NAME:-wedding}" > backup-pre-upgrade.sql
   ```

### Step 3: Fetch & Review Release Notes (`CHANGELOG.md`)

Fetch the latest branches and release tags from upstream and inspect [`CHANGELOG.md`](../CHANGELOG.md) (plus [`docs/versioning.md`](./versioning.md)):

```bash
git fetch upstream --tags
git log HEAD..upstream/main --oneline CHANGELOG.md
```

Pay special attention to:

- **Adopter Action Required**: Check if the release is flagged with `Adopter Action Required: Yes`.
- **Breaking Changes & Migration Guide**: Review new environment variables (`src/env.ts`), Docker Compose `:?` secret guards (`docker-compose.yml`), retired `AppConfig.modules` toggles (`src/lib/modules.ts`), and schema migrations (`prisma/migrations/`).

### Step 4: Merge Upstream Changes

Ensure your working directory is clean, check out `main`, and merge the upstream branch (or a specific release tag):

```bash
git status
git checkout main
git merge upstream/main
```

### Step 5: Resolve Merge Conflicts (If Any)

If you customized files inside `src/` or `prisma/`, resolve any Git conflicts before continuing:

```bash
git status
# Resolve conflicts in your editor, then stage and commit:
git add .
git commit -m "merge: sync upstream updates"
```

### Step 6: Execute Runtime-Specific Upgrade & Database Migrations

Choose the track matching your deployment topology (**Track A: Docker Compose**, **Track B: Standalone Docker**, or **Track C: Host Node.js**). Before restarting production containers or services, run **Step 7** (`npm run preflight:env -- --mode production`) to verify your `.env` secrets.

#### Track A: Docker Compose (`docker-compose.yml` — Recommended Container Baseline)

[`docker-compose.yml`](../docker-compose.yml) orchestrates `db` (`postgres:15-alpine`), a one-shot `migration` service, and `app` (`wedding-website:latest`, built from [`Dockerfile`](../Dockerfile)):

- **Persistent Volume Retention**: `db_data` (`/var/lib/postgresql/data`) and `uploads_data` (`/app/public/uploads`, UID/GID `1001`) are named Docker volumes that survive `docker compose up -d --build`. **Never run `docker compose down -v` during a production upgrade**, as `-v` deletes `db_data` and `uploads_data`.
- **Decoupled One-Shot Migrations**: `migration` runs `./node_modules/.bin/prisma migrate deploy` (backed by the isolated `/opt/prisma-cli` stage in `Dockerfile`) with `read_only: true`, `cap_drop: [ALL]`, and `restart: "no"` after `db` reports `service_healthy`, scoping container PostgreSQL overrides via `${CONTAINER_DATABASE_URL:-...}` and `${CONTAINER_POSTGRES_URL_NON_POOLING:-}` so host `@localhost:5432` `DATABASE_URL` and `POSTGRES_URL_NON_POOLING` values never leak into containers. `app` pins `NODE_ENV: production`, sets `RUN_MIGRATIONS=false` and `E2E_TEST=false` by default, and waits for `migration` (`condition: service_completed_successfully`) before starting `node server.js` behind `/usr/bin/tini`.

```bash
# 1. Validate local .env against production & Docker Compose ":?" guards (see Step 7)
npx tsx scripts/preflight-env.ts --mode production --env-file .env

# 2. Rebuild image, run one-shot migration service, and recreate app while preserving db_data & uploads_data
docker compose up -d --build

# 3. Verify container liveness (/api/live) and database readiness (/api/health)
docker compose ps
curl -fsS http://127.0.0.1:${PORT:-3000}/api/health -H "Host: localhost"
```

To execute migrations manually on demand (if `CONTAINER_DATABASE_URL` uses an external PgBouncer pooler, configure a direct `CONTAINER_POSTGRES_URL_NON_POOLING` URI in `.env` so `migration` routes directly through `prisma.config.ts`, or pass an ad-hoc override on the CLI while clearing `POSTGRES_URL_NON_POOLING` so Prisma 7 never sees matching primary and shadow database URLs):

```bash
# Standard Compose one-shot migration (honors CONTAINER_DATABASE_URL and CONTAINER_POSTGRES_URL_NON_POOLING)
docker compose run --rm migration

# Ad-hoc external PgBouncer CLI override using direct PostgreSQL connection
env -u POSTGRES_URL_NON_POOLING docker compose run --rm \
  -e DATABASE_URL="${CONTAINER_POSTGRES_URL_NON_POOLING:-$CONTAINER_DATABASE_URL}" \
  -e POSTGRES_URL_NON_POOLING="" \
  migration
```

#### Track B: Standalone Docker Container (`Dockerfile` & `docker-entrypoint.sh`)

When running the image directly via `docker run` without Docker Compose's `migration` service:

- **Runtime Entrypoint Flag (`RUN_MIGRATIONS=true`)**: Passing `-e RUN_MIGRATIONS=true` instructs [`docker-entrypoint.sh`](../docker-entrypoint.sh) to normalize `DATABASE_URL`, normalize and preserve non-empty `POSTGRES_URL_NON_POOLING` (unsetting blank values), and execute `./node_modules/.bin/prisma migrate deploy` (linked to `/opt/prisma-cli` in [`Dockerfile`](../Dockerfile)) automatically prior to `node server.js`.
- **Alternative One-Shot Container Migration**: For multi-replica rollouts, keep `RUN_MIGRATIONS=false` on web containers and run a one-shot migration container first (`docker run --rm --env-file .env wedding-website:latest ./node_modules/.bin/prisma migrate deploy`).
- **Uploads Persistence & Read-Only Root**: Mount a persistent named volume or UID `1001`-writable host directory (`chown -R 1001:1001 /var/lib/wedding/uploads`) at `/app/public/uploads`, plus `tmpfs` mounts at `/tmp` and `/app/.next/cache:uid=1001,gid=1001,mode=0755`.

```bash
# 1. Validate standalone .env secrets in production mode (skipping Compose-only DB_PASSWORD guard if using DATABASE_URL)
npx tsx scripts/preflight-env.ts --mode production --no-compose --env-file .env

# 2. Build updated image after tagging wedding-website:previous in Step 2
docker build -t wedding-website:latest .

# 3. Replace running standalone container with RUN_MIGRATIONS=true and persistent uploads volume
docker stop wedding-app && docker rm wedding-app
docker run -d --name wedding-app \
  -p 127.0.0.1:3000:3000 \
  --read-only \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  --tmpfs /tmp \
  --tmpfs /app/.next/cache:uid=1001,gid=1001,mode=0755 \
  -v wedding_uploads:/app/public/uploads \
  --env-file .env \
  -e RUN_MIGRATIONS=true \
  -e E2E_TEST=false \
  wedding-website:latest
```

#### Track C: Host Node.js Runtime (Node.js v22.x LTS)

For bare-metal or VM deployments running Node.js directly without Docker, verify the published GitHub Release's OIDC build provenance attestation and `SHA256SUMS` manifest (published by [`.github/workflows/release.yml`](../.github/workflows/release.yml) alongside categorized release notes per [`docs/versioning.md`](./versioning.md)) before applying dependencies and forward-only migrations:

```bash
# 0. Verify GitHub Release OIDC provenance and strict SHA256SUMS for the target v* release tag
RELEASE_TAG="v0.1.0"
mkdir -p /tmp/wedding-release
gh release download "$RELEASE_TAG" --repo fderuiter/wedding_website --dir /tmp/wedding-release --clobber
gh attestation verify /tmp/wedding-release/SHA256SUMS \
  --repo fderuiter/wedding_website \
  --signer-workflow fderuiter/wedding_website/.github/workflows/release.yml
(cd /tmp/wedding-release && sha256sum --check --strict SHA256SUMS)

# 1. Install deterministic lockfile dependencies
npm ci

# 2. Validate local .env secrets in production mode before migrating/restarting
npm run preflight:env -- --mode production --no-compose --env-file .env

# 3. Apply pending forward-only Prisma migrations against production .env and regenerate Prisma Client
dotenv -e .env -- npx prisma migrate deploy
npm run prisma:generate

# 4. Build standalone Next.js bundle and restart service
npm run build
npm start
```

> **Local vs. Production Migration CLI Note:** On production hosts, CI/CD runners, and PaaS targets, invoke `npx prisma migrate deploy` directly against an exported `DATABASE_URL` (or `dotenv -e .env -- npx prisma migrate deploy` when loading a host `.env` file), inspecting `_prisma_migrations` via [`prisma.config.ts`](../prisma.config.ts) and applying only unapplied SQL files from `prisma/migrations/`. If `DATABASE_URL` points to PgBouncer, run `DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy` (`prisma.config.ts` also auto-promotes `POSTGRES_URL_NON_POOLING` when `DATABASE_URL` uses PgBouncer). Reserve `npm run migrate:deploy` for local development fork verification: it wraps `dotenv -c development -- prisma migrate deploy`, which cascades `.env.development.local`, `.env.local`, `.env.development`, and `.env` and would load local `.env.development` overrides if present on a host.

### Step 7: Verify Local `.env` Secrets & Configuration Preflight

Run the read-only environment preflight CLI ([`scripts/preflight-env.ts`](../scripts/preflight-env.ts)) against your local `.env` file before starting or restarting services (`--mode production` or `NODE_ENV=production` enforces all production secret blocklists, whereas default `development` mode cascades `.env.development.local`, `.env.local`, `.env.development`, and `.env` for local contributor setups):

```bash
# Docker Compose production deployments (checks src/env.ts production rules + docker-compose.yml ":?" guards)
npm run preflight:env -- --mode production
# Equivalent explicit invocation:
npx tsx scripts/preflight-env.ts --mode production --env-file .env

# Standalone Docker or Host Node.js production deployments (checks src/env.ts production rules + DATABASE_URL)
npx tsx scripts/preflight-env.ts --mode production --no-compose --env-file .env
```

`scripts/preflight-env.ts` never prints raw secret values, connection URLs, or password hashes and fails with a non-zero exit code in `--mode production` (or when `NODE_ENV=production` is set) when any of the following are detected:

- **Missing or Default Docker Compose `:?` Secret Guards**: `DB_PASSWORD`, `ADMIN_PASSWORD`, `GUEST_PASSCODE`, or `GUEST_SESSION_SECRET` unset/empty in `.env`, `DB_PASSWORD` left at the disposable `.env.example` / `.env.ci` default, invalid `CONTAINER_DATABASE_URL` or `CONTAINER_POSTGRES_URL_NON_POOLING` overrides, or values containing unescaped `$` characters that Docker Compose would interpolate (escape literal `$` as `$$` or use single quotes).
- **Legacy or Placeholder `ADMIN_PASSWORD` Hashes**: Plaintext passwords, legacy non-64-byte scrypt hashes, `.env.example` dummy hashes, or E2E test hashes (generate a valid 16-byte salt / 64-byte scrypt key with `node scripts/generate-password-hash.mjs "your-strong-password"`).
- **Blocked `GUEST_PASSCODE` or Weak `GUEST_SESSION_SECRET`**: Default `wedding2026` or placeholder guest passcodes, session secrets shorter than 32 characters (`openssl rand -hex 32`), or `GUEST_SESSION_SECRET` matching `GUEST_PASSCODE`.
- **Unpaired or Placeholder Integration Keys**: `STRIPE_SECRET_KEY` set without `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (or vice versa), invalid `sk_`/`rk_`/`pk_`/`whsec_` prefixes, incomplete `S3_*` credentials, Cloudflare R2 `S3_REGION=auto` without `S3_ENDPOINT` or private `*.r2.cloudflarestorage.com` endpoints without `S3_PUBLIC_URL`, or `E2E_TEST=true` left enabled in production.

> **Maintainer Note:** If you are contributing documentation or schema changes to a fork, also run `npx tsx scripts/verify-env-docs.ts` (`npm run check:env-docs`) and `npm run check:runbooks` to verify committed Markdown docs and `.env.example`.

### Step 8: Post-Upgrade Verification & Smoke Checks

Validate that your upgraded instance builds cleanly and passes health/test checks:

```bash
# Host / development verification
npm run lint
npm run type-check
npm test
npm run build

# Live runtime readiness check (expects HTTP 200 with {"success":true,"data":{"status":"ok","database":"connected"}})
curl -fsS http://127.0.0.1:3000/api/health -H "Host: localhost"
```

---

## 3. Handling Configuration Schema Changes

Upstream releases may add or refine configuration fields in `AppConfig` or feature module schemas:

- **Non-Breaking Schema Additions**: New columns in `prisma/schema.prisma` include safe `@default(...)` values or nullable types so forward-only migrations populate existing `AppConfig` rows without downtime.
- **Expand-Migrate-Contract Schema Evolution**: Upstream database changes follow the three-phase **Expand-Migrate-Contract** policy enforced by `npm run lint:migrations` so additive releases preserve `N-1` rollback safety; see [`docs/versioning.md`](./versioning.md) for the canonical three-phase lifecycle and destructive DDL annotation rules.
- **Persisted Feature Module Toggles (`AppConfig.modules`)**: `ModuleConfigSchema` in `src/lib/modules.ts` persists the 9 feature toggles (`registry`, `groupGifting`, `weather`, `weddingParty`, `attractions`, `gallery`, `countdown`, `addToCalendar`, `interactive3D`) in `AppConfig.modules` (disabling `registry` automatically disables `groupGifting`; guest passcode gating is enforced globally via `GUEST_PASSCODE` and `GUEST_SESSION_SECRET`).
- **Zod Validation Fallbacks**: Zod schemas (`src/features/content/schemas.ts`) apply defaults gracefully when parsing older database records or snapshots.

---

## 4. Rollback, Troubleshooting & Database Recovery

### Container & Runtime Rollback (`wedding-website:previous`)

If an upgraded deployment fails health checks after Step 6, revert immediately to the `wedding-website:previous` image tagged in Step 2 (aligned with [`docs/deployment/docker-vps.md`](./deployment/docker-vps.md)):

1. **Docker Compose Rollback (Recommended — preserves Compose `db` network, loopback port binding, `db_data`, and `uploads_data`)**:
   ```bash
   docker tag wedding-website:previous wedding-website:latest
   docker compose up -d --no-deps app
   ```
2. **Standalone `docker run` Rollback (attaching Compose network, loopback port mapping, persistent `uploads_data` volume, and `DATABASE_URL` from `--env-file .env`)**:
   ```bash
   docker compose stop app
   docker run -d --name app-rollback \
     --network wedding_website_default \
     -p 127.0.0.1:3000:3000 \
     --read-only \
     --cap-drop=ALL \
     --security-opt=no-new-privileges:true \
     --tmpfs /tmp \
     --tmpfs /app/.next/cache:uid=1001,gid=1001,mode=0755 \
     -v wedding_website_uploads_data:/app/public/uploads \
     --env-file .env \
     -e E2E_TEST=false \
     wedding-website:previous
   ```
3. **Host Node.js Rollback**: Check out the previous Git tag or commit (`git checkout <previous-tag-or-sha>`), run `npm ci && npm run build`, and restart `npm start`.
4. **Forward-Only Database Migrations (`Expand-Migrate-Contract`)**: Prisma migrations are strictly forward-only (automatic destructive down-migrations are intentionally unsupported). Phase 1/2 additive migrations enforced by `npm run lint:migrations` remain backward-compatible with `wedding-website:previous`; if a major Phase 3 contract upgrade requires full database recovery, restore from the pre-upgrade `pg_dump` snapshot or `/admin/dashboard/maintenance` backup below.

### Prisma Migration Drift

If you edited `prisma/schema.prisma` directly in your local fork without generating a migration, Prisma may report schema drift during upgrade.

- **Recommended Fix**: Create a custom migration for your local changes prior to pulling upstream:
  ```bash
  npm run migrate:dev -- --name custom_local_changes
  ```
- Do not modify existing upstream migration folders in `prisma/migrations/`. Always apply downstream changes as new migration steps.

### Backup & Restore

Before performing major version upgrades, export a unified full-database backup from the Admin Dashboard:

1. Navigate to `/admin/dashboard/maintenance`.
2. Click **Export All Data** to download a single `schemaVersion: "2.0"` JSON backup (`src/app/api/admin/maintenance/export/route.ts`) covering all 15 domain database models (site settings, content nodes, media metadata, seating tables, guest invitation codes, wedding party members, attractions and hotel blocks, registry items, gift contributors, sub-events, event access grants, RSVPs, broadcast messages, broadcast recipients, and snapshot history; ephemeral `AuthLockout` counters are excluded).
3. Back up your `.env` file (`DB_PASSWORD`, `ADMIN_PASSWORD`, `GUEST_PASSCODE`, `GUEST_SESSION_SECRET`, `DATABASE_URL`, `STRIPE_*`, `S3_*`), persistent `uploads_data` media files, and outbound messaging provider secrets (`smtpPass`, `resendApiKey`, `sendgridApiKey`, `twilioAuthToken`) separately. For security, raw provider credentials and server environment secrets are redacted from JSON exports (non-secret delivery settings such as `emailProvider`, `smtpHost`, `smtpPort`, `smtpUser`, `smtpFrom`, `resendFrom`, `sendgridFrom`, `smsProvider`, `twilioAccountSid`, and `twilioFromNumber` are included).
4. To restore after an upgrade or into a clean database, select your `.json` backup file on `/admin/dashboard/maintenance`, verify the pre-flight record counts across content, gifts, guests, seating, sub-events, RSVPs, and broadcasts, and click **Import Data** (legacy `1.0` backups are also accepted—obsolete virtual fields are stripped automatically and broken guest links on gifts are cleared when guest records are absent; restoring into an existing database preserves already-stored provider credentials if omitted from the backup). For accidental single-record edits, use `/admin/dashboard/history` to roll back individual versions.

---

## 5. Upgrade Checklist

Use this checklist for every upstream upgrade:

- [ ] Exported a `schemaVersion: "2.0"` backup from `/admin/dashboard/maintenance` (and `pg_dump` snapshot) and tagged `docker tag wedding-website:latest wedding-website:previous`.
- [ ] Fetched latest upstream commits (`git fetch upstream --tags`).
- [ ] Reviewed [`CHANGELOG.md`](../CHANGELOG.md) for `Adopter Action Required: Yes`, breaking changes, and new `.env` or `:?` secret guards.
- [ ] Merged upstream branch (`git merge upstream/main`) and resolved any merge conflicts.
- [ ] Validated local `.env` secrets via `npm run preflight:env -- --mode production` (`npx tsx scripts/preflight-env.ts --mode production --env-file .env`).
- [ ] Applied forward-only migrations and rebuilt (`docker compose up -d --build` preserving `db_data` & `uploads_data`, standalone `docker run` with `RUN_MIGRATIONS=true`, production host `npm ci && dotenv -e .env -- npx prisma migrate deploy && npm run build` against `DATABASE_URL` / `POSTGRES_URL_NON_POOLING`, or local fork `npm run migrate:deploy` via `dotenv -c development`).
- [ ] Verified `/api/live` and `/api/health` readiness probes (and local `npm test` if running a modified fork).

- `20261125000000_add_household_members_and_member_rsvps`: Adds `HouseholdMember` and `SubEventMemberRsvp` relational tables and idempotently backfills existing household primaries, companions, seat numbers, and sub-event RSVP meal/dietary selections. Full-site JSON backups (`v2.0`) include `householdMember` and `subEventMemberRsvp` collections while remaining backward-compatible with pre-migration `v2.0` archives.
