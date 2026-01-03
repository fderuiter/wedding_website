import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { isPrivateUrl } from '@/utils/ssrf';
import { scraperService } from '@/features/registry/scraper';

/**
 * @api {post} /api/registry/scrape
 * @description Scrapes a given URL for product metadata.
 *
 * This function first uses `open-graph-scraper` to get standard metadata.
 * If that fails to find an image and the URL is from Amazon, it falls back
 * to fetching the raw HTML and parsing it with Cheerio to find the main
 * product image.
 *
 * @param {Request} request - The incoming Next.js request object.
 * @returns {Promise<NextResponse>} A promise that resolves to the scraped data.
 */
export async function POST(request: Request) {
  // Admin authentication check
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required and must be a string' }, { status: 400 });
    }

    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // SSRF Protection: Ensure URL does not point to a private IP
    if (await isPrivateUrl(url)) {
      return NextResponse.json({ error: 'Invalid URL: Private or restricted address' }, { status: 400 });
    }

    const scrapedData = await scraperService.scrape(url);

    return NextResponse.json(scrapedData);

  } catch (error: unknown) {
    console.error('Scraping error:', error);
    // Return a generic error message to prevent leaking internal details or stack traces
    return NextResponse.json({ error: 'Failed to scrape product info' }, { status: 500 });
  }
}
