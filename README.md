# Wedding Website & Custom Registry

This project is a comprehensive, open-source wedding website that features a custom-built, fully functional gift registry system. It serves as a customizable and self-hostable alternative to traditional wedding registry platforms, complete with modern features like 3D animations and a full administrative interface.

**[Documentation Portal](https://fderuiter.github.io/wedding_website/)** | **[Live Demo](https://fderuiter.github.io/wedding_website/demo/)** | **[Storybook](https://fderuiter.github.io/wedding_website/storybook/)** | **[Architecture Overview](./ARCHITECTURE.md)** | **[Runtime Contract](./docs/runtime-contract.md)** | **[Deployment Recipes](./DEPLOYMENT.md)** | **[API Specification](./public/openapi.json)** | **[Asset Storage System](./docs/ASSET_STORAGE.md)** | **[Downstream Upgrade Guide](./docs/upgrading.md)** | **[Versioning Policy](./docs/versioning.md)**

## Table of Contents

1.  [Purpose](#purpose)
2.  [Key Features](#key-features)
3.  [Tech Stack](#tech-stack)
4.  [Setup & Installation](#setup--installation)
    *   [Prerequisites](#prerequisites)
    *   [Installation Steps](#installation-steps)
    *   [Environment Variables](#environment-variables)
    *   [Database Setup](#database-setup)
5.  [Usage](#usage)
    *   [Development Server](#development-server)
    *   [Linting & Testing](#linting--testing)
    *   [First-Run Setup & Bootstrap](#first-run-setup--bootstrap)
    *   [Admin Access](#admin-access)
    *   [Guest Households, Address Collection & QR Label Printing](#guest-households-address-collection--qr-label-printing)
    *   [Registry Management](#registry-management)
    *   [Upgrading & Upstream Maintenance](#upgrading--upstream-maintenance)
6.  [Project Structure](#project-structure)
7.  [Contributing](#contributing)
8.  [License](#license)

## Purpose

The primary goal of this project is to provide a personal, customizable, and cost-effective solution for couples who want more control over their wedding website and registry. Unlike commercial platforms that often charge fees or have limited customization, this open-source solution allows you to:
*   Host your own registry without third-party fees.
*   Customize the design and content to match your wedding theme.
*   Integrate unique features like 3D interactive elements.
*   Keep your guest data private.

## Key Features

*   **Interactive User Experience:**
    *   Engaging 3D animations using **React Three Fiber** and **Rapier** physics (e.g., the interactive `/heart` page).
    *   A fully responsive, themeable design system for seamless viewing across devices.
    *   Smooth page transitions and scroll-based animations with **Framer Motion**.
    *   "Add to Calendar" (`.ics` and Google Calendar) generation and live wedding countdown widgets.
*   **Custom Gift Registry, Cash Funds & Checkout:**
    *   **Physical Gifts & Dedicated Funds:** Configure `PHYSICAL` gifts alongside `CASH_FUND` and `EXPERIENCE_FUND` items in [`src/features/registry/components/RegistryItemForm.tsx`](./src/features/registry/components/RegistryItemForm.tsx), complete with optional peer-to-peer payment handles (`Venmo`, `PayPal`, `Cash App`, `Zelle`, or `Custom`).
    *   **Stripe Card Checkout & Group Gifting:** Accept direct card contributions via **Stripe** `PaymentIntent` flows with optional processing-fee coverage (`calculateContributionAmounts` in [`src/features/registry/api/payment-intent.ts`](./src/features/registry/api/payment-intent.ts#L73-L75)), or let multiple guests fund shared group gifts with real-time progress bars.
    *   **Single, Batch URL & CSV Imports:** Pre-fill product metadata via single-URL Open Graph/retailer scraping, ingest up to **20** store URLs in parallel (`BatchUrlScraper`), or import external registry spreadsheets via CSV (`CsvRegistryImport`) in [`src/features/registry/pages/add-item.tsx`](./src/features/registry/pages/add-item.tsx).
    *   **Filtering & Sorting:** Guests can browse registry items by category, price range, availability, and "Most Wanted" highlights.
*   **Guest Households, RSVPs, Seating & Broadcasts:**
    *   **Household Invitation Sessions & Cutoffs:** Authenticate invited households with signed `GUEST_INVITE_COOKIE` sessions (`enforceActiveGuestPageSession` in [`src/core/auth/guestInviteSession.ts`](./src/core/auth/guestInviteSession.ts)), per-sub-event access matrices, and venue-timezone midnight RSVP cutoffs (`getVenueMidnightCutoffUtcMs`) with configurable grace periods (`0`–`168` hours in [`src/utils/rsvpDeadline.ts`](./src/utils/rsvpDeadline.ts)).
    *   **Interactive Seating Chart:** Arrange reception tables, auto-assign or drag-and-drop eligible guests with undo support (`useSeatingState`), and print floorplans (`FloorplanCanvas` and `PrintableFloorplan` in [`src/app/admin/dashboard/seating-chart/SeatingChartClient.tsx`](./src/app/admin/dashboard/seating-chart/SeatingChartClient.tsx#L4-L24)).
    *   **Multi-Provider Guest Broadcasts:** Compose targeted email and SMS announcements (`BroadcastModalForm` in [`src/components/admin/BroadcastModal.tsx`](./src/components/admin/BroadcastModal.tsx)) with audience filters, live previews, test sends, scheduled delivery, and retry logs across **Resend**, **SendGrid**, and **Twilio** adapters (see [`docs/BROADCASTS.md`](./docs/BROADCASTS.md)).
*   **Moderated Photo Gallery & Media Pipeline:**
    *   **Curated & Guest Albums:** Display curated couple galleries alongside moderated guest photo uploads (`PhotosPage` in [`src/app/photos/page.tsx`](./src/app/photos/page.tsx)) with responsive lightbox viewing, live reception slideshows, and admin ZIP archive exports.
    *   **HEIC Worker Transcoding:** Sanitize uploaded images and transcode `HEIC`/`HEIF` camera photos off the main event loop via `node:worker_threads` (`offloadSanitizeToWorker` in [`src/utils/imageProcessor.ts`](./src/utils/imageProcessor.ts)), backed by local filesystem or S3/R2 object storage.
*   **Modular Admin Control Panel & Portable Backups:**
    *   **14 Admin Modules:** Password-protected control panel (`ADMIN_NAV_ITEMS` in [`src/app/admin/dashboard/layout.tsx`](./src/app/admin/dashboard/layout.tsx)) spanning `Overview` (`/admin/dashboard`), `Registry` (`/admin/dashboard/registry`), `Thank-You Notes`, `Invitation Codes`, `Sub-Events Matrix`, `Seating Chart`, `Site Manager`, `Wedding Party`, `Media`, `Attractions`, `Content`, `Settings`, `History`, and `Maintenance`.
    *   **9 Runtime Feature Toggles:** Enable or disable `registry`, `groupGifting`, `weather`, `weddingParty`, `attractions`, `gallery`, `countdown`, `addToCalendar`, and `interactive3D` at runtime with automatic dependency resolution (`resolveModuleConfig` in [`src/lib/modules.ts`](./src/lib/modules.ts)).
    *   **Streaming `v2.0` JSON Backups:** Export and restore sanitized `v2.0` portable backups (`BACKUP_SCHEMA_VERSION` in [`src/app/api/admin/maintenance/export/route.ts`](./src/app/api/admin/maintenance/export/route.ts)) streaming all **15** Prisma models alongside point-in-time configuration snapshots.
*   **Standard Wedding Info Pages:** Customizable pages for event schedules, travel logistics, local attractions, wedding party bios, weather forecasts, and guest Q&A.

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

For detailed onboarding, local setup workflows, and testing runbooks, see the [Developer Setup Guide](./docs/developer-setup.md), [Testing Strategy](./.github/TESTING.md), and [Contribution Guidelines](./.github/CONTRIBUTING.md). For production hosting guidelines and minimum runtime requirements across container and cloud environments, see the [Application Runtime Contract](./docs/runtime-contract.md) and [Deployment Documentation](./DEPLOYMENT.md).

### Prerequisites

*   **Node.js & npm**: Node.js **v22.x LTS** (`>=22.22.1 <23.0.0`, pinned in [`.nvmrc`](./.nvmrc)) and **`npm@10.9.x`** (`^10.9.0`, enforced via [`.npmrc`](./.npmrc) and `devEngines` in [`package.json`](./package.json)).
*   **Git**: For version control.
*   **PostgreSQL Database**: Compatible with local PostgreSQL, the bundled Docker Compose `db` service (`docker compose up -d db` after `cp .env.example .env`, binding `127.0.0.1:5432:5432` with user `wedding`, password `wedding123`, database `wedding` via [`docker-compose.yml`](./docker-compose.yml) and [`docker-compose.ci.yml`](./docker-compose.ci.yml)), or cloud providers (e.g. Neon, Supabase, Railway, RDS, Cloud SQL). See [DEPLOYMENT.md](./DEPLOYMENT.md) for the PostgreSQL Database Contract and operational guidance.

### Installation Steps

1.  **Clone the repository and select Node.js 22 LTS:**
    ```bash
    git clone https://github.com/fderuiter/wedding_website.git
    cd wedding_website
    nvm use
    ```

2.  **Install dependencies cleanly from the lockfile:**
    ```bash
    npm ci
    ```

### Environment Variables

Create a `.env` file (or `.env.local`, `.env.development`, `.env.development.local`) in the root directory by copying [`.env.example`](./.env.example):

```bash
cp .env.example .env
```

Optional integrations (`POSTGRES_URL_NON_POOLING`, `CRON_SECRET`, all six `S3_*` variables, and `STRIPE_*`) remain commented out by default in `.env.example` so local asset uploads use `LocalStorageProvider` ([`src/utils/storage.ts`](./src/utils/storage.ts)) and Prisma migrations ([`prisma.config.ts`](./prisma.config.ts)) manage temporary shadow databases automatically without broken shadow URLs.

Configure the core local environment variables in `.env`:

```env
# PostgreSQL connection (matches local `docker compose up -d db` / docker-compose.ci.yml)
DATABASE_URL="postgresql://wedding:wedding123@localhost:5432/wedding?schema=public"
DB_PASSWORD="wedding123"

# Admin login hash (16-byte salt + 64-byte scrypt key required by src/utils/password.ts — NOT plaintext)
# Generate your hash with: node scripts/generate-password-hash.mjs "your_password"
ADMIN_PASSWORD="scrypt:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="

# Trusted hostnames allowed to access the application
ALLOWED_HOSTS="localhost,127.0.0.1,*.localhost,wedding.example,*.wedding.example"

# Global guest passcode and distinct HMAC-SHA256 guest session signing secret (32+ chars in production)
GUEST_PASSCODE="your-unique-guest-passcode"
GUEST_SESSION_SECRET="your-dedicated-guest-session-secret"
```

> **Important:** Replace the dummy `ADMIN_PASSWORD` placeholder by running `node scripts/generate-password-hash.mjs "your_password"` before signing in to the Setup Wizard or `/admin/login`.

### Database Setup

1.  **Start PostgreSQL (if using Docker Compose) & Run Migrations:** Apply the database schema to your PostgreSQL database:
    ```bash
    docker compose up -d db
    npm run migrate:dev
    ```
    `npm run migrate:dev` (`dotenv -c development -- prisma migrate dev`) loads `.env` automatically and creates all tables defined in `prisma/schema.prisma`.

2.  **Seed Data (Optional):** Run the database seeding script to populate initial configuration settings:
    ```bash
    npm run db:seed
    ```
    `npm run db:seed` (`dotenv -c development -- tsx scripts/seed.ts`) loads `.env` automatically without manual shell exports and upserts the global `AppConfig` record (`partner1Name: 'Jane'`, `partner2Name: 'John'`, `baseUrl: 'http://localhost:3000'`, venue details, and hero text) from [`scripts/seed.ts`](./scripts/seed.ts).

    > **Note on `SetupWizard` Bypass & Root Redirect:** Seeding `AppConfig` satisfies `isSiteInitialized` in [`src/lib/config.ts`](./src/lib/config.ts), which causes [`src/app/layout.tsx`](./src/app/layout.tsx) to skip rendering `<SetupWizard />` and [`src/middleware.ts`](./src/middleware.ts) to redirect unauthenticated requests to `/` (`303 See Other`) to `/guest/login`. Skip `npm run db:seed` if you want to walk through the First-Run Setup Wizard on an unseeded database.

## Usage

### Development Server

Start the development server:

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

### Linting & Testing

Run the linter to ensure code quality:

```bash
npm run lint
```

#### Running Tests with Isolated Database Setup

This project features an automated, zero-configuration local testing setup. Running the test command automatically:
1. Starts the local PostgreSQL database container (using Docker Compose) if it is not already running.
2. Waits for the database to be fully ready and accepting connections.
3. Automatically provisions and synchronizes the Prisma schema to an isolated, dedicated test database (`wedding_test`). This ensures that executing the test suite will never delete, modify, or insert records into your default development database.

To execute the unit and integration test suite locally (without coverage overhead):

```bash
npm test

# Or run a targeted test file:
npm test -- src/utils/__tests__/ApiError.test.ts
```

To run tests in watch mode or enforce full repository coverage thresholds (`80%` lines, `68%` branches):

```bash
npm run test:watch
npm run test:cov
```

### First-Run Setup & Bootstrap

On an **unseeded** installation (before `AppConfig` satisfies `isSiteInitialized`), visiting `http://localhost:3000` renders the five-step [`SetupWizard`](./src/components/setup/SetupWizard.tsx):

1. **Step 1 — Admin Authentication (`Welcome to Your Wedding Site!`):** Enter the plaintext admin password matching the 64-byte `ADMIN_PASSWORD` scrypt hash generated via `node scripts/generate-password-hash.mjs`. **No default password exists.**
2. **Step 2 — The Essentials:** Configure Partner 1 and Partner 2 names, wedding date, timezone, canonical Site URL (`baseUrl`), optional host contact email, venue name/city/state, and theme preset and brand colors (`ThemeConfigurationPanel`, with layout and print styling deferred to Site Settings), saved via `/api/admin/setup`.
3. **Step 3 — Sample Data Selection:** Choose a starter archetype preset and populate optional sample data modules (`registry`, `guests`, `seating`, `weddingParty`, `attractions`), or skip to start blank.
4. **Step 4 — Guest List Import:** Import a guest list CSV spreadsheet (`CsvImportWizardModal`) to generate invitation codes immediately, or skip for later.
5. **Step 5 — Complete Setup:** Optionally manage wedding party members (`WeddingPartyManagerModal`) and local attractions (`AttractionsManagerModal`), then proceed to `/admin/dashboard`. Once `AppConfig` is initialized, `/api/admin/setup` enforces replay protection (`403 Forbidden`) against unauthenticated requests, and `/` redirects unauthenticated visitors to `/guest/login`.

### Admin Access

1.  Navigate to `/admin/login`.
2.  Enter the password matching your configured `ADMIN_PASSWORD` scrypt hash.
3.  Upon successful login, you will land on `/admin/dashboard` (`Admin Overview`), which tracks onboarding milestones and links across all 14 admin workspaces (`Registry`, `Thank-You Notes`, `Invitation Codes`, `Sub-Events Matrix`, `Seating Chart`, `Site Manager`, `Wedding Party`, `Media`, `Attractions`, `Content`, `Settings`, `History`, and `Maintenance`).

### Guest Households, Address Collection & QR Label Printing

*   **Bounded Household Catalog & Pagination:** `GET /api/admin/invitation-codes` supports bounded full-catalog fetches up to `limit=1000` (while other `/api/admin/[entity]` resources remain capped at `100`) and exposes `X-Total-Count` and pagination headers through `apiClient`. The Invitation Codes dashboard paginates cards locally while computing search, RSVP totals, catering summaries, CSV duplicate checks, and server-backed broadcast recipient counts across the full household list.
*   **Public Address Collection & Promotion:** Visitors submitting `/guest/collect` (`POST /api/guest/address/public`) must provide `guestName`, `addressLine1`, `city`, `state`, and `zipCode` and receive an enumeration-safe confirmation response. Matching active invited households have blank contact/postal fields populated without overwriting an existing street address, free-text form notes are stored in `extraFields.householdNotes` (keeping `dietaryNotes` isolated for catering summaries), and unmatched or conflicting-address submissions are staged with the `address-collection` tag. Unpromoted `address-collection` entries cannot authenticate at `/api/guest/login`, validate codes, match `/api/guest/lookup`, or complete the `Guest List` onboarding milestone until an admin clicks **Promote to Invited** on `/admin/dashboard/invitation-codes`.
*   **Private Sub-Event Access & Avery QR Labels:** Guest card sub-event toggles and **Batch Sub-Event Access** list only private sub-events (`isPrivate: true`), since public sub-events are open to all invited guests. Printable QR label sheets render through a `document.body` portal formatted for Avery 5160 (3 columns, 30 per Letter sheet) and Avery 5163 (2 columns, 10 per Letter sheet), exclude sample rows (`isSample: true`), and encode canonical RSVP links from `AppConfig.baseUrl`.

### Registry Management

*   **Adding Gifts, Funds & Batch Imports:** Open `/admin/dashboard/registry` and click "Add New Item" (`/add-item`) to create `PHYSICAL` gifts, `CASH_FUND`, or `EXPERIENCE_FUND` items, scrape a single product URL, batch-scrape up to 20 retail URLs in parallel, or import a CSV spreadsheet.
*   **Group Gifts, Stripe & Payment Handles:** Enable group gifting on physical items (automatically enabled on cash and experience funds), accept card payments via **Stripe** when `STRIPE_*` keys are configured, or attach `Venmo`, `PayPal`, `Cash App`, `Zelle`, or `Custom` payment handles.
*   **Managing Contributions & Thank-You Notes:** Reorder items, track funded progress, confirm or void pending reservations in `/admin/dashboard/registry`, and manage contributor follow-ups in `/admin/dashboard/thank-you-notes`.

### Upgrading & Upstream Maintenance

If you cloned or forked this template to host your own wedding website, you can pull upstream fixes and new features using Git:

*   See **[docs/upgrading.md](./docs/upgrading.md)** for step-by-step instructions on adding upstream remotes, resolving conflicts, running database migrations (`npm run migrate:deploy`), and post-upgrade testing.
*   See **[docs/versioning.md](./docs/versioning.md)** for our Semantic Versioning policy, release note categorization, and breaking change protocols.

## Project Structure

*   `.githooks`: Repository Git hooks (such as `pre-commit` static verification gates).
*   `.github`: GitHub Actions CI/CD workflows, contributor and testing guides, and issue/PR templates.
*   `.storybook`: Storybook 8 configuration and preview decorators for isolated UI component development.
*   `assets`: Source brand assets and bundled fonts used during builds and image generation.
*   `docker`: Isolated Prisma CLI lockfile and offline package stubs for the production container image.
*   `docs`: Developer onboarding, runtime contract, feature specifications, and deployment runbooks.
*   `docs-portal`: VitePress documentation portal configuration, interactive OpenAPI explorer, and staged specs.
*   `e2e`: End-to-end browser, smoke, and accessibility test suites (Playwright).
*   `eslint-rules`: Custom workspace ESLint rules enforcing import boundaries and non-deprecated utilities.
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
