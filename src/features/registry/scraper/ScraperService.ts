import { ScraperStrategy, ScrapedData } from './types';
import { DefaultScraper } from './strategies/DefaultScraper';
import { AmazonScraper } from './strategies/AmazonScraper';

export class ScraperService {
  private strategies: ScraperStrategy[];

  constructor() {
    // Order matters: Specific strategies first, then default
    this.strategies = [
      new AmazonScraper(),
      new DefaultScraper() // This should always be last as it returns true for canHandle
    ];
  }

  /**
   * Scrapes the given URL using the most appropriate strategy.
   * @param url The URL to scrape.
   */
  async scrape(url: string): Promise<ScrapedData> {
    const strategy = this.strategies.find(s => s.canHandle(url));

    if (!strategy) {
      throw new Error('No scraper strategy found for this URL');
    }

    return strategy.scrape(url);
  }
}

// Export singleton instance
export const scraperService = new ScraperService();
