import ogs from 'open-graph-scraper';
import { ScraperStrategy, ScrapedData } from '../types';

export class DefaultScraper implements ScraperStrategy {
  canHandle(url: string): boolean {
    return true; // Default fallback for any URL
  }

  async scrape(url: string): Promise<ScrapedData> {
    const ogsOptions = {
      url,
      fetchOptions: {
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36',
        },
      },
    };

    const { error, result } = await ogs(ogsOptions);

    if (error) {
      console.error('DefaultScraper: Scraping failed:', result);
      throw new Error('Failed to scrape product info');
    }

    let image = result.ogImage && result.ogImage.length > 0 ? result.ogImage[0].url : '';
    if (!image && result.twitterImage && result.twitterImage.length > 0) {
      image = result.twitterImage[0].url;
    }

    return {
      name: result.ogTitle || '',
      description: result.ogDescription || '',
      image: image,
      vendorUrl: url,
      quantity: 1,
    };
  }
}
