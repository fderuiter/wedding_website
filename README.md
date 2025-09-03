# Wedding Website & Custom Registry

This project is a comprehensive, open-source wedding website that features a custom-built, fully functional gift registry system. It serves as a customizable and self-hostable alternative to traditional wedding registry platforms, complete with modern features like 3D animations and a full administrative interface.

**[Live Demo](https://abbifred.com/)** | **[Architecture Overview](./ARCHITECTURE.md)** | **[API Documentation](./API_DOCUMENTATION.md)**

## Key Features

*   **Interactive User Experience:**
    *   Engaging 3D animations using **React Three Fiber**.
    *   A fully responsive design for seamless viewing on all devices.
    *   Smooth page transitions and scroll-based animations with **Framer Motion**.
*   **Custom Gift Registry:**
    *   **Add & Edit Items:** Manually input gift details or use the built-in web scraper to pre-fill item information from online stores.
    *   **Group Gifting:** Allow guests to contribute partial amounts towards higher-priced items. Progress bars visualize the contribution status.
    *   **Filtering & Sorting:** Guests can easily browse the registry by filtering items by category and sorting them by price or contribution status.
*   **Admin Dashboard:** A password-protected dashboard for managing registry items, including adding, editing, and deleting products.
*   **Standard Wedding Info Pages:** Easily customizable pages for event details, travel information, and more.

## Tech Stack

This project is built with a modern, full-stack TypeScript architecture.

*   **Framework:** [Next.js](https://nextjs.org/) (App Router)
*   **Language:** [TypeScript](https://www.typescriptlang.org/)
*   **Styling:** [Tailwind CSS](https://tailwindcss.com/)
*   **Database ORM:** [Prisma](https://www.prisma.io/)
*   **Database:** [PostgreSQL](https://www.postgresql.org/) (hosted on [Neon](https://neon.tech/))
*   **3D & Animation:** [React Three Fiber](https://docs.pmnd.rs/react-three-fiber/getting-started/introduction) & [Framer Motion](https://www.framer.com/motion/)
*   **API Layer:** Next.js API Routes
*   **Testing:** [Jest](https://jestjs.io/), [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/), and [Playwright](https://playwright.dev/) for end-to-end testing.
*   **Deployment:** [Vercel](https://vercel.com/)

## Getting Started

### Prerequisites

*   Node.js (LTS version recommended)
*   Git

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/fderuiter/wedding_website.git
    cd wedding_website
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up Environment Variables:**
    *   Create a `.env.development.local` file by copying the example: `cp .env.example .env.development.local`.
    *   Add the following variables to your environment file:

        ```env
        # Required for Admin Login
        ADMIN_PASSWORD="your_super_secret_password"

        # Required for Prisma (PostgreSQL connection)
        # Obtain these from your database provider (e.g., Neon)
        POSTGRES_PRISMA_URL="postgresql://..."     # Connection pooler URL (for query access)
        POSTGRES_URL_NON_POOLING="postgresql://..." # Direct connection URL (for migrations)
        ```

4.  **Set up the database:**
    *   Run the following command to apply the database schema.
        ```bash
        npm run migrate:dev
        ```
    *   For production environments, migrations should be applied as part of your deployment pipeline:
        ```bash
        npm run migrate:deploy
        ```

### Running the Development Server

```bash
npm run dev
```
The application will be available at `http://localhost:3000`.

## Project Documentation

This project is extensively documented to provide clarity on its different aspects. The source code itself contains **JSDoc comments** for all major components, functions, and types.

*   [**ARCHITECTURE.md**](./ARCHITECTURE.md): An overview of the project's technical architecture, data flow, and component structure.
*   [**API_DOCUMENTATION.md**](./API_DOCUMENTATION.md): Detailed documentation for the backend API, including endpoints, request/response formats, and authentication.
*   [**TESTING.md**](./.github/TESTING.md): Information about the testing strategy, how to run tests, and the different types of tests included.
*   [**SCRAPER.md**](./SCRAPER.md): Details on the web scraper's functionality, implementation, and known limitations.
*   [**PROJECT_HISTORY.md**](./PROJECT_HISTORY.md): The original story and development notes for the project.

## Database Schema

The database schema is managed with Prisma and defines the core data structures for the application. The schema is located in `prisma/schema.prisma`.

### `RegistryItem` Model

This model represents a single item in the gift registry.

| Field               | Type      | Description                                                                                      |
| :------------------ | :-------- | :----------------------------------------------------------------------------------------------- |
| `id`                | `String`  | Unique identifier (UUID).                                                                        |
| `name`              | `String`  | The name of the item.                                                                            |
| `description`       | `String`  | A description of the item.                                                                       |
| `category`          | `String`  | The category the item belongs to (e.g., "Kitchen", "Honeymoon Fund").                              |
| `price`             | `Float`   | The total price of the item.                                                                     |
| `image`             | `String`  | URL for the item's image.                                                                        |
| `vendorUrl`         | `String?` | Optional URL to the vendor's product page.                                                       |
| `quantity`          | `Int`     | The number of this item requested.                                                               |
| `isGroupGift`       | `Boolean` | If `true`, guests can contribute partial amounts towards the price.                              |
| `purchased`         | `Boolean` | If `true`, the item has been fully purchased or funded.                                          |
| `purchaserName`     | `String?` | The name of the purchaser (for non-group gifts).                                                 |
| `amountContributed` | `Float`   | The total amount contributed so far (for group gifts).                                           |
| `contributors`      | `Contributor[]` | A list of contributors who have chipped in for this item.                                  |

### `Contributor` Model

This model represents a single contribution made by a guest towards a `RegistryItem`.

| Field          | Type     | Description                                                          |
| :------------- | :------- | :------------------------------------------------------------------- |
| `id`           | `String` | Unique identifier (UUID).                                            |
| `name`         | `String` | The name of the contributor.                                         |
| `amount`       | `Float`  | The amount they contributed.                                         |
| `date`         | `DateTime` | The date of the contribution.                                      |
| `registryItemId` | `String` | A foreign key linking to the `RegistryItem` this contribution is for. |

## Contributing

Contributions are welcome! Please see the [**CONTRIBUTING.md**](.github/CONTRIBUTING.md) file for guidelines on how to participate in this project.
