import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PhotoGalleryClient } from '../PhotoGalleryClient';

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

  it('renders zero-state empty state when no guest photos exist', () => {
    render(<PhotoGalleryClient initialPhotos={['/album/photo1.jpg', '/album/photo2.jpg']} />);

    expect(screen.getByTestId('guest-photos-section')).toBeInTheDocument();
    expect(screen.getByTestId('guest-photos-empty-state')).toBeInTheDocument();
    expect(screen.getByText('No guest photos yet')).toBeInTheDocument();
    expect(screen.queryByTestId('guest-photos-grid')).not.toBeInTheDocument();
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
