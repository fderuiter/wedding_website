import { ScraperService } from './ScraperService';
import { DefaultScraperStrategy } from './strategies/DefaultScraperStrategy';
import { AmazonScraperStrategy } from './strategies/AmazonScraperStrategy';

// Instantiate strategies
const amazonStrategy = new AmazonScraperStrategy();
const defaultStrategy = new DefaultScraperStrategy();

// Create the service instance with the strategies
// Note: Strategies are evaluated in order. The default strategy is the fallback.
export const scraperService = new ScraperService([amazonStrategy], defaultStrategy);
