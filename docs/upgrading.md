# Downstream Upgrade Guide

This guide explains how adopters who have cloned or forked the `wedding_website` repository can maintain upstream compatibility, pull updates, run database migrations, and handle schema or configuration changes without overwriting local customizations or personal wedding data.

---

## 1. Upstream Strategy & Architectural Principles

To ensure a smooth upgrade path for downstream adopters, the template adheres to the following architectural principle:

> **Personal content and deployment configuration must remain outside frequently modified application internals.**

### Personal Content Isolation
- **Database-Driven Content**: Personal details (e.g., couple's names, wedding date, venue details, story text, hero titles, theme colors, FAQs, wedding party members, registry items) are stored in PostgreSQL records via Prisma models (`AppConfig`, `Media`, `WeddingPartyMember`, `Attraction`, `RegistryItem`, `ContentNode`).
- **Avoid Hardcoding Details**: Do not hardcode couple names, dates, or custom copy inside core React components (`src/app/` or `src/features/`). Modify content through the **Admin Dashboard** (`/admin/dashboard`) or database seeds rather than core source code files.
- **Media Storage**: Upload custom images through the Admin Dashboard or store static assets in `public/` using custom file names to avoid upstream merge conflicts.

### Deployment Isolation
- **Environment Variables**: Server configuration, credentials, and deployment flags are injected strictly through environment variables (`ADMIN_PASSWORD`, `DATABASE_URL`, `S3_*`, etc.).
- **Containerization**: Deployments use standard, provider-neutral container setups (`Dockerfile`, `docker-compose.yml`) or standard Node.js hosting environments.

---

## 2. Downstream Upgrade Procedure

Follow these step-by-step instructions whenever a new upstream release or update is published.

### Step 1: Configure Upstream Remote (One-Time Setup)

In your local repository clone, add the official repository as the `upstream` remote:

```bash
git remote add upstream https://github.com/fderuiter/wedding_website.git
```

Verify that the remote was added:

```bash
git remote -v
```

### Step 2: Fetch Upstream Changes

Fetch the latest branches and release tags from upstream:

```bash
git fetch upstream --tags
```

### Step 3: Review Release Notes & `CHANGELOG.md`

Before merging, inspect the upstream `CHANGELOG.md` or release notes on GitHub:

```bash
git log HEAD..upstream/main --oneline CHANGELOG.md
```

Pay special attention to:
- **Adopter Action Required**: Check if the release is flagged with `Action Required: Yes`.
- **Breaking Changes**: Check for schema changes, required environment variable additions, or deprecations.
- **Migration Guide**: Follow any release-specific migration steps provided in the release notes.

### Step 4: Merge Upstream Changes

Ensure your local working directory is clean and checkout your primary main branch:

```bash
git status
git checkout main
```

Merge the upstream main branch (or a specific release tag, e.g., `v1.2.0`):

```bash
git merge upstream/main
```

### Step 5: Resolve Merge Conflicts (If Any)

If you customized core files inside `src/` or `prisma/`, Git may report merge conflicts:

1. Identify conflicting files:
   ```bash
   git status
   ```
2. Open the conflicting files and resolve the differences. Preserve your custom logic while accepting core application bug fixes and feature updates.
3. Mark resolved files and commit the merge:
   ```bash
   git add .
   git commit -m "merge: sync upstream updates (v1.2.0)"
   ```

### Step 6: Update Dependencies & Apply Database Migrations

After merging, install any updated npm packages and run Prisma database migrations:

```bash
# 1. Install updated dependencies
npm ci

# 2. Apply pending database migrations safely
npm run migrate:deploy

# 3. Regenerate Prisma Client types
npm run prisma:generate
```

> **Note:** `npm run migrate:deploy` executes `prisma migrate deploy`, which applies all new migration SQL scripts from `prisma/migrations/` in chronological order without modifying existing data records.

### Step 7: Verify Environment Variables & Configuration

Check if upstream introduced new environment variables by reviewing `.env.example` against your local configuration (`.env.development.local` or production settings):

```bash
npx tsx scripts/verify-env-docs.ts
```

If new environment variables were introduced, add them to your local environment file with appropriate values.

### Step 8: Build & Test

Validate that your site builds cleanly and passes test suites:

```bash
# Verify TypeScript types and linting
npm run lint
npm run type-check

# Execute local unit and integration tests
npm test

# Build production bundle
npm run build
```

---

## 3. Handling Configuration Schema Changes

Upstream releases may add new configuration fields to `AppConfig` or content schemas.

- **Non-Breaking Schema Additions**: New configuration fields in `prisma/schema.prisma` include default values (e.g., `@default(true)` or `@default("")`). When `npm run migrate:deploy` runs, PostgreSQL automatically fills existing `AppConfig` records with default values.
- **Zod Validation Fallbacks**: Zod schemas (`src/features/content/schemas.ts`) use fallback defaults so that missing optional fields in older database records do not cause runtime crashes.
- **Configuration Migration Scripts**: If a major release restructures configuration fields, a migration script will be provided under `scripts/migrations/` and documented in `CHANGELOG.md`.

---

## 4. Troubleshooting & Database Recovery

### Prisma Migration Drift
If you edited `prisma/schema.prisma` directly in your local fork without generating a migration, Prisma may report schema drift during upgrade.
- **Recommended Fix**: Create a custom migration for your local changes prior to pulling upstream:
  ```bash
  npm run migrate:dev -- --name custom_local_changes
  ```
- Do not modify existing upstream migration folders in `prisma/migrations/`. Always apply downstream changes as new migration steps.

### Backup & Restore
Before performing major version upgrades, export a full data backup from the Admin Dashboard:
1. Navigate to `/admin/dashboard/maintenance`.
2. Click **Export Backup JSON** to download a snapshot of all database records.
3. If necessary after an upgrade, use **Import Backup JSON** or snapshot restoration to recover data.

---

## 5. Upgrade Checklist

Use this checklist for every upstream upgrade:

- [ ] Fetched latest upstream commits (`git fetch upstream`).
- [ ] Reviewed `CHANGELOG.md` for breaking changes and adopter action notices.
- [ ] Merged upstream branch (`git merge upstream/main`).
- [ ] Resolved any merge conflicts.
- [ ] Updated npm dependencies (`npm ci`).
- [ ] Applied database migrations (`npm run migrate:deploy`).
- [ ] Verified environment variables (`.env.example`).
- [ ] Passed local tests and production build (`npm test && npm run build`).
