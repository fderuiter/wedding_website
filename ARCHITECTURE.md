# Project Architecture

This document provides a high-level overview of the wedding website's architecture. The project is a full-stack application built with Next.js, leveraging its capabilities for both client-side rendering and server-side API routes.

## Core Components

The application is composed of three main parts:

1.  **Frontend:** A React-based user interface built with Next.js Pages Router.
2.  **Backend:** A RESTful API built with Next.js API Routes.
3.  **Database:** A PostgreSQL database managed with Prisma ORM.

```mermaid
graph TD
    subgraph Browser
        A[React Frontend]
    end

    subgraph Server (Vercel)
        B[Next.js API Routes]
        C[Prisma Client]
    end

    subgraph Database (Neon)
        D[PostgreSQL]
    end

    A -- HTTP Requests --> B
    B -- Queries --> C
    C -- TCP Connection --> D
```

### 1. Frontend

The frontend is built using [Next.js](https://nextjs.org/) and [React](https://react.dev/). It is responsible for rendering the user interface that guests and administrators interact with.

-   **Location:** `src/app/`
-   **Key Technologies:**
    -   **React:** For building UI components.
    -   **Next.js:** For routing, server-side rendering, and client-side navigation.
    -   **Tailwind CSS:** For styling.
    -   **Framer Motion:** For animations.
    -   **React Query:** For managing server state, caching, and data fetching.
-   **Structure:**
    -   **Pages (`src/app/`):** Each file in this directory (e.g., `page.tsx`, `registry/page.tsx`) corresponds to a route in the application.
    -   **Components (`src/components/`):** Reusable UI elements like `RegistryCard`, `Gallery`, and `Modal` are located here.
    -   **Admin UI:** A separate set of pages and components under `src/app/admin/` provides an interface for managing the registry.

### 2. Backend (API)

The backend is a set of serverless functions implemented as [Next.js API Routes](https://nextjs.org/docs/api-routes/introduction). These routes handle business logic, data validation, and communication with the database.

-   **Location:** `src/app/api/`
-   **Key Technologies:**
    -   **Next.js API Routes:** For creating serverless API endpoints.
    -   **Prisma:** As the ORM for database access.
-   **Structure:**
    -   **Admin Routes (`src/app/api/admin/`):** Handle administrator authentication (login, logout, session checking).
    -   **Registry Routes (`src/app/api/registry/`):** Provide CRUD (Create, Read, Update, Delete) operations for registry items and handle guest contributions.
    -   **Scraper Route (`src/app/api/registry/scrape/`):** Contains the logic for fetching metadata from external product pages.

### 3. Database

The database stores all the data for the application, primarily the registry items and contributions.

-   **Location:** The schema is defined in `prisma/schema.prisma`.
-   **Key Technologies:**
    -   **PostgreSQL:** The relational database used for production (hosted on [Neon](https://neon.tech/)).
    -   **Prisma:** The ORM used to define the schema and interact with the database in a type-safe way.
-   **Data Models:**
    -   **`RegistryItem`:** Represents a single item in the gift registry.
    -   **`Contributor`:** Represents a contribution made by a guest towards a `RegistryItem`.

The use of Prisma allows for easy schema management through migrations and provides a type-safe client for querying the database from the backend API. The project was originally built with SQLite for local development and has since been migrated to PostgreSQL for production on Vercel.
