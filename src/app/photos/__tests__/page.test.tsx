import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotosPage from '../page';
import { PhotoGalleryClient } from '@/components/photos/PhotoGalleryClient';
import { getAppConfig } from '@/lib/config';
import { contentService } from '@/features/content';
import { isAdminRequest } from '@/core/auth/auth.server';

// Mock dependencies
jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: { gallery: true },
    photoAlbumUrl: '',
  }),
}));

jest.mock('@/lib/modules', () => ({
  isFeatureEnabled: jest.fn().mockReturnValue(true),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(false),
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
  beforeEach(() => {
    jest.clearAllMocks();
    (getAppConfig as unknown as jest.Mock).mockResolvedValue({
      modules: { gallery: true },
      photoAlbumUrl: '',
    });
    (contentService.getPublicPhotos as jest.Mock).mockResolvedValue([]);
    (isAdminRequest as jest.Mock).mockResolvedValue(false);
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
});
