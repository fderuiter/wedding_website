import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PhotoGalleryClient } from '../PhotoGalleryClient';
import { ToastProvider } from '@/components/ui/ToastProvider';

const originalFetch = global.fetch;

describe('PhotoGalleryClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(new Blob(['fake zip bytes'], { type: 'application/zip' })),
    } as unknown as Response);

    if (typeof window !== 'undefined' && window.URL) {
      window.URL.createObjectURL = jest.fn().mockReturnValue('blob:http://localhost/test');
      window.URL.revokeObjectURL = jest.fn();
    }
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('renders export toolbar and export all guest photos button', () => {
    render(<PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} />);

    expect(screen.getByTestId('export-all-guest-photos-btn')).toBeInTheDocument();
    expect(screen.getByText('Export All Guest Photos (.zip)')).toBeInTheDocument();
  });

  it('triggers zip export for all guest photos when button is clicked', async () => {
    render(<PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} />);

    const exportBtn = screen.getByTestId('export-all-guest-photos-btn');
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/media/export?tag=guest-upload');
    });
  });

  it('allows multi-selecting photos and exporting selected items', async () => {
    render(<PhotoGalleryClient initialPhotos={[]} />);

    // Simulate uploading a photo
    const fileInput = screen.getByTestId('guest-photo-file-input') as HTMLInputElement;
    const testFile = new File(['image bytes'], 'test.jpg', { type: 'image/jpeg' });

    // Mock upload response
    (global.fetch as jest.Mock).mockImplementation(async (url) => {
      if (url === '/api/guest/photos/upload') {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { id: 'upload-1', url: '/uploads/photos/test.jpg', altText: 'test.jpg' },
          }),
        };
      }
      return {
        ok: true,
        blob: async () => new Blob(['fake zip'], { type: 'application/zip' }),
      };
    });

    fireEvent.change(fileInput, { target: { files: [testFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('guest-photos-section')).toBeInTheDocument();
    });

    const checkbox = screen.getByTestId('photo-checkbox-0');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.getByTestId('export-selected-photos-btn')).toBeInTheDocument();
      expect(screen.getByText('Export Selected (1) (.zip)')).toBeInTheDocument();
    });

    const exportSelectedBtn = screen.getByTestId('export-selected-photos-btn');
    fireEvent.click(exportSelectedBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/media/export', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['upload-1'] }),
      }));
    });
  });

  describe('Photo Export Failure Notifications', () => {
    let consoleErrorSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it('displays an error toast and resets export loading state when network request rejects', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network offline'));

      render(
        <ToastProvider>
          <PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} />
        </ToastProvider>
      );

      const exportBtn = screen.getByTestId('export-all-guest-photos-btn');
      fireEvent.click(exportBtn);

      const alertToast = await screen.findByRole('alert');
      expect(alertToast).toHaveTextContent(/failed to export photos.*retry/i);

      await waitFor(() => {
        expect(exportBtn).not.toBeDisabled();
        expect(exportBtn).toHaveTextContent('Export All Guest Photos (.zip)');
      });
      expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('displays an error toast and resets export spinner when server returns HTTP 500', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as unknown as Response);

      render(
        <ToastProvider>
          <PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} />
        </ToastProvider>
      );

      const exportBtn = screen.getByTestId('export-all-guest-photos-btn');
      fireEvent.click(exportBtn);

      const alertToast = await screen.findByRole('alert');
      expect(alertToast).toHaveTextContent(/failed to export photos.*retry/i);

      await waitFor(() => {
        expect(exportBtn).not.toBeDisabled();
        expect(exportBtn).toHaveTextContent('Export All Guest Photos (.zip)');
      });
      expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('displays an error toast and preserves selection when exporting selected photos fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as unknown as Response);

      render(
        <ToastProvider>
          <PhotoGalleryClient initialPhotos={['/curated/photo1.jpg', '/curated/photo2.jpg']} />
        </ToastProvider>
      );

      fireEvent.click(screen.getByTestId('photo-checkbox-0'));
      const exportSelectedBtn = screen.getByTestId('export-selected-photos-btn');
      fireEvent.click(exportSelectedBtn);

      const alertToast = await screen.findByRole('alert');
      expect(alertToast).toHaveTextContent(/failed to export photos.*retry/i);

      await waitFor(() => {
        expect(exportSelectedBtn).not.toBeDisabled();
        expect(exportSelectedBtn).toHaveTextContent('Export Selected (1) (.zip)');
      });
    });

    it('handles export failure safely without crashing when rendered outside ToastProvider', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as unknown as Response);

      render(<PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} />);

      const exportBtn = screen.getByTestId('export-all-guest-photos-btn');
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/media/export?tag=guest-upload');
        expect(exportBtn).not.toBeDisabled();
        expect(exportBtn).toHaveTextContent('Export All Guest Photos (.zip)');
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('renders curated photos in default tab and zero-state empty state when switching to guest tab with no guest photos', () => {
    render(<PhotoGalleryClient initialPhotos={['/album/photo1.jpg', '/album/photo2.jpg']} />);

    // Default tab is curated photos and displays the curated photo grid
    expect(screen.getByTestId('curated-photos-section')).toBeInTheDocument();
    expect(screen.getByTestId('curated-photos-grid')).toBeInTheDocument();
    expect(screen.getByTestId('tab-curated')).toHaveAttribute('aria-selected', 'true');

    // Switch to guest tab
    fireEvent.click(screen.getByTestId('tab-guest'));

    // Guest tab displays empty state when no guest photos exist
    expect(screen.getByTestId('guest-photos-section')).toBeInTheDocument();
    expect(screen.getByTestId('guest-photos-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No guest photos yet')).toBeInTheDocument();
    expect(screen.queryByTestId('guest-photos-grid')).not.toBeInTheDocument();
  });

  describe('Tabbed Gallery Architecture and Scoped Views', () => {
    const sampleCuratedUrls = Array.from({ length: 16 }, (_, i) => `/curated/photo-${i + 1}.jpg`);

    it('displays all 16 curated wedding photos when guests load the page', () => {
      render(<PhotoGalleryClient initialPhotos={sampleCuratedUrls} />);

      // Verify Curated tab is active by default
      const curatedTab = screen.getByTestId('tab-curated');
      expect(curatedTab).toHaveAttribute('aria-selected', 'true');

      // Verify all 16 curated photos are rendered
      const curatedGrid = screen.getByTestId('curated-photos-grid');
      expect(curatedGrid).toBeInTheDocument();

      for (let i = 0; i < 16; i++) {
        const thumb = screen.getByTestId(`photo-thumbnail-${i}`);
        expect(thumb).toBeInTheDocument();
        expect(thumb).toHaveAttribute('data-category', 'curated');
      }
    });

    it('renders accessible tab bar with curated album and guest upload tabs and supports keyboard navigation', () => {
      render(<PhotoGalleryClient initialPhotos={sampleCuratedUrls} />);

      const tablist = screen.getByRole('tablist', { name: /photo gallery views/i });
      expect(tablist).toBeInTheDocument();

      const curatedTab = screen.getByTestId('tab-curated');
      const guestTab = screen.getByTestId('tab-guest');

      expect(curatedTab).toHaveAttribute('role', 'tab');
      expect(guestTab).toHaveAttribute('role', 'tab');
      expect(curatedTab).toHaveAttribute('aria-controls', 'tabpanel-curated');
      expect(guestTab).toHaveAttribute('aria-controls', 'tabpanel-guest');

      // Curated tab starts selected
      expect(curatedTab).toHaveAttribute('aria-selected', 'true');
      expect(curatedTab).toHaveAttribute('tabindex', '0');
      expect(guestTab).toHaveAttribute('aria-selected', 'false');
      expect(guestTab).toHaveAttribute('tabindex', '-1');

      // ArrowRight navigates to Guest tab
      curatedTab.focus();
      fireEvent.keyDown(curatedTab, { key: 'ArrowRight' });
      expect(guestTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('guest-photos-section')).toBeInTheDocument();

      // ArrowLeft navigates back to Curated tab
      fireEvent.keyDown(guestTab, { key: 'ArrowLeft' });
      expect(curatedTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('curated-photos-section')).toBeInTheDocument();
    });

    it('switches tabs between curated photos and guest uploads without page reloads', async () => {
      render(<PhotoGalleryClient initialPhotos={sampleCuratedUrls} />);

      // Initially on curated tab
      expect(screen.getByTestId('curated-photos-grid')).toBeInTheDocument();
      expect(screen.queryByTestId('guest-photos-section')).not.toBeInTheDocument();

      // Click guest tab
      fireEvent.click(screen.getByTestId('tab-guest'));
      expect(screen.queryByTestId('curated-photos-grid')).not.toBeInTheDocument();
      expect(screen.getByTestId('guest-photos-section')).toBeInTheDocument();
      expect(screen.getByTestId('guest-photo-file-input')).toBeInTheDocument();

      // Click curated tab
      fireEvent.click(screen.getByTestId('tab-curated'));
      expect(screen.getByTestId('curated-photos-grid')).toBeInTheDocument();
      expect(screen.queryByTestId('guest-photos-section')).not.toBeInTheDocument();
    });

    it('counts only visible photos in the active view and selects only items in active tab', () => {
      render(<PhotoGalleryClient initialPhotos={['/c1.jpg', '/c2.jpg', '/c3.jpg']} />);

      // Curated tab has 3 photos
      expect(screen.getByText('Select All Photos')).toBeInTheDocument();

      // Select one photo in curated tab
      fireEvent.click(screen.getByTestId('photo-checkbox-0'));
      expect(screen.getByText('(1 of 3 selected)')).toBeInTheDocument();
      expect(screen.getByText('Export Selected (1) (.zip)')).toBeInTheDocument();

      // Click Select All Photos in curated tab
      fireEvent.click(screen.getByTestId('toggle-select-all-photos-btn'));
      expect(screen.getByText('(3 of 3 selected)')).toBeInTheDocument();
      expect(screen.getByText('Deselect All')).toBeInTheDocument();
      expect(screen.getByText('Export Selected (3) (.zip)')).toBeInTheDocument();

      // Switch to Guest tab (0 photos)
      fireEvent.click(screen.getByTestId('tab-guest'));
      // Toolbar counter is hidden for empty guest tab
      expect(screen.queryByTestId('toggle-select-all-photos-btn')).not.toBeInTheDocument();
      expect(screen.queryByTestId('export-selected-photos-btn')).not.toBeInTheDocument();
    });

    it('navigates through curated photos within the lightbox viewer and displays correct position indices', () => {
      render(<PhotoGalleryClient initialPhotos={['/c1.jpg', '/c2.jpg', '/c3.jpg']} />);

      // Open second curated photo
      fireEvent.click(screen.getByTestId('photo-thumbnail-1'));

      expect(screen.getByRole('dialog', { name: 'Photo Preview' })).toBeInTheDocument();
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 3');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/c2.jpg');

      // Next button navigates to 3 of 3
      fireEvent.click(screen.getByTestId('lightbox-next-btn'));
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 3');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/c3.jpg');

      // Next wraps to 1 of 3
      fireEvent.click(screen.getByTestId('lightbox-next-btn'));
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 3');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/c1.jpg');
    });
  });

  it('renders guest photo grid when guest photo is uploaded', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: 'guest-1',
          url: '/uploads/guest-photo.jpg',
          altText: 'Guest Memory',
        },
      }),
    });

    render(<PhotoGalleryClient initialPhotos={[]} />);

    expect(screen.getByTestId('guest-photos-empty-state')).toBeInTheDocument();

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const validFile = new File(['guest image bytes'], 'guest.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('guest-photos-grid')).toBeInTheDocument();
    });

    expect(screen.queryByTestId('guest-photos-empty-state')).not.toBeInTheDocument();
  });

  describe('Lightbox Carousel Modal', () => {
    const uploadHelper = async (id: string, url: string, altText: string) => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id, url, altText },
        }),
      });

      const fileInput = screen.getByTestId('guest-photo-file-input');
      const file = new File(['image content'], `${id}.jpg`, { type: 'image/jpeg' });
      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByAltText(altText)).toBeInTheDocument();
      });
    };

    it('opens lightbox modal when thumbnail is clicked by index and displays counter', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('photo-1', '/uploads/photo1.jpg', 'First Photo');
      await uploadHelper('photo-2', '/uploads/photo2.jpg', 'Second Photo');

      // Click second thumbnail (index 1, which corresponds to First Photo since Second Photo was prepended)
      const thumbnail = screen.getByTestId('photo-thumbnail-1');
      fireEvent.click(thumbnail);

      expect(screen.getByRole('dialog', { name: 'Photo Preview' })).toBeInTheDocument();
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 2');
      const lightboxImg = screen.getByTestId('lightbox-image');
      expect(lightboxImg).toHaveAttribute('src', '/uploads/photo1.jpg');
    });

    it('renders thumbnails as accessible native buttons with descriptive aria-label and visible focus styles', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('photo-1', '/uploads/photo1.jpg', 'First Photo');
      await uploadHelper('photo-2', '/uploads/photo2.jpg', 'Second Photo');

      const thumbnail0 = screen.getByTestId('photo-thumbnail-0');
      const thumbnail1 = screen.getByTestId('photo-thumbnail-1');

      expect(thumbnail0.tagName).toBe('BUTTON');
      expect(thumbnail0).toHaveAttribute('type', 'button');
      expect(thumbnail0).toHaveAttribute('aria-label', 'View Second Photo');
      expect(thumbnail0).toHaveClass('focus-visible:ring-2');
      expect(thumbnail0).toHaveClass('focus-visible:ring-primary');

      expect(thumbnail1.tagName).toBe('BUTTON');
      expect(thumbnail1).toHaveAttribute('type', 'button');
      expect(thumbnail1).toHaveAttribute('aria-label', 'View First Photo');
    });

    it('supports Tab focus navigation and Enter key activation to open preview modal', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('photo-1', '/uploads/photo1.jpg', 'First Photo');
      await uploadHelper('photo-2', '/uploads/photo2.jpg', 'Second Photo');

      const thumbnail0 = screen.getByTestId('photo-thumbnail-0');
      thumbnail0.focus();
      expect(thumbnail0).toHaveFocus();

      // Enter key opens lightbox
      fireEvent.keyDown(thumbnail0, { key: 'Enter' });
      expect(screen.getByRole('dialog', { name: 'Photo Preview' })).toBeInTheDocument();
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 2');
      expect(screen.getByTestId('lightbox-close-btn')).toHaveFocus();
    });

    it('restores focus to originating thumbnail when lightbox dialog is closed', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('photo-1', '/uploads/photo1.jpg', 'First Photo');
      await uploadHelper('photo-2', '/uploads/photo2.jpg', 'Second Photo');

      const thumbnail1 = screen.getByTestId('photo-thumbnail-1');
      thumbnail1.focus();
      fireEvent.click(thumbnail1);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Close via Escape
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(thumbnail1).toHaveFocus();

      // Close via Close Button
      fireEvent.click(thumbnail1);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('lightbox-close-btn'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(thumbnail1).toHaveFocus();

      // Close via Backdrop
      fireEvent.click(thumbnail1);
      const dialog = screen.getByRole('dialog');
      fireEvent.click(dialog);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(thumbnail1).toHaveFocus();
    });

    it('restores focus to shifted originating thumbnail index when a new photo is uploaded while lightbox is open', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('photo-1', '/uploads/photo1.jpg', 'First Photo');
      await uploadHelper('photo-2', '/uploads/photo2.jpg', 'Second Photo');

      // Open lightbox on index 0 (Second Photo)
      const thumbnail0 = screen.getByTestId('photo-thumbnail-0');
      thumbnail0.focus();
      fireEvent.click(thumbnail0);
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 2');

      // Upload a new photo while modal is open (shifts Second Photo to index 1)
      await uploadHelper('photo-3', '/uploads/photo3.jpg', 'Third Photo');
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 3');

      // Close modal
      fireEvent.click(screen.getByTestId('lightbox-close-btn'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // Originating photo (Second Photo) is now at index 1
      const shiftedThumbnail = screen.getByTestId('photo-thumbnail-1');
      expect(shiftedThumbnail).toHaveFocus();
      expect(shiftedThumbnail).toHaveAttribute('aria-label', 'View Second Photo');
    });

    it('returns focus safely to the gallery container if the originating thumbnail button unmounts', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('photo-1', '/uploads/photo1.jpg', 'First Photo');

      const thumbnail = screen.getByTestId('photo-thumbnail-0');
      thumbnail.focus();
      fireEvent.click(thumbnail);
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      // Remove the thumbnail button from DOM to simulate unmounting
      thumbnail.remove();

      // Close dialog
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      const galleryGrid = screen.getByTestId('guest-photos-grid');
      expect(galleryGrid).toHaveFocus();
    });

    it('traps focus navigation with Tab and Shift+Tab within the lightbox dialog', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('photo-1', '/uploads/photo1.jpg', 'First Photo');
      await uploadHelper('photo-2', '/uploads/photo2.jpg', 'Second Photo');

      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      const closeBtn = screen.getByTestId('lightbox-close-btn');
      const nextBtn = screen.getByTestId('lightbox-next-btn');

      // Tabbing from last focusable element wraps to first
      nextBtn.focus();
      expect(nextBtn).toHaveFocus();
      fireEvent.keyDown(window, { key: 'Tab' });
      expect(closeBtn).toHaveFocus();

      // Shift+Tab from first focusable element wraps to last
      fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
      expect(nextBtn).toHaveFocus();
    });

    it('navigates via chevron clicks and wraps continuously around edges', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('p1', '/uploads/photo1.jpg', 'Photo One');
      await uploadHelper('p2', '/uploads/photo2.jpg', 'Photo Two');
      await uploadHelper('p3', '/uploads/photo3.jpg', 'Photo Three');

      // Grid order: index 0 = Photo Three, index 1 = Photo Two, index 2 = Photo One
      // Click index 0
      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));

      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 3');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/uploads/photo3.jpg');

      const nextBtn = screen.getByTestId('lightbox-next-btn');
      const prevBtn = screen.getByTestId('lightbox-prev-btn');

      // Forward navigation
      fireEvent.click(nextBtn);
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 3');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/uploads/photo2.jpg');

      fireEvent.click(nextBtn);
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 3');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/uploads/photo1.jpg');

      // Continuous wrap forward (last -> first)
      fireEvent.click(nextBtn);
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 3');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/uploads/photo3.jpg');

      // Continuous wrap backward (first -> last)
      fireEvent.click(prevBtn);
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('3 / 3');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/uploads/photo1.jpg');
    });

    it('navigates through photos via ArrowLeft and ArrowRight keyboard keys', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('p1', '/uploads/photo1.jpg', 'Photo One');
      await uploadHelper('p2', '/uploads/photo2.jpg', 'Photo Two');

      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 2');

      // ArrowRight -> next photo
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 2');

      // ArrowLeft -> previous photo
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 2');
    });

    it('closes lightbox modal on Escape key press, close button click, and backdrop click', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('p1', '/uploads/photo1.jpg', 'Photo One');

      // 1. Escape key
      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // 2. Close button
      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      fireEvent.click(screen.getByTestId('lightbox-close-btn'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      // 3. Backdrop click
      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(dialog);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('disables navigation controls in a single photo gallery', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('solo', '/uploads/solo.jpg', 'Solo Photo');

      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 1');

      const prevBtn = screen.getByTestId('lightbox-prev-btn');
      const nextBtn = screen.getByTestId('lightbox-next-btn');
      expect(prevBtn).toBeDisabled();
      expect(nextBtn).toBeDisabled();

      // Arrow keys do nothing in single photo mode
      fireEvent.keyDown(window, { key: 'ArrowRight' });
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 1');
      fireEvent.keyDown(window, { key: 'ArrowLeft' });
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 1');
    });

    it('keeps active modal index synchronized when a new photo is uploaded while modal is open', async () => {
      render(<PhotoGalleryClient initialPhotos={[]} />);
      await uploadHelper('orig-1', '/uploads/orig1.jpg', 'Original 1');
      await uploadHelper('orig-2', '/uploads/orig2.jpg', 'Original 2');

      // Open lightbox on index 0 (Original 2)
      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('1 / 2');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/uploads/orig2.jpg');

      // Upload a new photo while modal is open
      await uploadHelper('new-3', '/uploads/new3.jpg', 'New Photo 3');

      // The modal should remain displaying Original 2, but its index is now shifted to 2 of 3
      expect(screen.getByTestId('lightbox-counter')).toHaveTextContent('2 / 3');
      expect(screen.getByTestId('lightbox-image')).toHaveAttribute('src', '/uploads/orig2.jpg');
    });
  });
});
