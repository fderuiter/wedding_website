import { NextResponse, NextRequest } from 'next/server';
import ogs from 'open-graph-scraper';
import * as cheerio from 'cheerio';
import { isPrivateUrl } from '@/utils/ssrf';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const { url } = await request.json();

  if (!url || typeof url !== 'string') {
    throw new ApiError(400, 'URL is required and must be a string');
  }

  try {
    new URL(url);
  } catch {
    throw new ApiError(400, 'Invalid URL format');
  }

  if (await isPrivateUrl(url)) {
    throw new ApiError(400, 'Invalid URL: Private or restricted address');
  }

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
    throw new ApiError(500, 'Failed to scrape product info');
  }

  let image = result.ogImage && result.ogImage.length > 0 ? result.ogImage[0].url : '';
  if (!image && result.twitterImage && result.twitterImage.length > 0) {
    image = result.twitterImage[0].url;
  }

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

      const imageElement = $('#imgTagWrapperId img');

      if (imageElement.length > 0) {
        const imageSrc = imageElement.attr('src');
        if (imageSrc) {
          image = imageSrc;
        }
      }
    } catch (e) {
      console.error('Cheerio fallback for Amazon failed:', e);
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
});
