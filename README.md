# Wedding Website & Custom Registry

This project is an open-source, self-hostable wedding website and celebration management platform built with Next.js, TypeScript, and PostgreSQL. It combines guest invitation workflows, multi-event RSVPs, interactive seating charts, photo moderation, scheduled broadcasts, a customizable gift registry, 3D interactive scenes, and full-site backups without vendor lock-in.

**[Live Demo](https://abbifred.com/)** | **[Developer Setup](./docs/developer-setup.md)** | **[Architecture Overview](./ARCHITECTURE.md)** | **[Runtime Contract](./docs/runtime-contract.md)** | **[Deployment Recipes](./DEPLOYMENT.md)** | **[API Specification](./public/openapi.json)** | **[Asset Storage System](./docs/ASSET_STORAGE.md)** | **[Downstream Upgrade Guide](./docs/upgrading.md)** | **[Versioning Policy](./docs/versioning.md)**

## Table of Contents

1.  [Purpose](#purpose)
2.  [Key Features](#key-features)
3.  [Tech Stack](#tech-stack)
4.  [Setup & Installation](#setup--installation)
5.  [Upgrading & Upstream Maintenance](#upgrading--upstream-maintenance)
6.  [Project Structure](#project-structure)
7.  [Contributing](#contributing)
8.  [License](#license)

## Purpose

The primary goal of this project is to provide a personal, customizable, and cost-effective solution for couples who want full ownership over their wedding website, guest logistics, and registry:
*   Host your own celebration portal and registry without third-party platform fees.
*   Customize themes, layouts, print materials, and multi-event schedules from an administrative studio.
*   Keep guest contact details, RSVPs, photos, and seating plans private in your own PostgreSQL database.

## Key Features

*   **Invitation Codes & Multi-Event Responses (RSVPs):**
    *   Household **invitation codes** (`InvitationCode`), CSV guest imports, cohort-scoped **sub-events** (`SubEvent`, `SubEventAccess`), and per-event **event responses** (`SubEventRsvp`) with meal choices, dietary notes, plus-one rules, and venue-timezone RSVP deadline cutoffs.
*   **Interactive Seating Charts:**
    *   Drag-and-drop **seating charts** (`SeatingTable`) with table capacity tracking, household cohort grouping, printable floorplans, and guest table lookup.
*   **Guest Photo Uploads & Moderation:**
    *   Mobile-friendly guest photo gallery uploads (`Media`) with worker-offloaded `HEIC`/`HEIF` transcoding, backed by local disk or S3/R2 object storage and administrative **moderation** queues.
*   **Scheduled Broadcasts & Communications:**
    *   Cohort-filtered announcements and scheduled email/SMS **broadcasts** (`BroadcastMessage`, `BroadcastRecipient`) across Resend, SendGrid, and Twilio adapters processed via `/api/cron/broadcasts`.
*   **Custom Gift Registry, Cash Funds & Payments:**
    *   Physical gifts and dedicated cash/experience funds (`RegistryItem`, `Contributor`), single/batch product URL scraping and CSV imports, partial group gifting with live progress bars, peer-to-peer payment handles, and optional Stripe card checkout with webhook verification.
*   **3D Interactive Experiences & Theme Studio:**
    *   Interactive **React Three Fiber** and **Rapier** 3D scenes, **Framer Motion** transitions, 9 runtime feature toggles, "Add to Calendar" links, live weather forecasts, wedding party profiles (`WeddingPartyMember`), and local travel guides (`Attraction`).
*   **Full-Site Backups & Portable Administration:**
    *   Password-protected `/admin/dashboard` across 14 admin workspaces with content version history (`ContentNode`, `SnapshotVersion`) and streaming `v2.0` **15-model full-site backups** (JSON/ZIP export and restore across every persisted `prisma/schema.prisma` entity).

## Tech Stack

This project is built with a modern, full-stack TypeScript architecture.

*   **Framework:** [Next.js](https://nextjs.org/) (App Router)
*   **Language:** [TypeScript](https://www.typescriptlang.org/)
*   **Styling:** [Tailwind CSS](https://tailwindcss.com/)
*   **Database ORM:** [Prisma](https://www.prisma.io/)
*   **Database:** [PostgreSQL](https://www.postgresql.org/) (portable contract; compatible with local PostgreSQL, Neon, Supabase, Railway, AWS RDS, GCP Cloud SQL, etc.)
*   **3D & Animation:** [React Three Fiber](https://docs.pmnd.rs/react-three-fiber/getting-started/introduction), [Drei](https://github.com/pmndrs/drei), & [Framer Motion](https://www.framer.com/motion/)
*   **Physics:** [Rapier](https://rapier.rs/) (via `@react-three/rapier`) for 3D interactions.
*   **State Management:** [React Query](https://tanstack.com/query/latest) (TanStack Query) for server state.
*   **Testing:** [Jest](https://jestjs.io/), [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/), and [Playwright](https://playwright.dev/) for end-to-end testing.
*   **Deployment:** Multi-cloud options including [Docker / VPS](./docs/deployment/docker-vps.md), [Google Cloud Run](./docs/deployment/gcp-cloud-run.md), [Vercel](./docs/deployment/vercel.md), and [Railway / Render](./docs/deployment/railway-render.md) (See [Deployment Guide](./DEPLOYMENT.md)).

## Setup & Installation

Requires **Node.js v22.x LTS** (pinned in [`.nvmrc`](./.nvmrc)), **`npm@10.9.x`** (enforced via [`.npmrc`](./.npmrc) and [`package.json`](./package.json)), and **PostgreSQL 15+**.

```bash
git clone https://github.com/fderuiter/wedding_website.git
cd wedding_website
nvm use
npm ci
cp .env.example .env
docker compose up -d db
npm run migrate:dev
npm run dev
```

Generate a 64-byte scrypt hash for `ADMIN_PASSWORD` in `.env` with `node scripts/generate-password-hash.mjs "your_password"`, then open `http://localhost:3000` to complete the interactive First-Run Setup Wizard.

*   **Local Setup, Environment Variables & First-Run Wizard:** [docs/developer-setup.md](./docs/developer-setup.md)
*   **Unit, Accessibility, Container & Playwright E2E Testing:** [.github/TESTING.md](./.github/TESTING.md)
*   **Feature Scaffolding, Linting & Git Hook Workflow:** [.github/CONTRIBUTING.md](./.github/CONTRIBUTING.md)
*   **Canonical Environment Variable & Entity Reference:** [docs/runtime-contract.md](./docs/runtime-contract.md)
*   **Production Hosting & CI/CD Deployment Recipes:** [DEPLOYMENT.md](./DEPLOYMENT.md)

## Upgrading & Upstream Maintenance

If you cloned or forked this template to host your own wedding website, you can pull upstream fixes and new features using Git:

*   See **[docs/upgrading.md](./docs/upgrading.md)** for step-by-step instructions on adding upstream remotes, resolving conflicts, running database migrations (`npm run migrate:deploy`), and post-upgrade testing.
*   See **[docs/versioning.md](./docs/versioning.md)** for our Semantic Versioning policy, release note categorization, and breaking change protocols.

## Project Structure

*   `.githooks`: Repository Git hooks (`pre-commit` staged linting and `pre-push` workspace verification gates).
*   `.github`: GitHub Actions CI/CD workflows, contributor and testing guides, and issue/PR templates.
*   `.storybook`: Storybook 10 configuration and preview decorators for isolated UI component development.
*   `assets`: Source brand assets and bundled fonts used during builds and image generation.
*   `docker`: Isolated Prisma CLI lockfile and offline package stubs for the production container image.
*   `docs`: Developer onboarding, runtime contract, feature specifications, and deployment runbooks.
*   `docs-portal`: VitePress documentation portal configuration, interactive OpenAPI explorer, and staged specs.
*   `e2e`: End-to-end browser, smoke, and accessibility test suites (Playwright).
*   `eslint-rules`: Custom workspace ESLint rules enforcing utility import boundaries.
*   `prisma`: Database schema definition and SQL migrations.
*   `public`: Static assets and generated OpenAPI specification.
*   `scripts`: CLI verification, documentation sync, portal generation, and database seeding scripts.
*   `src/app`: Next.js App Router pages and Route Handlers.
*   `src/components`: Shared React components (Layout, UI elements, 3D scenes, first-run `setup/` wizard).
*   `src/core`: Framework infrastructure and authentication modules.
*   `src/features`: Feature-specific logic (e.g., `src/features/registry` contains all registry-related components, hooks, and services).
*   `src/hooks`: Shared React hooks.
*   `src/lib`: Core library configurations (Prisma client, `AppConfig` loader, runtime module toggles).
*   `src/mocks`: MSW mock handlers and server setup for Jest and Storybook.
*   `src/testing`: Typed test fixture factories.
*   `src/utils`: Stateless utility functions (validation, formatting, storage, image worker processing, password verification).

## Contributing

Contributions are welcome! Please see the [**CONTRIBUTING.md**](.github/CONTRIBUTING.md) file for guidelines on how to participate in this project.

## License

This project is open-source and available under the [GNU Affero General Public License](LICENSE).
