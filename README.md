# Wedding Website & Custom Registry

This project is a comprehensive, open-source wedding website that features a custom-built, fully functional gift registry system. It serves as a customizable and self-hostable alternative to traditional wedding registry platforms.

## Key Features

*   **Custom Gift Registry:**
    *   **Add & Edit Items:** Manually input gift details or use the built-in web scraper to pre-fill item information from online stores.
    *   **Group Gifting:** Allow guests to contribute partial amounts towards higher-priced items. Progress bars visualize the contribution status.
    *   **Filtering & Sorting:** Guests can easily browse the registry by filtering items by category and sorting them by price or contribution status.
    *   **Admin Dashboard:** A password-protected dashboard for managing registry items, including adding, editing, and deleting products.
*   **Standard Wedding Info Pages:** Easily customizable pages for event details, travel information, and more.

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
    *   Create a `.env.development.local` file in the root of the project for local development. For production, use your hosting provider's environment variable management system.
    *   Add the following variables to your environment file:

        ```env
        # Required for Admin Login
        ADMIN_PASSWORD="your_super_secret_password"

        # Required for Prisma (PostgreSQL connection)
        # Obtain these from your database provider (e.g., Neon)
        POSTGRES_PRISMA_URL="postgresql://..."     # Connection pooler URL (for query access)
        POSTGRES_URL_NON_POOLING="postgresql://..." # Direct connection URL (for migrations)
        ```

    *   Replace the placeholder values with your actual credentials. The `.env*` files are ignored by Git to protect your secrets.

4.  **Set up the database:**
    *   Run the following command to apply the database schema. This command is for local development and requires Docker to be running if you are using a local PostgreSQL instance.

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

## Tech Stack

*   **Framework:** Next.js (React)
*   **Language:** TypeScript
*   **Styling:** Tailwind CSS / PostCSS
*   **Database ORM:** Prisma
*   **Database:** PostgreSQL
*   **Testing:** Jest, React Testing Library

## Project Documentation

This project is documented across several files to provide clarity on its different aspects.

*   [**ARCHITECTURE.md**](./ARCHITECTURE.md): An overview of the project's technical architecture.
*   [**API_DOCUMENTATION.md**](./API_DOCUMENTATION.md): Detailed documentation for the backend API, including endpoints and data structures.
*   [**TESTING.md**](./.github/TESTING.md): Information about the testing strategy and how to run tests.
*   [**SCRAPER.md**](./SCRAPER.md): Details on the web scraper's functionality and known limitations.
*   [**PROJECT_HISTORY.md**](./PROJECT_HISTORY.md): The original story and development notes for the project.

## Data Model

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
| `purchased`         | `Boolean` | If `true`, the item has been fully purchased.                                                    |
| `purchaserName`     | `String?` | The name of the purchaser (for non-group gifts).                                                 |
| `amountContributed` | `Float`   | The total amount contributed so far (for group gifts).                                           |
| `contributors`      | `Contributor[]` | A list of contributors who have chipped in for this item.                                  |

### `Contributor` Model

This model represents a single contribution made by a guest towards a `RegistryItem`. It is only used for group gifts.

| Field          | Type     | Description                                                          |
| :------------- | :------- | :------------------------------------------------------------------- |
| `id`           | `String` | Unique identifier (UUID).                                            |
| `name`         | `String` | The name of the contributor.                                         |
| `amount`       | `Float`  | The amount they contributed.                                         |
| `date`         | `DateTime` | The date of the contribution.                                      |
| `registryItemId` | `String` | A foreign key linking to the `RegistryItem` this contribution is for. |

## Contributing

Contributions are welcome! Please see the [**CONTRIBUTING.md**](.github/CONTRIBUTING.md) file for guidelines on how to participate in this project.
