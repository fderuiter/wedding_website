/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET } from '../geocode/route';
import { isAdminRequest } from '@/core/auth/auth.server';
import { geocodeSearch } from '@/lib/geocoding';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/geocoding', () => ({
  geocodeSearch: jest.fn(),
}));

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockGeocodeSearch = geocodeSearch as jest.MockedFunction<typeof geocodeSearch>;

describe('GET /api/admin/geocode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
  });

  it('returns 401 Unauthorized when caller is not an authenticated admin', async () => {
    mockIsAdminRequest.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/admin/geocode?q=Seattle');
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(mockGeocodeSearch).not.toHaveBeenCalled();
  });

  it('returns 400 Bad Request when query parameter q is missing or shorter than 2 characters', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    const missingRes = await GET(new NextRequest('http://localhost/api/admin/geocode'));
    expect(missingRes.status).toBe(400);

    const shortRes = await GET(new NextRequest('http://localhost/api/admin/geocode?q=a'));
    expect(shortRes.status).toBe(400);
    expect(mockGeocodeSearch).not.toHaveBeenCalled();
  });

  it('returns 200 with structured geocode candidates for authenticated admins', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGeocodeSearch.mockResolvedValue([
      {
        displayName: 'Art Institute of Chicago, 111 S Michigan Ave, Chicago, IL 60603, USA',
        name: 'Art Institute of Chicago',
        streetAddress: '111 S Michigan Ave',
        city: 'Chicago',
        state: 'IL',
        zip: '60603',
        country: 'USA',
        latitude: 41.879584,
        longitude: -87.623713,
      },
    ]);

    const req = new NextRequest('http://localhost/api/admin/geocode?q=Art+Institute+Chicago&limit=4');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0]).toMatchObject({
      name: 'Art Institute of Chicago',
      streetAddress: '111 S Michigan Ave',
      city: 'Chicago',
      state: 'IL',
      zip: '60603',
      latitude: 41.879584,
      longitude: -87.623713,
    });
    expect(mockGeocodeSearch).toHaveBeenCalledWith('Art Institute Chicago', 4);
  });

  it('enforces per-IP rate limiting at 30 requests per minute', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGeocodeSearch.mockResolvedValue([]);

    for (let i = 0; i < 30; i++) {
      const req = new NextRequest(`http://localhost/api/admin/geocode?q=Seattle+${i}`, {
        headers: { 'x-forwarded-for': '203.0.113.42' },
      });
      const res = await GET(req);
      expect(res.status).toBe(200);
    }

    const throttledReq = new NextRequest('http://localhost/api/admin/geocode?q=Seattle+31', {
      headers: { 'x-forwarded-for': '203.0.113.42' },
    });
    const throttledRes = await GET(throttledReq);
    expect(throttledRes.status).toBe(429);
  });
});
