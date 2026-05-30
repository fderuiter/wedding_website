import { NextResponse } from 'next/server';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { isPrivateUrl } from '@/utils/ssrf';
import { chromium } from 'playwright';

/**
 * @api {post} /api/registry/scrape
 * @description Scrapes a given URL for product metadata.
 *
 * This function uses Playwright to render the page in a headless browser,
 * extracting standard metadata and handling JS-heavy sites like Amazon.
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

    let browser;
    try {
      browser = await chromium.launch({ 
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
        ]
      });
      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 },
        javaScriptEnabled: true,
      });
      const page = await context.newPage();

      // Setting a 15-second timeout and wait until domcontentloaded
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

      // Extract metadata
      const name = await page.evaluate(() => {
        const ogTitle = document.querySelector('meta[property="og:title"]');
        if (ogTitle) return ogTitle.getAttribute('content');
        return document.title || '';
      });

      const description = await page.evaluate(() => {
        const ogDesc = document.querySelector('meta[property="og:description"]');
        if (ogDesc) return ogDesc.getAttribute('content');
        const desc = document.querySelector('meta[name="description"]');
        if (desc) return desc.getAttribute('content');
        return '';
      });

      let image = await page.evaluate(() => {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage) return ogImage.getAttribute('content');
        const twitterImage = document.querySelector('meta[name="twitter:image"]');
        if (twitterImage) return twitterImage.getAttribute('content');
        return '';
      });

      // Fallback for Amazon: If no image was found, find the main product image
      const parsedUrl = new URL(url);
      const isAmazonDomain = parsedUrl.hostname === 'amazon.com' || parsedUrl.hostname.endsWith('.amazon.com');
      
      if (!image && isAmazonDomain) {
        image = await page.evaluate(() => {
          const img = document.querySelector('#imgTagWrapperId img');
          return img ? img.getAttribute('src') : '';
        }) || '';
      }

      await browser.close();

      return NextResponse.json({
        name: name || '',
        description: description || '',
        image: image || '',
        vendorUrl: url,
        quantity: 1,
      });

    } catch (error) {
      if (browser) await browser.close();
      console.error('Scraping failed:', error);
      return NextResponse.json({ error: 'Failed to scrape product info' }, { status: 500 });
    }

  } catch (error: unknown) {
    console.error('Scraping error:', error);
    // Return a generic error message to prevent leaking internal details or stack traces
    return NextResponse.json({ error: 'Failed to scrape product info' }, { status: 500 });
  }
}
