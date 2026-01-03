import { BaseScraperStrategy } from './BaseScraperStrategy';

export class DefaultScraperStrategy extends BaseScraperStrategy {
  canHandle(url: string): boolean {
    return true; // Fallback
  }
}
