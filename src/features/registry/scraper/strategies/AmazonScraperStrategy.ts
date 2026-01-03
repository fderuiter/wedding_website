import * as cheerio from 'cheerio';
import { BaseScraperStrategy } from './BaseScraperStrategy';
import { ScrapedData } from '../types';

export class AmazonScraperStrategy extends BaseScraperStrategy {
  canHandle(url: string): boolean {
    try {
        const parsedUrl = new URL(url);
        const hostname = parsedUrl.hostname;
        return hostname === 'amazon.com' || hostname.endsWith('.amazon.com');
    } catch {
        return false;
    }
  }

  async scrape(url: string): Promise<ScrapedData> {
    // Use base implementation first to get OGS data
    const data = await super.scrape(url);

    // Fallback: If no image was found, fetch HTML and parse with Cheerio
    if (!data.image) {
      try {
        const response = await fetch(url);
        const html = await response.text();
        const $ = cheerio.load(html);

        // Simplified selector for Amazon's main product image
        const imageElement = $('#imgTagWrapperId img');

        if (imageElement.length > 0) {
          const imageSrc = imageElement.attr('src');
          if (imageSrc) {
            data.image = imageSrc;
          }
        }
      } catch (e) {
        console.error('Cheerio fallback for Amazon failed:', e);
        // Don't throw an error, just proceed without the image
      }
    }

    return data;
  }
}
