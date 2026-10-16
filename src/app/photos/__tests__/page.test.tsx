import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotosPage from '../page';

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

jest.mock('next/script', () => {
  return function MockScript() {
    return null;
  };
});

jest.mock('@/components/photos/PhotoGalleryClient', () => ({
  PhotoGalleryClient: () => <div data-testid="photo-gallery-client" />,
}));

describe('PhotosPage Accessibility', () => {
  it('renders photo gallery embed objects with WCAG-compliant text alternatives and ARIA attributes', async () => {
    const pageElement = await PhotosPage();
    const { container } = render(pageElement);

    // Verify main heading
    expect(
      screen.getByRole('heading', { level: 1, name: /our wedding photos/i })
    ).toBeInTheDocument();

    // Verify gallery player widget container
    const widgetContainer = container.querySelector('.pa-gallery-player-widget');
    expect(widgetContainer).toBeInTheDocument();
    expect(widgetContainer).toHaveAttribute('role', 'region');
    expect(widgetContainer).toHaveAttribute('aria-label', 'Google Photos Gallery Embed');

    // Verify embedded object elements have role="img", aria-label, title, and body text alternative
    const objectElements = widgetContainer?.querySelectorAll('object') || [];
    expect(objectElements.length).toBeGreaterThan(0);

    objectElements.forEach((obj, idx) => {
      expect(obj).toHaveAttribute('role', 'img');
      expect(obj).toHaveAttribute('type', 'image/jpeg');
      expect(obj).toHaveAttribute('aria-label', `Wedding photo ${idx + 1}`);
      expect(obj).toHaveAttribute('title', `Wedding photo ${idx + 1}`);
      expect(obj.textContent).toContain(`Wedding photo ${idx + 1}`);
    });

    // Verify View Full Album link
    const albumLink = screen.getByRole('link', { name: /view full album/i });
    expect(albumLink).toBeInTheDocument();
    expect(albumLink).toHaveAttribute(
      'href',
      'https://photos.app.goo.gl/v1Rw81HSoyLVNEDx5'
    );
  });
});
