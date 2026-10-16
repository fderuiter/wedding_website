/** @jest-environment node */

import { GET, POST } from '../route';
import { PUT, DELETE } from '../[id]/route';
import { NextRequest } from 'next/server';
import { mediaRepository } from '@/features/media';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.mock('@/features/media', () => {
  const actual = jest.requireActual('@/features/media');
  return {
    ...actual,
    mediaRepository: {
      getAllMedia: jest.fn(),
      createMedia: jest.fn(),
      updateMedia: jest.fn(),
      deleteMedia: jest.fn(),
    },
  };
});

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

const mockMediaRepository = mediaRepository as jest.Mocked<typeof mediaRepository>;
const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

describe('Media API Routes Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true); // Default to admin authorized
  });

  describe('GET /api/media', () => {
    test('is publicly accessible (allows anonymous access)', async () => {
      mockIsAdminRequest.mockResolvedValue(false); // Not admin
      mockMediaRepository.getAllMedia.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });

      const req = new NextRequest('http://localhost/api/media');
      const res = await GET(req);
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        success: true,
        data: {
          data: [],
          total: 0,
          page: 1,
          limit: 20,
          totalPages: 0,
        },
      });
      expect(mockMediaRepository.getAllMedia).toHaveBeenCalledWith({ page: undefined, limit: undefined });
    });

    test('returns empty lists successfully with metadata envelope', async () => {
      mockMediaRepository.getAllMedia.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });

      const req = new NextRequest('http://localhost/api/media');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
        totalPages: 0,
      });
    });

    test('returns list of media records successfully with metadata envelope', async () => {
      const mockMediaList = [
        { id: 'm1', url: 'https://example.com/img1.jpg', altText: 'Image 1', isDecorative: false, createdAt: new Date(), updatedAt: new Date() },
        { id: 'm2', url: 'https://example.com/img2.jpg', altText: null, isDecorative: true, createdAt: new Date(), updatedAt: new Date() }
      ];
      mockMediaRepository.getAllMedia.mockResolvedValue({
        data: mockMediaList,
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const req = new NextRequest('http://localhost/api/media');
      const res = await GET(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({
        data: mockMediaList,
        total: 2,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    test('parses custom page and limit query parameters and passes them to repository', async () => {
      mockMediaRepository.getAllMedia.mockResolvedValue({
        data: [],
        total: 50,
        page: 2,
        limit: 10,
        totalPages: 5,
      });

      const req = new NextRequest('http://localhost/api/media?page=2&limit=10');
      const res = await GET(req);

      expect(res.status).toBe(200);
      expect(mockMediaRepository.getAllMedia).toHaveBeenCalledWith({ page: 2, limit: 10 });
      const body = await res.json();
      expect(body.data.page).toBe(2);
      expect(body.data.limit).toBe(10);
    });
  });

  describe('POST /api/media', () => {
    test('requires admin authorization', async () => {
      mockIsAdminRequest.mockResolvedValue(false);
      
      const req = new NextRequest('http://localhost/api/media', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://example.com/valid.jpg' }),
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Unauthorized');
    });

    test('rejects creation if URL is missing or malformed', async () => {
      const req = new NextRequest('http://localhost/api/media', {
        method: 'POST',
        body: JSON.stringify({ url: 'not-a-valid-url', altText: 'Test' }),
      });
      const res = await POST(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Validation failed');
      expect(body.details).toBeDefined();
    });

    test('creates media metadata successfully with valid payload', async () => {
      const payload = { url: 'https://example.com/photo.jpg', altText: 'Beautiful memory', isDecorative: false };
      const createdRecord = { id: 'new-id', ...payload, createdAt: new Date(), updatedAt: new Date() };
      mockMediaRepository.createMedia.mockResolvedValue(createdRecord);

      const req = new NextRequest('http://localhost/api/media', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const res = await POST(req);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toEqual({ success: true, data: createdRecord });
      expect(mockMediaRepository.createMedia).toHaveBeenCalledWith(payload);
    });
  });

  describe('PUT /api/media/[id]', () => {
    test('requires admin authorization', async () => {
      mockIsAdminRequest.mockResolvedValue(false);

      const req = new NextRequest('http://localhost/api/media/m1', {
        method: 'PUT',
        body: JSON.stringify({ altText: 'New Alt' }),
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'm1' }) });

      expect(res.status).toBe(401);
    });

    test('updates media with valid partial fields successfully', async () => {
      const payload = { altText: 'Updated memory desc', isDecorative: true };
      const updatedRecord = { id: 'm1', url: 'https://example.com/photo.jpg', ...payload, createdAt: new Date(), updatedAt: new Date() };
      mockMediaRepository.updateMedia.mockResolvedValue(updatedRecord);

      const req = new NextRequest('http://localhost/api/media/m1', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'm1' }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true, data: updatedRecord });
      expect(mockMediaRepository.updateMedia).toHaveBeenCalledWith('m1', payload);
    });

    test('rejects updates that violate schemas', async () => {
      const req = new NextRequest('http://localhost/api/media/m1', {
        method: 'PUT',
        body: JSON.stringify({ url: 'not-a-valid-url' }),
      });
      const res = await PUT(req, { params: Promise.resolve({ id: 'm1' }) });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Validation failed');
    });
  });

  describe('DELETE /api/media/[id]', () => {
    test('requires admin authorization', async () => {
      mockIsAdminRequest.mockResolvedValue(false);

      const req = new NextRequest('http://localhost/api/media/m1', { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ id: 'm1' }) });

      expect(res.status).toBe(401);
    });

    test('deletes media record successfully', async () => {
      mockMediaRepository.deleteMedia.mockResolvedValue(undefined as any);

      const req = new NextRequest('http://localhost/api/media/m1', { method: 'DELETE' });
      const res = await DELETE(req, { params: Promise.resolve({ id: 'm1' }) });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true });
      expect(mockMediaRepository.deleteMedia).toHaveBeenCalledWith('m1');
    });
  });
});
