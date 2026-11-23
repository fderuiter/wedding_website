# Agent & Contributor Guidelines (`AGENTS.md`)

This guide defines the local bootstrap, architecture boundaries, TypeScript configuration split, end-to-end authentication conventions, verification commands, and continuous integration guardrails for coding agents and contributors working in this repository.

## 1. Environment Bootstrap

- **Node.js & npm:** Node.js **v22.x LTS** (`^22.12.0`, pinned in [`.nvmrc`](.nvmrc)) and **`npm@10.9.x`** (`^10.9.0`, enforced via [`.npmrc`](.npmrc) and `devEngines` in [`package.json`](package.json); run `nvm use` if `nvm` is available).
- **Install dependencies:**
  ```bash
  CI=true npm ci
  ```
  *(Setting `CI=true` skips `.githooks` reconfiguration inside non-interactive sandboxes while still running Prisma Client generation via `postinstall`.)*
- **Regenerate Prisma Client (after schema edits):**
  ```bash
  npm run prisma:generate
  ```

## 2. Architecture & Module Boundaries

- **App Router (`src/app/`)**: Next.js pages, layouts, metadata builders, and HTTP route handlers (`src/app/api/**/route.ts`).
- **Core Infrastructure (`src/core/`)**: Authentication (`src/core/auth/`), session helpers, and framework-level services.
- **Feature Modules (`src/features/<domain>/`)**: Domain logic, schemas, services, and repositories (`broadcast`, `content`, `logistics`, `media`, `registry`, `seating`, `sub-events`, `weather`). Cross-domain imports must strictly go through each feature's public `index.ts` barrel (`@/features/<domain>`) rather than deep internal paths (`@/features/<domain>/*`), enforced by ESLint (`no-restricted-imports` in [`eslint.config.mjs`](eslint.config.mjs)).
- **Shared Components & Utilities (`src/components/`, `src/lib/`, `src/utils/`, `src/hooks/`)**: Domain-agnostic UI primitives, stateless helpers, and API route middleware ([`src/utils/withApiMiddleware.ts`](src/utils/withApiMiddleware.ts)). Keep runtime code portable and free of personal domains or tenant identifiers (`npm run check:identifiers`).
- **Test Fixtures & Mocks (`src/testing/factories/`, `src/mocks/`)**: Typed Zod-aligned test fixture builders ([`src/testing/factories/mediaFactory.ts`](src/testing/factories/mediaFactory.ts) and [`src/testing/factories/registryFactory.ts`](src/testing/factories/registryFactory.ts)) and MSW handlers/server used in Jest tests and Storybook.
- **End-to-End Suite (`e2e/`)**: Playwright browser, crawler, metadata, and accessibility specs (`e2e/*.spec.ts`) plus shared E2E helpers (`e2e/helpers/`).
- **Repository Scripts (`scripts/`)**: CLI verification, OpenAPI/architecture sync, VitePress portal staging, and database seeding scripts.

## 3. TypeScript Configuration Split

TypeScript verification is split across five project files so IDEs get complete workspace diagnostics while production builds never absorb test, Storybook, VitePress, or runner globals:

1. [`tsconfig.json`](tsconfig.json) — Unified root IDE and workspace config (`compilerOptions.types: ["node", "jest", "@testing-library/jest-dom", "jest-axe"]`). Includes app sources, tests, mocks, factories, CLI scripts, E2E specs, `.storybook/**/*`, and `docs-portal/.vitepress/**/*`, while excluding `node_modules`, `jest.setup.js`, `out`, `storybook-static`, `coverage`, `playwright-report`, `test-results`, `docs-portal/.vitepress/cache`, and `docs-portal/.vitepress/dist` so `tsserver` attaches every tracked TypeScript file cleanly.
2. [`tsconfig.build.json`](tsconfig.build.json) — Isolated non-composite production Next.js build config referenced by `typescript.tsconfigPath` in [`next.config.ts`](next.config.ts) (`compilerOptions.types: ["node"]`, `incremental: false`). Excludes `node_modules`, `out`, `storybook-static`, `jest.setup.js`, `scripts`, `e2e`, `.storybook`, `docs-portal`, `playwright.config.ts`, `prisma.config.ts`, `src/mocks`, `src/testing`, `**/*.stories.ts`, `**/*.stories.tsx`, `**/__tests__/**/*`, `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, and `**/*.spec.tsx` so `npm run build` (`next build`) validates only production runtime code.
3. [`tsconfig.test.json`](tsconfig.test.json) — Extends `tsconfig.json` with `incremental: true` (`tsBuildInfoFile: "./tsconfig.test.tsbuildinfo"`) and `types: ["node", "jest", "@testing-library/jest-dom", "jest-axe"]`, and includes `src/**/__tests__/**/*`, `src/**/*.test.{ts,tsx}`, `scripts/**/*.test.ts`, `src/mocks/**/*.ts`, and `src/testing/**/*.ts`.
4. [`tsconfig.e2e.json`](tsconfig.e2e.json) — Extends `tsconfig.json` with `incremental: true` (`tsBuildInfoFile: "./tsconfig.e2e.tsbuildinfo"`) and `types: ["node"]`, and checks [`playwright.config.ts`](playwright.config.ts) and `e2e/**/*.ts`.
5. [`tsconfig.scripts.json`](tsconfig.scripts.json) — Extends `tsconfig.json` with `incremental: true` (`tsBuildInfoFile: "./tsconfig.scripts.tsbuildinfo"`) and `types: ["node"]`, and checks `scripts/**/*.ts` (excluding `scripts/**/*.test.ts`, without `.ts` import extensions as `allowImportingTsExtensions` is not enabled).

Run all five TypeScript projects locally with:

```bash
npm run typecheck
# or
npm run type-check
```

To check a single project during targeted edits:

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.build.json
npx tsc --noEmit -p tsconfig.test.json
npx tsc --noEmit -p tsconfig.e2e.json
npx tsc --noEmit -p tsconfig.scripts.json
```

## 4. E2E Authentication & Secret Alignment

- **Centralized Cookie Signing**: All Playwright specs must import cookie generators and context seeders from [`e2e/helpers/auth.ts`](e2e/helpers/auth.ts). Do not duplicate HMAC token-signing functions inside individual `e2e/*.spec.ts` files.
- **Distinct Signing Secrets**:
  - `guest_auth` tokens are verified by [`src/core/auth/guest.server.ts`](src/core/auth/guest.server.ts) using `GUEST_SESSION_SECRET` (never `GUEST_PASSCODE`). Both production runtime validation in [`src/env.ts`](src/env.ts) and `e2e/helpers/auth.ts` require `GUEST_SESSION_SECRET` to be distinct from `GUEST_PASSCODE` and at least 32 characters long in production mode.
  - `admin_auth` tokens are signed and verified with a domain-separated HMAC key derived from the decoded 16-byte salt and 64-byte key of `ADMIN_PASSWORD` (`scrypt:[saltBase64]:[keyBase64]`) per [`src/core/auth/auth.server.ts`](src/core/auth/auth.server.ts).
- **Aligned Local & Container Defaults**:
  - [`playwright.config.ts`](playwright.config.ts), [`.env.ci`](.env.ci), [`docker-compose.ci.yml`](docker-compose.ci.yml), [`.env.test`](.env.test), and [`e2e/helpers/auth.ts`](e2e/helpers/auth.ts) all default `GUEST_SESSION_SECRET` to `playwright-e2e-session-secret-32-chars-min` and align on the 64-byte E2E `ADMIN_PASSWORD` scrypt hash.
  - For `GUEST_PASSCODE`, `playwright.config.ts`, `.env.ci`, `docker-compose.ci.yml`, and `e2e/helpers/auth.ts` default to `playwright-e2e-guest-passcode` (so `npx playwright test` and `TEST_CONTAINER=true npm run test:e2e:smoke` authenticate out of the box on clean checkouts when layering `--env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml`), whereas `.env.test` (loaded by [`scripts/pretest.mjs`](scripts/pretest.mjs) during Jest runs) sets `GUEST_PASSCODE="build-fallback-guest-passcode"`.
  - When overriding `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, or `ADMIN_PASSWORD` in shell or CI environments, pass identical values to both the Next.js server/container and the Playwright test process.
- **Isolated Database Bootstrap & Explicit Server Reuse (`playwright.config.ts`)**:
  - When `CI` and `TEST_CONTAINER` are unset, [`playwright.config.ts`](playwright.config.ts) automatically starts PostgreSQL via `docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml up -d db` (when Docker is running), pushes the Prisma schema (`npx prisma db push --accept-data-loss`), and seeds `AppConfig` (`npx tsx scripts/seed.ts`) in the isolated `wedding_test` database before starting `npm run dev` and probing `/api/ready`.
  - Automatic server reuse is disabled by default (`reuseExistingServer` is `false` unless `PLAYWRIGHT_REUSE_SERVER=true` is explicitly set outside `CI`) so Playwright never reuses an incompatible `npm run dev` server bound to `.env` (`wedding` development database and mismatched `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, or `ADMIN_PASSWORD`). Stop any running `npm run dev` server on port `3000` before running `npx playwright test`, or opt into `PLAYWRIGHT_REUSE_SERVER=true` only when the existing server explicitly targets `wedding_test` with aligned E2E secrets.
- **Loopback Origin Seeding & Pathname Assertions**:
  - Seed E2E cookies across both `http://127.0.0.1:3000` and `http://localhost:3000` via `seedGuestAuthCookies` or `seedAdminAndGuestAuthCookies`.
  - Guest and accessibility specs should assert `new URL(page.url()).pathname` after `page.goto(...)` so unexpected redirects to `/guest/login` or `/admin/login` fail immediately.

## 5. Local Verification & Pre-Push Quality Gates

Before opening a pull request or pushing changes, ensure your branch passes the same checks enforced by [`.github/workflows/ci.yml`](.github/workflows/ci.yml). Local Git hooks (installed via [`scripts/install-git-hooks.js`](scripts/install-git-hooks.js) on `npm ci`) split validation so [`.githooks/pre-commit`](.githooks/pre-commit) runs only `npx lint-staged` on staged files while [`.githooks/pre-push`](.githooks/pre-push) runs `npm run type-check`, `npm run lint:unused`, and all 10 `check:static` checks without destructive stashing or resets.

### Full Local Quality Gate

Run the sequential pre-push quality gate configured in [`scripts/check-quality.ts`](scripts/check-quality.ts):

```bash
npm run quality
# Alias: npm run check:all
```

`npm run quality` executes the following steps in exact sequential order (`scripts/check-quality.ts`):
1. Verify Environment Documentation (`npx tsx scripts/verify-env-docs.ts` / `check:env-docs`)
2. Verify Deployment Runbooks (`npx tsx scripts/verify-deployment-runbooks.ts` / `check:runbooks`)
3. Check Personal/Template Identifier Isolation (`npx tsx scripts/check-personal-identifiers.ts` / `check:identifiers`)
4. Check Workflow YAML 1.2 Syntax & Third-Party Action Pin Commit SHAs (`npm run check:action-pins` locally with `# v...` version comment checks; `npm run check:action-pins -- --verify-upstream` in CI)
5. Check Documentation Relative Links (`npx tsx scripts/check-doc-links.ts` / `check:links`)
6. Verify Specification Route & Symbol Contracts (`npm run check:spec-contracts` / [`scripts/verify-spec-contracts.ts`](scripts/verify-spec-contracts.ts))
7. Validate Prisma Schema (`npx tsx scripts/check-prisma-schema.ts` / `check:prisma`)
8. TypeScript Typecheck across all four project configs (`npm run typecheck`)
9. ESLint Code Linting (`npm run lint`)
10. Knip Unused Export Analysis (`npm run lint:unused`)
11. Verify Migration Compatibility (`npm run lint:migrations`)
12. Verify Documentation Synchronization (`npm run check:doc-sync`)
13. Verify Setup & Contributor Guides Contract (`npm run check:setup-guides` / [`scripts/verify-setup-guides.ts`](scripts/verify-setup-guides.ts))
14. Build Static Documentation Portal (`npm run docs:build`)
15. Build Static Storybook Showcase (`npm run build-storybook`) — prints remediation instructions and removes any partial `storybook-static` output on failure
16. Unit & Integration Tests (`npm test`) — invokes [`scripts/pretest.mjs`](scripts/pretest.mjs) (treats `node_modules` as aligned when `CI=true` with `node_modules/.package-lock.json` or when `node_modules/.package-lock-hash` matches `package-lock.json`, otherwise runs strict `npm ci`; checks `npm_lifecycle_event` and falls back to `npm run build` outside a `*test*` lifecycle; resets `test-results/jest-a11y-violations.json`; preserves explicit `DATABASE_URL` when `CI=true` or `TEST_DATABASE_URL` is set alongside [`jest.setup.js`](jest.setup.js) while isolating local runs via `.env.test` against `wedding_test`; probes TCP readiness on `DATABASE_URL` before starting `docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml up -d db` + polling `pg_isready` only when PostgreSQL is offline locally; runs `npx prisma migrate deploy` — automatically resetting the `public` schema on `wedding_test` if prior local `prisma db push` state triggers Prisma error `P3005` — and conditional `npm run prisma:generate`; and stages portal docs via `npx tsx scripts/generate-portal.ts --stage-only`) before running `jest --runInBand`

### Storybook Static Showcase Verification

[`tsconfig.json`](tsconfig.json) excludes `src/mocks` and does not run Webpack bundling over [`.storybook/main.ts`](.storybook/main.ts) or [`.storybook/preview.tsx`](.storybook/preview.tsx). Whenever you modify UI components, `src/**/*.stories.tsx`, `.storybook/*`, or MSW mock handlers in [`src/mocks/handlers.ts`](src/mocks/handlers.ts), verify Storybook compiles cleanly:

```bash
npm run build-storybook
```

- **CI Parity:** Pull requests and pushes to `main` execute an isolated `storybook-build` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) in parallel with `unit-test` and `build` (using `npm ci --ignore-scripts` and Webpack 5 filesystem caching across `node_modules/.cache/webpack` and `node_modules/.cache/storybook`), while manual dispatches of [`.github/workflows/storybook.yml`](.github/workflows/storybook.yml) share the same cache and `--ignore-scripts` install.
- **Interactive Development:** Run `npm run storybook` to launch the local Storybook server on port `6006`.
- **Git Hook Scope:** `npm run build-storybook` is intentionally kept out of both [`.githooks/pre-commit`](.githooks/pre-commit) and [`.githooks/pre-push`](.githooks/pre-push) so local commits and pushes stay fast, and `/storybook-static` remains ignored via [`.gitignore`](.gitignore).

### Accessibility Quality Gate (`npm run test:a11y` & `npm run test:a11y:unit`)

For fast component-only `jest-axe` checks across the 55 `src/` accessibility suites without starting Docker (`--coverage=false`):

```bash
npm run test:a11y:unit
```

To run the complete WCAG 2.2 AA accessibility quality gate locally (documented in [`.github/TESTING.md`](.github/TESTING.md)):

```bash
npm run test:a11y
```

To run against the production standalone Next.js build (matching CI behavior in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)):

```bash
npm run build
CI=true npm run test:a11y
```

This invokes `node scripts/a11y-report.mjs --run` ([`scripts/a11y-report.mjs`](scripts/a11y-report.mjs)), which:

1. Clears stale `test-results/` data.
2. Runs the targeted `--unit` component pass (`npx jest --runInBand --coverage=false --runTestsByPath ...` across the 55 `src/` `jest-axe` suites), initializing `test-results/jest-a11y-violations.json` and recording any component-level `jest-axe` violations via [`jest.setup.js`](jest.setup.js).
3. Reseeds `wedding_test` via `npx tsx scripts/seed.ts` ([`scripts/seed.ts`](scripts/seed.ts)) to restore valid `AppConfig` data wiped by Jest integration teardowns so [`src/app/layout.tsx`](src/app/layout.tsx) skips `<SetupWizard />`.
4. Runs `npx playwright test --grep @a11y` in bundled Chromium against `http://localhost:3000` (which uses `test-results/playwright` as Playwright's `outputDir` in [`playwright.config.ts`](playwright.config.ts) so startup cleanup preserves JSON artifacts, and persists unfiltered route-keyed `@axe-core/playwright` violations into `test-results/playwright-a11y-violations.json` via [`e2e/verification.spec.ts`](e2e/verification.spec.ts)).
5. Always writes `test-results/a11y-summary.md` first, then exits non-zero if the component pass failed, seeding failed, Playwright failed, or `totalViolations > 0`.

To regenerate `test-results/a11y-summary.md` from existing JSON artifacts without re-running the test suites (matching the dedicated `a11y-report` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml), which depends on `unit-test` and `e2e-test` with `if: '!cancelled()'`, downloads `jest-a11y-violations` and `playwright-a11y-violations`, marks any missing suite artifact as incomplete in `test-results/a11y-summary.md`, and updates the `<!-- a11y-report -->` pull request comment and `$GITHUB_STEP_SUMMARY`):

```bash
node scripts/a11y-report.mjs
```

### Targeted Verification Commands

- **Static Guardrails Bundle:** `npm run check:static`
  - `npm run check:env-docs` — Ensure environment variables align with [`.env.example`](.env.example) and deployment docs ([`scripts/verify-env-docs.ts`](scripts/verify-env-docs.ts)).
  - `npm run check:runbooks` — Verify deployment runbooks match live workflows, Docker Compose, and Prisma 7 contracts ([`scripts/verify-deployment-runbooks.ts`](scripts/verify-deployment-runbooks.ts)).
  - `npm run check:identifiers` — Guard against prohibited personal/template identifiers in runtime code ([`scripts/check-personal-identifiers.ts`](scripts/check-personal-identifiers.ts)).
  - `npm run check:action-pins` — Validate strict YAML 1.2 syntax across `.github/workflows/*.yml` and verify every external GitHub Action is pinned to a full 40-character commit SHA with an inline `# v...` version comment offline for pre-commit hooks; pass `-- --verify-upstream` (with `GITHUB_TOKEN`, as run in `.github/workflows/ci.yml`) to verify each pinned commit SHA exists upstream via the GitHub API ([`scripts/check-action-pins.ts`](scripts/check-action-pins.ts)).
  - `npm run check:links` — Verify all relative Markdown links resolve to existing repository files ([`scripts/check-doc-links.ts`](scripts/check-doc-links.ts)).
  - `npm run check:spec-contracts` — Verify API routes, HTTP methods, dynamic `ENTITY_KEY` slugs, and cited TypeScript symbols in architectural Markdown specifications match live codebase exports ([`scripts/verify-spec-contracts.ts`](scripts/verify-spec-contracts.ts)).
  - `npm run check:prisma` & `npm run lint:migrations` — Validate Prisma schema and migration compatibility.
  - `npm run check:doc-sync` — Verify [`public/openapi.json`](public/openapi.json), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`FEATURE_MODULES.md`](FEATURE_MODULES.md) match current schemas (`npx tsx scripts/generate-openapi.ts && npx tsx scripts/generate-docs.ts --skip-openapi`).
  - `npm run check:setup-guides` — Verify setup, contributor, and testing guides match `.env.example`, `.env.test`, scripts, [`.githooks/pre-commit`](.githooks/pre-commit), [`.githooks/pre-push`](.githooks/pre-push), and `tsconfig.json` ([`scripts/verify-setup-guides.ts`](scripts/verify-setup-guides.ts)).
- **Prisma Migration Parity Diff (PostgreSQL):** `POSTGRES_URL_NON_POOLING="postgresql://wedding:wedding123@localhost:5432/wedding_shadow?schema=public" npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` — Replays `prisma/migrations/` against an isolated `wedding_shadow` PostgreSQL database (configured via `shadowDatabaseUrl` in [`prisma.config.ts`](prisma.config.ts), matching the `Verify Prisma Migration Sync` step in [`.github/workflows/ci.yml`](.github/workflows/ci.yml)); if drift is detected (exit code `2`), generate and commit a forward-only migration with `npm run migrate:dev`.
- **Typecheck & Linting:** `npm run typecheck && npm run lint && npm run lint:unused`
  - ESLint enforces error-level rules for single quotes, 2-space indentation, semicolons, import boundaries (`no-restricted-imports`, `local-rules/no-restricted-utility-imports`), CommonJS bans (`@typescript-eslint/no-require-imports`), `prefer-const`, TypeScript-backed unused imports and variables (`unused-imports/no-unused-imports`, `unused-imports/no-unused-vars`), React Hook dependencies (`react-hooks/exhaustive-deps`), JSX entities and ARIA roles (`react/no-unescaped-entities`, `jsx-a11y/role-supports-aria-props`), Next.js image/navigation rules (`@next/next/no-img-element`, `@next/next/no-location-assign-relative-destination`), and `@typescript-eslint/no-explicit-any` outside the shrink-only `LEGACY_EXPLICIT_ANY_BASELINE_FILES` list, with `--max-warnings 0` enforced in `npm run lint` and `--max-warnings=0` in `lint-staged`. Do not disable ESLint rules in [`eslint.config.mjs`](eslint.config.mjs) or Axe rules in [`src/a11y-config.ts`](src/a11y-config.ts).
  - Knip ([`knip.json`](knip.json)) enforces strict unused file, export, and type analysis; export only symbols imported by entry files.
- **Documentation Portal:** `npm run docs:build` — Stages architectural and testing docs via [`scripts/generate-portal.ts`](scripts/generate-portal.ts) and compiles the VitePress documentation portal.
- **Targeted Unit Tests:** `npx jest <path/to/file.test.ts> --coverage=false` (use `npm test` to run [`scripts/pretest.mjs`](scripts/pretest.mjs) and the full suite with isolated `wedding_test` database setup and coverage thresholds in [`jest.config.mjs`](jest.config.mjs)).
- **Production Next.js Build & Standalone Verification:** `npm run build` followed by `npm run check:standalone -- --require-standalone` ([`scripts/check-docker-build.ts`](scripts/check-docker-build.ts); `npm run check:standalone` runs pre-build static Dockerfile/Compose/digest checks, while `--require-standalone` verifies `.next/standalone/server.js`, `.next/standalone/.next/static`, and `.next/standalone/public` without nested duplicates or `mockServiceWorker.js`).
- **Standalone & Container Smoke Tests:** `npm run test:standalone` ([`scripts/test-standalone.mjs`](scripts/test-standalone.mjs), **requires running `npm run build` first**, verifies PostgreSQL TCP readiness via `pg_isready -h localhost`, runs host migrations with `POSTGRES_URL_NON_POOLING` unset, and probes static `/assets/favicon.png`, `GET /api/ready`, `GET /api/registry/validate-code`, and authenticated `GET /api/registry/items` via [`scripts/smoke-runner.mjs`](scripts/smoke-runner.mjs)) and `npm run test:container` ([`scripts/test-container.mjs`](scripts/test-container.mjs), layering [`.env.ci`](.env.ci) and [`docker-compose.ci.yml`](docker-compose.ci.yml) and running the containerized `migration` service via `docker compose --env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml run --rm migration` by default even when `node_modules/.bin/prisma` exists on the host). **Warning:** Both smoke test scripts run `docker compose down -v` (with `--env-file .env.ci -f docker-compose.yml -f docker-compose.ci.yml`), which deletes local Docker Compose PostgreSQL volumes (`db_data`).
- **End-to-End & Smoke Browser Tests:** `npm run test:e2e` (`npx playwright test`) and `npm run test:e2e:smoke` (`playwright test --grep @smoke`, targeting fast `@smoke` specs in [`e2e/guest-callback-url.spec.ts`](e2e/guest-callback-url.spec.ts), [`e2e/meta.spec.ts`](e2e/meta.spec.ts), and [`e2e/skip-link.spec.ts`](e2e/skip-link.spec.ts) while excluding slow route crawlers and violation-recording specs) against `http://localhost:3000` in bundled Chromium (in CI, `e2e-test` and `container-e2e-smoke` start in parallel right after `build`; locally, Playwright automatically initializes and seeds `wedding_test` when `CI` and `TEST_CONTAINER` are unset — stop any running `npm run dev` on port `3000` first, or set `PLAYWRIGHT_REUSE_SERVER=true` only when the existing server targets `wedding_test` with aligned E2E secrets)

## 6. Repository Conventions & Guardrails

- **Strict Compiler Rules:** Preserve `strict`, `noUnusedLocals`, and `noUnusedParameters` in [`tsconfig.json`](tsconfig.json). Fix types at the source instead of disabling rules or adding `@ts-ignore` / `@ts-expect-error` directives.
- **API Route Middleware:** Wrap Next.js route handlers with `withApiMiddleware` ([`src/utils/withApiMiddleware.ts`](src/utils/withApiMiddleware.ts)). Zero-argument handlers (e.g. `withApiMiddleware(async () => ...)`) and optional `context` in direct unit test calls (`await GET(req)`) are supported.
- **Typed Test Fixtures & Knip:** Build test data with `createMockMedia` ([`src/testing/factories/mediaFactory.ts`](src/testing/factories/mediaFactory.ts)) and `createMockRegistryItem`, `createMockContributor`, `createMockCreateRegistryItemInput`, or `createMockInvitationCode` ([`src/testing/factories/registryFactory.ts`](src/testing/factories/registryFactory.ts)) whenever schemas in [`src/features/media/schemas.ts`](src/features/media/schemas.ts) or [`src/features/registry/schemas.ts`](src/features/registry/schemas.ts) evolve. Register any new test-only helper entrypoints in [`knip.json`](knip.json) so `npm run lint:unused` reports zero unused files or exports.
- **Feature Module Boundaries:** Import cross-feature code strictly through public barrel files (`@/features/<feature>`) rather than deep internal paths (`@/features/<feature>/*`).
- **Action Pinning:** Always pin third-party GitHub Actions to 40-character commit SHAs with a trailing version comment (e.g., `# v7.0.1`).
- **Further Reading:** See [Developer Setup Guide](docs/developer-setup.md), [Testing Strategy](.github/TESTING.md), and [Contribution Guidelines](.github/CONTRIBUTING.md).
