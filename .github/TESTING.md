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

Before Jest executes, npm automatically triggers the `pretest` hook defined in [scripts/pretest.mjs](../scripts/pretest.mjs). This orchestrates dependency synchronization, database containerization, and schema isolation:

1. **Dependency Alignment:** Verifies `package-lock.json` hash consistency against `node_modules/.package-lock-hash`. If packages are missing or lockfile changes are detected, it triggers a clean installation (`npm ci --legacy-peer-deps`).
2. **PostgreSQL Container Orchestration:** When running unit/integration tests, `scripts/pretest.mjs` checks if Docker is available. If running, it starts the local PostgreSQL database container via `docker compose up -d db` and polls `docker compose exec db pg_isready -U wedding` until the database is ready to accept connections.
3. **Graceful Fallback:** If Docker is not installed or the Docker daemon is not active, `scripts/pretest.mjs` logs a notice and skips container auto-start, falling back gracefully to existing PostgreSQL database connections.
4. **Strict Test Environment Isolation:** The pretest script clears parent shell database environment variables (`DATABASE_URL`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`, `PGDATASOURCE`, `ADMIN_PASSWORD`) and loads dedicated test configurations from `.env.test`. It targets an isolated test database (`wedding_test`, e.g. `postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public`) ensuring test executions never modify or delete records in local development or production databases.
5. **Schema Synchronization & Prisma Generation:** The hook pushes the current schema to the isolated test database using `npx prisma db push --accept-data-loss` and immediately executes `npm run prisma:generate` so the generated Prisma Client stays aligned with active data models before any tests run.

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

- **Playwright End-to-End Tests:**
  ```bash
  npx playwright test
  ```
  Executes browser-based end-to-end tests against a running Next.js application instance backed by an isolated test database.
  - **E2E Cookie Signing & Secret Alignment:** Playwright specs authenticate using shared helpers in [e2e/helpers/auth.ts](../e2e/helpers/auth.ts), which sign `guest_auth` cookies with `GUEST_SESSION_SECRET` and `admin_auth` cookies with `ADMIN_PASSWORD` across both `http://127.0.0.1:3000` and `http://localhost:3000`.
  - **Default Local & Container Secrets:** [playwright.config.ts](../playwright.config.ts), [docker-compose.yml](../docker-compose.yml), [.env.test](../.env.test), and [e2e/helpers/auth.ts](../e2e/helpers/auth.ts) align on the default 32+-character `GUEST_SESSION_SECRET` (`playwright-e2e-session-secret-32-chars-min`), distinct from `GUEST_PASSCODE` (`wedding2026`). This allows both local runs (`npx playwright test`) and Docker Compose smoke runs (`TEST_CONTAINER=true npx playwright test`) to work without manual secret configuration.
  - **Custom Secret Overrides:** When overriding `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, or `ADMIN_PASSWORD` locally or in CI, provide identical values to both the application server (or container) and the Playwright runner, ensuring `GUEST_SESSION_SECRET` is at least 32 characters long and never matches `GUEST_PASSCODE`.

- **Accessibility (A11y) Audits:**
  ```bash
  npm run test:a11y
  ```
  Runs unit tests, Playwright audits, and `node scripts/a11y-report.mjs` to evaluate WCAG compliance and generate accessibility report summaries.

- **Standalone Server Smoke Test:**
  ```bash
  npm run test:standalone
  ```
  Tests that standalone Next.js production builds boot correctly and respond to health probes.

- **OCI Container Smoke Test:**
  ```bash
  npm run test:container
  ```
  Builds the production Docker container and tests database migration, bootstrapping, and service readiness against a clean PostgreSQL container.

- **Static Repository & Document Checks:**
  ```bash
  npm run check:static
  ```
  Executes static verification gates across the project:
  - `npm run check:links`: Verifies that internal Markdown document links resolve correctly without broken references.
  - `npm run check:identifiers`: Scans for accidentally committed personal identifiers.
  - `npm run check:action-pins`: Ensures GitHub Actions workflow actions are pinned to full commit SHAs.
  - `npm run check:prisma`: Validates Prisma schema formatting and relations.
  - `npm run check:env-docs`: Validates environment variable documentation alignment.
  - `npm run lint:migrations`: Verifies migration compatibility.

- **Complete Quality Gate:**
  ```bash
  npm run quality
  # or
  npm run check:all
  ```
  Runs the full suite of static verifications, linter passes, and build checks prior to pushing.

## Writing New Tests

When contributing new functionality:

1. **Feature Co-location:** Place tests in a `__tests__` directory adjacent to the feature, component, or utility being introduced.
2. **User-Centric Component Tests:** Use React Testing Library to test behavior from an end-user or accessibility perspective, avoiding reliance on internal component implementation details.
3. **Database Operations:** Leverage the isolated test database environment. Do not hardcode production or development credentials in test files.
4. **Maintain Coverage:** Ensure new code includes sufficient unit and integration test coverage to uphold the global threshold standards (80% lines, 68% branches).
