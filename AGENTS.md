# Agent & Contributor Guidelines

This document defines architecture boundaries, local verification commands, and end-to-end authentication conventions for automated agents and contributors working in this repository.

## 1. Architecture & Module Boundaries

- **App Router (`src/app/`)**: Next.js pages, layouts, metadata builders, and HTTP route handlers.
- **Core Infrastructure (`src/core/`)**: Authentication (`src/core/auth/`), session helpers, and framework-level services.
- **Feature Modules (`src/features/<domain>/`)**: Domain logic, schemas, services, and repositories. Cross-domain imports must strictly go through each feature's public `index.ts` barrel (`@/features/<domain>`), enforced by ESLint (`no-restricted-imports`).
- **Shared Components & Utilities (`src/components/`, `src/lib/`, `src/utils/`, `src/hooks/`)**: Domain-agnostic UI primitives and stateless helpers. Keep runtime code portable and free of personal domains or tenant identifiers (`npm run check:identifiers`).
- **End-to-End Suite (`e2e/`)**: Playwright browser, crawler, metadata, and accessibility specs (`e2e/*.spec.ts`) plus shared E2E helpers (`e2e/helpers/`).

## 2. E2E Authentication & Secret Alignment

- **Centralized Cookie Signing**: All Playwright specs must import cookie generators and context seeders from [e2e/helpers/auth.ts](e2e/helpers/auth.ts). Do not duplicate HMAC token-signing functions inside individual `e2e/*.spec.ts` files.
- **Distinct Signing Secrets**:
  - `guest_auth` tokens are verified by [src/core/auth/guest.server.ts](src/core/auth/guest.server.ts) using `GUEST_SESSION_SECRET` (never `GUEST_PASSCODE`). Both production runtime validation in [src/env.ts](src/env.ts) and `e2e/helpers/auth.ts` require `GUEST_SESSION_SECRET` to be distinct from `GUEST_PASSCODE` and at least 32 characters long in production mode.
  - `admin_auth` tokens are signed and verified with `ADMIN_PASSWORD` (`scrypt:[saltBase64]:[keyBase64]`) per [src/core/auth/auth.server.ts](src/core/auth/auth.server.ts).
- **Aligned Local & Container Defaults**:
  - [playwright.config.ts](playwright.config.ts), [docker-compose.yml](docker-compose.yml), [.env.test](.env.test), and [e2e/helpers/auth.ts](e2e/helpers/auth.ts) default `GUEST_SESSION_SECRET` to `playwright-e2e-session-secret-32-chars-min` so `npx playwright test` and `TEST_CONTAINER=true npx playwright test` authenticate out of the box.
  - When overriding `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, or `ADMIN_PASSWORD` in shell or CI environments, pass identical values to both the Next.js server/container and the Playwright test process.
- **Loopback Origin Seeding & Pathname Assertions**:
  - Seed E2E cookies across both `http://127.0.0.1:3000` and `http://localhost:3000` via `seedGuestAuthCookies` or `seedAdminAndGuestAuthCookies`.
  - Guest and accessibility specs should assert `new URL(page.url()).pathname` after `page.goto(...)` so unexpected redirects to `/guest/login` or `/admin/login` fail immediately.

## 3. Quality Gates & Verification Commands

Run these checks locally before opening or updating a pull request:

- `npm run lint` — ESLint code style and import boundary checks (single quotes, 2-space indent, semicolons, no unused imports). Do not disable ESLint rules in [eslint.config.mjs](eslint.config.mjs) or Axe rules in [src/a11y-config.ts](src/a11y-config.ts).
- `npm run lint:unused` — Knip strict unused file, export, and type analysis ([knip.json](knip.json)). Export only symbols that are imported by entry files.
- `npm run typecheck` — TypeScript compiler check (`tsc --noEmit`).
- `npm run check:static` — Environment variable docs sync, personal identifier scan, 40-character GitHub Action SHA pin validation, Markdown relative link check, Prisma schema validation, migration compatibility, and OpenAPI/Architecture drift verification.
- `npm run docs:build` — Stages architectural and testing docs via [scripts/generate-portal.ts](scripts/generate-portal.ts) and compiles the VitePress documentation portal.
- `npm test` — Jest unit and integration suite with isolated `wedding_test` database setup.
- `npx playwright test` — End-to-end and Axe accessibility verification (see [.github/TESTING.md](.github/TESTING.md)).
