# Agent & Contributor Guidelines (`AGENTS.md`)

This guide defines the local bootstrap, architecture boundaries, end-to-end authentication conventions, verification commands, and continuous integration guardrails for coding agents and contributors working in this repository.

## 1. Environment Bootstrap

- **Node.js:** v22+
- **Install dependencies:**
  ```bash
  CI=true npm ci
  ```
  *(Setting `CI=true` skips `.githooks` reconfiguration inside non-interactive sandboxes while still running Prisma Client generation and documentation sync via `postinstall`.)*
- **Regenerate Prisma Client (after schema edits):**
  ```bash
  npm run prisma:generate
  ```

## 2. Architecture & Module Boundaries

- **App Router (`src/app/`)**: Next.js pages, layouts, metadata builders, and HTTP route handlers.
- **Core Infrastructure (`src/core/`)**: Authentication (`src/core/auth/`), session helpers, and framework-level services.
- **Feature Modules (`src/features/<domain>/`)**: Domain logic, schemas, services, and repositories. Cross-domain imports must strictly go through each feature's public `index.ts` barrel (`@/features/<domain>`) rather than deep internal paths (`@/features/<domain>/*`), enforced by ESLint (`no-restricted-imports`).
- **Shared Components & Utilities (`src/components/`, `src/lib/`, `src/utils/`, `src/hooks/`)**: Domain-agnostic UI primitives and stateless helpers. Keep runtime code portable and free of personal domains or tenant identifiers (`npm run check:identifiers`).
- **End-to-End Suite (`e2e/`)**: Playwright browser, crawler, metadata, and accessibility specs (`e2e/*.spec.ts`) plus shared E2E helpers (`e2e/helpers/`).

## 3. E2E Authentication & Secret Alignment

- **Centralized Cookie Signing**: All Playwright specs must import cookie generators and context seeders from [`e2e/helpers/auth.ts`](e2e/helpers/auth.ts). Do not duplicate HMAC token-signing functions inside individual `e2e/*.spec.ts` files.
- **Distinct Signing Secrets**:
  - `guest_auth` tokens are verified by [`src/core/auth/guest.server.ts`](src/core/auth/guest.server.ts) using `GUEST_SESSION_SECRET` (never `GUEST_PASSCODE`). Both production runtime validation in [`src/env.ts`](src/env.ts) and `e2e/helpers/auth.ts` require `GUEST_SESSION_SECRET` to be distinct from `GUEST_PASSCODE` and at least 32 characters long in production mode.
  - `admin_auth` tokens are signed and verified with `ADMIN_PASSWORD` (`scrypt:[saltBase64]:[keyBase64]`) per [`src/core/auth/auth.server.ts`](src/core/auth/auth.server.ts).
- **Aligned Local & Container Defaults**:
  - [`playwright.config.ts`](playwright.config.ts), [`docker-compose.yml`](docker-compose.yml), [`.env.test`](.env.test), and [`e2e/helpers/auth.ts`](e2e/helpers/auth.ts) default `GUEST_SESSION_SECRET` to `playwright-e2e-session-secret-32-chars-min` so `npx playwright test` and `TEST_CONTAINER=true npx playwright test` authenticate out of the box.
  - When overriding `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, or `ADMIN_PASSWORD` in shell or CI environments, pass identical values to both the Next.js server/container and the Playwright test process.
- **Loopback Origin Seeding & Pathname Assertions**:
  - Seed E2E cookies across both `http://127.0.0.1:3000` and `http://localhost:3000` via `seedGuestAuthCookies` or `seedAdminAndGuestAuthCookies`.
  - Guest and accessibility specs should assert `new URL(page.url()).pathname` after `page.goto(...)` so unexpected redirects to `/guest/login` or `/admin/login` fail immediately.

## 4. Local Verification & Pre-Push Quality Gates

Before opening a pull request or pushing changes, ensure your branch passes the same checks enforced by [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### Full Local Quality Gate

Run the sequential pre-push quality gate configured in [`scripts/check-quality.ts`](scripts/check-quality.ts):

```bash
npm run quality
# Alias: npm run check:all
```

`npm run quality` executes:
1. Static repository & documentation checks (`check:env-docs`, `check:identifiers`, `check:action-pins`, `check:links`, `check:prisma`, `lint:migrations`, `check:doc-sync`)
2. TypeScript type checking (`npm run typecheck`)
3. ESLint & Knip dead-code analysis (`npm run lint`, `npm run lint:unused`)
4. Static VitePress documentation portal build (`npm run docs:build`)
5. Static Storybook showcase build (`npm run build-storybook`) — prints remediation instructions and removes any partial `storybook-static` output on failure
6. Jest unit & integration test suite (`npm test`)

### Storybook Static Showcase Verification

[`tsconfig.json`](tsconfig.json) excludes `src/mocks` and does not run Webpack bundling over [`.storybook/main.ts`](.storybook/main.ts) or [`.storybook/preview.tsx`](.storybook/preview.tsx). Whenever you modify UI components, `src/**/*.stories.tsx`, `.storybook/*`, or MSW mock handlers in [`src/mocks/handlers.ts`](src/mocks/handlers.ts), verify Storybook compiles cleanly:

```bash
npm run build-storybook
```

- **CI Parity:** Pull requests and pushes to `main` execute an isolated `storybook-build` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) in parallel with `unit-test` and `build`, backed by Webpack 5 filesystem caching (`node_modules/.cache/webpack` and `node_modules/.cache/storybook`).
- **Interactive Development:** Run `npm run storybook` to launch the local Storybook server on port `6006`.
- **Pre-Commit Hook Scope:** `npm run build-storybook` is intentionally kept out of [`.githooks/pre-commit`](.githooks/pre-commit) so local commits stay fast, and `/storybook-static` remains ignored via [`.gitignore`](.gitignore).

### Targeted Verification Commands

- **Static Guardrails Bundle:** `npm run check:static`
  - `npm run check:action-pins` — Verify every external GitHub Action in `.github/workflows/*.yml` is pinned to a full 40-character commit SHA ([`scripts/check-action-pins.ts`](scripts/check-action-pins.ts)).
  - `npm run check:links` — Verify all relative Markdown links resolve to existing repository files ([`scripts/check-doc-links.ts`](scripts/check-doc-links.ts)).
  - `npm run check:identifiers` — Guard against prohibited personal/template identifiers in runtime code ([`scripts/check-personal-identifiers.ts`](scripts/check-personal-identifiers.ts)).
  - `npm run check:env-docs` — Ensure environment variables align with [`.env.example`](.env.example).
  - `npm run check:prisma` & `npm run lint:migrations` — Validate Prisma schema and migration compatibility.
  - `npm run check:doc-sync` — Verify [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`public/openapi.json`](public/openapi.json) match current schemas (`npx tsx scripts/generate-openapi.ts && npx tsx scripts/generate-docs.ts`).
- **Typecheck & Linting:** `npm run typecheck && npm run lint && npm run lint:unused`
  - ESLint enforces single quotes, 2-space indentation, semicolons, and import boundaries. Do not disable ESLint rules in [`eslint.config.mjs`](eslint.config.mjs) or Axe rules in [`src/a11y-config.ts`](src/a11y-config.ts).
  - Knip ([`knip.json`](knip.json)) enforces strict unused file, export, and type analysis; export only symbols imported by entry files.
- **Documentation Portal:** `npm run docs:build` — Stages architectural and testing docs via [`scripts/generate-portal.ts`](scripts/generate-portal.ts) and compiles the VitePress documentation portal.
- **Targeted Unit Tests:** `npx jest <path/to/file.test.ts> --coverage=false` (use `npm test` for the full suite with isolated `wedding_test` database setup and coverage thresholds).
- **Production Next.js Build:** `npm run build`
- **End-to-End Browser Tests:** `npx playwright test`

## 5. Repository Conventions & Guardrails

- **Feature Module Boundaries:** Import cross-feature code strictly through public barrel files (`@/features/<feature>`) rather than deep internal paths (`@/features/<feature>/*`).
- **Action Pinning:** Always pin third-party GitHub Actions to 40-character commit SHAs with a trailing version comment (e.g., `# v7.0.1`).
- **Further Reading:** See [Developer Setup Guide](docs/developer-setup.md), [Testing Strategy](.github/TESTING.md), and [Contribution Guidelines](.github/CONTRIBUTING.md).
