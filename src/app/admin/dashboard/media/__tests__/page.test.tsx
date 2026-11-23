import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MediaDashboardPage from '../page';
import { apiClient } from '@/lib/apiClient';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('MediaDashboardPage', () => {
  const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
  const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
  const mockPut = apiClient.put as jest.MockedFunction<typeof apiClient.put>;
  const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
  const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders EmptyState component with action button when media list is empty', async () => {
    mockGet.mockResolvedValueOnce([]);

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No items found')).toBeInTheDocument();
      expect(screen.getByText('No media items available in the library.')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Add Media' })).toHaveLength(2);
    });
  });

  it('opens edit form when action button on EmptyState is clicked', async () => {
    mockGet.mockResolvedValueOnce([]);

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No items found')).toBeInTheDocument();
    });

    const addButtons = screen.getAllByRole('button', { name: 'Add Media' });
    fireEvent.click(addButtons[0]);

    expect(screen.getByText('Create Media')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /file upload dropzone/i })).toBeInTheDocument();
  });

  it('uploads dropped image, populates URL input and default alt text from filename', async () => {
    mockGet.mockResolvedValueOnce([]);
    mockPost.mockImplementation(async (url) => {
      if (url === '/api/admin/upload') {
        return { url: '/uploads/sample-photo.png' };
      }
      return { id: 'media-1', url: '/uploads/sample-photo.png', altText: 'sample-photo.png' };
    });

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No items found')).toBeInTheDocument();
    });

    const addButton = screen.getAllByRole('button', { name: 'Add Media' })[0];
    fireEvent.click(addButton);

    const dropzone = screen.getByRole('button', { name: /file upload dropzone/i });
    const file = new File(['image bytes'], 'sample-photo.png', { type: 'image/png' });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [file],
      },
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/admin/upload', expect.any(FormData));
    });

    const urlInput = screen.getByLabelText('Image URL') as HTMLInputElement;
    const altInput = screen.getByLabelText('Alternative Text') as HTMLInputElement;

    await waitFor(() => {
      expect(urlInput.value).toBe('/uploads/sample-photo.png');
      expect(altInput.value).toBe('sample-photo.png');
    });

    // Save the new media item
    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/media', {
        url: '/uploads/sample-photo.png',
        altText: 'sample-photo.png',
        isDecorative: false,
      });
    });
  });

  it('submits publishToGallery=true when saving a local upload marked for gallery display', async () => {
    let saved = false;
    mockGet.mockImplementation(async (url) => {
      if (url.startsWith('/api/admin/photos/moderation')) {
        return { data: [], counts: { PENDING: 0, APPROVED: 0, REJECTED: 0 } };
      }
      if (saved) {
        return [
          {
            id: 'media-pub-1',
            url: '/uploads/gallery-vows.jpg',
            altText: 'Ceremony Vows',
            isDecorative: false,
            publishToGallery: true,
          },
        ];
      }
      return [];
    });
    mockPost.mockImplementation(async (url) => {
      if (url === '/api/admin/upload') {
        return { url: '/uploads/gallery-vows.jpg' };
      }
      saved = true;
      return {
        id: 'media-pub-1',
        url: '/uploads/gallery-vows.jpg',
        altText: 'Ceremony Vows',
        isDecorative: false,
        publishToGallery: true,
      };
    });

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No items found')).toBeInTheDocument();
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Add Media' })[0]);

    const dropzone = screen.getByRole('button', { name: /file upload dropzone/i });
    const file = new File(['image bytes'], 'gallery-vows.jpg', { type: 'image/jpeg' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect((screen.getByLabelText('Image URL') as HTMLInputElement).value).toBe('/uploads/gallery-vows.jpg');
    });

    fireEvent.change(screen.getByLabelText('Alternative Text'), {
      target: { value: 'Ceremony Vows' },
    });
    fireEvent.click(screen.getByTestId('publish-to-gallery-checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/media', {
        url: '/uploads/gallery-vows.jpg',
        altText: 'Ceremony Vows',
        isDecorative: false,
        publishToGallery: true,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('gallery-published-badge-media-pub-1')).toBeInTheDocument();
    });
  });

  it('displays inline error message when dropping oversized file in Dropzone', async () => {
    mockGet.mockResolvedValueOnce([]);

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No items found')).toBeInTheDocument();
    });

    const addButton = screen.getAllByRole('button', { name: 'Add Media' })[0];
    fireEvent.click(addButton);

    const dropzone = screen.getByRole('button', { name: /file upload dropzone/i });
    const hugeFile = new File(['x'.repeat(6 * 1024 * 1024)], 'huge.png', { type: 'image/png' });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [hugeFile],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('File size exceeds 5MB limit');
    });

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('renders media cards and handles editing existing media item', async () => {
    const existingMedia = [
      { id: '1', url: '/uploads/ring.jpg', altText: 'Wedding Ring', isDecorative: false },
    ];
    mockGet.mockResolvedValueOnce(existingMedia);

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('/uploads/ring.jpg')).toBeInTheDocument();
      expect(screen.getByText('Wedding Ring')).toBeInTheDocument();
    });

    const editButton = screen.getByRole('button', { name: 'Edit media: Wedding Ring' });
    fireEvent.click(editButton);

    expect(screen.getByText('Edit Media')).toBeInTheDocument();

    const altInput = screen.getByLabelText('Alternative Text') as HTMLInputElement;
    fireEvent.change(altInput, { target: { value: 'Updated Wedding Ring' } });

    mockPut.mockResolvedValueOnce({ ...existingMedia[0], altText: 'Updated Wedding Ring' });

    const saveButton = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/api/media/1', expect.objectContaining({
        altText: 'Updated Wedding Ring',
      }));
    });
  });

  it('handles media deletion via accessible confirmation alertdialog without native confirm', async () => {
    const existingMedia = [
      { id: '1', url: '/uploads/ring.jpg', altText: 'Wedding Ring', isDecorative: false },
    ];
    mockGet.mockResolvedValueOnce(existingMedia);
    mockDelete.mockResolvedValueOnce({});

    const confirmSpy = jest.spyOn(window, 'confirm');

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('/uploads/ring.jpg')).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole('button', { name: 'Delete media: Wedding Ring' });
    fireEvent.click(deleteButton);

    const alertDialog = await screen.findByRole('alertdialog');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();

    // Cancel keeps item without calling delete
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(alertDialog).not.toBeInTheDocument();
    });
    expect(mockDelete).not.toHaveBeenCalled();

    // Trigger again and confirm
    fireEvent.click(deleteButton);
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/api/media/1');
    });

    confirmSpy.mockRestore();
  });

  it('requires confirmation warning of permanent deletion before single or batch photo rejection', async () => {
    const pendingItems = [
      { id: 'p1', url: '/uploads/guest1.jpg', title: 'First Dance', createdAt: '2026-06-20T20:00:00Z' },
      { id: 'p2', url: '/uploads/guest2.jpg', title: 'Cake Cutting', createdAt: '2026-06-20T21:00:00Z' },
    ];
    mockGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/photos/moderation')) {
        return { data: pendingItems, counts: { PENDING: 2, APPROVED: 0, REJECTED: 0 } };
      }
      return [];
    });
    mockPatch.mockResolvedValue({ ok: true });
    mockPost.mockResolvedValue({ ok: true });

    const confirmSpy = jest.spyOn(window, 'confirm');

    render(<MediaDashboardPage />);

    const drawerBtn = await screen.findByTestId('toggle-moderation-drawer');
    await waitFor(() => {
      expect(screen.getByTestId('pending-count-badge')).toHaveTextContent('2');
    });
    fireEvent.click(drawerBtn);

    // Single photo reject: Cancel aborts API call
    fireEvent.click(screen.getByTestId('reject-photo-p1'));
    const singleDialog = await screen.findByRole('alertdialog');
    expect(singleDialog).toHaveTextContent(/permanently delete/i);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(mockPatch).not.toHaveBeenCalled();

    // Single photo reject: Confirm calls moderation endpoint
    fireEvent.click(screen.getByTestId('reject-photo-p1'));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/api/admin/photos/moderation', {
        id: 'p1',
        action: 'reject',
      });
    });

    mockPost.mockClear();

    // Batch photo reject: select remaining photo(s), verify Cancel aborts and Confirm executes
    fireEvent.click(screen.getByTestId('select-all-pending-btn'));
    fireEvent.click(screen.getByTestId('batch-reject-btn'));

    const batchDialog = await screen.findByRole('alertdialog');
    expect(batchDialog).toHaveTextContent(/permanently delete/i);
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(mockPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('batch-reject-btn'));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/admin/photos/moderation/batch', {
        ids: ['p2'],
        action: 'reject',
      });
    });

    confirmSpy.mockRestore();
  });

  it('allows multi-selection and triggering bulk zip export', async () => {
    const existingMedia = [
      { id: '1', url: '/uploads/ring.jpg', altText: 'Wedding Ring', isDecorative: false },
      { id: '2', url: '/uploads/cake.jpg', altText: 'Wedding Cake', isDecorative: false },
    ];
    mockGet.mockResolvedValueOnce(existingMedia);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(new Blob(['fake zip bytes'], { type: 'application/zip' })),
    } as unknown as Response);

    window.URL.createObjectURL = jest.fn().mockReturnValue('blob:http://localhost/test');
    window.URL.revokeObjectURL = jest.fn();

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('/uploads/ring.jpg')).toBeInTheDocument();
      expect(screen.getByText('/uploads/cake.jpg')).toBeInTheDocument();
    });

    const checkbox1 = screen.getByTestId('media-checkbox-1');
    fireEvent.click(checkbox1);

    await waitFor(() => {
      expect(screen.getByTestId('export-selected-admin-btn')).toBeInTheDocument();
      expect(screen.getByText('Export Selected (1) (.zip)')).toBeInTheDocument();
    });

    const exportSelectedBtn = screen.getByTestId('export-selected-admin-btn');
    fireEvent.click(exportSelectedBtn);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/media/export', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ ids: ['1'] }),
      }));
    });
  });

  it('displays polite live region announcement and skeleton placeholders while media query is pending', () => {
    mockGet.mockReturnValue(new Promise(() => {}));

    render(<MediaDashboardPage />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading media library...')).toBeInTheDocument();
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(screen.queryByText('No items found')).not.toBeInTheDocument();
  });

  it('captures API exceptions and renders AdminViewState error card instead of EmptyState, recovering on Retry', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/media')) {
        throw new Error('Storage bucket unreachable');
      }
      return [];
    });

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    expect(screen.getByText('Error: Storage bucket unreachable')).toBeInTheDocument();
    expect(screen.queryByText('No items found')).not.toBeInTheDocument();
    expect(screen.queryByText('No media items available in the library.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back to dashboard/i }));
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');

    // Now allow retry to succeed
    mockGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/media')) {
        return [{ id: 'recovered-1', url: '/uploads/recovered.jpg', altText: 'Recovered Photo', isDecorative: false }];
      }
      return [];
    });

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText('/uploads/recovered.jpg')).toBeInTheDocument();
      expect(screen.getByText('Recovered Photo')).toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('displays guest caption and uploader attribution on pending moderation cards', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/photos/moderation')) {
        return {
          photos: [
            {
              id: 'pending-node-1',
              createdAt: '2026-06-20T21:15:00.000Z',
              data: {
                url: '/uploads/photos/sparklers.jpg',
                title: 'Sparkler exit!',
                caption: 'Sparkler exit!',
                uploaderName: 'Aunt Clara',
                originalFilename: 'IMG_1234.HEIC',
                status: 'PENDING',
              },
            },
          ],
        };
      }
      return [];
    });

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('pending-count-badge')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByTestId('toggle-moderation-drawer'));

    expect(screen.getByTestId('pending-photo-card-pending-node-1')).toBeInTheDocument();
    expect(screen.getByTestId('pending-photo-title-pending-node-1')).toHaveTextContent('Sparkler exit!');
    expect(screen.getByTestId('pending-photo-uploader-pending-node-1')).toHaveTextContent('Uploaded by Aunt Clara');
    expect(screen.queryByText('IMG_1234.HEIC')).not.toBeInTheDocument();
  });

  it('renders an accessible Live Slideshow link to /photos/slideshow in the media header', async () => {
    mockGet.mockResolvedValueOnce([]);

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('No items found')).toBeInTheDocument();
    });

    const slideshowLink = screen.getByRole('link', { name: /live slideshow/i });
    expect(slideshowLink).toBeInTheDocument();
    expect(slideshowLink).toHaveAttribute('href', '/photos/slideshow');
  });

  it('allows editing inline caption and uploaderName on pending moderation cards before approving and in Media Edit form', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/photos/moderation')) {
        return {
          photos: [
            {
              id: 'pending-edit-1',
              createdAt: '2026-06-20T21:15:00.000Z',
              data: {
                url: '/uploads/photos/sparklers.jpg',
                title: 'Sparkler exit!',
                caption: 'Raw guest caption',
                uploaderName: 'Aunt Clara',
                status: 'PENDING',
              },
            },
          ],
        };
      }
      return [
        {
          id: 'media-guest-1',
          url: '/uploads/photos/approved-dance.jpg',
          altText: 'Dance Floor',
          caption: 'Initial Dance Caption',
          uploaderName: 'Cousin Leo',
          isDecorative: false,
          publishToGallery: true,
        },
      ];
    });
    mockPatch.mockResolvedValue({ success: true });
    mockPut.mockResolvedValue({
      id: 'media-guest-1',
      url: '/uploads/photos/approved-dance.jpg',
      altText: 'Dance Floor',
      isDecorative: false,
      publishToGallery: true,
    });

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('pending-count-badge')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByTestId('toggle-moderation-drawer'));

    const modCaptionInput = screen.getByTestId('pending-caption-input-pending-edit-1') as HTMLInputElement;
    const modUploaderInput = screen.getByTestId('pending-uploader-input-pending-edit-1') as HTMLInputElement;
    expect(modCaptionInput.value).toBe('Raw guest caption');
    expect(modUploaderInput.value).toBe('Aunt Clara');

    fireEvent.change(modCaptionInput, { target: { value: 'Edited Sparkler Send-Off' } });
    fireEvent.change(modUploaderInput, { target: { value: 'Clara & Joe' } });
    fireEvent.click(screen.getByTestId('approve-photo-pending-edit-1'));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/api/admin/photos/moderation', {
        id: 'pending-edit-1',
        action: 'approve',
        caption: 'Edited Sparkler Send-Off',
        uploaderName: 'Clara & Joe',
      });
    });

    // Also verify Media Edit form exposes and persists/clears Caption and Uploader Name
    fireEvent.click(screen.getByRole('button', { name: 'Edit media: Dance Floor' }));
    const mediaCaptionInput = screen.getByTestId('media-caption-input') as HTMLInputElement;
    const mediaUploaderInput = screen.getByTestId('media-uploader-input') as HTMLInputElement;
    expect(mediaCaptionInput.value).toBe('Initial Dance Caption');
    expect(mediaUploaderInput.value).toBe('Cousin Leo');

    fireEvent.change(mediaCaptionInput, { target: { value: '' } });
    fireEvent.change(mediaUploaderInput, { target: { value: 'Leo & Maya' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith(
        '/api/media/media-guest-1',
        expect.objectContaining({
          caption: '',
          uploaderName: 'Leo & Maya',
        })
      );
    });
  });
});
