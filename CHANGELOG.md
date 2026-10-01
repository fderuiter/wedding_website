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

> **Adopter Action Required**: No

### 🚀 Application Changes
- Implemented comprehensive downstream upgrade strategy and documentation (`docs/upgrading.md`).
- Documented semantic versioning policy, release categorization standards, and deprecation protocols (`docs/versioning.md`).

### 🗄️ Schema Changes
- None.

### ⚙️ Configuration Changes
- None.

### 🐳 Deployment & Infrastructure Changes
- Updated PR template (`.github/pull_request_template.md`) and contributing guide (`.github/CONTRIBUTING.md`) with release categorization and adopter action tracking.

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
