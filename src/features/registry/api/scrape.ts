import { NextResponse } from 'next/server';
import ogs from 'open-graph-scraper';
import * as cheerio from 'cheerio';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { isPrivateUrl } from '@/utils/ssrf';

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

    if (isPrivateUrl(url)) {
      return NextResponse.json({ error: 'Invalid URL: Internal addresses are not allowed' }, { status: 400 });
    }

    // First attempt: Use open-graph-scraper
    const ogsOptions = {
      url,
      fetchOptions: {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        },
      },
    };

    const { error, result } = await ogs(ogsOptions);

    if (error) {
      console.error('Scraping failed:', result);
      return NextResponse.json({ error: 'Failed to scrape product info', details: result }, { status: 500 });
    }

    let image = result.ogImage && result.ogImage.length > 0 ? result.ogImage[0].url : '';
    if (!image && result.twitterImage && result.twitterImage.length > 0) {
      image = result.twitterImage[0].url;
    }

    // Fallback for Amazon: If no image was found, fetch HTML and parse with Cheerio
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    const isAmazonDomain = (
      hostname === 'amazon.com' ||
      (hostname.endsWith('.amazon.com'))
    );
    if (!image && isAmazonDomain) {
      try {
        const response = await fetch(url);
        const html = await response.text();
        const $ = cheerio.load(html);

        // Simplified selector for Amazon's main product image
        const imageElement = $('#imgTagWrapperId img');

        if (imageElement.length > 0) {
          const imageSrc = imageElement.attr('src');
          if (imageSrc) {
            image = imageSrc;
          }
        }
      } catch (e) {
        console.error('Cheerio fallback for Amazon failed:', e);
        // Don't throw an error, just proceed without the image
      }
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
