import * as cheerio from 'cheerio';
import { DefaultScraper } from './DefaultScraper';
import { ScrapedData, ScraperStrategy } from '../types';

export class AmazonScraper implements ScraperStrategy {
  private defaultScraper: DefaultScraper;

  constructor() {
    this.defaultScraper = new DefaultScraper();
  }

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
    // First, try getting basic metadata using the default scraper (OGS)
    let data: ScrapedData;
    try {
      data = await this.defaultScraper.scrape(url);
    } catch (e) {
      // If default scraper fails hard, we might still want to try raw HTML,
      // but usually OGS is robust enough to at least return partial data.
      // For now, let's assume we start with empty data if OGS fails.
      data = {
        name: '',
        description: '',
        image: '',
        vendorUrl: url,
        quantity: 1,
      };
    }

    // If we already have an image, we are good.
    if (data.image) {
      return data;
    }

    // Fallback: Fetch HTML and parse with Cheerio to find the main product image
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
      console.error('AmazonScraper: Cheerio fallback failed:', e);
      // Don't throw, just return what we have
    }

    return data;
  }
}
