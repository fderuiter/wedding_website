import { NextResponse } from 'next/server';
import ogs from 'open-graph-scraper';

/**
 * @api {post} /api/registry/scrape
 * @description Scrapes a given URL for product metadata using open-graph-scraper.
 *
 * This function handles a POST request containing a URL to be scraped. It uses
 * the `open-graph-scraper` library to extract Open Graph metadata such as the
 * title, description, and image. This is more robust than the previous
 * `metascraper` implementation and has better success with sites like Amazon.
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

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    const options = {
      url,
      fetchOptions: {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        },
      },
    };

    const data = await ogs(options);
    const { error, result } = data;

    if (error) {
      // The error object from open-graph-scraper is a boolean. The actual error is in the result
      console.error('Scraping failed:', result);
      return NextResponse.json({ error: 'Failed to scrape product info', details: result }, { status: 500 });
    }

    // Start with the Open Graph image
    let image = result.ogImage && result.ogImage.length > 0 ? result.ogImage[0].url : '';

    // If no OG image, try to fall back to the Twitter-specific image tag
    if (!image && result.twitterImage && result.twitterImage.length > 0) {
      image = result.twitterImage[0].url;
    }

    const scrapedData = {
      name: result.ogTitle || '',
      description: result.ogDescription || '',
      image: image,
      vendorUrl: url,
      quantity: 1,
    };

    return NextResponse.json(scrapedData);

  } catch (error: unknown) {
    console.error('Scraping error:', error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return NextResponse.json({ error: 'Failed to scrape product info', details: errorMessage }, { status: 500 });
  }
}
