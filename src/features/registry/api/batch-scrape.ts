import { NextResponse, NextRequest } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { BatchScrapeUrlsSchema } from '../schemas';
import { scrapeProductUrl, ScrapedProductData } from './scrape';

export interface BatchScrapeResultItem {
  url: string;
  success: boolean;
  data?: ScrapedProductData;
  error?: string;
  errorDomain?: 'BLOCKED_BY_VENDOR' | 'URL_NOT_FOUND' | 'NETWORK_TIMEOUT' | 'INVALID_URL' | null;
}


/**
 * Runs tasks over an array with an explicit concurrency limit.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const idx = nextIndex++;
      results[idx] = await task(items[idx], idx);
    }
  };

  const pool = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(pool);
  return results;
}

/**
 * Scrapes metadata in parallel for batches of up to 20 product URLs with a concurrency limit of 5.
 * Individual URL failures do not abort the overall batch.
 * The entire batch operation times out after 15 seconds.
 */
export const POST = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const body = await parseJsonRequestBody(request);
  const parseResult = BatchScrapeUrlsSchema.safeParse(body);

  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0]?.message || 'Invalid batch scrape request.');
  }

  const { urls } = parseResult.data;

  // Master timeout of 15 seconds for the entire batch operation
  const masterController = new AbortController();
  const masterTimeout = setTimeout(() => {
    masterController.abort();
  }, 15000);

  try {
    const results = await runWithConcurrency<string, BatchScrapeResultItem>(
      urls,
      5, // Concurrency limit of 5
      async (rawUrl) => {
        const trimmed = (rawUrl || '').trim();

        // Validate individual URL format
        if (!trimmed || (!trimmed.startsWith('http://') && !trimmed.startsWith('https://'))) {
          return {
            url: trimmed,
            success: false,
            error: 'Invalid URL format: URL must begin with http:// or https://',
            errorDomain: 'INVALID_URL',
          };
        }

        try {
          // Verify valid URL syntax
          new URL(trimmed);
        } catch {
          return {
            url: trimmed,
            success: false,
            error: 'Invalid URL syntax',
            errorDomain: 'INVALID_URL',
          };
        }

        try {
          const scraped = await scrapeProductUrl(trimmed, 10000, masterController.signal);
          return {
            url: trimmed,
            success: true,
            data: scraped,
          };
        } catch (err: any) {
          let errorDomain = err?.data?.errorDomain || err?.errorDomain;
          if (!errorDomain) {
            if (err?.message?.startsWith('URL_NOT_FOUND')) {
              errorDomain = 'URL_NOT_FOUND';
            } else if (err?.message?.startsWith('BLOCKED_BY_VENDOR') || err?.message?.startsWith('Blocked:')) {
              errorDomain = 'BLOCKED_BY_VENDOR';
            } else {
              errorDomain = 'NETWORK_TIMEOUT';
            }
          }
          return {
            url: trimmed,
            success: false,
            error: err?.message || 'Failed to extract product details from URL',
            errorDomain: errorDomain as BatchScrapeResultItem['errorDomain'],
          };
        }
      }
    );

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;

    return NextResponse.json({
      success: true,
      results,
      total: results.length,
      successful,
      failed,
    });
  } finally {
    clearTimeout(masterTimeout);
  }
});
