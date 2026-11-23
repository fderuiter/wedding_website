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

Before Jest executes, npm automatically triggers the `pretest`, `pretest:watch`, and `pretest:cov` lifecycle hooks in [package.json](../package.json), invoking [scripts/pretest.mjs](../scripts/pretest.mjs). This orchestrates CI-aware dependency alignment, database readiness checks, and schema isolation:

1. **CI-Aware Dependency Alignment & Strict `npm ci`:** Treats `node_modules` as aligned when `CI=true` with an existing `node_modules/.package-lock.json` or when `node_modules/.package-lock-hash` matches the SHA-256 digest of `package-lock.json`. When local dependencies are missing or lockfile drift is detected, it runs strict `npm ci` (enforcing peer dependency checks) and records `node_modules/.package-lock-hash`.
2. **Lifecycle-Aware Execution:** Inspects `npm_lifecycle_event` — when the lifecycle event includes `test` (`npm test`, `npm run test:watch`, `npm run test:cov`, `npm run pretest`), it runs the unit/integration preparation steps below; if invoked directly outside a `*test*` lifecycle event, it falls back to running a full `npm run build`.
3. **Accessibility Violation Reset:** Initializes `test-results/jest-a11y-violations.json` to `[]` before Jest runs component-level `jest-axe` assertions.
4. **Test Environment Isolation & Explicit `DATABASE_URL` Preservation:** Both `scripts/pretest.mjs` and [jest.setup.js](../jest.setup.js) preserve the caller's `DATABASE_URL` when `CI=true` is set or honor `TEST_DATABASE_URL` when targeting a custom PostgreSQL instance, while still loading test defaults from [`.env.test`](../.env.test) (`GUEST_PASSCODE="build-fallback-guest-passcode"`, `GUEST_SESSION_SECRET="playwright-e2e-session-secret-32-chars-min"`). Locally (when neither `CI=true` nor `TEST_DATABASE_URL` is set), they clear parent shell database and admin variables (`DATABASE_URL`, `POSTGRES_URL_NON_POOLING`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, `PGDATASOURCE`, `ADMIN_PASSWORD`) and target the isolated `wedding_test` database (`postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public`) so test runs never modify local development data.
5. **TCP Readiness Probing & Conditional PostgreSQL Container Startup:** Probes TCP readiness on the host and port parsed from `DATABASE_URL` before invoking Docker Compose. When a PostgreSQL listener already accepts connections (such as GitHub Actions `services.db` or an active local database) or when `CI=true`, `docker compose up -d db` is skipped. Locally, when the target port is offline and Docker (`docker info`) is running, it starts the container via `docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml up -d db` and polls `pg_isready -U wedding` until ready; if Docker is unavailable, it logs a notice and falls back gracefully.
6. **Schema Synchronization & Conditional Prisma Generation:** Ensures `wedding_test` exists and applies committed forward-only migrations via `npx prisma migrate deploy` (automatically resetting the `public` schema on `wedding_test` and retrying once if prior local `prisma db push` state triggers Prisma error `P3005`), then runs `npm run prisma:generate` only when `node_modules/.prisma/client` is missing or older than `prisma/schema.prisma` (skipping duplicate generation after `postinstall` in CI).
7. **Stage-Only Documentation Portal Sync:** Runs `npx tsx scripts/generate-portal.ts --stage-only` ([`scripts/generate-portal.ts`](../scripts/generate-portal.ts)) to validate relative Markdown links and stage `docs-portal/` (`docs-portal/development/`) and `openapi.json` without rerunning OpenAPI or architecture AST generators during unit test setup.

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
  Executes browser-based end-to-end tests in bundled Chromium against `http://localhost:3000` backed by the isolated `wedding_test` database (honoring optional `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` overrides when set). `npm run test:e2e:smoke` (`playwright test --grep @smoke`) runs the targeted fast smoke specs ([e2e/guest-callback-url.spec.ts](../e2e/guest-callback-url.spec.ts), [e2e/meta.spec.ts](../e2e/meta.spec.ts), and [e2e/skip-link.spec.ts](../e2e/skip-link.spec.ts)) while excluding slow route crawlers in [e2e/crawler.spec.ts](../e2e/crawler.spec.ts) and route violation writers in [e2e/verification.spec.ts](../e2e/verification.spec.ts). In [.github/workflows/ci.yml](workflows/ci.yml), `e2e-test` (`npx playwright test`) and `container-e2e-smoke` (`TEST_CONTAINER=true npm run test:e2e:smoke` against `wedding-website-container`) start immediately in parallel once `build` succeeds without waiting for `unit-test`.
  - **Automated `wedding_test` Bootstrap:** When `CI` and `TEST_CONTAINER` are unset, [playwright.config.ts](../playwright.config.ts) automatically starts the Docker Compose PostgreSQL `db` container (if Docker is running), synchronizes the schema (`npx prisma db push --accept-data-loss`), and seeds `AppConfig` (`npx tsx scripts/seed.ts`) in `wedding_test` before launching `npm run dev` on `http://localhost:3000` and probing `/api/ready`.
  - **Isolated Server Lifecycle & Explicit Reuse Opt-In:** [playwright.config.ts](../playwright.config.ts) disables `reuseExistingServer` by default so Playwright never silently reuses a running `npm run dev` process bound to `.env` (which targets the `wedding` development database and uses local `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, and `ADMIN_PASSWORD` values that cause `src/core/auth/guest.server.ts` to reject E2E cookies). Stop any running `npm run dev` on port `3000` before running `npm run test:e2e` (`npx playwright test`), or set `PLAYWRIGHT_REUSE_SERVER=true` (when `CI` is unset) only when the existing server explicitly targets `wedding_test` and shares aligned E2E session secrets.
  - **E2E Cookie Signing & Secret Alignment:** Playwright specs authenticate using shared helpers in [e2e/helpers/auth.ts](../e2e/helpers/auth.ts), which sign `guest_auth` cookies with `GUEST_SESSION_SECRET` and `admin_auth` cookies with a domain-separated HMAC key derived from the decoded 64-byte `ADMIN_PASSWORD` scrypt hash across both `http://127.0.0.1:3000` and `http://localhost:3000`.
  - **Default Local & Container Secrets:** [playwright.config.ts](../playwright.config.ts), [.env.ci](../.env.ci), [docker-compose.ci.yml](../docker-compose.ci.yml), [.env.test](../.env.test), and [e2e/helpers/auth.ts](../e2e/helpers/auth.ts) all align on the default 32+-character `GUEST_SESSION_SECRET` (`playwright-e2e-session-secret-32-chars-min`) and 64-byte E2E `ADMIN_PASSWORD` scrypt hash. For `GUEST_PASSCODE`, `playwright.config.ts`, `.env.ci`, `docker-compose.ci.yml`, and `e2e/helpers/auth.ts` default to `playwright-e2e-guest-passcode` (so `npx playwright test` and `TEST_CONTAINER=true npm run test:e2e:smoke` work on clean checkouts without `.env` or manual secret configuration when using `docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml`), whereas `.env.test` (loaded by `scripts/pretest.mjs` for Jest runs) sets `GUEST_PASSCODE` to `build-fallback-guest-passcode`.
  - **Custom Secret Overrides:** When overriding `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, or `ADMIN_PASSWORD` locally or in CI, provide identical values to both the application server (or container) and the Playwright runner, ensuring `GUEST_SESSION_SECRET` is at least 32 characters long and never matches `GUEST_PASSCODE`.

- **Accessibility (A11y) Audits:**
  ```bash
  # Fast component-only jest-axe checks (53 src/ suites, no Docker required):
  npm run test:a11y:unit

  # Full component + @a11y Playwright WCAG 2.2 AA audit:
  npm run test:a11y
  ```
  `npm run test:a11y:unit` runs [scripts/a11y-report.mjs](../scripts/a11y-report.mjs) (`--unit`), executing only the 53 `src/` `jest-axe` suites with `--coverage=false` and recording component violations to `test-results/jest-a11y-violations.json`. `npm run test:a11y` runs `scripts/a11y-report.mjs` (`--run`), which cleans `test-results/`, runs the targeted `--unit` component pass, reseeds `wedding_test` via `npx tsx scripts/seed.ts` ([scripts/seed.ts](../scripts/seed.ts)) to restore valid `AppConfig` data wiped by Jest integration teardowns (skipping `<SetupWizard />` in `src/app/layout.tsx`), runs `npx playwright test --grep @a11y`, and writes unfiltered WCAG 2.2 AA violations to `test-results/a11y-summary.md` (for production standalone mode, run `npm run build && CI=true npm run test:a11y`). In [.github/workflows/ci.yml](workflows/ci.yml), an isolated `a11y-report` job depends on `unit-test` and `e2e-test` (`if: '!cancelled()'`), downloads `jest-a11y-violations` and `playwright-a11y-violations`, marks missing suite artifacts as incomplete in `test-results/a11y-summary.md`, and updates the `<!-- a11y-report -->` pull request comment and `$GITHUB_STEP_SUMMARY` even when violations exit non-zero.

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
  Executes all ten static verification gates configured in `package.json`:
  - `npm run check:env-docs`: Validates environment variable documentation alignment across `.env.example` and deployment guides.
  - `npm run check:runbooks`: Validates deployment runbooks against workflows, Docker Compose, and Prisma 7 contracts.
  - `npm run check:identifiers`: Scans for accidentally committed personal/template identifiers.
  - `npm run check:action-pins`: Validates strict YAML 1.2 workflow syntax across `.github/workflows/` and ensures GitHub Actions workflow actions are pinned to full 40-character commit SHAs with inline `# v...` version comments (`npm run check:action-pins -- --verify-upstream` in CI verifies upstream commit existence).
  - `npm run check:links`: Verifies that internal Markdown document links resolve cleanly without broken references.
  - `npm run check:spec-contracts`: Verifies that `/api/*` routes, HTTP methods, dynamic admin `ENTITY_KEY` slugs, and TypeScript symbols cited in architectural Markdown specs match live source files.
  - `npm run check:prisma`: Validates Prisma schema formatting and relations.
  - `npm run lint:migrations`: Verifies database migration compatibility.
  - `npm run check:doc-sync`: Verifies generated OpenAPI (`public/openapi.json`), architecture (`ARCHITECTURE.md`), and feature module (`FEATURE_MODULES.md`) documentation match current schemas.
  - `npm run check:setup-guides`: Verifies setup, contributor, and testing guides stay aligned with `.env.example`, `.env.test`, `package.json`, `.githooks/pre-commit`, `.githooks/pre-push`, `scripts/check-quality.ts`, and `tsconfig.json`.

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
