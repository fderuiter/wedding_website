/** @jest-environment node */

import { GET, PUT } from '../features/route';
import { NextRequest } from 'next/server';

jest.mock('@/features/content', () => ({
  contentService: {
    getFeatures: jest.fn(),
    updateFeatures: jest.fn(),
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

import { contentService } from '@/features/content';
import { isAdminRequest } from '@/core/auth/auth.server';

const mockContentService = contentService as jest.Mocked<typeof contentService>;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

function makeAuthReq(method: 'GET' | 'PUT', body?: any) {
  return new NextRequest('http://localhost/api/admin/features', {
    method,
    headers: {
      cookie: 'admin_auth=valid-token',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeUnauthReq(method: 'GET' | 'PUT') {
  return new NextRequest('http://localhost/api/admin/features', {
    method,
  });
}

describe('GET /api/admin/features', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = makeUnauthReq('GET');
    const res = await GET(req, {});

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('Unauthorized');
  });

  it('returns features when authenticated', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const mockFeatures = [{ id: 'feat1', name: 'Rsvp', enabled: true }];
    (mockContentService.getFeatures as jest.Mock).mockResolvedValue(mockFeatures);

    const req = makeAuthReq('GET');
    const res = await GET(req, {});

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual(mockFeatures);
    expect(mockContentService.getFeatures).toHaveBeenCalled();
  });
});

describe('PUT /api/admin/features', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = makeUnauthReq('PUT');
    const res = await PUT(req, {});

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('Unauthorized');
  });

  it('updates features when authenticated and request is valid', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (mockContentService.updateFeatures as jest.Mock).mockResolvedValue(undefined);

    const validFeatures = [{ id: 'feat1', enabled: false }];
    const req = makeAuthReq('PUT', { features: validFeatures });
    const res = await PUT(req, {});

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockContentService.updateFeatures).toHaveBeenCalledWith(validFeatures);
  });

  it('returns 400 validation error when features are missing', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    const req = makeAuthReq('PUT', {});
    const res = await PUT(req, {});

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
  });

  it('returns 400 validation error when features is not an array', async () => {
    mockIsAdminRequest.mockResolvedValue(true);

    const req = makeAuthReq('PUT', { features: 'not-an-array' });
    const res = await PUT(req, {});

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
  });
});
