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
   - **Strict ESLint Enforcement:** Run `npm run lint` (or `npm run lint:fix`). [`eslint.config.mjs`](../eslint.config.mjs) enforces **error-level** rules that fail builds, pre-commit hooks, and CI — including single quotes (`@stylistic/quotes`), 2-space indentation (`@stylistic/indent`), required semicolons (`@stylistic/semi`), public feature barrel imports only (`no-restricted-imports` banning `@/features/*/*`), utility import boundaries (`local-rules/no-restricted-utility-imports`), no `require()` imports outside `.cjs` (`@typescript-eslint/no-require-imports`), and zero unused imports (`unused-imports/no-unused-imports`).
6. **Test Your Changes & Run Quality Gates:** Before submitting your PR, ensure all quality gates pass locally. You can run all checks at once or individual commands:

   - **Run All Quality Checks:**
     ```bash
     npm run quality
     # or: npm run check:all
     ```
     Executes all static checks, linters, documentation portal and Storybook static builds, and unit/integration tests via [scripts/check-quality.ts](../scripts/check-quality.ts) (see [AGENTS.md](../AGENTS.md) and [TESTING.md](TESTING.md) for details).

   - **Individual Quality Checks:**
     - `npm run check:static` - Run the full static verification bundle (`check:env-docs`, `check:runbooks`, `check:identifiers`, `check:action-pins`, `check:links`, `check:prisma`, `lint:migrations`, `check:doc-sync`, and `check:setup-guides`).
     - `npm run check:env-docs` - Ensure environment variables match `.env.example` and deployment documentation.
     - `npm run check:runbooks` - Verify deployment runbooks match live workflows, Docker Compose, and Prisma 7 contracts.
     - `npm run check:setup-guides` - Verify setup, testing, and contributor guides match `.env.example`, `.env.test`, scripts, hooks, and `tsconfig.json`.
     - `npm run check:identifiers` - Guard against hardcoded personal/template identifiers in core runtime files.
     - `npm run check:action-pins` - Validate strict YAML 1.2 syntax in `.github/workflows/` and ensure third-party GitHub Actions are pinned to 40-character commit SHAs.
     - `npm run check:links` - Validate relative documentation links across Markdown files.
     - `npm run check:prisma` & `npm run lint:migrations` - Validate Prisma schema structure and migration compatibility.
     - `npm run check:standalone` - Verify Next.js standalone build & container portability.
     - `npm run check:doc-sync` - Verify generated documentation (`public/openapi.json`, `ARCHITECTURE.md`, and `FEATURE_MODULES.md`) is synchronized with codebase schemas without drift.
     - `npm run docs:build` - Verify static VitePress documentation portal builds successfully.
     - `npm run build-storybook` - Verify static Storybook component showcase, story imports, and MSW mock handlers compile cleanly via Webpack.
     - `npm run typecheck` (or `npm run type-check`) - Check TypeScript types across `tsconfig.json`, `tsconfig.test.json`, `tsconfig.e2e.json`, and `tsconfig.scripts.json` (production app, unit/integration tests and `src/mocks`, Playwright E2E specs, and `scripts/`).
     - `npm run lint` & `npm run lint:unused` - Run ESLint and Knip unused export analysis.
     - `npm test` - Run Jest unit and integration tests.
     - `npx playwright test` - Run Playwright E2E and smoke tests against the isolated `wedding_test` database (automatically initialized and seeded when `CI` and `TEST_CONTAINER` are unset; stop any running `npm run dev` on port `3000` first, or opt into `PLAYWRIGHT_REUSE_SERVER=true` only when the existing server targets `wedding_test` with aligned `GUEST_SESSION_SECRET`, `GUEST_PASSCODE`, and `ADMIN_PASSWORD` values).
     - `npm run test:a11y` - Run Jest tests, reseed `wedding_test` (`npx tsx scripts/seed.ts`), run Playwright accessibility checks, and generate summary reports.
7. **Commit Your Changes:** Write clear commit messages. Something like `fix: Correct spelling on registry item description` or `feat: Add animation to RSVP button`.

    ```bash
    git add .
    git commit -m "fix: Correct spelling on registry item description"
    ```

    Committing triggers [`.githooks/pre-commit`](../.githooks/pre-commit) (installed automatically by `npm install`), which:
    1. Runs `npx lint-staged` (`eslint --fix` on staged `*.{js,jsx,ts,tsx}` files).
    2. Temporarily stashes unstaged changes (`git stash push --keep-index --include-untracked`) and runs eleven sequential workspace checks before restoring stashed edits: `npm run type-check`, `npm run lint:unused`, `npm run check:env-docs`, `npm run check:runbooks`, `npm run check:setup-guides`, `npm run check:identifiers`, `npm run check:action-pins`, `npm run check:links`, `npm run check:prisma`, `npm run lint:migrations`, and `npm run check:doc-sync`.

8. **Push to Your Fork:**

    ```bash
    git push origin fix/registry-typo
    ```

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

* **TypeScript:** Strict mode (`strict`, `noUnusedLocals`, `noUnusedParameters`) is enforced across all four `tsconfig*.json` files. Explicitly define types and avoid `any`.
* **React:** Functional components with Hooks are the way.
* **Tailwind CSS:** Utility classes first. Avoid custom CSS unless absolutely necessary.
* **Formatting & Imports (`eslint.config.mjs`):** Single quotes, 2-space indentation, semicolons, zero unused imports, no `require()` outside `.cjs`, and cross-feature imports strictly via `@/features/<domain>` public barrels are enforced as **errors** by `npm run lint` (use `npm run lint:fix` to auto-format).

## Code of Conduct

Basically, don't be a jerk. Treat everyone with respect. If you see someone violating this simple rule, let me know.

Thanks again for helping out!
