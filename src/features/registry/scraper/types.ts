export interface ScrapedData {
  name: string;
  description: string;
  image: string;
  vendorUrl: string;
  quantity: number;
}

export interface ScraperStrategy {
  /**
   * Determines if this strategy can handle the given URL.
   * @param url The URL to scrape.
   */
  canHandle(url: string): boolean;

  /**
   * Scrapes the given URL for product metadata.
   * @param url The URL to scrape.
   */
  scrape(url: string): Promise<ScrapedData>;
}
