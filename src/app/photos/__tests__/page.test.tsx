import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotosPage from '../page';
import { PhotoGalleryClient } from '@/components/photos/PhotoGalleryClient';

// Mock dependencies
jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: { gallery: true },
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

jest.mock('@/components/photos/PhotoGalleryClient', () => ({
  PhotoGalleryClient: jest.fn(() => <div data-testid="photo-gallery-client" />),
}));

describe('PhotosPage', () => {
  it('renders native photo gallery client and accessible page elements without third-party embed', async () => {
    const pageElement = await PhotosPage();
    const { container } = render(pageElement);

    // Verify main heading
    expect(
      screen.getByRole('heading', { level: 1, name: /our wedding photos/i })
    ).toBeInTheDocument();

    // Verify native photo gallery client is rendered directly
    expect(screen.getByTestId('photo-gallery-client')).toBeInTheDocument();

    // Verify initialPhotos prop passed to PhotoGalleryClient contains curated photos
    expect(PhotoGalleryClient).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPhotos: expect.arrayContaining([
          expect.stringContaining('googleusercontent.com'),
        ]),
      }),
      undefined
    );

    // Verify third-party embed widget is removed
    const widgetContainer = container.querySelector('.pa-gallery-player-widget');
    expect(widgetContainer).not.toBeInTheDocument();

    // Verify fallback indicator is rendered when live feeds are unavailable
    expect(screen.getByTestId('photos-fallback-indicator')).toBeInTheDocument();
    expect(
      screen.getByText(/displaying curated photo gallery/i)
    ).toBeInTheDocument();

    // Verify View Full Album link
    const albumLink = screen.getByRole('link', { name: /view full album \(opens in a new tab\)/i });
    expect(albumLink).toBeInTheDocument();
    expect(albumLink).toHaveAttribute(
      'href',
      'https://photos.app.goo.gl/v1Rw81HSoyLVNEDx5'
    );
  });
});
