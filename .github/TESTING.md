# Testing Strategy

This document outlines the testing strategy, test architecture, and quality assurance workflows for the wedding website project. The project maintains an automated, full-coverage testing suite enforced across unit, integration, accessibility, and end-to-end quality gates in continuous integration.

## Tech Stack

- **Unit & Integration Framework:** [Jest](https://jestjs.io/)
- **Component Testing Utilities:** [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- **Environment:** [JSDOM](https://github.com/jsdom/jsdom) to simulate browser environments for component tests.
- **End-to-End Testing:** [Playwright](https://playwright.dev/) for headless browser automation.
- **Language:** TypeScript, with tests written in `.test.ts` and `.test.tsx` files.
- **Database & ORM:** [Prisma](https://www.prisma.io/) with automated PostgreSQL container isolation via Docker Compose.

## How to Run Tests

### Running Unit & Integration Tests

You can run the entire unit and integration test suite using:

```bash
npm test
```

You can also run Jest in watch mode during development:

```bash
npm run test:watch
```

To run Jest with coverage reporting:

```bash
npm run test:cov
```

### Pretest Lifecycle & Database Automation

Before Jest executes, npm automatically triggers the `pretest`, `pretest:watch`, and `pretest:cov` lifecycle hooks in [package.json](../package.json), invoking [scripts/pretest.mjs](../scripts/pretest.mjs). This orchestrates dependency synchronization, database containerization, and schema isolation:

1. **Dependency Alignment:** Verifies `package-lock.json` SHA-256 hash consistency against `node_modules/.package-lock-hash`. If packages are missing or lockfile changes are detected, it triggers a clean installation (`npm ci`).
2. **Lifecycle-Aware Execution:** Inspects `npm_lifecycle_event` — when the lifecycle event includes `test` (`npm test`, `npm run test:watch`, `npm run test:cov`, `npm run pretest`), it runs the unit/integration preparation steps below; if invoked directly outside a `*test*` lifecycle event, it falls back to running a full `npm run build`.
3. **Accessibility Violation Reset:** Initializes `test-results/jest-a11y-violations.json` to `[]` before Jest runs component-level `jest-axe` assertions.
4. **PostgreSQL Container Orchestration & Graceful Fallback:** Checks if Docker is active (`docker info`). If running, it starts the local PostgreSQL container via `docker compose -f docker-compose.yml -f docker-compose.ci.yml up -d db` and polls `pg_isready -U wedding` until ready; if Docker is unavailable, it logs a notice and falls back gracefully to existing PostgreSQL connections.
5. **Strict Test Environment Isolation:** Clears parent shell database and admin variables (`DATABASE_URL`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, `PGDATASOURCE`, `ADMIN_PASSWORD`) and loads dedicated test settings from [`.env.test`](../.env.test) (`GUEST_PASSCODE="build-fallback-guest-passcode"`, `GUEST_SESSION_SECRET="playwright-e2e-session-secret-32-chars-min"`), targeting the isolated `wedding_test` database (`postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public`) so test runs never modify local development data.
6. **Schema Synchronization & Prisma Generation:** Pushes the current schema to `wedding_test` via `npx prisma db push --accept-data-loss` and runs `npm run prisma:generate` so Prisma Client stays aligned with active models.
7. **Documentation Portal Staging:** Runs `npx tsx scripts/generate-portal.ts` ([`scripts/generate-portal.ts`](../scripts/generate-portal.ts)) to validate relative Markdown links, synchronize OpenAPI/architecture docs, and stage `docs-portal/development/` before Jest executes portal verification suites.

## Test Structure & Architecture

Tests are modular and co-located with their respective application domains and features:

- **Feature Modules:** Feature-specific services, repositories, schemas, and integration suites live in `src/features/<feature>/__tests__/`. For example:
  - Feature service tests: [src/features/registry/__tests__/service.test.ts](../src/features/registry/__tests__/service.test.ts)
  - Admin feature tests: `src/features/admin/__tests__/`
  - Broadcast feature tests: `src/features/broadcast/__tests__/service.test.ts`
  - Seating service tests: `src/features/seating/__tests__/admin.service.test.ts`
  - Content integration tests: `src/features/content/__tests__/content.integration.test.ts`
- **Core Infrastructure & Authentication:** Framework-level utilities, server components, and security logic reside in `src/core/<module>/__tests__/`. For example:
  - Infrastructure service tests: [src/core/infrastructure/__tests__/service.test.ts](../src/core/infrastructure/__tests__/service.test.ts)
  - Admin auth & session tests: `src/core/auth/__tests__/adminAuth.test.ts`
- **UI Components:** Reusable React component tests are located in `src/components/__tests__/` as well as domain subdirectories such as `src/components/ui/__tests__/`, `src/components/admin/__tests__/`, and `src/components/photos/__tests__/`.
- **API Route Handlers:** HTTP endpoint handlers and route middleware tests are located in `src/app/api/__tests__/` and respective sub-route directories (e.g. `src/features/registry/api/__tests__/`).
- **Shared Libraries & Utilities:** Common utilities, formatting helpers, and configuration parsers are tested in `src/utils/__tests__/` and `src/lib/__tests__/`.
- **End-to-End Specs:** Multi-step guest and administrative browser workflows are located in `e2e/`.

## Quality Gates & Verification Workflows

The codebase enforces strict quality gates in [jest.config.mjs](../jest.config.mjs) and GitHub Actions continuous integration ([.github/workflows/ci.yml](workflows/ci.yml)).

### Jest Coverage Thresholds

Global coverage thresholds are actively enforced in [jest.config.mjs](../jest.config.mjs). Pull requests that drop global test coverage below these thresholds fail CI:

- **Lines:** 80%
- **Branches:** 68%

### Verification & Quality Scripts

A variety of verification scripts in [package.json](../package.json) support comprehensive local validation and CI quality gates:

- **Unit & Integration Suite:**
  ```bash
  npm test
  ```
  Runs pretest container automation followed by Jest in sequential band execution (`jest --runInBand`).

- **Playwright End-to-End & Smoke Tests:**
  ```bash
  npm run test:e2e
  # Fast smoke subset (@smoke):
  npm run test:e2e:smoke
  ```
  Executes browser-based end-to-end tests in bundled Chromium against `http://localhost:3000` backed by the isolated `wedding_test` database (honoring optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` overrides when set).
  - **Automated `wedding_test` Bootstrap:** When `CI` and `TEST_CONTAINER` are unset, [playwright.config.ts](../playwright.config.ts) automatically starts the Docker Compose PostgreSQL `db` container (if Docker is running), synchronizes the schema (`npx prisma db push --accept-data-loss`), and seeds `AppConfig` (`npx tsx scripts/seed.ts`) in `wedding_test` before launching `npm run dev` on `http://localhost:3000` and probing `/api/ready`.
  - **Isolated Server Lifecycle & Explicit Reuse Opt-In:** [playwright.config.ts](../playwright.config.ts) disables `reuseExistingServer` by default so Playwright never silently reuses a running `npm run dev` process bound to `.env` (which targets the `wedding` development database and uses local `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, and `ADMIN_PASSWORD` values that cause `src/core/auth/guest.server.ts` to reject E2E cookies). Stop any running `npm run dev` on port `3000` before running `npm run test:e2e` (`npx playwright test`), or set `PLAYWRIGHT_REUSE_SERVER=true` (when `CI` is unset) only when the existing server explicitly targets `wedding_test` and shares aligned E2E session secrets.
  - **E2E Cookie Signing & Secret Alignment:** Playwright specs authenticate using shared helpers in [e2e/helpers/auth.ts](../e2e/helpers/auth.ts), which sign `guest_auth` cookies with `GUEST_SESSION_SECRET` and `admin_auth` cookies with a domain-separated HMAC key derived from the decoded 64-byte `ADMIN_PASSWORD` scrypt hash across both `http://127.0.0.1:3000` and `http://localhost:3000`.
  - **Default Local & Container Secrets:** [playwright.config.ts](../playwright.config.ts), [docker-compose.ci.yml](../docker-compose.ci.yml), [.env.test](../.env.test), and [e2e/helpers/auth.ts](../e2e/helpers/auth.ts) all align on the default 32+-character `GUEST_SESSION_SECRET` (`playwright-e2e-session-secret-32-chars-min`) and 64-byte E2E `ADMIN_PASSWORD` scrypt hash. For `GUEST_PASSCODE`, `playwright.config.ts`, `docker-compose.ci.yml`, and `e2e/helpers/auth.ts` default to `playwright-e2e-guest-passcode` (so `npx playwright test` and `TEST_CONTAINER=true npx playwright test` work without manual secret configuration when using `-f docker-compose.yml -f docker-compose.ci.yml`), whereas `.env.test` (loaded by `scripts/pretest.mjs` for Jest runs) sets `GUEST_PASSCODE` to `build-fallback-guest-passcode`.
  - **Custom Secret Overrides:** When overriding `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, or `ADMIN_PASSWORD` locally or in CI, provide identical values to both the application server (or container) and the Playwright runner, ensuring `GUEST_SESSION_SECRET` is at least 32 characters long and never matches `GUEST_PASSCODE`.

- **Accessibility (A11y) Audits:**
  ```bash
  # Fast component-only jest-axe checks (42 src/ suites, no Docker required):
  npm run test:a11y:unit

  # Full component + @a11y Playwright WCAG 2.2 AA audit:
  npm run test:a11y
  ```
  `npm run test:a11y:unit` runs [scripts/a11y-report.mjs](../scripts/a11y-report.mjs) (`--unit`), executing only the 42 `src/` `jest-axe` suites with `--coverage=false` and recording component violations to `test-results/jest-a11y-violations.json`. `npm run test:a11y` runs `scripts/a11y-report.mjs` (`--run`), which cleans `test-results/`, runs the targeted `--unit` component pass, reseeds `wedding_test` via `npx tsx scripts/seed.ts` ([scripts/seed.ts](../scripts/seed.ts)) to restore valid `AppConfig` data wiped by Jest integration teardowns (skipping `<SetupWizard />` in `src/app/layout.tsx`), runs `npx playwright test --grep @a11y`, and writes unfiltered WCAG 2.2 AA violations to `test-results/a11y-summary.md` (for production standalone mode, run `npm run build && CI=true npm run test:a11y`).

- **Standalone Server Smoke Test:**
  ```bash
  npm run build
  npm run check:standalone -- --require-standalone
  npm run test:standalone
  ```
  Verifies post-build standalone asset staging (`.next/standalone/server.js`, `.next/standalone/.next/static`, and `.next/standalone/public` via [`scripts/check-docker-build.ts`](../scripts/check-docker-build.ts)) and runs [`scripts/test-standalone.mjs`](../scripts/test-standalone.mjs) + [`scripts/smoke-runner.mjs`](../scripts/smoke-runner.mjs) to check PostgreSQL TCP readiness (`pg_isready -h localhost`), clean migrations (`POSTGRES_URL_NON_POOLING` unset), `/assets/favicon.png`, `/api/ready`, `/api/registry/validate-code`, and authenticated `/api/registry/items`.
  > **Warning:** `npm run test:standalone` requires running `npm run build` beforehand (it exits immediately if `.next/standalone/server.js`, `.next/standalone/.next/static`, or `.next/standalone/public` is missing) and executes `docker compose down -v` (with `-f docker-compose.yml -f docker-compose.ci.yml`) at startup and cleanup, **deleting local Docker Compose PostgreSQL volumes (`db_data`)**.

- **OCI Container Smoke Test:**
  ```bash
  npm run test:container
  ```
  Runs [`scripts/test-container.mjs`](../scripts/test-container.mjs) with [`docker-compose.ci.yml`](../docker-compose.ci.yml) to build the production Docker container, execute the containerized `migration` service (`docker compose -f docker-compose.yml -f docker-compose.ci.yml run --rm migration`) by default even when `node_modules/.bin/prisma` exists on the host, and verify schema readiness, static assets, authenticated data-backed routes, `pg.Pool` connection bounds, and `SIGTERM` draining.
  > **Warning:** Like `npm run test:standalone`, `npm run test:container` executes `docker compose down -v` (with `-f docker-compose.yml -f docker-compose.ci.yml`) at startup and cleanup, **wiping local Docker Compose PostgreSQL volumes (`db_data`)**.

- **Static Repository & Document Checks:**
  ```bash
  npm run check:static
  ```
  Executes all ten static verification gates configured in `package.json`:
  - `npm run check:env-docs`: Validates environment variable documentation alignment across `.env.example` and deployment guides.
  - `npm run check:runbooks`: Validates deployment runbooks against workflows, Docker Compose, and Prisma 7 contracts.
  - `npm run check:identifiers`: Scans for accidentally committed personal/template identifiers.
  - `npm run check:action-pins`: Validates strict YAML 1.2 workflow syntax across `.github/workflows/` and ensures GitHub Actions workflow actions are pinned to full 40-character commit SHAs.
  - `npm run check:links`: Verifies that internal Markdown document links resolve cleanly without broken references.
  - `npm run check:spec-contracts`: Verifies that `/api/*` routes, HTTP methods, dynamic admin `ENTITY_KEY` slugs, and TypeScript symbols cited in architectural Markdown specs match live source files.
  - `npm run check:prisma`: Validates Prisma schema formatting and relations.
  - `npm run lint:migrations`: Verifies database migration compatibility.
  - `npm run check:doc-sync`: Verifies generated OpenAPI (`public/openapi.json`), architecture (`ARCHITECTURE.md`), and feature module (`FEATURE_MODULES.md`) documentation match current schemas.
  - `npm run check:setup-guides`: Verifies setup, contributor, and testing guides stay aligned with `.env.example`, `.env.test`, `package.json`, `.githooks/pre-commit`, `scripts/check-quality.ts`, and `tsconfig.json`.

- **Storybook Static Showcase Build:**
  ```bash
  npm run build-storybook
  ```
  Compiles component stories (`src/**/*.stories.tsx`), Storybook configuration ([.storybook/main.ts](../.storybook/main.ts), [.storybook/preview.tsx](../.storybook/preview.tsx)), and MSW mock handlers ([src/mocks/handlers.ts](../src/mocks/handlers.ts)) via Webpack 5, matching the parallel `storybook-build` CI job in [.github/workflows/ci.yml](workflows/ci.yml). Use `npm run storybook` for interactive component development.

- **Complete Quality Gate:**
  ```bash
  npm run quality
  # or
  npm run check:all
  ```
  Runs the full sequential suite in [scripts/check-quality.ts](../scripts/check-quality.ts) — including static verifications, TypeScript and linter passes, documentation portal and Storybook static builds (`npm run docs:build`, `npm run build-storybook`), and unit/integration tests — prior to pushing (see also [AGENTS.md](../AGENTS.md)).

## Writing New Tests

When contributing new functionality:

1. **Feature Co-location:** Place tests in a `__tests__` directory adjacent to the feature, component, or utility being introduced.
2. **User-Centric Component Tests:** Use React Testing Library to test behavior from an end-user or accessibility perspective, avoiding reliance on internal component implementation details.
3. **Database Operations:** Leverage the isolated test database environment. Do not hardcode production or development credentials in test files.
4. **Maintain Coverage:** Ensure new code includes sufficient unit and integration test coverage to uphold the global threshold standards (80% lines, 68% branches).
