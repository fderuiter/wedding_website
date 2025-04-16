# Build Plan

- A **Landing Page** (pages/index.js) that showcases a cool hero section (you can customize it with your own images/animations) plus a taste of your portfolio.
- A **Registry Page** (pages/registry.js) that loads items from an API endpoint, implements client‑side filtering and search (using Fuse.js), and shows individual registry items via “cards” and modals.
- Basic **API routes** under pages/api/registry that (a) return a list of registry items (from a sample JSON file), (b) accept a contribution/claim (demo only) and (c) provide an endpoint to “scrape” product info from a URL (using metascraper).  
- A basic **admin guide** via environment variables and documentation so you can later add authentication and persistence.
- Open‑source–ready project structure (including README, LICENSE, and sample .env.example).

Feel free to customize and extend the code. (Note that for a production deployment you’d need to use a real database, secure the admin endpoints, and polish some error handling—but this “starter” code is a strong foundation both as a portfolio piece and as a template for a wedding registry.)

Below is the project file tree and each file’s content.

---

## Project File Structure

```
wedding-website/
├── components/
│   ├── Layout.js
│   ├── Modal.js
│   └── RegistryCard.js
├── data/
│   └── registry.json
├── pages/
│   ├── api/
│   │   └── registry/
│   │       ├── contribute.js
│   │       ├── items.js
│   │       └── scrape.js
│   ├── index.js
│   └── registry.js
├── public/
│   └── images/
│       └── hero.jpg
├── styles/
│   └── globals.css
├── .env.example
├── LICENSE
├── next.config.js
├── package.json
├── postcss.config.js
└── tailwind.config.js
```

---

## 1. Project Configuration Files

### File: package.json

```json
{
  "name": "wedding-website",
  "version": "1.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "autoprefixer": "^10.0.0",
    "fuse.js": "^6.5.3",
    "metascraper": "^5.15.2",
    "metascraper-description": "^5.15.2",
    "metascraper-image": "^5.15.2",
    "metascraper-title": "^5.15.2",
    "next": "^13.0.0",
    "node-fetch": "^3.3.1",
    "postcss": "^8.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "tailwindcss": "^3.0.0"
  }
}
```

### File: next.config.js

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true
};

module.exports = nextConfig;
```

### File: postcss.config.js

```js
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

### File: tailwind.config.js

```js
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
```

### File: .env.example

```env
# Copy this file to .env.local and update values.
ADMIN_PASSWORD=your_admin_password_here
# If you use an external database, add your DATABASE_URL=...
```

### File: LICENSE

You can use, for example, the MIT License. Here’s a short version:

```text
MIT License

Copyright (c) [Year]

Permission is hereby granted, free of charge, to any person obtaining a copy...
[Full MIT license text here]
```

### File: README.md

```markdown
# Wedding Website & Registry

This project is a two‑page wedding website that doubles as a developer portfolio and open source template. It features:
- A modern, ultra‑fast landing page.
- A robust wedding registry page with filtering, search, and item detail modals.
- API endpoints for retrieving registry items, processing contributions, and scraping vendor data.
- A clean codebase using Next.js and Tailwind CSS.

## Getting Started

1. **Clone the repo:**
   ```bash
   git clone https://github.com/yourusername/wedding-website.git
   cd wedding-website
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Copy `.env.example` to `.env.local` and update the admin password and other settings as needed.

4. **Run in development mode:**

   ```bash
   npm run dev
   ```

5. **Build for production:**

   ```bash
   npm run build
   npm start
   ```

## Project Structure

- **pages/**: Contains the landing page (`index.js`), registry page (`registry.js`), and API endpoints under `/api/registry`.
- **components/**: Reusable components (Layout, Modal, RegistryCard).
- **data/registry.json**: Sample registry items.
- **styles/**: Global styles powered by Tailwind CSS.

## Future Enhancements

- Add authentication for admin pages.
- Use a real database for registry items and contributions.
- Integrate with payment gateways for online contributions.
- Improve the web scraping tool with error handling and richer extraction.

## License

This project is open source under the MIT License.

```

---

## 2. Data & Static Files

### File: data/registry.json

This file contains sample registry items. You can later update it manually or via the admin web scraper.

```json
[
  {
    "id": "item1",
    "name": "Vintage Wine Glasses",
    "description": "Elegant glasses for special toasts.",
    "category": "Kitchen",
    "price": "60",
    "image": "/images/wine-glasses.jpg",
    "vendorUrl": "https://example.com/item1",
    "quantity": 1,
    "reserved": false,
    "contributors": []
  },
  {
    "id": "item2",
    "name": "Handcrafted Cutting Board",
    "description": "Perfect for kitchen moments together.",
    "category": "Kitchen",
    "price": "80",
    "image": "/images/cutting-board.jpg",
    "vendorUrl": "https://example.com/item2",
    "quantity": 1,
    "reserved": false,
    "contributors": []
  }
]
```

_(Place appropriate images in the public/images folder or update the paths accordingly.)_

---

## 3. Pages

### File: pages/index.js  

This is the landing page (main wedding page/portfolio).

```jsx
import Layout from '../components/Layout';
import Link from 'next/link';

export default function Home() {
  return (
    <Layout>
      <section
        id="hero"
        className="h-screen bg-cover bg-center flex flex-col justify-center items-center"
        style={{ backgroundImage: "url('/images/hero.jpg')" }}
      >
        <h1 className="text-5xl text-white font-bold drop-shadow-lg">
          John & Jane’s Wedding
        </h1>
        <p className="text-2xl text-white mt-4 drop-shadow-lg">
          October 10th at the Plummer House
        </p>
        <div className="mt-10">
          <Link href="/registry">
            <a className="bg-white text-gray-800 px-6 py-3 rounded-full text-lg font-semibold shadow-lg hover:bg-gray-100">
              View Our Registry
            </a>
          </Link>
        </div>
      </section>
      
      <section id="about" className="py-20 px-4 text-center">
        <h2 className="text-4xl font-bold mb-4">Our Story</h2>
        <p className="max-w-2xl mx-auto text-lg">
          We met, fell in love, and decided to build a life together. Our wedding
          is a celebration of love, laughter, and a passion for building amazing things!
        </p>
      </section>
      
      <section id="portfolio" className="py-20 px-4 bg-gray-100 text-center">
        <h2 className="text-4xl font-bold mb-4">Developer Portfolio</h2>
        <p className="max-w-2xl mx-auto text-lg">
          This website is not only a celebration of our wedding but also a showcase of modern, responsive, and interactive web development.
        </p>
      </section>
    </Layout>
  );
}
```

### File: pages/registry.js  

This page shows the registry and implements search/filter functionality.

```jsx
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import RegistryCard from '../components/RegistryCard';
import Modal from '../components/Modal';
import Fuse from 'fuse.js';

export default function Registry() {
  const [items, setItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeItem, setActiveItem] = useState(null);

  // Load items from our API endpoint
  useEffect(() => {
    fetch('/api/registry/items')
      .then((res) => res.json())
      .then((data) => {
        setItems(data);
        setFilteredItems(data);
      })
      .catch((err) => console.error("Error fetching registry items", err));
  }, []);

  // Fuse.js search config
  const fuse = new Fuse(items, {
    keys: ['name', 'description', 'category'],
    threshold: 0.3
  });

  useEffect(() => {
    if (!searchTerm) {
      setFilteredItems(items);
    } else {
      const results = fuse.search(searchTerm);
      setFilteredItems(results.map(result => result.item));
    }
  }, [searchTerm, items]);

  return (
    <Layout>
      <section className="py-10 px-4">
        <h1 className="text-4xl font-bold text-center mb-8">Wedding Registry</h1>
        <div className="flex justify-center mb-6">
          <input
            type="text"
            placeholder="Search gifts..."
            className="border p-2 rounded w-full max-w-md"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredItems.map(item => (
            <RegistryCard key={item.id} item={item} onClick={() => setActiveItem(item)} />
          ))}
        </div>
      </section>
      
      {activeItem && (
        <Modal item={activeItem} onClose={() => setActiveItem(null)} />
      )}
    </Layout>
  );
}
```

---

## 4. API Endpoints

### File: pages/api/registry/items.js  

Reads the sample registry items from the data file.

```js
import { promises as fs } from 'fs';
import path from 'path';

export default async function handler(req, res) {
  try {
    const filePath = path.join(process.cwd(), 'data', 'registry.json');
    const jsonData = await fs.readFile(filePath, 'utf8');
    const items = JSON.parse(jsonData);
    res.status(200).json(items);
  } catch (error) {
    console.error("Error reading registry file: ", error);
    res.status(500).json({ error: 'Failed to load registry items' });
  }
}
```

### File: pages/api/registry/contribute.js  

A demo endpoint to process a contribution/claim. (In production this would update a database.)

```js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // For demonstration, simply echo the received data.
  const { itemId, contributorName, amount, action } = req.body;
  
  // In production, you’d validate, update your DB, etc.
  console.log(`Received ${action} for item ${itemId} by ${contributorName} for amount ${amount}`);
  
  res.status(200).json({ message: 'Contribution processed successfully', itemId });
}
```

### File: pages/api/registry/scrape.js  

A basic web scraper using metascraper to fetch product info from a URL.

```js
import fetch from 'node-fetch';
import metascraper from 'metascraper';
import metascraperTitle from 'metascraper-title';
import metascraperDescription from 'metascraper-description';
import metascraperImage from 'metascraper-image';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }
  
  try {
    const response = await fetch(url);
    const html = await response.text();
    
    const metadata = await metascraper({
      html,
      url,
      plugins: [metascraperTitle(), metascraperDescription(), metascraperImage()]
    });
    
    // Return extracted information.
    res.status(200).json({
      title: metadata.title || '',
      description: metadata.description || '',
      image: metadata.image || ''
      // You could extend this further with price/vendor extraction.
    });
  } catch (error) {
    console.error("Scraping error: ", error);
    res.status(500).json({ error: 'Failed to scrape product info' });
  }
}
```

---

## 5. Components

### File: components/Layout.js  

A common layout with header and footer.

```jsx
import Link from 'next/link';

export default function Layout({ children }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="py-4 px-6 bg-white shadow">
        <nav className="flex justify-between items-center max-w-5xl mx-auto">
          <Link href="/">
            <a className="text-xl font-bold">Wedding Site</a>
          </Link>
          <div className="space-x-4">
            <Link href="/">
              <a>Home</a>
            </Link>
            <Link href="/registry">
              <a>Registry</a>
            </Link>
          </div>
        </nav>
      </header>
      
      <main className="flex-1">{children}</main>
      
      <footer className="py-4 px-6 bg-gray-50 text-center">
        <p>Made with ❤️ &bull; Open Source on <a className="underline" href="https://github.com/yourusername/wedding-website" target="_blank" rel="noopener noreferrer">GitHub</a></p>
      </footer>
    </div>
  );
}
```

### File: components/RegistryCard.js  

Displays a registry item as a card.

```jsx
export default function RegistryCard({ item, onClick }) {
  return (
    <div
      className="border rounded-lg overflow-hidden shadow hover:shadow-lg transition cursor-pointer"
      onClick={onClick}
    >
      <img src={item.image} alt={item.name} className="w-full h-48 object-cover" />
      <div className="p-4">
        <h3 className="text-xl font-bold">{item.name}</h3>
        <p className="text-gray-600">{item.category}</p>
        <p className="mt-2 text-gray-800">$ {item.price}</p>
      </div>
    </div>
  );
}
```

### File: components/Modal.js  

A simple modal to show item details and allow contribution.

```jsx
import { useState } from 'react';

export default function Modal({ item, onClose }) {
  const [contributorName, setContributorName] = useState("");
  const [amount, setAmount] = useState("");

  // This function simulates a contribution API call.
  const handleContribute = async () => {
    const payload = {
      itemId: item.id,
      contributorName,
      amount,
      action: "contribute"
    };

    try {
      const res = await fetch('/api/registry/contribute', {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      alert(data.message);
      onClose();
    } catch (error) {
      console.error("Contribution error: ", error);
      alert("Failed to process your contribution. Please try again later.");
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-xl w-full p-6 relative">
        <button
          className="absolute top-2 right-2 text-gray-600"
          onClick={onClose}
        >
          &#x2715;
        </button>
        <img src={item.image} alt={item.name} className="w-full h-64 object-cover rounded" />
        <h2 className="text-2xl font-bold mt-4">{item.name}</h2>
        <p className="mt-2 text-gray-700">{item.description}</p>
        <p className="mt-2 text-gray-800 font-semibold">Price: $ {item.price}</p>
        <a
          href={item.vendorUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-4 text-blue-500 underline"
        >
          View on Vendor Site
        </a>

        <div className="mt-6">
          <h3 className="font-semibold mb-2">Contribute / Claim This Gift</h3>
          <input
            type="text"
            placeholder="Your Name"
            className="border p-2 rounded w-full mb-2"
            value={contributorName}
            onChange={(e) => setContributorName(e.target.value)}
          />
          <input
            type="number"
            placeholder="Contribution Amount"
            className="border p-2 rounded w-full mb-4"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
            onClick={handleContribute}
          >
            Submit Contribution
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## 6. Global Styles

### File: styles/globals.css

Be sure to import Tailwind’s base styles.

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Custom global styles can go here */
body {
  font-family: 'Inter', sans-serif;
}
```

Also, in pages/_app.js (if not already created), import the global styles:

### File: pages/_app.js

```jsx
import '../styles/globals.css';

export default function MyApp({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
```

---

## Next Steps

1. **Customize Content & Design:**  
   – Replace the sample text, images, and styling with your own design to really make it “wow.”  
   – Adjust Tailwind’s configuration or add custom CSS as needed.

2. **Extend API Functionality:**  
   – Hook up a real database for persistent storage (e.g. SQLite, Postgres, or Firestore).  
   – Add proper authentication for admin endpoints.

3. **Improve the Web Scraper:**  
   – Enhance the scraping endpoint with better error handling and more robust data extraction.

4. **Deployment:**  
   – Deploy using Vercel, Netlify, or another hosting platform that supports Next.js.

5. **Open Source:**  
   – Update the README/CONTRIBUTING files to help others fork and reuse your work.

This project provides a full‐stack starting point for your wedding website and registry. It’s both a practical tool for your wedding on October 10 at the Plummer House and a portfolio piece demonstrating modern, robust web development. Happy coding, and congratulations on your upcoming wedding!
