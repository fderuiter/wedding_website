# Local Environment Setup

This guide provides step-by-step instructions for configuring a local development environment for the wedding website platform. Following this guide ensures consistent environment configuration, reproducible database schemas, and clean verification gates.

---

## 1. Prerequisites

Before installing the application, verify that your machine meets the minimum system requirements:

- **Node.js**: LTS version v22+ is required. Verify your installed version with `node -v`.
- **Git**: Modern Git for version control and branch management (`git --version`).
- **PostgreSQL Database**: A running PostgreSQL instance (v15+ recommended). You can run PostgreSQL locally, via Docker, or use cloud-hosted instances (e.g. Neon, Supabase, Railway, AWS RDS, GCP Cloud SQL). Refer to the [PostgreSQL Database Contract in DEPLOYMENT.md](../DEPLOYMENT.md) and [Application Runtime Contract](./runtime-contract.md) for operational expectations.
- **Docker & Docker Compose** *(Optional)*: Recommended for automated test database containerization and container smoke tests.

---

## 2. Cloning the Repository & Installing Dependencies

1. **Clone the repository:**

   ```bash
   git clone https://github.com/fderuiter/wedding_website.git
   cd wedding_website
   ```

2. **Install project dependencies:**

   ```bash
   npm install
   ```

   The postinstall lifecycle hook automatically runs `prisma generate` to compile the Prisma Client and updates architecture documentation.

---

## 3. Environment Variables Configuration

The platform relies on environment variables for database connections, administrative credentials, and runtime features.

1. **Create an environment file:**

   Copy the provided `.env.example` template to `.env` (or `.env.local` / `.env.development`):

   ```bash
   cp .env.example .env
   ```

2. **Configure Required Variables:**

   Open `.env` in your editor and configure the following required variables:

   ```env
   # Required for Admin Login (Must be a scrypt hash, NOT plaintext)
   ADMIN_PASSWORD="scrypt:c2FsdA==:aGFzaA=="

   # Required for PostgreSQL connection
   DATABASE_URL="postgresql://user:password@localhost:5432/wedding_dev?schema=public"
   ```

3. **Generating the Admin Password Hash:**

   > **Security Guardrail**: Never commit unencrypted administrative passwords or private credentials to the repository. The system strictly rejects plaintext passwords.

   Generate a cryptographically secure scrypt hash using the local utility script:

   ```bash
   node scripts/generate-password-hash.mjs "your_secure_password"
   ```

   Copy the output string (`scrypt:[saltBase64]:[keyBase64]`) and paste it as the value of `ADMIN_PASSWORD` in your `.env` file.

4. **Optional Variables:**

   - `POSTGRES_URL_NON_POOLING`: A direct connection string bypassing connection poolers (useful for Prisma migrations on pooled providers).
   - `HISTORY_VERSION_LIMIT`: Maximum number of historical versions retained for content audits (defaults to `50`).

---

## 4. Database Initialization & Seeding

1. **Run Database Migrations:**

   Apply the Prisma schema to your PostgreSQL database to create application tables:

   ```bash
   npm run migrate:dev
   ```

2. **Seed Initial Application Data (Optional):**

   Populate the database with baseline site settings, partner details, hero content, and initial wedding configuration:

   ```bash
   npm run db:seed
   ```

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

If you start with an unseeded database, navigating to `http://localhost:3000` will direct you to the **First-Run Setup Wizard**:

1. Authenticate with the plaintext password corresponding to the `ADMIN_PASSWORD` scrypt hash configured in your `.env` file.
2. Enter your partner names, wedding date, canonical site URL, venue information, and timezone.
3. Once completed, the bootstrap endpoint is sealed against unauthorized replay attacks (`403 Forbidden`). Subsequent updates can be managed via the Admin Dashboard (`/admin/dashboard`).

---

## 6. Quality Gates & Testing

Before committing code or submitting pull requests, run local quality checks to ensure test coverage and style compliance:

- **ESLint & Code Formatting:**
  ```bash
  npm run lint
  ```

- **Unit & Integration Test Suite:**
  ```bash
  npm test
  # or in watch mode
  npm run test:watch
  ```
  The test runner automatically isolates database state by orchestrating an isolated PostgreSQL container (`wedding_test`) via pretest hooks, ensuring your local development data is never modified.

- **Full Quality Gate:**
  ```bash
  npm run quality
  # or
  npm run check:all
  ```

---

## 7. Next Steps & Additional Resources

- **[Testing Strategy](../.github/TESTING.md)**: Detailed breakdown of Jest unit tests, Playwright E2E suites, database isolation, and coverage requirements.
- **[Contribution Guidelines](../.github/CONTRIBUTING.md)**: Coding standards, branching rules, quality thresholds, and pull request submission etiquette.
- **[Deployment Strategy](../DEPLOYMENT.md)**: Multi-target cloud recipes for Docker VPS, Cloud Run, Vercel, and Render.
- **[Application Runtime Contract](./runtime-contract.md)**: Container specification and production environment requirements.
