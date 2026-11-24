# Agent & Contributor Guidelines (`AGENTS.md`)

This guide defines the local bootstrap, architecture boundaries, TypeScript configuration split, end-to-end authentication conventions, verification commands, and continuous integration guardrails for coding agents and contributors working in this repository.

## 1. Environment Bootstrap

- **Node.js & npm:** Node.js **v22.x LTS** (`>=22.22.1 <23.0.0`, pinned in [`.nvmrc`](.nvmrc)) and **`npm@10.9.x`** (`^10.9.0`, enforced via [`.npmrc`](.npmrc) and `devEngines` in [`package.json`](package.json); run `nvm use` if `nvm` is available).
- **Install dependencies:**
  ```bash
  CI=true npm ci
  ```
  *(Setting `CI=true` skips `.githooks` reconfiguration inside non-interactive sandboxes while still running `next typegen`, Prisma Client generation, and `node_modules/.package-lock-hash` recording via `postinstall`.)*
- **Regenerate Prisma Client (after schema edits):**
  ```bash
  npm run prisma:generate
  ```

## 2. Architecture & Module Boundaries

- **App Router (`src/app/`)**: Next.js pages, layouts, metadata builders, and HTTP route handlers (`src/app/api/**/route.ts`).
- **Core Infrastructure (`src/core/`)**: Authentication (`src/core/auth/`), session helpers, and framework-level services.
- **Feature Modules (`src/features/<domain>/`)**: Domain logic, schemas, services, and repositories (`broadcast`, `content`, `logistics`, `media`, `registry`, `seating`, `sub-events`, `weather`). Cross-domain imports must strictly go through each feature's public `index.ts` barrel (`@/features/<domain>`) rather than deep internal paths (`@/features/<domain>/*`), enforced by ESLint (`no-restricted-imports` in [`eslint.config.mjs`](eslint.config.mjs)).
- **Shared Components & Utilities (`src/components/`, `src/lib/`, `src/utils/`, `src/hooks/`)**: Domain-agnostic UI primitives, stateless helpers, base-path helpers (`resolveShowcasePath` in [`src/lib/basePath.ts`](src/lib/basePath.ts)), and API route middleware ([`src/utils/withApiMiddleware.ts`](src/utils/withApiMiddleware.ts)). Keep runtime code portable and free of personal domains or tenant identifiers (`npm run check:identifiers`).
- **Interactive Static Showcase Runtime (`STATIC_EXPORT` / `npm run build:export`)**: Compiles a database-free interactive browser showcase (`out/`) with deterministic sample archetypes, client-side `/api/*` interception, and simulated registry checkout; see [`docs/developer-setup.md`](docs/developer-setup.md) and [`docs/runtime-contract.md`](docs/runtime-contract.md) for the canonical demo storage and module architecture.
- **Test Fixtures & Mocks (`src/testing/factories/`, `src/mocks/`)**: Typed Zod-aligned test fixture builders ([`src/testing/factories/mediaFactory.ts`](src/testing/factories/mediaFactory.ts) and [`src/testing/factories/registryFactory.ts`](src/testing/factories/registryFactory.ts)) and MSW handlers/server used in Jest tests and Storybook.
- **End-to-End Suite (`e2e/`)**: Playwright browser, crawler, metadata, and accessibility specs (`e2e/*.spec.ts`), standalone static showcase runtime/a11y audits (`e2e/static/*.audit.ts`), plus shared E2E helpers (`e2e/helpers/`).
- **Repository Scripts (`scripts/`)**: CLI verification, OpenAPI/architecture sync, VitePress portal staging, and database seeding scripts.

## 3. TypeScript Configuration Split

TypeScript verification is split across five project files so IDEs get complete workspace diagnostics while production builds never absorb test, Storybook, VitePress, or runner globals:

1. [`tsconfig.json`](tsconfig.json) — Unified root IDE and workspace config (`compilerOptions.types: ["node", "jest", "@testing-library/jest-dom", "jest-axe"]`). Includes app sources, tests, mocks, factories, CLI scripts, E2E specs, `.storybook/**/*`, and `docs-portal/.vitepress/**/*`, while excluding `node_modules`, `jest.setup.js`, `.next-export`, `.next/export-stage`, `out`, `storybook-static`, `coverage`, `playwright-report`, `test-results`, `docs-portal/.vitepress/cache`, and `docs-portal/.vitepress/dist` so `tsserver` attaches every tracked TypeScript file cleanly.
2. [`tsconfig.build.json`](tsconfig.build.json) — Isolated non-composite production Next.js build config referenced by `typescript.tsconfigPath` in [`next.config.ts`](next.config.ts) (`compilerOptions.types: ["node"]`, `incremental: false`). Excludes `node_modules`, `out`, `storybook-static`, `jest.setup.js`, `scripts`, `e2e`, `.storybook`, `docs-portal`, `playwright.config.ts`, `playwright.static.config.ts`, `prisma.config.ts`, `src/mocks`, `src/testing`, `**/*.stories.ts`, `**/*.stories.tsx`, `**/__tests__/**/*`, `**/*.test.ts`, `**/*.test.tsx`, `**/*.spec.ts`, and `**/*.spec.tsx` so `npm run build` (`next build`) validates only production runtime code.
3. [`tsconfig.test.json`](tsconfig.test.json) — Extends `tsconfig.json` with `incremental: true` (`tsBuildInfoFile: "./tsconfig.test.tsbuildinfo"`) and `types: ["node", "jest", "@testing-library/jest-dom", "jest-axe"]`, and includes `src/**/__tests__/**/*`, `src/**/*.test.{ts,tsx}`, `scripts/**/*.test.ts`, `src/mocks/**/*.ts`, and `src/testing/**/*.ts`.
4. [`tsconfig.e2e.json`](tsconfig.e2e.json) — Extends `tsconfig.json` with `incremental: true` (`tsBuildInfoFile: "./tsconfig.e2e.tsbuildinfo"`) and `types: ["node"]`, and checks [`playwright.config.ts`](playwright.config.ts), [`playwright.static.config.ts`](playwright.static.config.ts), and `e2e/**/*.ts`.
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

## 4. Verification & Quality Gates

Invoke the unified quality workflow in [`scripts/check-quality.ts`](scripts/check-quality.ts) instead of running copied step lists manually — `npm run check:static`, `npm run check:pre-push`, `npm run quality`, and [`.github/workflows/ci.yml`](.github/workflows/ci.yml) all share step definitions from `scripts/check-quality.ts`:

```bash
# Fast static, contract, doc-sync, and container digest checks:
npm run check:static

# Shared local pre-push profile (static checks with check:standalone --static-only, typecheck, lint, Knip, and check:audit):
npm run check:pre-push

# Full verification (static checks, typecheck, lint, Knip, check:audit, docs:build, build-storybook, build:export, and Jest coverage):
npm run quality
```

- **Split Local Git Hooks:** [`.githooks/pre-commit`](.githooks/pre-commit) runs only `npx lint-staged` on staged files without stashing or resetting workspace edits, while [`.githooks/pre-push`](.githooks/pre-push) delegates directly to `npm run check:pre-push` (`scripts/check-quality.ts --pre-push`, matching the CI `verify` job without requiring heavy Next.js, VitePress, or Storybook builds; see [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md)).
- **Targeted Iteration:** Run `npm test -- <path/to/file.test.ts>` (or `npm run test:watch`) for fast cached unit/integration feedback without coverage overhead, `npm run test:cov` to enforce global `80%` line and `68%` branch coverage thresholds, `npm run typecheck && npm run lint && npm run lint:unused` for static code health, `npm run build-storybook` whenever modifying UI stories, `.storybook/*`, or [`src/mocks/handlers.ts`](src/mocks/handlers.ts) (`storybook-build` in CI), and `NEXT_PUBLIC_BASE_PATH="/wedding_website/demo" npm run build:export && NEXT_PUBLIC_BASE_PATH="/wedding_website/demo" npm run test:e2e:static` whenever modifying App Router pages, layouts, dynamic segments, demo handlers, or theme contrast tokens ([`scripts/build-export.mjs`](scripts/build-export.mjs) stages sources inside `.next/export-stage` without `src/app/api`, caches under `.next-export/cache` with `trailingSlash: true` and optional `NEXT_PUBLIC_BASE_PATH`, and [`playwright.static.config.ts`](playwright.static.config.ts) audits all exported subpath routes in light and dark themes inside the `static-export-build` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) gating `deploy-docs`).
- **CI & Release Provenance Gates:** `ci.yml` executes full verification on pull requests, `main` pushes, `v*` version tag pushes (restricting `deploy-docs` to `main` pushes and published releases), and published releases; [`publish-artifact.yml`](.github/workflows/publish-artifact.yml), [`deploy-provider.yml`](.github/workflows/deploy-provider.yml), and [`deploy.yml`](.github/workflows/deploy.yml) require a passing `ci.yml` run for the verified 40-character source revision (`org.opencontainers.image.revision` / SLSA provenance) and update `:latest` only for the highest stable `vMAJOR.MINOR.PATCH` release tag.
- **Authoritative Testing & Setup Runbooks:** Refer to [`.github/TESTING.md`](.github/TESTING.md) for `scripts/pretest.mjs` `wedding_test` database isolation and preflight hash caching, Playwright E2E execution (`npm run test:e2e`), WCAG 2.2 AA accessibility audits (`npm run test:a11y`), PostgreSQL migration drift checks, and standalone/container smoke tests (`npm run test:standalone`, `npm run test:container`), and to [`docs/developer-setup.md`](docs/developer-setup.md) for local `.env` and `SetupWizard` bootstrap.

## 5. Repository Conventions & Guardrails

- **Strict Compiler & Linter Rules:** Preserve `strict`, `noUnusedLocals`, and `noUnusedParameters` in [`tsconfig.json`](tsconfig.json), and keep ESLint (`--max-warnings 0` in `npm run lint`, `--max-warnings=0` in `lint-staged`, and the shrink-only `LEGACY_EXPLICIT_ANY_BASELINE_FILES` ratchet in [`eslint.config.mjs`](eslint.config.mjs)) and Axe ([`src/a11y-config.ts`](src/a11y-config.ts)) error-clean. Fix types and lint errors at the source instead of disabling rules or adding `@ts-ignore` / `@ts-expect-error` directives.
- **API Route Middleware:** Wrap Next.js route handlers with `withApiMiddleware` ([`src/utils/withApiMiddleware.ts`](src/utils/withApiMiddleware.ts)). Zero-argument handlers (e.g. `withApiMiddleware(async () => ...)`) and optional `context` in direct unit test calls (`await GET(req)`) are supported.
- **Playwright Auth Helpers:** Import E2E cookie generators and context seeders strictly from [`e2e/helpers/auth.ts`](e2e/helpers/auth.ts) rather than duplicating HMAC token signing inside `e2e/*.spec.ts` files (see [`.github/TESTING.md`](.github/TESTING.md) for secret alignment rules).
- **Typed Test Fixtures & Knip:** Build test data with `createMockMedia` ([`src/testing/factories/mediaFactory.ts`](src/testing/factories/mediaFactory.ts)) and `createMockRegistryItem`, `createMockContributor`, `createMockCreateRegistryItemInput`, or `createMockInvitationCode` ([`src/testing/factories/registryFactory.ts`](src/testing/factories/registryFactory.ts)) whenever schemas in [`src/features/media/schemas.ts`](src/features/media/schemas.ts) or [`src/features/registry/schemas.ts`](src/features/registry/schemas.ts) evolve. Register any new test-only helper entrypoints in [`knip.json`](knip.json) so `npm run lint:unused` reports zero unused files or exports.
- **Feature Module Boundaries & Scaffolding:** Scaffold new domains with `npm run scaffold -- <feature-name>` and import cross-feature code strictly through public barrel files (`@/features/<feature>`) rather than deep internal paths (`@/features/<feature>/*`), as documented in [`.github/CONTRIBUTING.md`](.github/CONTRIBUTING.md).
- **Action Pinning:** Always pin third-party GitHub Actions to 40-character commit SHAs with a trailing version comment (e.g., `# v7.0.1`).
- **Further Reading:** See [Developer Setup Guide](docs/developer-setup.md), [Testing Strategy](.github/TESTING.md), [Contribution Guidelines](.github/CONTRIBUTING.md), and [Application Runtime Contract](docs/runtime-contract.md).
