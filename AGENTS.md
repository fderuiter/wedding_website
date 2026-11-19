# Agent & Contributor Guide

This repository powers a configurable Next.js App Router wedding website with Prisma/PostgreSQL persistence, modular domain features, Jest unit/integration suites, Playwright E2E suites, and automated documentation generation.

## Repository Layout & Boundaries

- `src/app/` — Next.js App Router pages, layouts, and API route handlers (`src/app/api/**/route.ts`).
- `src/features/<domain>/` — Domain modules (`broadcast`, `content`, `logistics`, `media`, `registry`, `seating`, `sub-events`, `weather`). Cross-feature consumers must import from the barrel file `@/features/<domain>` rather than deep internal paths (`@/features/<domain>/*`), enforced by ESLint (`eslint.config.mjs`).
- `src/components/` — Shared UI primitives and feature-agnostic presentation components.
- `src/core/`, `src/lib/`, `src/utils/` — Authentication, Prisma/config singletons, theme tokens, safe network/storage helpers, and API middleware (`src/utils/withApiMiddleware.ts`).
- `src/testing/factories/` — Typed Zod-aligned test fixture builders (`src/testing/factories/mediaFactory.ts` and `src/testing/factories/registryFactory.ts`).
- `src/mocks/` — MSW server and handlers used in Jest tests.
- `e2e/` — Playwright browser and API specs (`playwright.config.ts`).
- `scripts/` — CLI verification, OpenAPI/architecture sync, VitePress portal staging, and database seeding scripts.

## TypeScript Configuration Split

TypeScript verification is split across four project files so production builds never absorb test or runner globals while every TypeScript file in the repository is strictly checked:

1. [`tsconfig.json`](./tsconfig.json) — Production Next.js config (`compilerOptions.types: ["node"]`). Excludes unit/integration tests, `src/mocks`, `e2e`, and `scripts` so `npm run build` (`next build`) validates only production runtime code.
2. [`tsconfig.test.json`](./tsconfig.test.json) — Extends `tsconfig.json` with `types: ["jest", "node", "@testing-library/jest-dom"]` and includes `**/*.test.ts`, `**/*.test.tsx`, `**/__tests__/**/*`, `src/mocks/**/*.ts`, and `jest-axe` matcher declarations.
3. [`tsconfig.e2e.json`](./tsconfig.e2e.json) — Extends `tsconfig.json` with `types: ["node"]` and checks `playwright.config.ts` and `e2e/**/*.ts`.
4. [`tsconfig.scripts.json`](./tsconfig.scripts.json) — Extends `tsconfig.json` with `types: ["node"]` and checks `scripts/**/*.ts` (without `.ts` import extensions, as `allowImportingTsExtensions` is not enabled).

Run all four TypeScript projects locally with:

```bash
npm run typecheck
# or
npm run type-check
```

To check a single project during targeted edits:

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
npx tsc --noEmit -p tsconfig.e2e.json
npx tsc --noEmit -p tsconfig.scripts.json
```

## Coding & Testing Guardrails

- **Strict Compiler Rules:** Preserve `strict`, `noUnusedLocals`, and `noUnusedParameters` in `tsconfig.json`. Fix types at the source instead of disabling rules or adding `@ts-ignore` / `@ts-expect-error` directives.
- **API Route Middleware:** Wrap Next.js route handlers with `withApiMiddleware` (`src/utils/withApiMiddleware.ts`). Zero-argument handlers (e.g. `withApiMiddleware(async () => ...)`) and optional `context` in direct unit test calls (`await GET(req)`) are supported.
- **Typed Test Fixtures & Knip:** Build test data with `createMockMedia` (`src/testing/factories/mediaFactory.ts`) and `createMockRegistryItem`, `createMockContributor`, `createMockCreateRegistryItemInput`, or `createMockInvitationCode` (`src/testing/factories/registryFactory.ts`) whenever schemas in `src/features/media/schemas.ts` or `src/features/registry/schemas.ts` evolve. Register any new test-only helper entrypoints in [`knip.json`](./knip.json) so `npm run lint:unused` reports zero unused files or exports.
- **Code Style:** Use single quotes, semicolons, and 2-space indentation (`npm run lint`). Do not introduce personal deployment identifiers into repository files (`npm run check:identifiers`).

## Local Quality Gates & Documentation Sync

Before committing or opening a pull request, run:

```bash
npm run typecheck        # Type-check production, test/mocks, e2e, and scripts configs
npm run lint             # ESLint code & style rules
npm run lint:unused      # Knip unused files/exports check
npm test                 # Jest unit & integration suite (>=80% line, >=68% branch coverage)
```

Whenever you modify API schemas, routes, `ARCHITECTURE.md`, [Developer Setup](./docs/developer-setup.md), [Contribution Guidelines](./.github/CONTRIBUTING.md), or other staged portal docs, regenerate synchronized artifacts and verify zero drift:

```bash
npx tsx scripts/generate-openapi.ts
npx tsx scripts/generate-docs.ts
npm run docs:build
npm run check:doc-sync
npm run check:links
```

Run the complete local verification pipeline at any time with `npm run quality`.
