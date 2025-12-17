/** @jest-environment node */

import { POST as contributePOST } from '@/features/registry/api/contribute';
import { POST as addItemPOST } from '@/features/registry/api/add-item';
import { POST as scrapePOST } from '@/features/registry/api/scrape';
import { RegistryService } from '@/features/registry/service';
import ogs from 'open-graph-scraper';
import { isAdminRequest } from '@/utils/adminAuth.server';

// Mock dependencies
jest.mock('@/features/registry/service');
jest.mock('open-graph-scraper');
jest.mock('@/utils/adminAuth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockContributeToItem = RegistryService.contributeToItem as jest.Mock;
const mockCreateItem = RegistryService.createItem as jest.Mock;
const ogsMock = ogs as jest.Mock;
const mockIsAdminRequest = isAdminRequest as jest.Mock;

describe('API Security - Error Handling', () => {
  const sensitiveErrorMsg = "Database connection failed: user 'postgres' password authentication failed";

  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console.error since we expect errors to be logged
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('POST /api/registry/contribute', () => {
    it('should NOT leak database errors', async () => {
      mockContributeToItem.mockRejectedValue(new Error(sensitiveErrorMsg));

      const request = new Request('http://localhost/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({ itemId: 'uuid', name: 'John', amount: 50 }),
      });

      const response = await contributePOST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).not.toBe(sensitiveErrorMsg);
      expect(body.error).toBe('Failed to process contribution. Please try again later.');
    });
  });

  describe('POST /api/registry/add-item', () => {
    it('should NOT leak database errors', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      mockCreateItem.mockRejectedValue(new Error(sensitiveErrorMsg));

      const request = new Request('http://localhost/api/registry/add-item', {
        method: 'POST',
        body: JSON.stringify({ name: 'Toaster', price: 50, quantity: 1, category: 'Kitchen' }),
      });

      const response = await addItemPOST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).not.toBe(sensitiveErrorMsg);
      expect(body.error).toBe('Failed to add item to registry. Please try again later.');
    });
  });

  describe('POST /api/registry/scrape', () => {
    it('should NOT leak scraping errors', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      ogsMock.mockResolvedValue({ error: true, result: { some: 'internal detail' } });

      const request = new Request('http://localhost/api/registry/scrape', {
        method: 'POST',
        body: JSON.stringify({ url: 'http://example.com' }),
      });

      const response = await scrapePOST(request);
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to scrape product info. Please try again later.');
      expect(body.details).toBeUndefined(); // Should not return details object
    });
  });
});
