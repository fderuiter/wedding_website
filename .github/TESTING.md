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

Run the unit and integration test suite without coverage instrumentation for fast local iteration:

```bash
npm test

# Run a single targeted test file:
npm test -- src/utils/__tests__/ApiError.test.ts
```

Run Jest in interactive watch mode during active development (without coverage overhead or global threshold failures):

```bash
npm run test:watch
```

Run the full suite with global coverage threshold enforcement (`80%` lines, `68%` branches) and lightweight terminal + `coverage/lcov.info` output:

```bash
npm run test:cov

# Explicitly build full interactive HTML coverage reports alongside lcov/json/clover:
npm run test:cov:html
```

### Pretest Lifecycle & Database Automation

Before Jest executes, npm automatically triggers the `pretest`, `pretest:watch`, and `pretest:cov` lifecycle hooks in [package.json](../package.json), invoking [scripts/pretest.mjs](../scripts/pretest.mjs). Preflight steps combine CI-aware dependency/database preservation with local caching so warm targeted runs stay fast:

1. **CI-Aware Dependency Alignment & Strict `npm ci`:** Treats `node_modules` as aligned when `CI=true` with an existing `node_modules/.package-lock.json` or when `node_modules/.package-lock-hash` (initialized during `npm ci` via `postinstall` running `node scripts/pretest.mjs --record-install-state`) matches the SHA-256 digest of `package-lock.json`. When local dependencies are missing or lockfile drift is detected, it runs strict `npm ci` (enforcing peer dependency checks) and records `node_modules/.package-lock-hash`.
2. **Accessibility Violation Reset:** Resets `test-results/jest-a11y-violations.json` to `[]` before every Jest run so component-level `jest-axe` assertions report only current violations.
3. **Test Environment Isolation, `CI=true` Preservation & `TEST_DATABASE_URL` Override:** Both `scripts/pretest.mjs` and [jest.setup.js](../jest.setup.js) honor explicit `TEST_DATABASE_URL` overrides (when targeting a custom PostgreSQL instance) or preserve the caller's `DATABASE_URL` when `CI=true`, while still loading test defaults from [`.env.test`](../.env.test) (`GUEST_PASSCODE="build-fallback-guest-passcode"`, `GUEST_SESSION_SECRET="playwright-e2e-session-secret-32-chars-min"`). Locally (when neither `CI=true` nor `TEST_DATABASE_URL` is set), they clear parent shell database and admin variables (`DATABASE_URL`, `POSTGRES_URL_NON_POOLING`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, `PGDATASOURCE`, `ADMIN_PASSWORD`) and target the isolated `wedding_test` database (`postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public`) so test runs never modify local development data.
4. **TCP Readiness Probing & Conditional PostgreSQL Container Startup:** Probes TCP readiness on the host and port parsed from `DATABASE_URL` (`node:net`) before invoking Docker Compose. When a PostgreSQL listener already accepts connections (such as GitHub Actions `services.db` or an active local database) or when `CI=true`, `docker compose up -d db` is skipped. Locally, when the target port is offline and Docker (`docker info`) is running, it starts the container via `docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml up -d db` and polls `pg_isready -U wedding` until ready; if Docker is unavailable, it logs a notice and falls back gracefully.
5. **Cached Migration Synchronization & Conditional Prisma Client Generation:** Ensures isolated test databases (`wedding_test`) exist and tracks `prisma/schema.prisma`, `prisma/migrations/`, and target database URL state in `node_modules/.cache/pretest-state.json`, skipping repeated `npx prisma migrate deploy` (which automatically resets unbaselined `prisma db push` schemas on Prisma error `P3005` and retries once) and `npm run prisma:generate` executions when committed migrations and `node_modules/.prisma/client` are already up to date (including skipping duplicate generation after `postinstall` in CI). Documentation portal staging is intentionally omitted from preflight and handled directly by dedicated portal suites ([`src/__tests__/generate-portal.test.ts`](../src/__tests__/generate-portal.test.ts)) and `npm run docs:build`.

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

Global coverage thresholds are enforced in [jest.config.mjs](../jest.config.mjs) during dedicated coverage runs (`npm run test:cov`), `npm run quality`, and the `unit-test` CI job across all matched `src/**/*.{ts,tsx}` files (while skipped during standard `npm test` and `npm run test:watch` runs for fast local iteration). Pull requests that drop global test coverage below these thresholds fail CI:

- **Lines:** 80%
- **Branches:** 68%

By default, `npm run test:cov` emits lightweight `text-summary` terminal output and `coverage/lcov.info` (`lcovonly`). Run `npm run test:cov:html` (or set `COVERAGE_HTML=true`) when you need full interactive HTML reports under `coverage/`.

### Verification & Quality Scripts

A variety of verification scripts in [package.json](../package.json) support comprehensive local validation and CI quality gates:

- **Unit, Integration & Coverage Suites:**
  ```bash
  npm test
  npm run test:cov
  ```
  `npm test` runs cached preflight automation followed by `jest --runInBand` without coverage instrumentation, while `npm run test:cov` runs `jest --coverage --maxWorkers=1` to generate `coverage/lcov.info` and enforce global coverage thresholds.

- **Playwright End-to-End & Smoke Tests:**
  ```bash
  npm run test:e2e
  # Fast smoke subset (@smoke):
  npm run test:e2e:smoke
  ```
  Executes browser-based end-to-end tests in bundled Chromium against `http://localhost:3000` backed by the isolated `wedding_test` database (honoring optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` overrides when set). `npm run test:e2e:smoke` (`playwright test --grep @smoke`) runs the targeted fast smoke specs ([e2e/guest-callback-url.spec.ts](../e2e/guest-callback-url.spec.ts), [e2e/meta.spec.ts](../e2e/meta.spec.ts), and [e2e/skip-link.spec.ts](../e2e/skip-link.spec.ts)) while excluding slow route crawlers in [e2e/crawler.spec.ts](../e2e/crawler.spec.ts) and route violation writers in [e2e/verification.spec.ts](../e2e/verification.spec.ts). In [.github/workflows/ci.yml](workflows/ci.yml), `e2e-test` (`npx playwright test`) and `container-e2e-smoke` (`TEST_CONTAINER=true npm run test:e2e:smoke` against `wedding-website-container`) start immediately in parallel once `build` succeeds without waiting for `unit-test`.
  - **Automated `wedding_test` Bootstrap:** When `CI` and `TEST_CONTAINER` are unset, [playwright.config.ts](../playwright.config.ts) automatically starts the Docker Compose PostgreSQL `db` container (if Docker is running), synchronizes the schema (`npx prisma db push --accept-data-loss`), and seeds `AppConfig` (`npx tsx scripts/seed.ts`) in `wedding_test` before launching `npm run dev` on `http://localhost:3000` and probing `/api/ready`.
  - **Isolated Server Lifecycle & Explicit Reuse Opt-In:** [playwright.config.ts](../playwright.config.ts) disables `reuseExistingServer` by default so Playwright never silently reuses a running `npm run dev` process bound to `.env` (which targets the `wedding` development database and uses local `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, and `ADMIN_PASSWORD` values that cause `src/core/auth/guest.server.ts` to reject E2E cookies). Stop any running `npm run dev` on port `3000` before running `npm run test:e2e` (`npx playwright test`), or set `PLAYWRIGHT_REUSE_SERVER=true` (when `CI` is unset) only when the existing server explicitly targets `wedding_test` and shares aligned E2E session secrets.
  - **E2E Cookie Signing & Secret Alignment:** Playwright specs authenticate using shared helpers in [e2e/helpers/auth.ts](../e2e/helpers/auth.ts), which sign `guest_auth` cookies with `GUEST_SESSION_SECRET` and `admin_auth` cookies with a domain-separated HMAC key derived from the decoded 64-byte `ADMIN_PASSWORD` scrypt hash across both `http://127.0.0.1:3000` and `http://localhost:3000`.
  - **Default Local & Container Secrets:** [playwright.config.ts](../playwright.config.ts), [.env.ci](../.env.ci), [docker-compose.ci.yml](../docker-compose.ci.yml), [.env.test](../.env.test), and [e2e/helpers/auth.ts](../e2e/helpers/auth.ts) all align on the default 32+-character `GUEST_SESSION_SECRET` (`playwright-e2e-session-secret-32-chars-min`) and 64-byte E2E `ADMIN_PASSWORD` scrypt hash. For `GUEST_PASSCODE`, `playwright.config.ts`, `.env.ci`, `docker-compose.ci.yml`, and `e2e/helpers/auth.ts` default to `playwright-e2e-guest-passcode` (so `npx playwright test` and `TEST_CONTAINER=true npm run test:e2e:smoke` work on clean checkouts without `.env` or manual secret configuration when using `docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml`), whereas `.env.test` (loaded by `scripts/pretest.mjs` for Jest runs) sets `GUEST_PASSCODE` to `build-fallback-guest-passcode`.
  - **Custom Secret Overrides:** When overriding `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, or `ADMIN_PASSWORD` locally or in CI, provide identical values to both the application server (or container) and the Playwright runner, ensuring `GUEST_SESSION_SECRET` is at least 32 characters long and never matches `GUEST_PASSCODE`.

- **Accessibility (A11y) Audits:**
  ```bash
  # Fast component-only jest-axe checks (67 src/ suites, no Docker required):
  npm run test:a11y:unit

  # Standalone static showcase light & dark WCAG 2.2 AA audit (no Docker or database required):
  NEXT_PUBLIC_BASE_PATH="/wedding_website/demo" npm run build:export
  NEXT_PUBLIC_BASE_PATH="/wedding_website/demo" npm run test:a11y:static

  # Full component + @a11y Playwright WCAG 2.2 AA audit:
  npm run test:a11y
  ```
  `npm run test:a11y:unit` runs [scripts/a11y-report.mjs](../scripts/a11y-report.mjs) (`--unit`), executing only the 67 `src/` `jest-axe` suites with `--coverage=false` and recording component violations to `test-results/jest-a11y-violations.json`. `npm run test:a11y:static` (`node scripts/a11y-report.mjs --static`, delegating browser execution to `npm run test:e2e:static` via [playwright.static.config.ts](../playwright.static.config.ts) and [scripts/serve-static-export.mjs](../scripts/serve-static-export.mjs)) serves the pre-built `out/` directory under `NEXT_PUBLIC_BASE_PATH` without Docker, PostgreSQL, live Next.js servers, or external network calls, scanning all exported showcase routes in both `light` and `dark` themes (`>= 62` route/theme scans) and writing `test-results/static-a11y-violations.json` + `test-results/a11y-summary.md`. `npm run test:a11y` runs `scripts/a11y-report.mjs` (`--run`), which cleans `test-results/`, runs the targeted `--unit` component pass, reseeds `wedding_test` via `npx tsx scripts/seed.ts` ([scripts/seed.ts](../scripts/seed.ts)) to restore valid `AppConfig` data wiped by Jest integration teardowns (skipping `<SetupWizard />` in `src/app/layout.tsx`), runs `npx playwright test --grep @a11y`, and writes unfiltered WCAG 2.2 AA violations to `test-results/a11y-summary.md` (for production standalone mode, run `npm run build && CI=true npm run test:a11y`). In [.github/workflows/ci.yml](workflows/ci.yml), an isolated `a11y-report` job depends on `unit-test`, `e2e-test`, and `static-export-build` (`if: '!cancelled()'`), downloads `jest-a11y-violations`, `playwright-a11y-violations`, and `static-a11y-violations` (`--include-static`), marks missing suite artifacts as incomplete in `test-results/a11y-summary.md`, and updates the `<!-- a11y-report -->` pull request comment and `$GITHUB_STEP_SUMMARY` even when violations exit non-zero.

- **Standalone Server Smoke Test:**
  ```bash
  npm run build
  npm run check:standalone -- --require-standalone
  npm run test:standalone
  ```
  Verifies post-build standalone asset staging (`.next/standalone/server.js`, `.next/standalone/.next/static`, and `.next/standalone/public` via [`scripts/check-docker-build.ts`](../scripts/check-docker-build.ts)) and runs [`scripts/test-standalone.mjs`](../scripts/test-standalone.mjs) + [`scripts/smoke-runner.mjs`](../scripts/smoke-runner.mjs) to check PostgreSQL TCP readiness (`pg_isready -h localhost`), clean migrations (`POSTGRES_URL_NON_POOLING` unset), `/assets/favicon.png`, `/api/ready`, `/api/registry/validate-code`, authenticated `/api/registry/items`, and worker-based HEIC photo upload transcoding.
  > **Note:** `npm run test:standalone` requires running `npm run build` beforehand (it exits immediately if `.next/standalone/server.js`, `.next/standalone/.next/static`, or `.next/standalone/public` is missing). When `DATABASE_URL` is unset, it selects free loopback `PORT` and `DB_PORT` values (honoring `TEST_PORT` and `DB_PORT` overrides) and runs `docker compose -p wedding-smoke-standalone --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml down -v` at startup and cleanup so isolated smoke volumes are torn down while preserving default local `db_data` and `uploads_data` volumes; when `DATABASE_URL` is set explicitly, it skips starting or tearing down the isolated database container and targets that URL directly.

- **OCI Container Smoke Test:**
  ```bash
  npm run test:container
  ```
  Runs [`scripts/test-container.mjs`](../scripts/test-container.mjs) with [`.env.ci`](../.env.ci) and [`docker-compose.ci.yml`](../docker-compose.ci.yml) to build the production Docker container, execute the containerized `migration` service (`docker compose -p wedding-smoke-container --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml run --rm migration`) by default even when `node_modules/.bin/prisma` exists on the host, and verify schema readiness, static assets, authenticated data-backed routes, worker-based HEIC photo upload transcoding, `pg.Pool` connection bounds, and `SIGTERM` draining.
  > **Note:** `npm run test:container` selects free loopback `PORT` and `DB_PORT` values (honoring `TEST_PORT` and `DB_PORT` overrides without killing existing processes on port `3000`) and executes `docker compose -p wedding-smoke-container --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml down -v` at startup and cleanup, isolating smoke containers and volumes so default local `db_data` and `uploads_data` volumes remain untouched.

- **Static Repository & Document Checks:**
  ```bash
  npm run check:static
  ```
  Executes the shared static verification list in [scripts/check-quality.ts](../scripts/check-quality.ts) (`--static`), matching the `verify` job in [.github/workflows/ci.yml](workflows/ci.yml). For local environment setup, Git hooks ([`.githooks/pre-commit`](../.githooks/pre-commit) and [`.githooks/pre-push`](../.githooks/pre-push)), and generated doc-sync rules, see the [Developer Setup Guide](../docs/developer-setup.md) and [Contribution Guidelines](CONTRIBUTING.md).

- **PostgreSQL Migration Drift Verification (`Verify Prisma Migration Sync`):**
  ```bash
  POSTGRES_URL_NON_POOLING="postgresql://wedding:wedding123@localhost:5432/wedding_shadow?schema=public" \
    npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
  ```
  Mirrors the `Verify Prisma Migration Sync` CI gate in the `unit-test` job of [.github/workflows/ci.yml](workflows/ci.yml), replaying `prisma/migrations/` against an isolated `wedding_shadow` PostgreSQL database bound via [prisma.config.ts](../prisma.config.ts) (`shadowDatabaseUrl`). Ensure `wedding_shadow` exists on your local PostgreSQL container (`docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml exec -T db psql -U wedding -d postgres -c 'CREATE DATABASE wedding_shadow;'`), and run `npm run migrate:dev` to generate and commit forward-only SQL migrations whenever schema drift is detected (exit code `2`).

- **Storybook Static Showcase Build:**
  ```bash
  npm run build-storybook
  ```
  Compiles component stories (`src/**/*.stories.tsx`), Storybook configuration ([.storybook/main.ts](../.storybook/main.ts), [.storybook/preview.tsx](../.storybook/preview.tsx)), and MSW mock handlers ([src/mocks/handlers.ts](../src/mocks/handlers.ts)) via Webpack 5, matching the parallel `storybook-build` CI job in [.github/workflows/ci.yml](workflows/ci.yml) and manual [.github/workflows/storybook.yml](workflows/storybook.yml) workflow (both installing dependencies with `npm ci --ignore-scripts`). Use `npm run storybook` for interactive component development.

- **Static HTML Showcase Build & Subpath Runtime/A11y Audit:**
  ```bash
  NEXT_PUBLIC_BASE_PATH="/wedding_website/demo" npm run build:export
  NEXT_PUBLIC_BASE_PATH="/wedding_website/demo" npm run test:e2e:static
  ```
  Compiles the database-free static HTML showcase (`output: 'export'`) inside `.next/export-stage` without `src/app/api` ([scripts/build-export.mjs](../scripts/build-export.mjs)), isolating export build caches in `.next-export/cache` ([next.config.ts](../next.config.ts)) while preserving `src/app/api` and `.next/standalone` in the repository root, then serves `out/` over loopback via [scripts/serve-static-export.mjs](../scripts/serve-static-export.mjs) and executes [e2e/static/static-showcase.audit.ts](../e2e/static/static-showcase.audit.ts) ([playwright.static.config.ts](../playwright.static.config.ts)) across every exported subpath route in light and dark themes, matching the `static-export-build` CI job in [.github/workflows/ci.yml](workflows/ci.yml) that gates `deploy-docs`.

- **Complete Quality Gate:**
  ```bash
  npm run quality
  # or
  npm run check:all
  ```
  Runs the full sequential suite in [scripts/check-quality.ts](../scripts/check-quality.ts) — including static verifications, TypeScript and linter passes, documentation portal, Storybook, and static HTML showcase builds (`npm run docs:build`, `npm run build-storybook`, `npm run build:export`), and full-coverage unit/integration tests (`npm run test:cov`) — prior to pushing (see also [AGENTS.md](../AGENTS.md)).

## Writing New Tests

When contributing new functionality:

1. **Feature Co-location:** Place tests in a `__tests__` directory adjacent to the feature, component, or utility being introduced.
2. **User-Centric Component Tests:** Use React Testing Library to test behavior from an end-user or accessibility perspective, avoiding reliance on internal component implementation details.
3. **Database Operations:** Leverage the isolated test database environment. Do not hardcode production or development credentials in test files.
4. **Maintain Coverage:** Ensure new code includes sufficient unit and integration test coverage to uphold the global threshold standards (80% lines, 68% branches).
