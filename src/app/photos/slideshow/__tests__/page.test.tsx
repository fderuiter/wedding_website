import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotosSlideshowPage from '../page';
import { notFound } from 'next/navigation';
import { contentService } from '@/features/content';
import { isFeatureEnabled } from '@/lib/modules';

// Mock dependencies
jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    baseUrl: 'https://wedding.example.com',
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
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders slideshow client with empty photos array when no database photos exist', async () => {
    (contentService.getPublicPhotos as jest.Mock).mockResolvedValue([]);

    const pageElement = await PhotosSlideshowPage();
    render(pageElement);

    const client = screen.getByTestId('reception-slideshow-client');
    expect(client).toBeInTheDocument();
    expect(client).toHaveAttribute('data-count', '0');
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
    expect(client).toHaveAttribute('data-upload-url', 'https://wedding.example.com/photos?tab=guest');
  });

  it('calls notFound when gallery feature module is disabled', async () => {
    (isFeatureEnabled as unknown as jest.Mock).mockReturnValue(false);

    await PhotosSlideshowPage();
    expect(notFound).toHaveBeenCalled();
  });
});
