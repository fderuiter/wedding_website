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

Every release published to GitHub and logged in `CHANGELOG.md` must clearly categorize changes into standardized sections. This allows maintainers and downstream adopters to quickly assess the impact of an upgrade.

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
- Updated Docker base image to `node:22-alpine`.

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
3. **Database Schema Breaking Changes**:
   - Destructive database alterations (such as column renames or table deletions) must be executed in a two-phase release process:
     - **Phase 1 (Minor Release)**: Introduce the new column/model alongside the old one and mirror writes or support legacy fallback. Mark the old field as `@deprecated`.
     - **Phase 2 (Major Release)**: Remove the deprecated field and finalize the migration after the deprecation window expires.

---

## 4. Database Migration Strategy

Database migrations manage schema transitions safely across upstream and downstream instances.

- **Prisma Migration Files**: All database schema changes must be created using Prisma migration CLI (`npm run migrate:dev -- --name <descriptive_name>`) and committed under `prisma/migrations/`.
- **Association with Releases**: Migration folders in `prisma/migrations/` are immutable and tied directly to the release commit in which they were introduced.
- **Downstream Execution**: Downstream adopters execute `npm run migrate:deploy` (`npx prisma migrate deploy`), which inspects the `_prisma_migrations` tracking table in PostgreSQL and applies only unapplied migrations.
- **Non-Destructive Defaults**: All new columns in minor releases MUST provide a default value (e.g., `@default("")`, `@default(false)`, `@default(now())`) or be optional (`?`) so existing database rows migrate without data loss or downtime.

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

- [ ] Does this PR alter `prisma/schema.prisma`? -> **Action Required**: Run `npm run migrate:deploy`.
- [ ] Does this PR add or change environment variables in `src/env.ts` or `.env.example`? -> **Action Required**: Update local `.env` files.
- [ ] Does this PR change `AppConfig` or content schemas in `src/features/content/schemas.ts`? -> **Action Required**: Review site settings in Admin UI.
- [ ] Does this PR update `package.json` dependencies or Node engine versions? -> **Action Required**: Run `npm ci`.
- [ ] Does this PR change container setup (`Dockerfile`, `docker-compose.yml`)? -> **Action Required**: Rebuild container image.

If ANY of these apply, flag the release notes with **`Adopter Action Required: Yes`** and document the exact steps in the release notes.
