import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotosSlideshowPage from '../page';
import { notFound } from 'next/navigation';
import { contentService } from '@/features/content';
import { isFeatureEnabled } from '@/lib/modules';
import { verifyPhotoQrLinkToken } from '@/core/auth/photoUploadToken';

// Mock dependencies
jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
}));

jest.mock('next/headers', () => ({
  headers: jest.fn().mockResolvedValue(new Map([['host', 'wedding.example.com']])),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  enforceActiveGuestPageSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appConfig: {
      findFirst: jest.fn().mockResolvedValue({ guestPhotoQrTokenVersion: 3 }),
    },
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    baseUrl: 'https://wedding.example.com',
    modules: { gallery: true },
    guestPhotoQrTokenVersion: 3,
  }),
}));

jest.mock('@/lib/modules', () => ({
  isFeatureEnabled: jest.fn().mockReturnValue(true),
}));

jest.mock('@/features/content', () => ({
  contentService: {
    getPublicPhotos: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('@/lib/query-wrapper', () => ({
  withPageQuery: jest.fn().mockImplementation(async (fn) => fn()),
}));

jest.mock('@/components/photos/ReceptionSlideshowClient', () => ({
  ReceptionSlideshowClient: ({ initialPhotos, uploadUrl }: any) => (
    <div
      data-testid="reception-slideshow-client"
      data-count={initialPhotos?.length}
      data-upload-url={uploadUrl}
    >
      Slideshow Client Mock
    </div>
  ),
}));

describe('PhotosSlideshowPage', () => {
  const originalStaticExport = process.env.STATIC_EXPORT;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STATIC_EXPORT;
  });

  afterAll(() => {
    if (originalStaticExport === undefined) {
      delete process.env.STATIC_EXPORT;
    } else {
      process.env.STATIC_EXPORT = originalStaticExport;
    }
  });

  it('renders slideshow client with empty photos array and embeds signed QR upload URL', async () => {
    (contentService.getPublicPhotos as jest.Mock).mockResolvedValue([]);

    const pageElement = await PhotosSlideshowPage();
    render(pageElement);

    const client = screen.getByTestId('reception-slideshow-client');
    expect(client).toBeInTheDocument();
    expect(client).toHaveAttribute('data-count', '0');
    const uploadUrl = client.getAttribute('data-upload-url') ?? '';
    const parsedUrl = new URL(uploadUrl);
    expect(parsedUrl.origin).toBe('https://wedding.example.com');
    expect(parsedUrl.pathname).toBe('/photos');
    const qrToken = parsedUrl.searchParams.get('qr');
    expect(qrToken).toBeTruthy();

    const verified = await verifyPhotoQrLinkToken(qrToken);
    expect(verified).toEqual(
      expect.objectContaining({
        purpose: 'photo_qr_link',
        v: 3,
      })
    );
  });

  it('omits dynamic QR signing and headers when STATIC_EXPORT=true', async () => {
    process.env.STATIC_EXPORT = 'true';
    (contentService.getPublicPhotos as jest.Mock).mockResolvedValue([]);

    const pageElement = await PhotosSlideshowPage();
    render(pageElement);

    const client = screen.getByTestId('reception-slideshow-client');
    expect(client).toHaveAttribute('data-upload-url', 'https://wedding.example.com/photos?tab=guest');
  });

  it('renders slideshow client with database approved photos when available and maps updatedAt and prioritized title', async () => {
    (contentService.getPublicPhotos as jest.Mock).mockResolvedValue([
      {
        id: 'node-1',
        createdAt: new Date('2026-06-20T18:00:00.000Z'),
        updatedAt: new Date('2026-06-20T19:15:00.000Z'),
        data: {
          url: 'https://example.com/custom-photo.jpg',
          title: 'Admin Curated Title',
          caption: 'Original Guest Caption',
          uploaderName: 'Aunt Clara',
        },
      },
    ]);

    const pageElement = await PhotosSlideshowPage();
    render(pageElement);

    const client = screen.getByTestId('reception-slideshow-client');
    expect(client).toBeInTheDocument();
    expect(client).toHaveAttribute('data-count', '1');
    expect(client.getAttribute('data-upload-url')).toMatch(
      /^https:\/\/wedding\.example\.com\/photos\?qr=/
    );
  });

  it('calls notFound when gallery feature module is disabled', async () => {
    (isFeatureEnabled as unknown as jest.Mock).mockReturnValue(false);

    await PhotosSlideshowPage();
    expect(notFound).toHaveBeenCalled();
  });
});
