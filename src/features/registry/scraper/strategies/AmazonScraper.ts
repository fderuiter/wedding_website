import * as cheerio from 'cheerio';
import { IScraperStrategy, ScrapedData } from '../types';
import { DefaultScraper } from './DefaultScraper';

export class AmazonScraper implements IScraperStrategy {
  private defaultScraper: DefaultScraper;

  constructor() {
    this.defaultScraper = new DefaultScraper();
  }

  canScrape(url: string): boolean {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      return (
        hostname === 'amazon.com' ||
        hostname.endsWith('.amazon.com')
      );
    } catch {
      return false;
    }
  }

  async scrape(url: string): Promise<ScrapedData> {
    // First, try to get data using the default scraper (OG tags)
    let initialData: ScrapedData;
    try {
      initialData = await this.defaultScraper.scrape(url);
    } catch (e) {
      // If default scraping fails completely, we might still try to parse HTML,
      // but usually OGS failing means the site is unreachable.
      // However, we can initialize a blank slate if OGS fails.
      initialData = {
        name: '',
        description: '',
        image: '',
        vendorUrl: url,
        quantity: 1,
      };
    }

    // If we already have an image, we are good.
    if (initialData.image) {
      return initialData;
    }

    // Fallback: Fetch HTML and parse with Cheerio
    try {
      const response = await fetch(url, {
        headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
          },
      });
      const html = await response.text();
      const $ = cheerio.load(html);

      // Simplified selector for Amazon's main product image
      const imageElement = $('#imgTagWrapperId img');

      if (imageElement.length > 0) {
        const imageSrc = imageElement.attr('src');
        if (imageSrc) {
          initialData.image = imageSrc;
        }
      }
    } catch (e) {
      console.error('Cheerio fallback for Amazon failed:', e);
      // Don't throw, just return what we have
    }

    return initialData;
  }
}
