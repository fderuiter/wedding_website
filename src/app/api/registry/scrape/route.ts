import { NextResponse } from 'next/server';
import fetch from 'node-fetch';
import metascraper from 'metascraper';
import metascraperTitle from 'metascraper-title';
import metascraperDescription from 'metascraper-description';
import metascraperImage from 'metascraper-image';
// import metascraperPrice from 'metascraper-price'; // Price plugin was not available

// Initialize metascraper with desired plugins
const scraper = metascraper([
  metascraperTitle(),
  metascraperDescription(),
  metascraperImage(),
  // metascraperPrice(), // Price plugin was not available
]);

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required and must be a string' }, { status: 400 });
    }

    // Validate URL format (basic check)
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Fetch HTML content from the provided URL
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }
    const html = await response.text();

    // Extract metadata using metascraper
    const metadata = await scraper({ html, url });

    // Prepare the response data
    const scrapedData = {
      name: metadata.title || '',
      description: metadata.description || '',
      image: metadata.image || '',
      vendorUrl: url, // Include the original URL
      // price: metadata.price, // Would be added here if plugin worked
      quantity: 1, // Default quantity to 1
    };

    return NextResponse.json(scrapedData);

  } catch (error: unknown) {
    console.error('Scraping error:', error);
    let errorMessage = 'Failed to scrape product info';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
