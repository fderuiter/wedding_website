import { ScrapeUrlSchema } from '@/utils/validation';
import { NextResponse, NextRequest } from 'next/server';
import { parse } from 'node-html-parser';
import { safeFetch } from '@/utils/safeFetch';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { logger } from '@/lib/logger';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const body = await request.json();
  const parseResult = ScrapeUrlSchema.safeParse(body);
  
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { url } = parseResult.data;

  try {
    const response = await safeFetch(url, {
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

    // 1. JSON-LD structured data extraction
    let ldName: string | undefined;
    let ldDescription: string | undefined;
    let ldImage: string | undefined;
    let ldImageAlt: string | undefined;

    const ldScripts = root.querySelectorAll('script[type="application/ld+json"]');
    for (const script of ldScripts) {
      try {
        const text = (script.textContent || script.text || '').trim();
        if (!text) continue;
        const json = JSON.parse(text);
        const product = findProductObject(json);
        if (product) {
          if (!ldName && typeof product.name === 'string') {
            ldName = product.name;
          }
          if (!ldDescription && typeof product.description === 'string') {
            ldDescription = product.description;
          }
          if (product.image) {
            const parsedImg = parseLdImage(product.image);
            if (!ldImage && parsedImg) {
              ldImage = parsedImg.url;
              if (!ldImageAlt && parsedImg.alt) {
                ldImageAlt = parsedImg.alt;
              }
            }
          }
        }
      } catch (err) {
        // Gracefully wrap parsing in try/catch block to handle malformed JSON structure without failing.
      }
    }

    const getMetaContent = (property: string) => {
      return root.querySelector(`meta[property="${property}"]`)?.getAttribute('content') ||
             root.querySelector(`meta[name="${property}"]`)?.getAttribute('content') || '';
    };

    const ogTitle = getMetaContent('og:title');
    const titleTag = root.querySelector('title')?.textContent || '';
    const name = ldName || ogTitle || titleTag || '';

    const description = ldDescription || getMetaContent('og:description');

    let image = ldImage || getMetaContent('og:image');
    let imageAlt = ldImageAlt || getMetaContent('og:image:alt') || getMetaContent('twitter:image:alt') || '';

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
          imageAlt = imageAlt || imageElement.getAttribute('alt') || '';
        }
      }
    }

    const scrapedData = {
      name: name,
      description: description,
      imageUrl: image,
      imageAlt: imageAlt,
      vendorUrl: url,
      quantity: 1,
    };

    return NextResponse.json(scrapedData);
  } catch (error: any) {
    logger.error('Scraping failed:', error);
    if (error instanceof ApiError) {
      throw error;
    }
    if (error && error.message && (error.message.startsWith('Blocked:') || error.message === 'Invalid URL')) {
      throw new ApiError(400, error.message);
    }
    throw new ApiError(500, 'Failed to scrape product info');
  }
});

function findProductObject(obj: any): any | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findProductObject(item);
      if (found) return found;
    }
    return null;
  }

  const type = obj['@type'];
  if (type) {
    if (typeof type === 'string' && type.toLowerCase() === 'product') {
      return obj;
    }
    if (Array.isArray(type) && type.some(t => typeof t === 'string' && t.toLowerCase() === 'product')) {
      return obj;
    }
  }

  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    const found = findProductObject(obj['@graph']);
    if (found) return found;
  }

  for (const key of Object.keys(obj)) {
    if (key !== '@graph') {
      const found = findProductObject(obj[key]);
      if (found) return found;
    }
  }

  return null;
}

function parseLdImage(imageField: any): { url: string; alt?: string } | null {
  if (!imageField) return null;
  if (typeof imageField === 'string') {
    return { url: imageField };
  }
  if (Array.isArray(imageField)) {
    for (const item of imageField) {
      const parsed = parseLdImage(item);
      if (parsed) return parsed;
    }
  }
  if (typeof imageField === 'object') {
    let url: string | undefined;
    if (typeof imageField.url === 'string') {
      url = imageField.url;
    } else if (typeof imageField.contentUrl === 'string') {
      url = imageField.contentUrl;
    }
    if (url) {
      let alt: string | undefined;
      if (typeof imageField.caption === 'string') {
        alt = imageField.caption;
      } else if (typeof imageField.name === 'string') {
        alt = imageField.name;
      }
      return { url, alt };
    }
  }
  return null;
}
