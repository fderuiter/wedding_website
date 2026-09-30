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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);

    let response: Response;
    try {
      response = await safeFetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr instanceof ApiError) {
        throw fetchErr;
      }
      if (fetchErr && fetchErr.message && (fetchErr.message.startsWith('Blocked:') || fetchErr.message === 'Invalid URL')) {
        throw new ApiError(400, fetchErr.message);
      }
      throw new ApiError(422, 'NETWORK_TIMEOUT: Network request timed out or failed while reaching vendor site.', { errorDomain: 'NETWORK_TIMEOUT' });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      if (response.status === 403 || response.status === 401 || response.status === 429) {
        throw new ApiError(422, 'BLOCKED_BY_VENDOR: Access to this retailer website was blocked.', { errorDomain: 'BLOCKED_BY_VENDOR' });
      } else if (response.status === 404 || response.status === 410) {
        throw new ApiError(422, 'URL_NOT_FOUND: Product URL could not be found.', { errorDomain: 'URL_NOT_FOUND' });
      } else {
        throw new ApiError(422, 'NETWORK_TIMEOUT: Retailer server error or timeout occurred.', { errorDomain: 'NETWORK_TIMEOUT' });
      }
    }

    const html = await response.text();
    const root = parse(html);

    // 1. JSON-LD structured data extraction
    let ldName: string | undefined;
    let ldDescription: string | undefined;
    let ldImage: string | undefined;
    let ldImageAlt: string | undefined;
    let ldPrice: number | undefined;

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
          if (ldPrice === undefined) {
            ldPrice = extractLdPrice(product);
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

    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    const isAmazonDomain = hostname === 'amazon.com' || hostname.endsWith('.amazon.com');
    const isTargetDomain = hostname === 'target.com' || hostname.endsWith('.target.com');
    const isCostcoDomain = hostname === 'costco.com' || hostname.endsWith('.costco.com');

    // Vendor specific title heuristics
    let vendorTitle: string | undefined;
    if (isAmazonDomain) {
      vendorTitle = root.querySelector('#productTitle, #title')?.textContent?.trim();
    } else if (isTargetDomain) {
      vendorTitle = root.querySelector('h1[data-test="product-title"], h1.pdp-title')?.textContent?.trim();
    } else if (isCostcoDomain) {
      vendorTitle = root.querySelector('h1[data-qa="product-title"], .product-h1, h1.product-title')?.textContent?.trim();
    }

    // Multi-tier price extraction strategy
    let price: number | undefined = ldPrice;

    if (price === undefined) {
      const ogPrice = getMetaContent('og:price:amount');
      price = parsePrice(ogPrice);
    }

    if (price === undefined) {
      const productPrice = getMetaContent('product:price:amount');
      price = parsePrice(productPrice);
    }

    if (price === undefined) {
      const twitterLabel1 = getMetaContent('twitter:label1');
      if (twitterLabel1 && twitterLabel1.toLowerCase().includes('price')) {
        const twitterData1 = getMetaContent('twitter:data1');
        price = parsePrice(twitterData1);
      }
    }

    if (price === undefined) {
      const amazonPriceElements = root.querySelectorAll('.a-price .a-offscreen');
      for (const el of amazonPriceElements) {
        const parsed = parsePrice(el.textContent);
        if (parsed !== undefined) {
          price = parsed;
          break;
        }
      }
    }

    // Vendor specific description heuristics
    let vendorDescription: string | undefined;
    if (isAmazonDomain) {
      vendorDescription = root.querySelector('#feature-bullets, #productDescription')?.textContent?.trim();
    } else if (isTargetDomain) {
      vendorDescription = root.querySelector('div[data-test="item-details-description"], #pdp-tab-description')?.textContent?.trim();
    } else if (isCostcoDomain) {
      vendorDescription = root.querySelector('#product-description, .product-info-description')?.textContent?.trim();
    }

    // Vendor specific image heuristics
    let vendorImage: string | undefined;
    let imageAlt = ldImageAlt || getMetaContent('og:image:alt') || getMetaContent('twitter:image:alt') || '';

    if (isAmazonDomain) {
      const imgEl = root.querySelector('#imgTagWrapperId img, #landingImage, #main-image, img#landingImage');
      if (imgEl) {
        vendorImage = imgEl.getAttribute('src');
        if (!imageAlt && imgEl.getAttribute('alt')) {
          imageAlt = imgEl.getAttribute('alt') || '';
        }
      }
    } else if (isTargetDomain) {
      const imgEl = root.querySelector('div[data-test="product-image"] img, img[data-test="current-image"], picture img');
      if (imgEl) {
        vendorImage = imgEl.getAttribute('src');
        if (!imageAlt && imgEl.getAttribute('alt')) {
          imageAlt = imgEl.getAttribute('alt') || '';
        }
      }
    } else if (isCostcoDomain) {
      const imgEl = root.querySelector('#initialLoadedImage, .product-image-canvas img, img[data-qa="product-image"]');
      if (imgEl) {
        vendorImage = imgEl.getAttribute('src');
        if (!imageAlt && imgEl.getAttribute('alt')) {
          imageAlt = imgEl.getAttribute('alt') || '';
        }
      }
    }

    const ogTitle = getMetaContent('og:title');
    const titleTag = root.querySelector('title')?.textContent?.trim() || '';
    const name = ldName || ogTitle || vendorTitle || titleTag || '';

    const description = ldDescription || getMetaContent('og:description') || vendorDescription || '';

    const image = ldImage || getMetaContent('og:image') || getMetaContent('twitter:image') || vendorImage || '';

    // Extract site favicon candidate as fallback
    let faviconUrl = '';
    const faviconLink = root.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    if (faviconLink) {
      const href = faviconLink.getAttribute('href');
      if (href) {
        try {
          faviconUrl = new URL(href, url).toString();
        } catch {
          // ignore
        }
      }
    }
    if (!faviconUrl) {
      try {
        faviconUrl = new URL('/favicon.ico', url).toString();
      } catch {
        faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
      }
    }

    const scrapedData = {
      name: name,
      description: description,
      ...(price !== undefined ? { price } : {}),
      imageUrl: image,
      imageAlt: imageAlt,
      vendorUrl: url,
      quantity: 1,
      faviconUrl: faviconUrl,
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
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNREFUSED' || error?.message?.includes('fetch failed')) {
      throw new ApiError(422, 'NETWORK_TIMEOUT: Network request timed out while fetching product info.', { errorDomain: 'NETWORK_TIMEOUT' });
    }
    throw new ApiError(422, 'NETWORK_TIMEOUT: Failed to scrape product info due to network error.', { errorDomain: 'NETWORK_TIMEOUT' });
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

export function parsePrice(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;

  let num: number;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '');
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return undefined;
    num = parseFloat(match[0]);
  } else {
    return undefined;
  }

  if (isNaN(num) || !isFinite(num) || num <= 0) {
    return undefined;
  }

  return Math.round(num * 100) / 100;
}

function extractPriceFromOffer(offer: any): number | undefined {
  if (!offer || typeof offer !== 'object') return undefined;

  let price = parsePrice(offer.price);
  if (price !== undefined) return price;

  price = parsePrice(offer.lowPrice);
  if (price !== undefined) return price;

  if (offer.priceSpecification) {
    const specs = Array.isArray(offer.priceSpecification)
      ? offer.priceSpecification
      : [offer.priceSpecification];
    for (const spec of specs) {
      if (spec && typeof spec === 'object') {
        price = parsePrice(spec.price);
        if (price !== undefined) return price;
      }
    }
  }

  return undefined;
}

function extractLdPrice(product: any): number | undefined {
  if (!product || typeof product !== 'object') return undefined;

  if (product.offers) {
    const offers = Array.isArray(product.offers) ? product.offers : [product.offers];
    for (const offer of offers) {
      const price = extractPriceFromOffer(offer);
      if (price !== undefined) return price;
    }
  }

  const directPrice = parsePrice(product.price) ?? parsePrice(product.lowPrice);
  if (directPrice !== undefined) return directPrice;

  return undefined;
}

