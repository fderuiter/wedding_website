import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotosPage from '../page';
import { PhotoGalleryClient } from '@/components/photos/PhotoGalleryClient';
import { getAppConfig } from '@/lib/config';
import { contentService } from '@/features/content';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import {
  getActivePhotoUploadSession,
  getGuestInviteSession,
} from '@/core/auth/guestInviteSession';
import { getSignedPhotoUploadSession } from '@/core/auth/photoUploadToken';

const mockRedirect = jest.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
  redirect: (url: string) => mockRedirect(url),
}));

// Mock dependencies
jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: { gallery: true },
    photoAlbumUrl: '',
    guestPhotoQrTokenVersion: 1,
  }),
}));

jest.mock('@/lib/modules', () => ({
  isFeatureEnabled: jest.fn().mockReturnValue(true),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/core/auth/guest.server', () => ({
  isGuestRequest: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  enforceActiveGuestPageSession: jest.fn().mockResolvedValue(undefined),
  getActivePhotoUploadSession: jest.fn().mockResolvedValue(null),
  getGuestInviteSession: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/core/auth/photoUploadToken', () => ({
  getSignedPhotoUploadSession: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/features/content', () => ({
  contentService: {
    getPublicPhotos: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('@/lib/query-wrapper', () => ({
  withPageQuery: jest.fn().mockImplementation(async (fn) => fn()),
}));

jest.mock('@/components/photos/PhotoGalleryClient', () => ({
  PhotoGalleryClient: jest.fn(() => <div data-testid="photo-gallery-client" />),
}));

describe('PhotosPage', () => {
  const originalStaticExport = process.env.STATIC_EXPORT;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.STATIC_EXPORT;
    (getAppConfig as unknown as jest.Mock).mockResolvedValue({
      modules: { gallery: true },
      photoAlbumUrl: '',
      guestPhotoQrTokenVersion: 1,
    });
    (contentService.getPublicPhotos as jest.Mock).mockResolvedValue([]);
    (isAdminRequest as jest.Mock).mockResolvedValue(false);
    (isGuestRequest as jest.Mock).mockResolvedValue(false);
    (getGuestInviteSession as jest.Mock).mockResolvedValue(null);
    (getSignedPhotoUploadSession as jest.Mock).mockResolvedValue(null);
    (getActivePhotoUploadSession as jest.Mock).mockResolvedValue(null);
  });

  afterAll(() => {
    if (originalStaticExport === undefined) {
      delete process.env.STATIC_EXPORT;
    } else {
      process.env.STATIC_EXPORT = originalStaticExport;
    }
  });

  it('passes empty initialPhotos and omits hardcoded Google Photos links when zero approved photos exist', async () => {
    const pageElement = await PhotosPage();
    const { container } = render(pageElement);

    expect(
      screen.getByRole('heading', { level: 1, name: /our wedding photos/i })
    ).toBeInTheDocument();

    expect(screen.getByTestId('photo-gallery-client')).toBeInTheDocument();

    expect(PhotoGalleryClient).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPhotos: [],
        defaultTab: 'curated',
        isAdmin: false,
      }),
      undefined
    );

    const widgetContainer = container.querySelector('.pa-gallery-player-widget');
    expect(widgetContainer).not.toBeInTheDocument();
    expect(screen.queryByTestId('photos-fallback-indicator')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /view full album/i })
    ).not.toBeInTheDocument();
  });

  it('renders configured external album link when photoAlbumUrl is set', async () => {
    (getAppConfig as unknown as jest.Mock).mockResolvedValue({
      modules: { gallery: true },
      photoAlbumUrl: 'https://album.example.com/our-wedding',
    });

    const pageElement = await PhotosPage();
    render(pageElement);

    const albumLink = screen.getByRole('link', {
      name: /view full album \(opens in a new tab\)/i,
    });
    expect(albumLink).toBeInTheDocument();
    expect(albumLink).toHaveAttribute(
      'href',
      'https://album.example.com/our-wedding'
    );
  });

  it('preserves real UUIDs, captions, guest category, and admin status when hydrating approved nodes', async () => {
    (isAdminRequest as jest.Mock).mockResolvedValue(true);
    (contentService.getPublicPhotos as jest.Mock).mockResolvedValue([
      {
        id: '11111111-1111-4111-8111-111111111111',
        type: 'Photo',
        tags: ['gallery', 'curated'],
        data: {
          url: '/uploads/curated-vows.jpg',
          title: 'First Kiss',
          status: 'APPROVED',
          isVisible: true,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        type: 'Photo',
        tags: ['gallery', 'guest-upload'],
        data: {
          url: '/uploads/photos/dancefloor.jpg',
          title: 'Dance Floor Joy',
          status: 'APPROVED',
          isVisible: true,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const pageElement = await PhotosPage();
    render(pageElement);

    expect(PhotoGalleryClient).toHaveBeenCalledWith(
      expect.objectContaining({
        isAdmin: true,
        defaultTab: 'curated',
        initialPhotos: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            url: '/uploads/curated-vows.jpg',
            title: 'First Kiss',
            isGuestUpload: false,
            category: 'curated',
          },
          {
            id: '22222222-2222-4222-8222-222222222222',
            url: '/uploads/photos/dancefloor.jpg',
            title: 'Dance Floor Joy',
            isGuestUpload: true,
            category: 'guest',
          },
        ],
      }),
      undefined
    );
  });

  it('maps mediaId, caption, and uploaderName onto PublicPhotoItem objects and defaults to guest tab when only guest photos exist', async () => {
    (contentService.getPublicPhotos as jest.Mock).mockResolvedValue([
      {
        id: '33333333-3333-4333-8333-333333333333',
        type: 'Photo',
        tags: ['gallery', 'guest-upload'],
        data: {
          mediaId: '44444444-4444-4444-8444-444444444444',
          url: '/uploads/photos/sparklers.jpg',
          title: 'Sparkler exit!',
          caption: 'Sparkler exit!',
          uploaderName: 'Aunt Clara',
          originalFilename: 'IMG_1234.HEIC',
          status: 'APPROVED',
          isVisible: true,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const pageElement = await PhotosPage();
    render(pageElement);

    expect(PhotoGalleryClient).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultTab: 'guest',
        initialPhotos: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            mediaId: '44444444-4444-4444-8444-444444444444',
            url: '/uploads/photos/sparklers.jpg',
            title: 'Sparkler exit!',
            caption: 'Sparkler exit!',
            uploaderName: 'Aunt Clara',
            isGuestUpload: true,
            category: 'guest',
          },
        ],
      }),
      undefined
    );
  });

  it('honors ?tab=guest searchParams even when curated photos exist', async () => {
    (contentService.getPublicPhotos as jest.Mock).mockResolvedValue([
      {
        id: 'curated-1',
        type: 'Photo',
        tags: ['gallery', 'curated'],
        data: { url: '/uploads/vows.jpg', title: 'Vows', status: 'APPROVED', isVisible: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const pageElement = await PhotosPage({ searchParams: Promise.resolve({ tab: 'guest' }) });
    render(pageElement);

    expect(PhotoGalleryClient).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultTab: 'guest',
      }),
      undefined
    );
  });

  it('defaults photo-scoped visitors to the guest upload tab even without ?tab=guest', async () => {
    (getSignedPhotoUploadSession as jest.Mock).mockResolvedValue({
      purpose: 'photo_upload_session',
      v: 1,
      iat: 1000,
      exp: 9999999999999,
    });
    (getActivePhotoUploadSession as jest.Mock).mockResolvedValue({
      purpose: 'photo_upload_session',
      v: 1,
      iat: 1000,
      exp: 9999999999999,
    });

    const pageElement = await PhotosPage();
    render(pageElement);

    expect(PhotoGalleryClient).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultTab: 'guest',
      }),
      undefined
    );
  });

  it('redirects photo-scoped visitors to /guest/login when QR token version was rotated', async () => {
    (getSignedPhotoUploadSession as jest.Mock).mockResolvedValue({
      purpose: 'photo_upload_session',
      v: 1,
      iat: 1000,
      exp: 9999999999999,
    });
    (getActivePhotoUploadSession as jest.Mock).mockResolvedValue(null);

    await expect(PhotosPage()).rejects.toThrow(
      'NEXT_REDIRECT:/guest/login?callbackUrl=%2Fphotos%3Ftab%3Dguest'
    );
  });

  it('guards cookie and searchParams reads when STATIC_EXPORT=true', async () => {
    process.env.STATIC_EXPORT = 'true';
    const searchParamsReject = Promise.reject(new Error('searchParams should not be read in static export'));
    // Prevent unhandled rejection warning
    searchParamsReject.catch(() => {});

    const pageElement = await PhotosPage({ searchParams: searchParamsReject });
    render(pageElement);

    expect(getSignedPhotoUploadSession).not.toHaveBeenCalled();
    expect(isAdminRequest).not.toHaveBeenCalled();
    expect(PhotoGalleryClient).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultTab: 'curated',
        isAdmin: false,
      }),
      undefined
    );
  });
});
