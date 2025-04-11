# Abbigayle & Frederick's Wedding Website & Registry

This project is a wedding website for Abbigayle Schultz and Frederick de Ruiter, built with [Next.js](https://nextjs.org), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), and [Tailwind CSS](https://tailwindcss.com/). It features a visually engaging landing page with a 3D animation and a functional wedding registry.

## Features

- **Landing Page (`/`)**: Displays wedding information with an interactive 3D scene using React Three Fiber.
- **Registry Page (`/registry`)**: Allows guests to browse registry items, search using Fuse.js, view details in a modal, and contribute to or claim gifts.
- **API Endpoints (`/api/registry/*`)**: Handles fetching registry items and processing contributions/claims, updating a local JSON file (`src/data/registry.json`).

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **3D Animation**: React Three Fiber, Drei
- **Client-side Search**: Fuse.js
- **State Management**: React Hooks (useState, useEffect, useMemo)
- **Linting/Formatting**: ESLint

## Getting Started

First, install the dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

- The main page can be edited by modifying `src/app/page.tsx`.
- The registry page can be edited by modifying `src/app/registry/page.tsx`.
- Registry items are stored in `src/data/registry.json`.
- API logic is located in `src/app/api/registry/`.

## Project Structure Highlights

```
wedding_website/
├── src/
│   ├── app/                 # Main application routes (pages) and API routes
│   │   ├── page.tsx         # Landing page
│   │   ├── registry/        # Registry page and related components
│   │   └── api/             # Backend API endpoints
│   ├── components/          # Reusable React components (Modal, RegistryCard, WeddingScene)
│   ├── data/                # Static data files (registry.json)
│   ├── styles/              # Styling configuration (theme.ts)
│   └── types/               # TypeScript type definitions (registry.ts)
├── public/                # Static assets (images, svgs)
├── next.config.ts         # Next.js configuration
├── tailwind.config.js     # Tailwind CSS configuration
└── tsconfig.json          # TypeScript configuration
```

## Learn More

To learn more about the technologies used, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [React Documentation](https://react.dev/) - learn about React.
- [Tailwind CSS Documentation](https://tailwindcss.com/docs) - learn about Tailwind CSS.
- [React Three Fiber Documentation](https://docs.pmnd.rs/react-three-fiber/getting-started/introduction) - learn about React Three Fiber.

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out the [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
