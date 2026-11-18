# Agent Guidelines

This document describes local verification workflows and quality gates for coding agents working in this repository. Keep local checks aligned with continuous integration ([.github/workflows/ci.yml](.github/workflows/ci.yml)), [.github/TESTING.md](.github/TESTING.md), and [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md).

## Static, Lint, and Type Verification

Run the full local quality suite before opening or updating a pull request:

```bash
npm run quality
```

Individual static and lint checks can also be run directly:

- `npm run check:static` — Validates environment variable docs, personal/template identifier isolation, pinned 40-character GitHub Action commit SHAs, relative Markdown links, Prisma schema validity, migration compatibility, and generated documentation sync.
- `npm run typecheck` — Runs `tsc --noEmit`.
- `npm run lint` — Runs ESLint across the repository.
- `npm run lint:unused` — Runs Knip unused file/export analysis ([knip.json](knip.json)).
- `npm run docs:build` — Stages architectural docs and builds the VitePress portal.

## Unit, Integration, and E2E Tests

- **Unit & Integration Tests (`npm test`)**:
  - Automatically runs [scripts/pretest.mjs](scripts/pretest.mjs) first, which starts/checks the isolated PostgreSQL `wedding_test` database, pushes the Prisma schema, generates the Prisma client, stages portal docs, and initializes `test-results/jest-a11y-violations.json`.
  - Executes Jest sequentially (`jest --runInBand`) and enforces global coverage thresholds in [jest.config.mjs](jest.config.mjs).
- **Playwright End-to-End Tests (`npx playwright test`)**:
  - Uses `test-results/playwright` as Playwright's `outputDir` ([playwright.config.ts](playwright.config.ts)) so startup cleanup preserves JSON accessibility artifacts in `test-results/`.
  - Persists route-keyed page accessibility scan results to `test-results/playwright-a11y-violations.json` in [e2e/verification.spec.ts](e2e/verification.spec.ts).

## Accessibility Quality Gate (`npm run test:a11y`)

To run the complete WCAG accessibility quality gate locally (documented in [.github/TESTING.md](.github/TESTING.md)):

```bash
npm run test:a11y
```

To run against the production standalone Next.js build (matching CI behavior in [.github/workflows/ci.yml](.github/workflows/ci.yml)):

```bash
npm run build
DATABASE_URL="postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public" npm run db:seed
CI=true npm run test:a11y
```

This invokes `node scripts/a11y-report.mjs --run` ([scripts/a11y-report.mjs](scripts/a11y-report.mjs)), which:

1. Clears stale `test-results/` data.
2. Runs `npm test`, recording any component-level `jest-axe` violations via [jest.setup.js](jest.setup.js) into `test-results/jest-a11y-violations.json`.
3. Runs `npx playwright test`, recording route-keyed `@axe-core/playwright` violations across audited routes into `test-results/playwright-a11y-violations.json`.
4. Always writes `test-results/a11y-summary.md` first, then exits non-zero if Jest failed, Playwright failed, or `totalViolations > 0`.

To regenerate `test-results/a11y-summary.md` from existing JSON artifacts without re-running the test suites (as done in CI after downloading artifacts):

```bash
node scripts/a11y-report.mjs
```
