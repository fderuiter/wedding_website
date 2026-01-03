import { IScraperStrategy, ScrapedData } from './types';
import { DefaultScraperStrategy } from './strategies/DefaultScraperStrategy';

export class ScraperService {
  private strategies: IScraperStrategy[];
  private defaultStrategy: IScraperStrategy;

  constructor(strategies: IScraperStrategy[], defaultStrategy: IScraperStrategy = new DefaultScraperStrategy()) {
    this.strategies = strategies;
    this.defaultStrategy = defaultStrategy;
  }

  async scrape(url: string): Promise<ScrapedData> {
    const strategy = this.strategies.find(s => s.canHandle(url));
    if (strategy) {
         return strategy.scrape(url);
    }
    return this.defaultStrategy.scrape(url);
  }
}
