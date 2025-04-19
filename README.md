# Wedding Website & Custom Registry

This project is a custom wedding website featuring a fully functional gift registry system.

## The Story

Honestly, I started this because [theknot.com](https://theknot.com) felt kinda limiting and, well, a bit bullshit. It's free, sure, but I wanted something that looked cooler. I initially got sidetracked thinking about using Three.js to make something visually fancy, but let me tell you, that stuff is *hard*. Got a cool loading heart though. Tried to make some rings fly around eachout and then combine to make a heart, then transition that into the main page but it ended up looking terrible, so I just kept the heart.

I ended up just vibe-coding my way through this and built a whole registry system instead, which turned out pretty slick. It even has a web scraper to help add items quickly from other sites.

**Tech Journey:** Started with storing registry data in a simple JSON file, but eventually migrated to using Prisma with a SQLite database for a more robust setup.

**Known Scraper Quirks:**

* Doesn't work with Costco links.
* Works for Amazon, but doesn't pull in the product images automatically.
* Adding new items you just need some TLC and might need manual image uploads. The webscraper probably is more of a bug than a feature at this point...

## Getting Started

### Prerequisites

* Node.js (which includes npm) - LTS version recommended.
* Git

### Installation

1. Clone the repository:

    ```bash
    git clone https://github.com/fderuiter/wedding_website/tree/main
    cd wedding_website
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. **Set up Environment Variables:**
    * Create a file named `.env` in the root of the project (`/Users/fred/Documents/GitHub/wedding_website/.env`).
    * Add the admin password to this file:

        ```env
        ADMIN_PASSWORD=your_super_secret_password
        ```

    * Replace `your_super_secret_password` with the actual password you want to use for the admin login.
    * **Important:** This `.env` file is already included in the `.gitignore` so your password won't be accidentally committed.

4. Set up the database:
    * Ensure Prisma CLI is available (it should be installed with `npm install`).
    * Run migrations to create the database schema:

        ```bash
        npx prisma migrate dev --name init
        ```

        *(Note: If the database and initial migration already exist, you might skip this or use `prisma db push` depending on the state)*

### Running the Development Server

```bash
npm run dev
```

This will start the Next.js development server (likely on `http://localhost:3000`).

## Key Features

* Wedding information pages (the standard stuff).
* **The Main Event: Custom Gift Registry**
  * **Add Items:** Manually input gift details or try your luck with the *slightly* temperamental web scraper (remember the quirks mentioned above!).
  * **Edit Items:** Because typos happen, or maybe you decided you want the *other* color toaster.
  * **Contribution Tracking:** Lets guests chip in for bigger ticket items without needing one person to front all the cash. Shows a progress bar so everyone can see how close you are to getting that fancy espresso machine.
  * **Filtering & Sorting:** Guests can sort by price, category, or how much is left to contribute, making it easy to find something in their budget.
  * **Admin Dashboard:** A secret back-end area (client side password protection bb) where you can add, edit, and delete registry items without messing things up for the guests.

## Tech Stack

* **Framework:** Next.js (React)
* **Styling:** Tailwind CSS / PostCSS
* **Database ORM:** Prisma
* **Database:** SQLite (for development/simplicity)
* **Language:** TypeScript
* **Testing:** Jest, React Testing Library
