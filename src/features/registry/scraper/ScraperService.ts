import { IScraperStrategy, ScrapedData } from './types';
import { DefaultScraper } from './strategies/DefaultScraper';
import { AmazonScraper } from './strategies/AmazonScraper';

export class ScraperService {
  private strategies: IScraperStrategy[];

  constructor() {
    // Order matters: specific strategies first, then the default catch-all
    this.strategies = [
      new AmazonScraper(),
      new DefaultScraper()
    ];
  }

  async scrape(url: string): Promise<ScrapedData> {
    for (const strategy of this.strategies) {
      if (strategy.canScrape(url)) {
        return strategy.scrape(url);
      }
    }
    throw new Error('No scraper strategy found for this URL');
  }
}

export const scraperService = new ScraperService();
