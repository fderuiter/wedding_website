# Versioning, Release Policy, and Upstream Standards

This document defines the versioning policy, release standards, breaking-change management, database and configuration migration strategies, and maintainer expectations for the `wedding_website` project.

---

## 1. Semantic Versioning Policy

The project strictly follows [Semantic Versioning 2.0.0](https://semver.org/) (`MAJOR.MINOR.PATCH`) to communicate the impact of releases to downstream adopters:

| Version Component | Increment Rule | Examples & Impact on Downstream Adopters |
|---|---|---|
| **MAJOR** (`X.0.0`) | Incompatible schema changes, removed features, breaking API changes, or non-backwards-compatible configuration schema updates requiring manual migration steps. | Database schema breaking change (e.g. dropping columns/tables), removing a deprecated route or component prop, requiring new mandatory environment variables. |
| **MINOR** (`0.Y.0`) | New features, backwards-compatible database schema additions (new tables/optional columns with defaults), new optional configuration fields, UI additions. | Adding a new page (e.g., Guestbook), adding optional fields to `AppConfig` or `RegistryItem`, adding non-breaking API endpoints. |
| **PATCH** (`0.0.Z`) | Backwards-compatible bug fixes, security patches, styling fixes, performance improvements, documentation updates. | Fixing a scraper edge case, correcting layout bugs on mobile devices, updating dependencies without API changes. |

---

## 2. Release Notes & Changelog Expectations

Every release published to GitHub and logged in `CHANGELOG.md` must clearly categorize changes into standardized sections. Pushing a `v*` version tag runs [`.github/workflows/publish-artifact.yml`](../.github/workflows/publish-artifact.yml) to promote or build multi-platform GHCR images and then triggers [`.github/workflows/release.yml`](../.github/workflows/release.yml) (`Publish GitHub Release`), which extracts the matching version entry (or `## [Unreleased]` prior to section cutover) from `CHANGELOG.md` via [`scripts/release-integrity.sh`](../scripts/release-integrity.sh) and publishes an OIDC-attested GitHub Release containing `SHA256SUMS`, `sbom-index.spdx.json`, `sbom-amd64.spdx.json`, `sbom-arm64.spdx.json`, and the Track C source archive (`wedding-website-<tag>.tar.gz`). This allows maintainers and downstream adopters to quickly assess the impact of an upgrade and verify artifact integrity before deploying.

### Categorization Standards

Every release entry in `CHANGELOG.md` MUST include an explicit header indicating whether adopter action is required (`Adopter Action Required: Yes | No`), followed by these distinct categories (omitting empty categories):

1. **🚀 Application Changes**: UI improvements, feature additions, bug fixes, client/server refactoring.
2. **🗄️ Schema Changes**: Prisma database schema updates, new database models, column additions/modifications, and associated migration scripts (`prisma/migrations/`).
3. **⚙️ Configuration Changes**: Changes to `AppConfig` schema (`src/features/content/schemas.ts`), feature flags, or environment variables (`src/env.ts`, `.env.example`).
4. **🐳 Deployment & Infrastructure Changes**: Updates to Docker configuration (`Dockerfile`, `docker-compose.yml`), CI/CD workflows (`.github/workflows/`), runtime Node.js requirements, or hosting specifications.
5. **⚠️ Breaking Changes & Migration Guide**: Step-by-step instructions required for adopters upgrading across breaking changes.

### Standard Release Note Template

```markdown
## [1.2.0] - 2026-10-15

> **Adopter Action Required**: Yes (Database migration required)

### 🚀 Application Changes
- Added RSVP status filter in Admin Guest Management dashboard.
- Fixed 3D heart animation stutter on iOS WebKit browsers.

### 🗄️ Schema Changes
- Added `isPlusOne` column with `@default(false)` to `Contributor` model (`prisma/migrations/20261015_add_contributor_plus_one/`).

### ⚙️ Configuration Changes
- Added optional `showAddToCalendar` toggle to `AppConfig` schema.

### 🐳 Deployment & Infrastructure Changes
- Updated Docker base image digest for `node:22-bookworm-slim`.

### ⚠️ Breaking Changes & Migration Guide
- None (All schema changes are backwards-compatible additions with defaults).
```

---

## 3. Breaking-Change & Deprecation Policy

To prevent unexpected breakage for downstream forks:

1. **Migration Instructions Required**: Any pull request or release containing a breaking change MUST provide explicit migration instructions in the PR description and release notes.
2. **Deprecation Windows**:
   - Before removing or altering an established feature, API route, or component interface, maintainers must flag it as deprecated for **at least one MINOR release cycle** (or a minimum window of 30 days).
   - Code deprecations must be marked using TypeScript `@deprecated` JSDoc annotations and produce runtime warning logs where applicable.
3. **Database Schema Breaking Changes (`Expand-Migrate-Contract`)**:
   - Destructive or non-backward-compatible database alterations (such as column/table drops, renames, type changes, or tightening nullability) must follow the three-phase **Expand-Migrate-Contract** release policy (aligned with [`DEPLOYMENT.md`](../DEPLOYMENT.md), [`ARCHITECTURE.md`](../ARCHITECTURE.md), and [`docs/upgrading.md`](./upgrading.md)):
     - **Phase 1: Expand** *(Minor Release)*: Introduce additive, backward-compatible schema changes only—new tables, nullable columns, `DROP NOT NULL`, or `NOT NULL` columns accompanied by an explicit `DEFAULT`. Automated pre-deployment linting via `npm run lint:migrations` ([`scripts/verify-migration-compatibility.ts`](../scripts/verify-migration-compatibility.ts)) blocks unannotated destructive or `N-1`-incompatible DDL in CI and deployment workflows.
     - **Phase 2: Migrate** *(Transition & Backfill)*: Deploy application code that dual-reads/dual-writes across old and new schema structures (marking superseded code paths `@deprecated`) and backfill existing rows while preserving `N-1` container rollback safety.
     - **Phase 3: Contract** *(Subsequent / Major Release)*: After the deprecation window expires and no active application version queries the obsolete columns or tables, remove the deprecated schema structures in a dedicated migration annotated with a statement-scoped `-- allow-destructive: <reason>` SQL comment (requiring a non-empty `<reason>`).

---

## 4. Database Migration Strategy

Database migrations manage schema transitions safely across upstream and downstream instances.

- **Prisma Migration Files**: All database schema changes must be created using Prisma migration CLI (`npm run migrate:dev -- --name <descriptive_name>`) and committed under `prisma/migrations/`.
- **Association with Releases**: Migration folders in `prisma/migrations/` are immutable and tied directly to the release commit in which they were introduced.
- **Local vs. Production Migration Execution**: Production pipelines and hosts apply migrations with `npx prisma migrate deploy` against `DATABASE_URL` (bound in [`prisma.config.ts`](../prisma.config.ts), or `DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy` behind transaction-mode poolers; containers invoke `./node_modules/.bin/prisma migrate deploy` offline), whereas `npm run migrate:deploy` is reserved for local development environments; see [`docs/upgrading.md`](./upgrading.md) for the canonical environment cascade and host execution tracks.
- **Automated Compatibility Linting (`npm run lint:migrations`)**: [`scripts/verify-migration-compatibility.ts`](../scripts/verify-migration-compatibility.ts) inspects every SQL statement in `prisma/migrations/` during local quality gates, PR checks, and release workflows, rejecting unannotated destructive or `N-1`-incompatible DDL (`DROP TABLE`, `DROP COLUMN`, `RENAME COLUMN`, `RENAME TO`, `DROP CONSTRAINT`, `DROP TYPE`, `TRUNCATE`, `SET NOT NULL`, `SET DATA TYPE`, and `ADD COLUMN ... NOT NULL` without `DEFAULT`) unless explicitly authorized for a Phase 3 contract cleanup via `-- allow-destructive: <reason>`.
- **Non-Destructive Defaults**: All new columns in minor (Phase 1 Expand) releases MUST provide a default value (e.g., `@default("")`, `@default(false)`, `@default(now())`) or be optional (`?`) so existing database rows and `N-1` containers operate without data loss or downtime.

---

## 5. Configuration Migration & Schema Versioning Strategy

Configuration settings (stored in `AppConfig` and defined in `src/features/content/schemas.ts`) must support forward and backward compatibility.

- **Zod Schema Defaults**: New configuration fields added to `AppConfigSchema` must use Zod defaults (e.g., `.default(true)`) or be marked `.optional()`.
- **Graceful Parsing Fallbacks**: When parsing existing database records that lack new configuration fields, Zod schemas automatically apply default values during request validation without throwing runtime errors.
- **Configuration Migrations**: If configuration keys are restructured or renamed:
  1. A database migration or seed handler script must update existing `AppConfig` rows in PostgreSQL.
  2. The Zod schema must support fallback transformation from legacy field names to new field names during the transition window.

---

## 6. Supported-Version Policy & Maintainer Guidelines

### Maintenance Scope
- **Current Major Version**: Full support with active feature additions, bug fixes, and security patches.
- **Previous Major Version (N-1)**: Critical security patches and major bug fixes supported for 6 months after a new major release.

### Maintainer Checklist for Identifying Action Items
When reviewing PRs and tagging releases, maintainers must check if adopters need to take action:

- [ ] Does this PR alter `prisma/schema.prisma` or `prisma/migrations/`? -> **Action Required**: Verify `npm run lint:migrations` passes and instruct adopters to apply migrations per [`docs/upgrading.md`](./upgrading.md) (`npx prisma migrate deploy` in production, `./node_modules/.bin/prisma migrate deploy` in containers, or `npm run migrate:deploy` in local development).
- [ ] Does this PR add or change environment variables in `src/env.ts` or `.env.example`? -> **Action Required**: Update local `.env` files.
- [ ] Does this PR change `AppConfig` or content schemas in `src/features/content/schemas.ts`? -> **Action Required**: Review site settings in Admin UI.
- [ ] Does this PR update `package.json` dependencies or Node engine versions? -> **Action Required**: Run `npm ci`.
- [ ] Does this PR change container setup (`Dockerfile`, `docker-compose.yml`)? -> **Action Required**: Rebuild container image.

If ANY of these apply, flag the release notes with **`Adopter Action Required: Yes`** and document the exact steps in the release notes.
