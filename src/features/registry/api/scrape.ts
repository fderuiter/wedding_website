import { DynamicSchema } from "@/utils/validation";
import { NextResponse, NextRequest } from 'next/server';
import { parse } from 'node-html-parser';
import { isPrivateUrl } from '@/utils/ssrf';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const { url } = await request.json();
  DynamicSchema.safeParse({ url });

  if (!url || typeof url !== 'string') {
    throw new ApiError(400, 'URL is required and must be a string');
  }

  try {
    new URL(url);
  } catch {
    throw new ApiError(400, 'Invalid URL format');
  }

  /**
   * SSRF Guard Clause:
   * Resolves the target hostname to an IP address (IPv4 or IPv6) and validates it
   * against known private, loopback, and restricted address ranges (e.g., 10.0.0.0/8,
   * 127.0.0.0/8, 192.168.0.0/16, fc00::/7). This prevents Server-Side Request Forgery
   * by ensuring the scraper only accesses publicly routable external infrastructure.
   */
  if (await isPrivateUrl(url)) {
    throw new ApiError(400, 'Invalid URL: Private or restricted address');
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new ApiError(500, 'Failed to fetch the provided URL');
    }

    const html = await response.text();
    const root = parse(html);

    const getMetaContent = (property: string) => {
      return root.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ||
             root.querySelector(`meta[name="${property}"]`)?.getAttribute('content') || '';
    };

    const ogTitle = getMetaContent('og:title');
    const titleTag = root.querySelector('title')?.textContent || '';
    const name = ogTitle || titleTag || '';

    const description = getMetaContent('og:description');

    let image = getMetaContent('og:image');
    if (!image) {
      image = getMetaContent('twitter:image');
    }

    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    const isAmazonDomain = (
      hostname === 'amazon.com' ||
      (hostname.endsWith('.amazon.com'))
    );
    
    /**
     * Vendor-Specific Logic: Amazon Fallback
     * Amazon product pages often lack standard Open Graph image tags or load primary images dynamically.
     * This fallback targets the specific DOM selector `#imgTagWrapperId img`, which wraps the primary
     * product image on most standard Amazon item pages, extracting its `src` attribute.
     */
    if (!image && isAmazonDomain) {
      const imageElement = root.querySelector('#imgTagWrapperId img');
      if (imageElement) {
        const imageSrc = imageElement.getAttribute('src');
        if (imageSrc) {
          image = imageSrc;
        }
      }
    }

    const scrapedData = {
      name: name,
      description: description,
      image: image,
      vendorUrl: url,
      quantity: 1,
    };

    return NextResponse.json(scrapedData);
  } catch (error) {
    console.error('Scraping failed:', error);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, 'Failed to scrape product info');
  }
});
