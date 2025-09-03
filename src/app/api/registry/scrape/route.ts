import { NextResponse } from 'next/server';
import fetch, { FetchError } from 'node-fetch';
import metascraper from 'metascraper';
import metascraperTitle from 'metascraper-title';
import metascraperDescription from 'metascraper-description';
import metascraperImage from 'metascraper-image';

/**
 * A web scraper endpoint to fetch product metadata from a given URL.
 * It uses the 'metascraper' library to extract Open Graph and metadata tags
 * from the HTML of the target page.
 *
 * Known limitations:
 * - Does not fetch price, as 'metascraper-price' was not available or working.
 * - May be blocked by sites with anti-scraping measures (e.g., Costco).
 * - Image scraping may not work for all sites (e.g., Amazon).
 * - Success depends heavily on the target site having well-formed metadata.
 */
const scraper = metascraper([
  metascraperTitle(),
  metascraperDescription(),
  metascraperImage(),
]);

/**
 * @api {post} /api/registry/scrape
 * @description Scrapes a given URL for product metadata.
 *
 * This function handles a POST request containing a URL to be scraped. It fetches
 * the HTML from the URL and uses the `metascraper` library to extract metadata
 * such as the title, description, and image.
 *
 * @param {Request} request - The incoming Next.js request object, containing the URL to scrape in the JSON body.
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object
 * containing the scraped data or an error message.
 */
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
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
      },
    });
    if (!response.ok) {
      const status = response.status >= 500 ? 502 : 400;
      return NextResponse.json(
        { error: `Failed to fetch URL: ${response.statusText}` },
        { status }
      );
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
    let status = 500;
    let errorMessage = 'Failed to scrape product info';
    if (error instanceof FetchError) {
      status = 502;
      errorMessage = error.message;
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: errorMessage }, { status });
  }
}
