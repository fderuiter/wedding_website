# Agent Guidelines (`AGENTS.md`)

This guide defines the local bootstrap, verification commands, and continuous integration guardrails for coding agents and contributors working in this repository.

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

## 2. Local Verification & Pre-Push Quality Gates

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
- **Documentation Portal:** `npm run docs:build`
- **Targeted Unit Tests:** `npx jest <path/to/file.test.ts> --coverage=false` (use `npm test` for the full suite with coverage thresholds).
- **Production Next.js Build:** `npm run build`
- **End-to-End Browser Tests:** `npx playwright test`

## 3. Repository Conventions & Guardrails

- **Feature Module Boundaries:** Import cross-feature code strictly through public barrel files (`@/features/<feature>`) rather than deep internal paths (`@/features/<feature>/*`).
- **Action Pinning:** Always pin third-party GitHub Actions to 40-character commit SHAs with a trailing version comment (e.g., `# v7.0.1`).
- **Further Reading:** See [Developer Setup Guide](docs/developer-setup.md), [Testing Strategy](.github/TESTING.md), and [Contribution Guidelines](.github/CONTRIBUTING.md).
