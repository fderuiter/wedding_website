export interface ScrapedData {
  name: string;
  description: string;
  image: string;
  vendorUrl: string;
  quantity: number;
}

export interface IScraperStrategy {
  canScrape(url: string): boolean;
  scrape(url: string): Promise<ScrapedData>;
}
