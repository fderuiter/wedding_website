# Wedding Website & Custom Registry

This project is a custom wedding website featuring a fully functional gift registry system.

## The Story

Honestly, I started this because [theknot.com](https://theknot.com) felt kinda limiting and, well, a bit bullshit. It's free, sure, but I wanted something that looked cooler, plus it felt like I was selling my soul to the baby of big tech and big wedding... I can't afford the stuff they're tring to sell me, and too keep wedding costs down here we are. I initially got sidetracked thinking about using Three.js to make something visually fancy, but let me tell you, that stuff is *hard*. Got a cool loading heart though. Tried to make some rings fly around eachout and then combine to make a heart, then transition that into the main page, but it ended up looking awful, so I just kept the heart.

I ended up just vibe-coding my way through this and built a whole registry system instead, which turned out pretty slick. It even has a web scraper to help add items quickly from other sites.

**Tech Journey:** Started with storing registry data in a simple JSON file, then migrated to using Prisma with a SQLite database for local development. For deployment on Vercel, the database was migrated again to PostgreSQL, hosted on [Neon](https://neon.tech/), to leverage their serverless capabilities. The old SQLite migration script and database file might still be lurking in the repo, remnants of a bygone era. Enjoy the claimed costco energy drink item test data that might still be in the history somewhere.

**Known Scraper Quirks:**

* Doesn't work with Costco links. Apparently costco doesn't like webscrapers... Who knew?
* Works for Amazon, but doesn't pull in the product images automatically.
* Adding new items you just need some TLC and might need manual image uploads. The webscraper probably is more of a bug than a feature at this point...
* And many more 🙄

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
    * Create a file named `.env` (or `.env.development.local` for local overrides) in the root of the project.
    * Add the necessary environment variables:

        ```env
        # Required for Admin Login
        ADMIN_PASSWORD=your_super_secret_password

        # Required for Prisma (PostgreSQL connection) - Get these from Neon or your provider
        POSTGRES_PRISMA_URL="postgresql://..." # Connection pooler URL
        POSTGRES_URL_NON_POOLING="postgresql://..." # Direct connection URL (for migrations)

        # Optional: Set Node environment (defaults to development if not set)
        # NODE_ENV=development
        ```

    * Replace placeholders with your actual admin password and database connection strings.
    * **Important:** The `.env*` files are included in `.gitignore` so your secrets won't be accidentally committed.

4. Set up the database:
    * Ensure Prisma CLI is available (it should be installed with `npm install`).
    * **For local development:** Run migrations to create/update the database schema against your local or development PostgreSQL instance defined in `.env.development.local`:

        ```bash
        npm run migrate:dev
        ```

        *(This uses `prisma migrate dev`)*

    * **For deployment environments (like Vercel):** Apply migrations using the deployment connection string (usually handled by the build process or deployment platform settings, referencing environment variables):

        ```bash
        npm run migrate:deploy
        ```

        *(This uses `prisma migrate deploy`)*

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
* **Database:** PostgreSQL (hosted on [Neon](https://neon.tech/) for deployment)
* **Language:** TypeScript
* **Testing:** Jest, React Testing Library

## Note about tests

I got a whole bunch of tests in here which I was making as I was going through for a false sense of security in code reliablilty, however making sure they pass as I was going through kinda fell by the wayside. So they're still in here, but they probably shouldn't be. So if they don't pass know that it's not you... It's me.

## and another thing

If anyone out there want to help out, made this public. Some things I'd like to do is smooth out the animation at the start. I'll probably need to add real content here and maybe a nice looking photo album. I don't really know how this whole github thing is supposed to work, but I'm pretty sure there are some ways to collaborate. Any help would be greatly appreciative. For example I tried to add one of those add to calendar buttons. Pretty sure I installed a package to do that and had that on the main page... But I digress... I'm probably using too many packages anyways, heck there are like a thousand packages as part of this project (shout out to those competent devs out there, you're the real MVP).

## Next steps

Deployed! Right now it's live at: <https://wedding-website-rho-six.vercel.app>. Migrated the db to PostgreSQL using Neon, which added the `@neondatabase/serverless` package and required updating Prisma configuration and connection strings. Fixed some wonky issues with the routes during deployment. Need to verify the registry system thoroughly post-migration. Maybe I'll fix up all the tests for fun. General bug fixes. Maybe adding a bug template in GitHub? Maybe put this on my linkedIn? Just kidding, I don't want to be unemployed...
