import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PhotoGalleryClient } from '../PhotoGalleryClient';
import { ToastProvider } from '@/components/ui/ToastProvider';

const originalFetch = global.fetch;

describe('PhotoGalleryClient', () => {
  let formSubmitSpy: jest.SpyInstance;
  let anchorClickSpy: jest.SpyInstance;
  let blobSpy: jest.Mock;
  let lastDownloadHref = '';
  let lastDownloadName = '';
  let lastSubmittedFormFields: Array<{ name: string; value: string }> = [];

  beforeEach(() => {
    jest.clearAllMocks();
    lastDownloadHref = '';
    lastDownloadName = '';
    lastSubmittedFormFields = [];
    blobSpy = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: blobSpy,
    } as unknown as Response);

    const origAnchorClick = HTMLAnchorElement.prototype.click;
    anchorClickSpy = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        if (this.hasAttribute('download')) {
          lastDownloadHref = this.getAttribute('href') ?? '';
          lastDownloadName = this.getAttribute('download') ?? '';
          return;
        }
        origAnchorClick.call(this);
      });

    formSubmitSpy = jest
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(function (this: HTMLFormElement) {
        lastSubmittedFormFields = Array.from(this.querySelectorAll('input')).map((input) => ({
          name: input.name,
          value: input.value,
        }));
      });

    if (typeof window !== 'undefined' && window.URL) {
      window.URL.createObjectURL = jest.fn().mockReturnValue('blob:http://localhost/test');
      window.URL.revokeObjectURL = jest.fn();
    }
  });

  afterEach(() => {
    anchorClickSpy.mockRestore();
    formSubmitSpy.mockRestore();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('hides export toolbar and selection checkboxes from public guests by default', () => {
    render(
      <PhotoGalleryClient
        initialPhotos={[
          {
            id: '11111111-1111-4111-8111-111111111111',
            url: '/uploads/photo1.jpg',
            title: 'Curated Photo',
            category: 'curated',
          },
        ]}
      />
    );

    expect(screen.queryByTestId('gallery-export-toolbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-all-guest-photos-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('export-selected-photos-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('toggle-select-all-photos-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('photo-checkbox-0')).not.toBeInTheDocument();
  });

  it('renders export toolbar and export all guest photos button for administrators', () => {
    render(<PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} isAdmin={true} />);

    expect(screen.getByTestId('export-all-guest-photos-btn')).toBeInTheDocument();
    expect(screen.getByText('Export All Guest Photos (.zip)')).toBeInTheDocument();
  });

  it('triggers preflight check and native <a download> zip export for all guest photos without blob buffering', async () => {
    render(<PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} isAdmin={true} />);

    const exportBtn = screen.getByTestId('export-all-guest-photos-btn');
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/media/export?tag=guest-upload&preflight=1&filename=guest-photos.zip'
      );
      expect(lastDownloadHref).toBe('/api/media/export?tag=guest-upload&filename=guest-photos.zip');
      expect(lastDownloadName).toBe('guest-photos.zip');
    });
    expect(blobSpy).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('allows administrators to multi-select curated and guest photos and submit native hidden form export using real UUIDs', async () => {
    render(
      <PhotoGalleryClient
        isAdmin={true}
        initialPhotos={[
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            url: '/uploads/photos/approved-guest.jpg',
            title: 'Approved Guest Toast',
            isGuestUpload: true,
            category: 'guest',
          },
        ]}
      />
    );

    expect(screen.getByTestId('guest-photos-section')).toBeInTheDocument();
    expect(screen.getByText('Approved Guest Toast')).toBeInTheDocument();

    const checkbox = screen.getByTestId('photo-checkbox-0');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.getByTestId('export-selected-photos-btn')).toBeInTheDocument();
      expect(screen.getByText('Export Selected (1) (.zip)')).toBeInTheDocument();
    });

    const exportSelectedBtn = screen.getByTestId('export-selected-photos-btn');
    fireEvent.click(exportSelectedBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/media/export',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            ids: ['550e8400-e29b-41d4-a716-446655440000'],
            filename: 'selected-photos.zip',
            preflight: true,
          }),
        })
      );
      expect(formSubmitSpy).toHaveBeenCalledTimes(1);
    });
    expect(lastSubmittedFormFields).toEqual([
      { name: 'ids', value: '550e8400-e29b-41d4-a716-446655440000' },
      { name: 'filename', value: 'selected-photos.zip' },
    ]);
    expect(blobSpy).not.toHaveBeenCalled();
    expect(window.URL.createObjectURL).not.toHaveBeenCalled();
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
          <PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} isAdmin={true} />
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
      expect(lastDownloadHref).toBe('');
      expect(window.URL.createObjectURL).not.toHaveBeenCalled();
    });

    it.each([401, 404, 500])(
      'displays an error toast and resets export spinner when server preflight returns HTTP %i',
      async (statusCode) => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
          ok: false,
          status: statusCode,
        } as unknown as Response);

        render(
          <ToastProvider>
            <PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} isAdmin={true} />
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
        expect(lastDownloadHref).toBe('');
        expect(window.URL.createObjectURL).not.toHaveBeenCalled();
      }
    );

    it('displays an error toast and preserves selection when exporting selected photos fails', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as unknown as Response);

      render(
        <ToastProvider>
          <PhotoGalleryClient initialPhotos={['/curated/photo1.jpg', '/curated/photo2.jpg']} isAdmin={true} />
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
      expect(formSubmitSpy).not.toHaveBeenCalled();
    });

    it('handles export failure safely without crashing when rendered outside ToastProvider', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      } as unknown as Response);

      render(<PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} isAdmin={true} />);

      const exportBtn = screen.getByTestId('export-all-guest-photos-btn');
      fireEvent.click(exportBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/media/export?tag=guest-upload&preflight=1&filename=guest-photos.zip'
        );
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
      render(<PhotoGalleryClient initialPhotos={['/c1.jpg', '/c2.jpg', '/c3.jpg']} isAdmin={true} />);

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

  it('keeps newly uploaded pending guest photos out of public gallery tabs until moderation approval', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'guest-1',
            nodeId: 'node-guest-1',
            url: '/uploads/guest-photo.jpg',
            altText: 'Guest Memory',
            status: 'PENDING',
            isVisible: false,
          },
        ],
      }),
    });

    render(<PhotoGalleryClient initialPhotos={[]} />);

    expect(screen.getByTestId('guest-photos-empty-state')).toBeInTheDocument();

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const validFile = new File(['guest image bytes'], 'guest.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('upload-pending-notice')).toBeInTheDocument();
    });

    expect(screen.getByTestId('guest-photos-empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('guest-photos-grid')).not.toBeInTheDocument();
    expect(screen.getByTestId('tab-guest')).toHaveTextContent('0');
  });

  describe('Lightbox Carousel Modal', () => {
    const uploadHelper = async (id: string, url: string, altText: string) => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id, url, altText, status: 'APPROVED', isVisible: true },
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

  describe('Guest Attribution and PublicPhotoItem Hydration', () => {
    it('hydrates PublicPhotoItem guest uploads into the Guest Uploads tab and renders caption + uploaderName in grid and lightbox', () => {
      render(
        <PhotoGalleryClient
          initialPhotos={[
            {
              id: 'curated-1',
              url: '/uploads/curated-1.jpg',
              title: 'Ceremony Vows',
              isGuestUpload: false,
            },
            {
              id: 'guest-1',
              mediaId: 'media-guest-1',
              url: '/uploads/photos/sparklers.jpg',
              caption: 'Sparkler send-off!',
              uploaderName: 'Aunt Clara',
              isGuestUpload: true,
            },
          ]}
        />
      );

      expect(screen.getByTestId('tab-curated')).toHaveTextContent('1');
      expect(screen.getByTestId('tab-guest')).toHaveTextContent('1');

      // Switch to Guest Uploads tab
      fireEvent.click(screen.getByTestId('tab-guest'));
      expect(screen.getByTestId('guest-photos-grid')).toBeInTheDocument();
      expect(screen.getByText('Sparkler send-off!')).toBeInTheDocument();
      expect(screen.getByTestId('guest-photo-uploader-0')).toHaveTextContent('Photo by Aunt Clara');

      // Open lightbox and verify both caption and uploader attribution are shown
      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));
      expect(screen.getByTestId('lightbox-caption')).toHaveTextContent('Sparkler send-off!');
      expect(screen.getByTestId('lightbox-uploader')).toHaveTextContent('Photo by Aunt Clara');
    });

    it('avoids duplicate attribution text when guest photo has uploaderName without a custom caption', () => {
      render(
        <PhotoGalleryClient
          initialPhotos={[
            {
              id: 'guest-2',
              url: '/uploads/photos/toast.jpg',
              uploaderName: 'Uncle Bob',
              isGuestUpload: true,
            },
          ]}
        />
      );

      expect(screen.getByTestId('guest-photos-grid')).toBeInTheDocument();
      expect(screen.getByText('Photo by Uncle Bob')).toBeInTheDocument();
      expect(screen.queryByTestId('guest-photo-uploader-0')).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId('photo-thumbnail-0'));
      expect(screen.getByTestId('lightbox-caption')).toHaveTextContent('Photo by Uncle Bob');
      expect(screen.queryByTestId('lightbox-uploader')).not.toBeInTheDocument();
    });
  });

  it('renders an accessible Live Slideshow link to /photos/slideshow outside the tablist', () => {
    render(<PhotoGalleryClient initialPhotos={['/uploads/photo1.jpg']} />);

    const slideshowLink = screen.getByRole('link', { name: /live slideshow/i });
    expect(slideshowLink).toBeInTheDocument();
    expect(slideshowLink).toHaveAttribute('href', '/photos/slideshow');

    const tablist = screen.getByRole('tablist', { name: /photo gallery views/i });
    expect(tablist.contains(slideshowLink)).toBe(false);
  });

  it('honors ?tab=guest in window.location.search on client mount and exposes GuestPhotoDropzone', async () => {
    window.history.pushState({}, '', '/photos?tab=guest');

    try {
      render(
        <PhotoGalleryClient
          defaultTab="curated"
          initialPhotos={[
            {
              id: 'curated-1',
              url: '/uploads/curated1.jpg',
              title: 'Curated Vows',
              category: 'curated',
            },
          ]}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('tab-guest')).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('guest-photo-dropzone')).toBeInTheDocument();
      });
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  it('immediately renders auto-approved guest uploads in the gallery grid without page reload', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: 'media-live-1',
          nodeId: 'node-live-1',
          url: '/uploads/photos/live-dance.jpg',
          title: 'Dance Floor Encore',
          caption: 'Dance Floor Encore',
          uploaderName: 'DJ Maya',
          status: 'APPROVED',
          isVisible: true,
          createdAt: new Date().toISOString(),
        },
      }),
    });

    render(<PhotoGalleryClient defaultTab="guest" initialPhotos={[]} />);

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const validFile = new File(['jpeg bytes'], 'dance.jpg', { type: 'image/jpeg' });
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('guest-photos-grid')).toBeInTheDocument();
      expect(screen.getByText('Dance Floor Encore')).toBeInTheDocument();
      expect(screen.getByTestId('upload-live-notice')).toBeInTheDocument();
    });
  });
});
