# Local Environment Setup

This guide provides step-by-step instructions for configuring a local development environment for the wedding website platform. Following this guide ensures consistent environment configuration, reproducible database schemas, and clean verification gates.

---

## 1. Prerequisites

Before installing the application, verify that your machine meets the minimum system requirements:

- **Node.js & npm**: Node.js **v22.x LTS** (`^22.12.0`, pinned in [`.nvmrc`](../.nvmrc)) and **`npm@10.9.x`** (`^10.9.0`, enforced via [`.npmrc`](../.npmrc) and `devEngines` in [`package.json`](../package.json)). Verify your installed versions with `node -v` and `npm -v` (or run `nvm use`).
- **Git**: Modern Git for version control and branch management (`git --version`).
- **PostgreSQL Database**: A running PostgreSQL instance (v15+ recommended). You can run PostgreSQL locally, via Docker, or use cloud-hosted instances (e.g. Neon, Supabase, Railway, AWS RDS, GCP Cloud SQL). Refer to the [PostgreSQL Database Contract in DEPLOYMENT.md](../DEPLOYMENT.md) and [Application Runtime Contract](./runtime-contract.md) for operational expectations.
- **Docker & Docker Compose** *(Optional)*: Recommended for automated test database containerization and container smoke tests.

---

## 2. Cloning the Repository & Installing Dependencies

1. **Clone the repository and select Node.js 22 LTS:**

   ```bash
   git clone https://github.com/fderuiter/wedding_website.git
   cd wedding_website
   nvm use
   ```

2. **Install project dependencies from the lockfile:**

   ```bash
   npm ci
   ```

   The `postinstall` lifecycle hook automatically runs `prisma generate` to compile the Prisma Client and records `node_modules/.package-lock-hash` so the first test run skips redundant dependency installation.

---

## 3. Environment Variables Configuration

The platform relies on environment variables for database connections, administrative credentials, and runtime features.

1. **Create an environment file:**

   Copy the provided [`.env.example`](../.env.example) template to `.env` (or `.env.local` / `.env.development`):

   ```bash
   cp .env.example .env
   ```

2. **Configure Required & Core Variables:**

   Open `.env` in your editor and review or customize the core runtime variables. By default, `DATABASE_URL` matches the local PostgreSQL container (`POSTGRES_USER=wedding`, `POSTGRES_PASSWORD=wedding123`, `POSTGRES_DB=wedding` bound on `127.0.0.1:5432` in [`docker-compose.yml`](../docker-compose.yml) / [`docker-compose.ci.yml`](../docker-compose.ci.yml)):

   ```env
   # PostgreSQL connection (matches `docker compose up -d db` local setup)
   DATABASE_URL="postgresql://wedding:wedding123@localhost:5432/wedding?schema=public"
   DB_PASSWORD="wedding123"

   # Required for Admin Login (16-byte salt + 64-byte scrypt hash verified by src/utils/password.ts, NOT plaintext)
   ADMIN_PASSWORD="scrypt:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=="

   # Trusted host domains allowed to access the application
   ALLOWED_HOSTS="localhost,127.0.0.1,*.localhost,wedding.example,*.wedding.example"

   # Global guest passcode and distinct HMAC-SHA256 guest session secret (32+ chars in production)
   GUEST_PASSCODE="your-unique-guest-passcode"
   GUEST_SESSION_SECRET="your-dedicated-guest-session-secret"
   ```

3. **Generating the Admin Password Hash:**

   > **Security Guardrail**: Never commit unencrypted administrative passwords or private credentials to the repository. The dummy `ADMIN_PASSWORD` placeholder in `.env.example` satisfies schema format checks for `db:seed` but cannot authenticate logins.

   Generate a 64-byte scrypt hash (`N=16384, r=8, p=1`, required by [`src/utils/password.ts`](../src/utils/password.ts)) using [`scripts/generate-password-hash.mjs`](../scripts/generate-password-hash.mjs):

   ```bash
   node scripts/generate-password-hash.mjs "your_secure_password"
   ```

   Copy the output string (`scrypt:[saltBase64]:[keyBase64]`) and paste it as the value of `ADMIN_PASSWORD` in your `.env` file.

4. **Optional Variables (Commented Out by Default in `.env.example`):**

   - `POSTGRES_URL_NON_POOLING`: Direct non-pooling/shadow database connection string read by [`prisma.config.ts`](../prisma.config.ts). Keep commented out for local PostgreSQL so `npm run migrate:dev` automatically creates a temporary shadow database instead of failing against a nonexistent shadow URL.
   - `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_PUBLIC_URL`: S3/R2 object storage settings. Keep all six commented out locally so [`src/utils/storage.ts`](../src/utils/storage.ts) uses `LocalStorageProvider`.
   - `CRON_SECRET`: Optional bearer secret for scheduled broadcast cron endpoints.
   - `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`: Optional Stripe card checkout credentials (leave commented out for direct transfer registry funds).
   - `DB_USER`, `DB_NAME`, `DB_PORT`, `CONTAINER_DATABASE_URL`: Optional Docker Compose PostgreSQL and external container database overrides (`NODE_ENV` is also commented out so host processes default to `development` while Next.js builds use `production`).
   - `HISTORY_VERSION_LIMIT`: Maximum number of historical versions retained for content audits (defaults to `50`).

---

## 4. Database Initialization & Seeding

1. **Start Local PostgreSQL (if using Docker Compose) & Run Migrations:**

   Start the PostgreSQL container and apply the Prisma schema to create application tables:

   ```bash
   docker compose up -d db
   npm run migrate:dev
   ```

2. **Seed Initial Application Data (Optional):**

   Populate the database with baseline `AppConfig` settings (`partner1Name`, `partner2Name`, `baseUrl`, hero content, and venue details) from [`scripts/seed.ts`](../scripts/seed.ts):

   ```bash
   npm run db:seed
   ```

   `npm run db:seed` runs `dotenv -c development -- tsx scripts/seed.ts`, automatically loading `.env` without manual shell exports.

   > **Note on `SetupWizard` Bypass & `/` Redirect:** Seeding `AppConfig` populates non-placeholder partner names and `baseUrl`, which satisfies `isSiteInitialized` in [`src/lib/config.ts`](../src/lib/config.ts), skips `<SetupWizard />` in [`src/app/layout.tsx`](../src/app/layout.tsx), and causes [`src/middleware.ts`](../src/middleware.ts) to redirect unauthenticated visits to `/` (`303 See Other`) to `/guest/login` (sign in with `GUEST_PASSCODE`, or visit `/admin/login` with your `ADMIN_PASSWORD`). Leave the database unseeded (skip `npm run db:seed`) if you want to test the First-Run Setup Wizard.

3. **Regenerate Prisma Client (if modifying schemas):**

   ```bash
   npm run prisma:generate
   ```

---

## 5. Running the Development Server

Start the Next.js development server with Turbopack:

```bash
npm run dev
```

The application will start at `http://localhost:3000`.

### First-Run Setup Wizard

If you start `npm run dev` with an **unseeded** database, navigating to `http://localhost:3000` renders all five steps of the **First-Run Setup Wizard** ([`src/components/setup/SetupWizard.tsx`](../src/components/setup/SetupWizard.tsx)):

1. **Step 1 — Admin Authentication (`Welcome to Your Wedding Site!`):** Authenticate with the plaintext password corresponding to the 64-byte `ADMIN_PASSWORD` scrypt hash generated via `node scripts/generate-password-hash.mjs` in `.env`.
2. **Step 2 — The Essentials:** Enter Partner 1 & Partner 2 names, wedding date, timezone, canonical Site URL (`baseUrl`), optional host contact email, venue name/city/state, and theme preset and brand colors (`ThemeConfigurationPanel`, with layout and print tuning deferred to Site Settings), saved via `/api/admin/setup`.
3. **Step 3 — Sample Data Selection:** Choose a starter archetype preset and populate optional sample data modules (`registry`, `guests`, `seating`, `weddingParty`, `attractions`), or skip to start blank.
4. **Step 4 — Guest List Import:** Import a guest list CSV spreadsheet (`CsvImportWizardModal`) to issue invitation codes right away, or skip for later.
5. **Step 5 — Complete Setup:** Optionally manage wedding party members (`WeddingPartyManagerModal`) and local attractions (`AttractionsManagerModal`), then open `/admin/dashboard`. Once `AppConfig` is initialized, `/api/admin/setup` is sealed against unauthenticated replay attacks (`403 Forbidden`), and unauthenticated `/` requests redirect to `/guest/login`.

---

## 6. Verification & Next Steps

Before opening a pull request, run the shared quality workflow (`npm run check:static` for fast static checks or `npm run quality` for the full pre-push suite). Rather than duplicating test, linting, and agent rules here, refer to each authoritative guide:

- **[Testing Strategy](../.github/TESTING.md)**: Fast cached local Jest unit/integration tests (`npm test`), coverage threshold verification (`npm run test:cov`), `wedding_test` pretest database isolation, Playwright E2E (`npm run test:e2e`), WCAG 2.2 AA accessibility audits (`npm run test:a11y`), and standalone/container smoke tests.
- **[Contribution Guidelines](../.github/CONTRIBUTING.md)**: Feature module scaffolding (`npm run scaffold`), ESLint/Knip rules, `.githooks/pre-commit` workflow, and documentation synchronization (`npm run check:doc-sync`).
- **[Agent & Architecture Guidelines](../AGENTS.md)**: Module boundaries, the five-file TypeScript configuration split (`npm run typecheck`), and non-interactive verification workflows.
- **[Application Runtime Contract](./runtime-contract.md)** & **[Deployment Strategy](../DEPLOYMENT.md)**: Canonical environment variable matrix, persisted `prisma/schema.prisma` entities, and cloud hosting recipes.
