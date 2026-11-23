/** @jest-environment node */

import { GET } from '../route';
import { NextRequest } from 'next/server';
import { contentService } from '@/features/content';
import { getAppConfig } from '@/lib/config';

jest.mock('@/features/content', () => ({
  contentService: {
    getPublicPhotos: jest.fn(),
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

const mockGetPublicPhotos = contentService.getPublicPhotos as jest.MockedFunction<typeof contentService.getPublicPhotos>;
const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

describe('GET /api/photos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppConfig.mockResolvedValue({
      modules: { gallery: true },
    } as any);
  });

  it('returns approved public photos successfully', async () => {
    const mockNodes = [
      {
        id: 'photo-1',
        type: 'Photo',
        createdAt: new Date('2026-06-20T18:00:00.000Z'),
        updatedAt: new Date('2026-06-20T18:00:00.000Z'),
        data: {
          url: 'https://example.com/photo1.jpg',
          title: 'First Dance',
          altText: 'Couple first dance',
          status: 'APPROVED',
          isVisible: true,
        },
      },
      {
        id: 'photo-2',
        type: 'Photo',
        createdAt: new Date('2026-06-20T18:30:00.000Z'),
        updatedAt: new Date('2026-06-20T18:30:00.000Z'),
        data: {
          url: 'https://example.com/photo2.jpg',
          title: 'Cake Cutting',
          status: 'APPROVED',
          isVisible: true,
        },
      },
    ];

    mockGetPublicPhotos.mockResolvedValue(mockNodes as any);

    const req = new NextRequest('http://localhost/api/photos');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeUndefined(); // Verifies duplicate raw nodes are excluded
    expect(mockGetPublicPhotos).toHaveBeenCalledWith({ limit: 50 });
    expect(json.photos).toHaveLength(2);
    expect(json.photos[0]).toEqual({
      id: 'photo-1',
      url: 'https://example.com/photo1.jpg',
      title: 'First Dance',
      altText: 'Couple first dance',
      createdAt: '2026-06-20T18:00:00.000Z',
      updatedAt: '2026-06-20T18:00:00.000Z',
    });
    expect(json.photos[1]).toEqual({
      id: 'photo-2',
      url: 'https://example.com/photo2.jpg',
      title: 'Cake Cutting',
      altText: 'Cake Cutting',
      createdAt: '2026-06-20T18:30:00.000Z',
      updatedAt: '2026-06-20T18:30:00.000Z',
    });
  });

  it('includes guest caption, uploaderName, updatedAt, and prioritizes explicit title over caption', async () => {
    mockGetPublicPhotos.mockResolvedValue([
      {
        id: 'guest-node-1',
        type: 'Photo',
        tags: ['gallery', 'guest-upload'],
        createdAt: new Date('2026-06-20T20:00:00.000Z'),
        updatedAt: new Date('2026-06-20T20:05:00.000Z'),
        data: {
          url: '/uploads/photos/sparklers.jpg',
          title: 'Admin Polished Title',
          altText: 'Sparkler exit!',
          caption: 'Sparkler exit!',
          uploaderName: 'Aunt Clara',
          status: 'APPROVED',
          isVisible: true,
        },
      },
    ] as any);

    const req = new NextRequest('http://localhost/api/photos');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.photos).toEqual([
      {
        id: 'guest-node-1',
        url: '/uploads/photos/sparklers.jpg',
        title: 'Admin Polished Title',
        altText: 'Sparkler exit!',
        caption: 'Sparkler exit!',
        uploaderName: 'Aunt Clara',
        isGuestUpload: true,
        createdAt: '2026-06-20T20:00:00.000Z',
        updatedAt: '2026-06-20T20:05:00.000Z',
      },
    ]);
  });

  it('queries only photos created after since cursor when since query parameter is present', async () => {
    mockGetPublicPhotos.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/photos?since=2026-06-20T18:00:00.000Z');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.photos).toEqual([]);
    expect(json.data).toBeUndefined();
    expect(mockGetPublicPhotos).toHaveBeenCalledWith({
      since: new Date('2026-06-20T18:00:00.000Z'),
    });
  });

  it('returns 400 when since query parameter is not a valid date', async () => {
    const req = new NextRequest('http://localhost/api/photos?since=invalid-date');
    const res = await GET(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Invalid "since" parameter');
  });

  it('returns empty array when no approved photos exist', async () => {
    mockGetPublicPhotos.mockResolvedValue([]);

    const req = new NextRequest('http://localhost/api/photos');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.photos).toEqual([]);
  });

  it('returns 404 when gallery module is disabled', async () => {
    mockGetAppConfig.mockResolvedValue({
      modules: { gallery: false },
    } as any);

    const req = new NextRequest('http://localhost/api/photos');
    const res = await GET(req);

    expect(res.status).toBe(404);
  });
});
