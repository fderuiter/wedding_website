import { NextResponse } from 'next/server';
import fetch from 'node-fetch';

// Initialize metascraper with desired plugins
const metascraper = require('metascraper')([
  require('metascraper-title')(),
  require('metascraper-description')(),
  require('metascraper-image')(),
  // require('metascraper-price')(), // Price plugin was not available
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
    } catch (_) {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Fetch HTML content from the provided URL
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.statusText}`);
    }
    const html = await response.text();

    // Extract metadata using metascraper
    const metadata = await metascraper({ html, url });

    // Prepare the response data
    // Note: Price is not included as the plugin was unavailable.
    // Quantity usually isn't available via metadata and needs manual input.
    const scrapedData = {
      name: metadata.title || '',
      description: metadata.description || '',
      image: metadata.image || '',
      vendorUrl: url, // Include the original URL
      // price: metadata.price, // Would be added here if plugin worked
      quantity: 1, // Default quantity to 1, Abbi can adjust this
    };

    return NextResponse.json(scrapedData);

  } catch (error) {
    console.error("Scraping error:", error);
    let errorMessage = 'Failed to scrape product info';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    // Provide more specific error if possible
    if (errorMessage.includes('Failed to fetch')) {
        return NextResponse.json({ error: `Could not reach the provided URL. Please check the link. (${errorMessage})` }, { status: 400 });
    }
    
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
