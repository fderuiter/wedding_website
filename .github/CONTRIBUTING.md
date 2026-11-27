# Contributing to This Glorious Wedding Website Thing

First off, thanks for considering contributing! Seriously, you clicking here is probably the highlight of my week. Whether you found a bug that annoys you more than a misplaced seating card, have a genius idea for a feature (like, maybe, automatically RSVPing 'yes' for everyone?), or just want to fix my questionable code, your help is appreciated.

This project, while built for a specific wedding, is also a bit of a portfolio piece and an experiment in slightly-too-complex-for-a-wedding-website engineering. So, let's keep it fun and maybe slightly professional.

## Ground Rules (The "Please Don't Make Me Cry" List)

1. **Be Nice:** Seriously. We're all just trying to make cool stuff (or, in this case, a functional website). Let's be respectful and constructive.
2. **Check Existing Issues:** Before you file a new bug report or feature request, please take a quick peek at the [existing issues](https://github.com/fderuiter/wedding_website/issues) to see if someone else has already mentioned it. Maybe add a thumbs-up or your own details to an existing issue.
3. **Use the Templates:** When you *do* create a new issue, please use the provided templates in [`.github/ISSUE_TEMPLATE/`](ISSUE_TEMPLATE) (`Bug Report`, `Feature Request`, [`Documentation Improvement`](ISSUE_TEMPLATE/documentation.md), `Accessibility Issue Report`, `Configuration Management Improvement`, `Refactoring & Code Quality Task`, `Testing Improvement Task`, `UI/UX Improvement Suggestion`). They help me understand what's going on without needing a crystal ball.

## How to Contribute (The Fun Part!)

1. **Fork the Repo:** Click that 'Fork' button up top. This creates your own copy of the project.
2. **Clone Your Fork:**

    ```bash
    git clone https://github.com/YOUR_USERNAME/wedding_website.git
    cd wedding_website
    ```

3. **Set Up:** Follow the setup instructions in the [Developer Setup Guide](../docs/developer-setup.md) (or root [README.md](../README.md#setup--installation)). Make sure you can run the project locally (`npm run dev`).
4. **Create a Branch:** Make a new branch for your changes. Name it something descriptive, like `fix/registry-typo` or `feat/add-confetti-button`.

    ```bash
    git checkout -b fix/registry-typo
    ```

5. **Make Your Changes:** Write your code, fix the bug, or improve the docs while adhering to our TypeScript, React, Tailwind CSS, and ESLint rules:
   - **Scaffold New Feature Modules:** When introducing a new domain feature under `src/features/`, run `npm run scaffold -- <feature-name>` ([`scripts/scaffold-feature.mjs`](../scripts/scaffold-feature.mjs), kebab-case) to generate the standard `api/`, `components/`, `hooks/`, `lib/`, `schemas.ts`, `types.ts`, `repository.ts`, `service.ts`, and public `index.ts` barrel structure.
   - **Strict ESLint Enforcement:** Run `npm run lint` (or `npm run lint:fix`). [`eslint.config.mjs`](../eslint.config.mjs) enforces **error-level** rules that fail builds, pre-commit hooks, and CI — including single quotes (`@stylistic/quotes`), 2-space indentation (`@stylistic/indent`), required semicolons (`@stylistic/semi`), `prefer-const`, public feature barrel imports only (`no-restricted-imports` banning `@/features/*/*`), utility import boundaries (`local-rules/no-restricted-utility-imports`), no `require()` imports outside `.cjs` (`@typescript-eslint/no-require-imports`), zero unused imports or variables (`unused-imports/no-unused-imports`, `unused-imports/no-unused-vars`), React Hook dependencies (`react-hooks/exhaustive-deps`), JSX entities and ARIA role support (`react/no-unescaped-entities`, `jsx-a11y/role-supports-aria-props`), Next.js image/navigation guardrails (`@next/next/no-img-element`, `@next/next/no-location-assign-relative-destination`), and `@typescript-eslint/no-explicit-any` outside the shrink-only `LEGACY_EXPLICIT_ANY_BASELINE_FILES` list — with `--max-warnings 0` enforced in `npm run lint` and `--max-warnings=0` on staged files in `lint-staged`.
6. **Test Your Changes & Run Quality Gates:** Before submitting your PR, ensure all quality gates pass locally. You can run all checks at once or individual commands:

   - **Run All Quality Checks:**
     ```bash
     npm run quality
     # or: npm run check:all
     ```
     Executes all static checks, linters, documentation portal (`npm run docs:build`), Storybook (`npm run build-storybook`), and static HTML showcase (`npm run build:export`) builds, and unit/integration tests (`npm run test:cov`) via [scripts/check-quality.ts](../scripts/check-quality.ts) (see [AGENTS.md](../AGENTS.md) and [TESTING.md](TESTING.md) for details).

   - **Targeted Quality & Documentation Sync Commands:**
     - `npm run check:static` - Run the shared static and container configuration checks defined in [`scripts/check-quality.ts`](../scripts/check-quality.ts) (`--static`).
     - `npm run check:doc-sync` & `npm run docs:sync` - Verify generated documentation (`public/openapi.json`, `ARCHITECTURE.md`, and `FEATURE_MODULES.md`) is synchronized with codebase schemas in memory without modifying files on disk (`--check`), or explicitly regenerate them on disk with `npm run docs:sync` (`npx tsx scripts/generate-openapi.ts && npx tsx scripts/generate-docs.ts --skip-openapi`).
     - `npm run typecheck`, `npm run lint`, & `npm run lint:unused` - Check TypeScript types (see [AGENTS.md](../AGENTS.md) for the five-file `tsconfig*.json` split), ESLint rules (`--max-warnings 0` with content-hashed `.eslintcache` via `--cache-strategy content` and the shrink-only `LEGACY_EXPLICIT_ANY_BASELINE_FILES` ratchet), and Knip unused exports.
     - `npm test`, `npm run test:cov`, `npm run test:e2e`, & `npm run test:a11y` - Run fast local Jest unit/integration tests (`npm test`, or `npm test -- <path>`), enforce global `80%` line / `68%` branch coverage (`npm run test:cov`), run Playwright E2E specs, and run WCAG 2.2 AA accessibility audits (see [TESTING.md](TESTING.md) for `wedding_test` database isolation, E2E secret alignment, and container smoke tests).
7. **Commit Your Changes:** Write clear commit messages. Something like `fix: Correct spelling on registry item description` or `feat: Add animation to RSVP button`.

    ```bash
    git add .
    git commit -m "fix: Correct spelling on registry item description"
    ```

    Committing triggers [`.githooks/pre-commit`](../.githooks/pre-commit) (installed automatically by `npm ci`), which materializes the staged Git index (`git write-tree`) into an ephemeral snapshot directory (hydrating `node_modules` and path-rewritten `.eslintcache` via [`scripts/quality/worktree-cache.mjs`](../scripts/quality/worktree-cache.mjs)), runs `npx lint-staged` (`--no-stash --no-revert --no-hide-partially-staged --diff=--staged --diff-filter=ACMRD`: `eslint --cache --cache-location .eslintcache --cache-strategy content --no-warn-ignored --no-error-on-unmatched-pattern --fix --max-warnings=0` on staged `*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}` and `.githooks/*` files, plus `check:action-pins`, `lint:migrations`, `check:standalone -- --static-only`, and `check:links` on staged workflows, SQL migrations, container files, `package.json` and `package-lock.json` manifests, and added/modified/deleted Markdown docs), writes `eslint --fix` blobs back to the active Git index, and applies non-conflicting fix hunks to the working tree without stashing or resetting unstaged edits or untracked files.

8. **Push to Your Fork:**

    ```bash
    git push origin fix/registry-typo
    ```

    Pushing triggers [`.githooks/pre-push`](../.githooks/pre-push) (installed automatically by `npm ci`):
    * **Ref Inspection & Ephemeral Worktree Isolation:** Parses pushed refs from `stdin` (skipping branch deletions and up-to-date refs) and runs in place when `HEAD`, tracked files, and non-ignored untracked files (`git status --porcelain --untracked-files=normal`) match the pushed commit, or inside an ephemeral detached `git worktree` (hydrating `node_modules` with isolated `node_modules/.prisma` whenever `prisma/schema.prisma` diverges, `.eslintcache` rewritten to worktree paths via [`scripts/quality/worktree-cache.mjs`](../scripts/quality/worktree-cache.mjs), content-hashed `*.tsbuildinfo`, and `next-env.d.ts` plus `.next/types` only when `.next/types/.route-manifest.json` matches the worktree route digest) without stashing or resetting local files.
    * **Parallel Verification Profile:** Prepares Prisma Client once (`ensurePrismaClientReady`) before launching checks in parallel via a bounded worker pool ([`scripts/quality/parallel-pool.mjs`](../scripts/quality/parallel-pool.mjs)) aligned with the shared `npm run check:pre-push` profile in [`scripts/check-quality.ts`](../scripts/check-quality.ts) (`--pre-push`: `type-check` via [`scripts/quality/run-typecheck.mjs`](../scripts/quality/run-typecheck.mjs), `lint`, `lint:unused`, `check:prisma -- --skip-generate`, conditional `check:audit` when pushed commits modify `package.json`, `package-lock.json`, `docker/prisma-cli/package.json`, or `docker/prisma-cli/package-lock.json`, and all lightweight static checks including `check:standalone -- --static-only` for container digest pins and `package.json` lockfile specifier sync).

9. **Open a Pull Request (PR):** Go back to the *original* `fderuiter/wedding_website` repository on GitHub. You should see a prompt to create a Pull Request from your new branch. Click it!
    * Give your PR a clear title and description.
    * Reference any relevant issues (e.g., "Fixes #123").
    * Explain *what* you changed and *why*.

10. **Wait Patiently:** I'll review the PR as soon as I can. I might ask for changes or clarification. Once it's approved, I'll merge it in. You're a contributor!

## A Note on Documentation & Upstream Compatibility

We treat upstream compatibility as a core feature of this template. If your pull request introduces changes that affect downstream adopters (such as database migrations, configuration schema changes, environment variables, or breaking changes):

1. **Categorize Changes**: Check the appropriate categories in the PR template (🚀 Application, 🗄️ Schema, ⚙️ Configuration, 🐳 Deployment, ⚠️ Breaking Change, 📚 Documentation).
2. **Flag Adopter Action**: Explicitly flag whether the change requires downstream adopter action (`Adopter Action Required: Yes | No`).
3. **Migration Instructions**: Include clear, step-by-step migration instructions in the PR description if database migrations, environment variable additions, or breaking changes are involved.
4. **Docs Sync**: Keep documentation in sync. For details on versioning guidelines and release categorization, refer to [docs/versioning.md](../docs/versioning.md) and [docs/upgrading.md](../docs/upgrading.md).

## Shared Code and Reusability Guidelines

To minimize codebase bloat and prevent technical debt, we enforce a strict manual review process for shared code reusability. Before creating any new UI component or utility function, you must verify if a suitable solution already exists.

### Step-by-Step Verification Process

1. **Search Existing Codebase:**
   * Run a global search or check the `src/components/ui/` folder for existing visual elements (e.g., buttons, overlays, form inputs).
   * Run a global search or check the `src/utils/` and `src/lib/` directories for common helper logic (e.g., date helpers, class merging utilities, client wrappers).
2. **Review Existing Files Directly:**
   * Browse `src/components/ui/` and `src/utils/` to see if there is an existing component or function that can be extended or configured via props/arguments instead of writing a new one from scratch.
3. **Ask/Consult:**
   * For non-trivial logic, consult other contributors or review existing open pull requests to check if someone else is already implementing a similar helper or component.
4. **Determine Placement:**
   * If the logic is specific only to one domain or feature (e.g., RSVP list table, weather-specific widget), place it in `src/features/<feature-name>/{components,hooks}/`. Keep it isolated from the generic shared folders.
   * If the logic is general-purpose, reusable, and domain-agnostic, it should be placed in `src/components/ui/` (for UI primitives) or `src/utils/` (for stateless utilities).

### Standards for Shared Utility Functions

All new utility functions placed in the global `src/utils/` folder must follow these strict style and location standards:
* **Domain-Agnostic:** They must be generic and completely decoupled from specific business logic, wedding details, or feature schemas. For example, a function to format dates (`formatDate`) is domain-agnostic, while a function to format RSVP-specific registry items belongs in the registry feature folder.
* **Stateless and Pure:** Utility functions must be pure functions with no side effects. They must not rely on global state, mutable external variables, or perform asynchronous networking. Given the same inputs, they must always return the same outputs.
* **TypeScript & Quality:** Explicitly define TypeScript argument and return types. Avoid the use of `any`.
* **Placement:**
  * Place domain-agnostic, stateless helpers in `src/utils/` (e.g., as standalone utility files or added to an existing domain-agnostic utility file).
  * Ensure that feature-specific logic is strictly isolated in feature-specific subdirectories under `src/features/` (use `npm run scaffold -- <feature-name>` when creating a new feature module).

## Code Style

* **TypeScript:** Strict mode (`strict`, `noUnusedLocals`, `noUnusedParameters`) is enforced across all five `tsconfig*.json` files. Explicitly define types and avoid `any`.
* **React:** Functional components with Hooks are the way.
* **Tailwind CSS:** Utility classes first. Avoid custom CSS unless absolutely necessary.
* **Formatting & Imports (`eslint.config.mjs`):** Single quotes, 2-space indentation, semicolons, `prefer-const`, zero unused imports or variables (`unused-imports/no-unused-imports`, `unused-imports/no-unused-vars`), no `require()` outside `.cjs`, cross-feature imports strictly via `@/features/<domain>` public barrels, React Hook dependencies (`react-hooks/exhaustive-deps`), JSX entity/ARIA role rules (`react/no-unescaped-entities`, `jsx-a11y/role-supports-aria-props`), Next.js image/navigation rules (`@next/next/no-img-element`, `@next/next/no-location-assign-relative-destination`), and `@typescript-eslint/no-explicit-any` outside the shrink-only legacy baseline are enforced as **errors** by `npm run lint` (`--max-warnings 0`; use `npm run lint:fix` to auto-format) and `lint-staged` (`--max-warnings=0`).

## Code of Conduct

Basically, don't be a jerk. Treat everyone with respect. If you see someone violating this simple rule, let me know.

Thanks again for helping out!
