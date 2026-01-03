export interface ScrapedData {
  name: string;
  description: string;
  image: string;
  vendorUrl: string;
  quantity: number;
}

export interface IScraperStrategy {
  canHandle(url: string): boolean;
  scrape(url: string): Promise<ScrapedData>;
}
