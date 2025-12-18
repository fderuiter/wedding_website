# Wedding Website & Custom Registry

This project is a comprehensive, open-source wedding website that features a custom-built, fully functional gift registry system. It serves as a customizable and self-hostable alternative to traditional wedding registry platforms, complete with modern features like 3D animations and a full administrative interface.

**[Live Demo](https://abbifred.com/)** | **[Architecture Overview](./ARCHITECTURE.md)** | **[API Documentation](./API_DOCUMENTATION.md)**

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
    *   [Admin Access](#admin-access)
    *   [Registry Management](#registry-management)
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
    *   Engaging 3D animations using **React Three Fiber** (e.g., the interactive Heart page).
    *   A fully responsive design for seamless viewing on all devices.
    *   Smooth page transitions and scroll-based animations with **Framer Motion**.
    *   "Add to Calendar" functionality for guests.
*   **Custom Gift Registry:**
    *   **Add & Edit Items:** Manually input gift details or use the built-in web scraper to pre-fill item information from online stores (supports Open Graph metadata and basic Amazon scraping).
    *   **Group Gifting:** Allow guests to contribute partial amounts towards higher-priced items. Progress bars visualize the contribution status.
    *   **Filtering & Sorting:** Guests can easily browse the registry by filtering items by category, price range, and status.
*   **Admin Dashboard:** A password-protected dashboard for managing registry items, including adding, editing, and deleting products.
*   **Standard Wedding Info Pages:** Easily customizable pages for event details, travel information, weather forecasts, and photo galleries.

## Tech Stack

This project is built with a modern, full-stack TypeScript architecture.

*   **Framework:** [Next.js](https://nextjs.org/) (App Router)
*   **Language:** [TypeScript](https://www.typescriptlang.org/)
*   **Styling:** [Tailwind CSS](https://tailwindcss.com/)
*   **Database ORM:** [Prisma](https://www.prisma.io/)
*   **Database:** [PostgreSQL](https://www.postgresql.org/) (hosted on [Neon](https://neon.tech/))
*   **3D & Animation:** [React Three Fiber](https://docs.pmnd.rs/react-three-fiber/getting-started/introduction), [Drei](https://github.com/pmndrs/drei), & [Framer Motion](https://www.framer.com/motion/)
*   **Physics:** [Rapier](https://rapier.rs/) (via `@react-three/rapier`) for 3D interactions.
*   **State Management:** [React Query](https://tanstack.com/query/latest) (TanStack Query) for server state.
*   **Testing:** [Jest](https://jestjs.io/), [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/), and [Playwright](https://playwright.dev/) for end-to-end testing.
*   **Deployment:** [Vercel](https://vercel.com/)

## Setup & Installation

### Prerequisites

*   **Node.js**: LTS version recommended (v18+).
*   **Git**: For version control.
*   **PostgreSQL Database**: You can use a local Postgres instance or a cloud provider like Neon or Supabase.

### Installation Steps

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/fderuiter/wedding_website.git
    cd wedding_website
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Environment Variables

Create a `.env.development.local` file in the root directory by copying the example or creating a new one. You need to define the following variables:

```env
# Required for Admin Login (Must be a BCrypt hash, NOT plaintext)
# Generate a hash by running: node scripts/generate-password-hash.js "your_password"
ADMIN_PASSWORD="$2b$10$..."

# Required for Prisma (PostgreSQL connection)
# Obtain these from your database provider
POSTGRES_PRISMA_URL="postgresql://user:password@host:port/database?pgbouncer=true&connect_timeout=15"
POSTGRES_URL_NON_POOLING="postgresql://user:password@host:port/database?connect_timeout=15"
```

### Database Setup

1.  **Run Migrations:** Apply the database schema to your PostgreSQL database.
    ```bash
    npm run migrate:dev
    ```
    This command creates the necessary tables (`RegistryItem`, `Contributor`, etc.) defined in `prisma/schema.prisma`.

2.  **Seed Data (Optional):** If you have a seeding script or want to migrate data from a JSON file, you can run the migration script (this uses the configured Prisma provider to seed the database).
    ```bash
    npm run db:seed
    ```

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

Run the test suite:

```bash
npm test
```

### Admin Access

1.  Navigate to `/admin/login`.
2.  Enter the password you configured in `ADMIN_PASSWORD`.
3.  Upon successful login, you will be redirected to `/admin/dashboard`.

### Registry Management

*   **Adding Items:** From the dashboard, click "Add New Item". You can paste a product URL to auto-fill details or enter them manually.
*   **Group Gifts:** Toggle the "Allow Group Gifting?" checkbox to let multiple guests contribute to a single item.
*   **Managing Contributions:** The dashboard shows the funded status of each item. You can edit items to update quantities or fix typos.

## Project Structure

*   `src/app`: Next.js App Router pages and API routes.
*   `src/components`: Shared React components (Layout, UI elements, 3D scenes).
*   `src/features`: Feature-specific logic (e.g., `src/features/registry` contains all registry-related components, hooks, and services).
*   `src/data`: Static data files (e.g., wedding party members, things to do).
*   `src/lib`: Core library configurations (Prisma client).
*   `src/utils`: Utility functions (validation, formatting, auth).
*   `src/styles`: Global styles and theme configuration.
*   `prisma`: Database schema definition.
*   `public`: Static assets (images, fonts).
*   `e2e`: End-to-end tests (Playwright).
*   `scripts`: Utility scripts for database migration and maintenance.

## Contributing

Contributions are welcome! Please see the [**CONTRIBUTING.md**](.github/CONTRIBUTING.md) file for guidelines on how to participate in this project.

## License

This project is open-source and available under the [MIT License](LICENSE).
