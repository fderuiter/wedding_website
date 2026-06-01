import { NextResponse } from 'next/server';
import ogs from 'open-graph-scraper';
import * as cheerio from 'cheerio';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { isPrivateUrl } from '@/utils/ssrf';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

/**
 * @api {post} /api/registry/scrape
 * @description Scrapes a given URL for product metadata.
 *
 * This function first uses `open-graph-scraper` to get standard metadata.
 * If that fails to find critical data (image or price) it falls back
 * to fetching the raw HTML and parsing it with Cheerio.
 * If Cheerio still fails (often for SPAs and dynamic sites), it falls back
 * to a lightweight serverless headless browser.
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

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return NextResponse.json({ error: 'Only HTTP(S) URLs are allowed' }, { status: 400 });
    }

    if (isPrivateUrl(parsedUrl.toString())) {
      return NextResponse.json({ error: 'Private or internal URLs are not allowed' }, { status: 400 });
    }

    // SSRF Protection: Ensure URL does not point to a private IP
    if (await isPrivateUrl(url)) {
      return NextResponse.json({ error: 'Invalid URL: Private or restricted address' }, { status: 400 });
    }

    // Attempt 1: Fast Static Parsing (ogs)
    const ogsOptions = {
      url,
      customMetaTags: [
        { multiple: false, property: 'product:price:amount', fieldName: 'ogPriceAmount' },
        { multiple: false, property: 'price', fieldName: 'price' }
      ],
      fetchOptions: {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        },
      },
    };

    const { error, result } = await ogs(ogsOptions);

    if (error && !result) {
      console.error('Initial static scraping failed');
    }

    let image = result?.ogImage && result.ogImage.length > 0 ? result.ogImage[0].url : '';
    if (!image && result?.twitterImage && result.twitterImage.length > 0) {
      image = result.twitterImage[0].url;
    }
    
    let name = result?.ogTitle || '';
    let description = result?.ogDescription || '';
    let price: number | null = null;
    
    // Try to parse price from custom OG tags if available
    let parsedOgPrice = result?.customMetaTags?.ogPriceAmount || result?.customMetaTags?.price;
    if (Array.isArray(parsedOgPrice)) parsedOgPrice = parsedOgPrice[0];
    if (typeof parsedOgPrice === 'string' && !isNaN(parseFloat(parsedOgPrice))) {
      price = parseFloat(parsedOgPrice);
    }
    
    // Heuristic Check: Are we missing critical data?
    const hostname = new URL(url).hostname.toLowerCase();
    const isAmazonDomain = hostname === 'amazon.com' || hostname.endsWith('.amazon.com');
    // If it's a typical static site that provides name and image, but no price, we might skip headless to save resources,
    // but the prompt implies price is critical. So we will require price, but allow exceptions if it's explicitly Amazon where price is harder to grab without rendering?
    // Actually, Amazon price requires rendering most of the time. Let's just say we require name, image, and price.
    const isMissingData = !image || !name || price === null;

    // Attempt 2: Cheerio fallback for specific domains (like Amazon static parsing)
    if (!image && isAmazonDomain) {
      try {
        const response = await fetch(url);
        const html = await response.text();
        const $ = cheerio.load(html);

        const imageElement = $('#imgTagWrapperId img');
        if (imageElement.length > 0) {
          const imageSrc = imageElement.attr('src');
          if (imageSrc) image = imageSrc;
        }
      } catch (e) {
        console.error('Cheerio fallback failed:', e);
      }
    }

    // Attempt 3: Heuristic Headless Browser Fallback
    // Invoke only if critical data is still missing
    if (isMissingData && (!image || !name || !price)) {
      console.log('Missing critical data, invoking headless browser fallback for:', url);
      let browser = null;
      try {
        browser = await puppeteer.launch({
          args: [...chromium.args, '--disable-blink-features=AutomationControlled'],
          executablePath: await chromium.executablePath(),
          headless: true, // run in headless mode
        });
        const page = await browser.newPage();
        
        // Randomize user agent to help avoid bot detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-US,en;q=0.9',
        });
        
        // Handle navigation timeouts gracefully
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 10000 }).catch(e => console.warn('Navigation timeout, continuing evaluation anyway', e));
        
        // Wait for async rendering briefly
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        const dynamicData = await page.evaluate(() => {
          let dynImage = '';
          let dynName = '';
          let dynPrice: number | null = null;
          
          const hostname = window.location.hostname;
          const normalizedHostname = hostname.toLowerCase();

          if (normalizedHostname === 'amazon.com' || normalizedHostname.endsWith('.amazon.com')) {
            const imgEl = document.querySelector('#imgTagWrapperId img') || document.querySelector('#landingImage') || document.querySelector('.imgTagWrapper img');
            if (imgEl) dynImage = (imgEl as HTMLImageElement).src;
            
            const titleEl = document.querySelector('#productTitle');
            if (titleEl) dynName = (titleEl as HTMLElement).innerText.trim();
            
            const priceEl = document.querySelector('.a-price .a-offscreen');
            if (priceEl) {
              const priceText = (priceEl as HTMLElement).innerText.replace(/[^0-9.]/g, '');
              dynPrice = parseFloat(priceText);
            }
          } else {
            // General SPA fallback
            const ogImage = document.querySelector('meta[property="og:image"]') as HTMLMetaElement;
            if (ogImage && ogImage.content) dynImage = ogImage.content;
            if (!dynImage) {
              const imgs = Array.from(document.querySelectorAll('img'));
              const largeImg = imgs.find(img => img.width > 200 && img.height > 200);
              if (largeImg) dynImage = largeImg.src;
            }
            
            const ogTitle = document.querySelector('meta[property="og:title"]') as HTMLMetaElement;
            if (ogTitle && ogTitle.content) dynName = ogTitle.content;
            else dynName = document.title;
            
            const priceSelectors = ['.price', '[class*="price"]', '[data-test="price"]', '[itemprop="price"]'];
            for (const sel of priceSelectors) {
              const el = document.querySelector(sel);
              if (el) {
                const text = (el as HTMLElement).innerText.trim();
                const match = text.match(/\$[\d,]+\.\d{2}/);
                if (match) {
                  dynPrice = parseFloat(match[0].replace(/[^\d.]/g, ''));
                  break;
                }
              }
            }
          }
          return { dynImage, dynName, dynPrice };
        });
        
        if (!image && dynamicData.dynImage) image = dynamicData.dynImage;
        if (!name && dynamicData.dynName) name = dynamicData.dynName;
        if (!price && dynamicData.dynPrice) price = dynamicData.dynPrice;
      } catch (err) {
        console.error('Headless browser fallback failed:', err);
      } finally {
        if (browser) await browser.close();
      }
    }

    if (!name && !image) {
      console.warn(`Scraping failed for ${url}, returning manual entry error.`);
      return NextResponse.json({ 
        error: 'Could not extract product details. The website might be blocking scrapers. Please enter the details manually.' 
      }, { status: 422 });
    }

    const scrapedData = {
      name: name,
      description: description,
      image: image,
      vendorUrl: url,
      quantity: 1,
      ...(price !== null ? { price } : {}), // only include price if found
    };

    return NextResponse.json(scrapedData);

  } catch (error: unknown) {
    console.error('Scraping error:', error);
    return NextResponse.json({ error: 'Failed to scrape product info' }, { status: 500 });
  }
}
