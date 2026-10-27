/** @jest-environment node */

import { GET, POST, DELETE } from '../route';
import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import {
  getSampleDataStatus,
  generateSampleData,
  purgeSampleData,
} from '@/lib/sampleData/generator';
import { getAppConfig, isSiteInitialized } from '@/lib/config';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/sampleData/generator', () => ({
  getSampleDataStatus: jest.fn(),
  generateSampleData: jest.fn(),
  purgeSampleData: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
  isSiteInitialized: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockGetSampleDataStatus = getSampleDataStatus as jest.MockedFunction<typeof getSampleDataStatus>;
const mockGenerateSampleData = generateSampleData as jest.MockedFunction<typeof generateSampleData>;
const mockPurgeSampleData = purgeSampleData as jest.MockedFunction<typeof purgeSampleData>;
const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;
const mockIsSiteInitialized = isSiteInitialized as jest.MockedFunction<typeof isSiteInitialized>;

describe('Sample Data Admin API Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue({ initialized: true } as any);
    mockIsSiteInitialized.mockReturnValue(true);
  });

  describe('GET /api/admin/sample-data', () => {
    it('returns 401 if not admin', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const req = new NextRequest('http://localhost/api/admin/sample-data');
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns sample data status when admin', async () => {
      mockGetSampleDataStatus.mockResolvedValue({ isGenerated: true, archetype: 'classic', count: 10 } as any);
      const req = new NextRequest('http://localhost/api/admin/sample-data');
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({
        success: true,
        isGenerated: true,
        archetype: 'classic',
        count: 10,
      });
    });
  });

  describe('POST /api/admin/sample-data', () => {
    it('returns 401 if not admin', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const req = new Request('http://localhost/api/admin/sample-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetype: 'classic' }),
      }) as NextRequest;
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    it('generates sample data if admin', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      mockGenerateSampleData.mockResolvedValue({ success: true, count: 15 } as any);
      const req = new Request('http://localhost/api/admin/sample-data', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archetype: 'destination' }),
      }) as NextRequest;
      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(mockGenerateSampleData).toHaveBeenCalledWith({
        archetype: 'destination',
        modules: undefined,
      });
    });
  });

  describe('DELETE /api/admin/sample-data', () => {
    it('returns 401 if not admin', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      const req = new NextRequest('http://localhost/api/admin/sample-data', { method: 'DELETE' });
      const res = await DELETE(req);
      expect(res.status).toBe(401);
    });

    it('purges sample data when admin', async () => {
      mockPurgeSampleData.mockResolvedValue({ success: true, purged: 10 } as any);
      const req = new NextRequest('http://localhost/api/admin/sample-data', { method: 'DELETE' });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ success: true, purged: 10 });
    });
  });
});
