import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { GuestPhotoDropzone } from '../GuestPhotoDropzone';

expect.extend(toHaveNoViolations);

// Global fetch mock
const originalFetch = global.fetch;

describe('GuestPhotoDropzone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('renders dropzone with instructions and acceptable file formats', async () => {
    const { container } = render(<GuestPhotoDropzone />);

    expect(screen.getByText('Share Your Wedding Photos')).toBeInTheDocument();
    expect(screen.getByText(/Supports JPEG, PNG, WebP, and HEIC/i)).toBeInTheDocument();
    const uploaderNameInput = screen.getByLabelText(/Your Name/i);
    expect(uploaderNameInput).toHaveAttribute('id', 'guest-photo-uploader-name');
    expect(uploaderNameInput).toHaveAttribute('autocomplete', 'name');
    expect(uploaderNameInput).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByTestId('guest-photo-dropzone')).toBeInTheDocument();
    const fileInput = screen.getByLabelText('Upload wedding photos');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('type', 'file');
    expect(fileInput).toHaveAttribute('id', 'guest-photo-file-input');

    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows client validation error when file exceeds 10MB limit', async () => {
    render(<GuestPhotoDropzone />);

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const oversizedFile = new File([new ArrayBuffer(10 * 1024 * 1024 + 100)], 'large.jpg', {
      type: 'image/jpeg',
    });

    fireEvent.change(fileInput, { target: { files: [oversizedFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-message')).toHaveTextContent(
        '"large.jpg" exceeds the 10 MB limit'
      );
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('shows client validation error when unsupported file format is selected', async () => {
    render(<GuestPhotoDropzone />);

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const invalidFile = new File(['dummy pdf content'], 'doc.pdf', {
      type: 'application/pdf',
    });

    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-message')).toHaveTextContent(
        '"doc.pdf" is an unsupported format'
      );
    });

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps pending guest uploads out of onUploadSuccess while displaying pending review notice', async () => {
    const handleSuccess = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'media-999',
            nodeId: 'node-999',
            altText: 'My Ceremony Photo',
            status: 'PENDING',
            isVisible: false,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });

    render(<GuestPhotoDropzone onUploadSuccess={handleSuccess} />);

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const validFile = new File(['valid png bytes'], 'ceremony.png', {
      type: 'image/png',
    });

    fireEvent.change(fileInput, { target: { files: [validFile] } });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId('staged-uploads-bar')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/guest/photos/upload',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('upload-success-badge')).toHaveTextContent('Uploaded (Pending Review)');
      expect(screen.getByTestId('upload-pending-notice')).toBeInTheDocument();
    });

    expect(handleSuccess).not.toHaveBeenCalled();
  });

  it('invokes onUploadSuccess only when server returns an approved visible photo', async () => {
    const handleSuccess = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: 'media-999',
          nodeId: 'node-999',
          url: '/uploads/photos/photo1.png',
          altText: 'My Ceremony Photo',
          status: 'APPROVED',
          isVisible: true,
          createdAt: new Date().toISOString(),
        },
      }),
    });

    render(<GuestPhotoDropzone onUploadSuccess={handleSuccess} />);

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const validFile = new File(['valid png bytes'], 'ceremony.png', {
      type: 'image/png',
    });

    fireEvent.change(fileInput, { target: { files: [validFile] } });
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'node-999',
          url: '/uploads/photos/photo1.png',
          status: 'APPROVED',
          isVisible: true,
        })
      );
    });
  });

  it('handles drag over and drop events', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: 'm1', url: '/uploads/p1.png' },
      }),
    });

    render(<GuestPhotoDropzone />);
    const dropzone = screen.getByTestId('guest-photo-dropzone');

    fireEvent.dragOver(dropzone);
    expect(screen.getByText('Drop your photos here!')).toBeInTheDocument();

    const validFile = new File(['file data'], 'reception.jpg', { type: 'image/jpeg' });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [validFile],
      },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('displays error badge when API upload fails', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        error: 'Corrupt image payload',
      }),
    });

    render(<GuestPhotoDropzone />);

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const validFile = new File(['corrupt data'], 'photo.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [validFile] } });
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-badge')).toHaveTextContent('Failed');
      expect(screen.getByTestId('upload-error-message')).toHaveTextContent('Corrupt image payload');
    });
  });

  it('displays retry button for failed uploads and successfully retries when clicked', async () => {
    // First upload attempt fails
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

    render(<GuestPhotoDropzone />);

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const validFile = new File(['valid photo data'], 'retry-me.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [validFile] } });
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-badge')).toHaveTextContent('Failed');
    });

    // Locate retry button using button data-testid starting with retry-upload-
    const retryButton = screen.getByTestId(/^retry-upload-/);
    expect(retryButton).toBeInTheDocument();

    // Mock successful retry attempt
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: 'media-retried', url: '/uploads/retry-me.jpg' },
      }),
    });

    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByTestId('upload-success-badge')).toHaveTextContent('Uploaded');
    });

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('throttles concurrent batch uploads to at most 2 active 10-file requests and processes remaining queued batches as slots free up', async () => {
    const resolvers: Array<(_resolveValue: unknown) => void> = [];
    (global.fetch as jest.Mock).mockImplementation(() => {
      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    });

    render(<GuestPhotoDropzone />);
    const fileInput = screen.getByTestId('guest-photo-file-input');

    const files = Array.from({ length: 25 }, (_, idx) =>
      new File([`f${idx + 1}`], `file${idx + 1}.jpg`, { type: 'image/jpeg' })
    );

    fireEvent.change(fileInput, { target: { files } });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId('staged-batch-pill')).toHaveTextContent('25 · 3 Batches');
    expect(screen.getByTestId('confirm-upload-btn')).toHaveTextContent('Upload 25 Photos');
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    // 25 files -> 2 active 10-file batch requests initially, with 5 remaining queued
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    expect(screen.getAllByText('Uploading...')).toHaveLength(20);
    expect(screen.getAllByText('Queued')).toHaveLength(5);

    // Resolve first 10-file batch
    resolvers[0]({
      ok: true,
      json: async () => ({
        success: true,
        data: Array.from({ length: 10 }, (_, idx) => ({
          id: `media-b1-${idx}`,
          url: `/uploads/file${idx + 1}.jpg`,
        })),
      }),
    });

    // Slot freed -> 3rd batch (remaining 5 files) starts
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    // Resolve 2nd and 3rd batches
    resolvers[1]({
      ok: true,
      json: async () => ({
        success: true,
        data: Array.from({ length: 10 }, (_, idx) => ({
          id: `media-b2-${idx}`,
          url: `/uploads/file${idx + 11}.jpg`,
        })),
      }),
    });
    resolvers[2]({
      ok: true,
      json: async () => ({
        success: true,
        data: Array.from({ length: 5 }, (_, idx) => ({
          id: `media-b3-${idx}`,
          url: `/uploads/file${idx + 21}.jpg`,
        })),
      }),
    });

    // All 25 uploads complete successfully
    await waitFor(() => {
      expect(screen.getAllByTestId('upload-success-badge')).toHaveLength(25);
    });
  });

  it('aborts in-flight request when user removes an active upload item and suppresses error alerts', async () => {
    const abortSpy = jest.spyOn(AbortController.prototype, 'abort');
    let capturedSignal: AbortSignal | undefined;

    (global.fetch as jest.Mock).mockImplementation((_url, options) => {
      capturedSignal = options?.signal;
      return new Promise((_, reject) => {
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }
      });
    });

    render(<GuestPhotoDropzone />);
    const fileInput = screen.getByTestId('guest-photo-file-input');
    const validFile = new File(['file data'], 'cancel-me.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [validFile] } });
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Click remove button
    const removeButton = screen.getByLabelText('Remove cancel-me.jpg');
    fireEvent.click(removeButton);

    expect(abortSpy).toHaveBeenCalled();
    expect(capturedSignal?.aborted).toBe(true);

    // Item should be removed from DOM and no error badge displayed
    await waitFor(() => {
      expect(screen.queryByText('cancel-me.jpg')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('upload-error-badge')).not.toBeInTheDocument();

    abortSpy.mockRestore();
  });

  it('aborts all active requests when component unmounts', async () => {
    const abortSpy = jest.spyOn(AbortController.prototype, 'abort');
    const capturedSignals: AbortSignal[] = [];

    (global.fetch as jest.Mock).mockImplementation((_url, options) => {
      if (options?.signal) {
        capturedSignals.push(options.signal);
      }
      return new Promise(() => {});
    });

    const { unmount } = render(<GuestPhotoDropzone />);
    const fileInput = screen.getByTestId('guest-photo-file-input');
    const files = Array.from({ length: 12 }, (_, idx) =>
      new File([`d${idx}`], `unmount${idx + 1}.jpg`, { type: 'image/jpeg' })
    );

    fireEvent.change(fileInput, { target: { files } });
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    expect(capturedSignals).toHaveLength(2);
    expect(capturedSignals[0].aborted).toBe(false);
    expect(capturedSignals[1].aborted).toBe(false);

    unmount();

    expect(abortSpy).toHaveBeenCalledTimes(2);
    expect(capturedSignals[0].aborted).toBe(true);
    expect(capturedSignals[1].aborted).toBe(true);

    abortSpy.mockRestore();
  });

  it('aborts all active requests and clears list when "Clear status" is clicked', async () => {
    const abortSpy = jest.spyOn(AbortController.prototype, 'abort');
    const capturedSignals: AbortSignal[] = [];

    (global.fetch as jest.Mock).mockImplementation((_url, options) => {
      if (options?.signal) {
        capturedSignals.push(options.signal);
      }
      return new Promise(() => {});
    });

    render(<GuestPhotoDropzone />);
    const fileInput = screen.getByTestId('guest-photo-file-input');
    const files = Array.from({ length: 22 }, (_, idx) =>
      new File([`d${idx}`], `clear${idx + 1}.jpg`, { type: 'image/jpeg' })
    );

    fireEvent.change(fileInput, { target: { files } });
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    const clearButton = screen.getByTestId('clear-status-button');
    fireEvent.click(clearButton);

    expect(abortSpy).toHaveBeenCalledTimes(2);
    expect(capturedSignals[0].aborted).toBe(true);
    expect(capturedSignals[1].aborted).toBe(true);

    await waitFor(() => {
      expect(screen.queryByTestId('upload-progress-container')).not.toBeInTheDocument();
    });

    abortSpy.mockRestore();
  });

  it('accepts iPhone HEIC files with empty MIME type and sends trimmed uploaderName and caption in FormData', async () => {
    let submittedFormData: FormData | undefined;
    (global.fetch as jest.Mock).mockImplementationOnce(async (_url, options) => {
      submittedFormData = options?.body as FormData;
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: 'media-heic-1',
              nodeId: 'node-heic-1',
              url: '/uploads/photos/IMG_1234.jpg',
              title: 'Sparkler exit!',
              uploaderName: 'Aunt Clara',
              caption: 'Sparkler exit!',
              status: 'PENDING',
              isVisible: false,
            },
          ],
        }),
      };
    });

    render(<GuestPhotoDropzone />);

    fireEvent.change(screen.getByTestId('guest-photo-uploader-name'), {
      target: { value: '  Aunt Clara  ' },
    });

    const heicFile = new File(['heic-bytes'], 'IMG_1234.HEIC', { type: '' });
    fireEvent.change(screen.getByTestId('guest-photo-file-input'), {
      target: { files: [heicFile] },
    });

    expect(screen.getByTestId('upload-heic-badge')).toHaveTextContent('HEIC');
    fireEvent.change(screen.getByLabelText('Caption for IMG_1234.HEIC'), {
      target: { value: '  Sparkler exit!  ' },
    });

    expect(global.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(submittedFormData).toBeInstanceOf(FormData);
    expect((submittedFormData?.get('files') as File)?.name).toBe('IMG_1234.HEIC');
    expect(submittedFormData?.get('uploaderName')).toBe('Aunt Clara');
    expect(submittedFormData?.getAll('captions')).toEqual(['Sparkler exit!']);
    expect(submittedFormData?.get('caption')).toBe('Sparkler exit!');

    await waitFor(() => {
      expect(screen.getByTestId('upload-pending-notice')).toBeInTheDocument();
    });
  });

  it('prefills uploaderName from defaultUploaderName, applies attribution edited after file selection, keeps uploaderName, and resets caption on confirm', async () => {
    const submittedPayloads: Array<{ uploaderName: FormDataEntryValue | null; caption: FormDataEntryValue | null }> = [];
    (global.fetch as jest.Mock).mockImplementation(async (_url, options) => {
      const fd = options?.body as FormData;
      submittedPayloads.push({
        uploaderName: fd.get('uploaderName'),
        caption: fd.get('caption'),
      });
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [{ id: 'm-staged-1', url: '/uploads/photos/staged.jpg', status: 'PENDING', isVisible: false }],
        }),
      };
    });

    render(<GuestPhotoDropzone defaultUploaderName="The Rivera Family" />);

    const uploaderInput = screen.getByTestId('guest-photo-uploader-name') as HTMLInputElement;
    expect(uploaderInput.value).toBe('The Rivera Family');

    // Select a file FIRST before typing caption or editing uploaderName
    const photoFile = new File(['jpeg-bytes'], 'table-toast.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('guest-photo-file-input'), {
      target: { files: [photoFile] },
    });

    // Staged: no network request yet
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Ready to upload')).toBeInTheDocument();
    expect(screen.getByTestId('confirm-upload-btn')).toHaveTextContent('Upload 1 Photo');

    // Edit attribution AFTER file selection
    fireEvent.change(uploaderInput, { target: { value: 'Elena Rivera' } });
    const perPhotoCaptionInput = screen.getByLabelText('Caption for table-toast.jpg') as HTMLInputElement;
    fireEvent.change(perPhotoCaptionInput, { target: { value: 'Cheers from Table 4!' } });

    // Confirm upload
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(submittedPayloads[0]).toEqual({
      uploaderName: 'Elena Rivera',
      caption: 'Cheers from Table 4!',
    });

    // uploaderName stays populated for subsequent uploads while staged caption input is replaced by uploaded status
    expect(uploaderInput.value).toBe('Elena Rivera');
    await waitFor(() => {
      expect(screen.queryByTestId('guest-photo-caption-input')).not.toBeInTheDocument();
    });
  });

  it('maintains sequential h2 heading hierarchy, accessible progressbar/alert/status semantics, per-file action labels, and zero axe violations', async () => {
    let resolveActiveUpload: ((_val: unknown) => void) | undefined;
    (global.fetch as jest.Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveActiveUpload = resolve;
          })
      )
      .mockRejectedValueOnce(new Error('Upload timeout'));

    const { container } = render(
      <main>
        <h1>Photo Gallery</h1>
        <GuestPhotoDropzone />
      </main>
    );

    const fileInput = screen.getByTestId('guest-photo-file-input');
    const activeFile = new File(['active-bytes'], 'ceremony-vows.jpg', { type: 'image/jpeg' });
    const failingFile = new File(['fail-bytes'], 'reception-dance.jpg', { type: 'image/jpeg' });

    fireEvent.change(fileInput, { target: { files: [activeFile] } });

    // Verify staged confirmation bar and staged badges have zero axe violations prior to upload
    expect(screen.getByTestId('staged-uploads-bar')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    // Start first upload (remains in-flight)
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    // Stage and confirm second upload so it runs in parallel slot 2 and rejects independently
    fireEvent.change(fileInput, { target: { files: [failingFile] } });
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('upload-error-badge')).toHaveTextContent('Failed');
    });

    // Heading order: Upload Status is an h2 sibling, and Clear status button is outside the heading
    const statusHeading = screen.getByRole('heading', { level: 2, name: 'Upload Status' });
    const clearButton = screen.getByTestId('clear-status-button');
    expect(statusHeading.contains(clearButton)).toBe(false);

    // Active upload exposes role="progressbar" with aria-valuemin/max/now and filename aria-label
    const progressbar = screen.getByRole('progressbar', { name: 'Uploading ceremony-vows.jpg' });
    expect(progressbar).toHaveAttribute('aria-valuemin', '0');
    expect(progressbar).toHaveAttribute('aria-valuemax', '100');
    expect(progressbar).toHaveAttribute('aria-valuenow');

    // Failed upload exposes role="alert" and per-file Retry + Remove buttons with size="sm" (h-8 >= 24px)
    expect(screen.getByTestId('upload-error-message')).toHaveAttribute('role', 'alert');
    const retryBtn = screen.getByRole('button', { name: 'Retry upload for reception-dance.jpg' });
    const removeFailedBtn = screen.getByRole('button', { name: 'Remove reception-dance.jpg' });
    const removeActiveBtn = screen.getByRole('button', { name: 'Remove ceremony-vows.jpg' });
    expect(retryBtn).toHaveClass('h-8');
    expect(removeFailedBtn).toHaveClass('h-8');
    expect(removeActiveBtn).toHaveClass('h-8');

    expect(await axe(container)).toHaveNoViolations();

    // Complete active upload as pending review and verify polite role="status" notice
    resolveActiveUpload?.({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'media-pending-1',
            nodeId: 'node-pending-1',
            url: '/uploads/photos/ceremony-vows.jpg',
            status: 'PENDING',
            isVisible: false,
          },
        ],
      }),
    });

    await waitFor(() => {
      expect(screen.getByTestId('upload-pending-notice')).toHaveAttribute('role', 'status');
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('displays Published Live badge and accessible live status banner when auto-approval returns APPROVED + isVisible', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: 'media-live-77',
            nodeId: 'node-live-77',
            url: '/uploads/photos/live.jpg',
            title: 'Live Toast',
            status: 'APPROVED',
            isVisible: true,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    });

    const { container } = render(
      <main>
        <h1>Photo Gallery</h1>
        <GuestPhotoDropzone />
      </main>
    );

    const file = new File(['jpeg bytes'], 'live.jpg', { type: 'image/jpeg' });
    fireEvent.change(screen.getByTestId('guest-photo-file-input'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByTestId('confirm-upload-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('upload-success-badge')).toHaveTextContent('Published Live');
      expect(screen.getByTestId('upload-live-notice')).toHaveAttribute('role', 'status');
      expect(screen.queryByTestId('upload-pending-notice')).not.toBeInTheDocument();
    });
    expect(await axe(container)).toHaveNoViolations();
  });

  it('chunks 16 staged photos into 2 multipart POST requests (10 + 6) with aligned per-photo captions, renders local thumbnails, and revokes every object URL on removal, clear, and unmount', async () => {
    const origCreateObjectURL = URL.createObjectURL;
    const origRevokeObjectURL = URL.revokeObjectURL;
    let blobSeq = 0;
    const createObjectUrlMock = jest.fn(() => `blob:http://localhost/preview-${++blobSeq}`);
    const revokeObjectUrlMock = jest.fn();
    URL.createObjectURL = createObjectUrlMock;
    URL.revokeObjectURL = revokeObjectUrlMock;

    const postedBatches: Array<{ filenames: string[]; captions: string[] }> = [];
    (global.fetch as jest.Mock).mockImplementation(async (_url, options) => {
      const fd = options?.body as FormData;
      const files = fd.getAll('files') as File[];
      const captions = fd.getAll('captions').map((c) => String(c));
      postedBatches.push({
        filenames: files.map((f) => f.name),
        captions,
      });
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: files.map((f, idx) => ({
            id: `media-${f.name}-${idx}`,
            nodeId: `node-${f.name}-${idx}`,
            status: 'PENDING',
            isVisible: false,
          })),
        }),
      };
    });

    try {
      const { container, unmount } = render(<GuestPhotoDropzone />);
      const fileInput = screen.getByTestId('guest-photo-file-input');

      // Stage 17 files (16 JPEGs + 1 HEIC), then remove 1 JPEG -> 16 staged photos
      const initialFiles = [
        new File(['rm'], 'remove-me.jpg', { type: 'image/jpeg' }),
        ...Array.from({ length: 15 }, (_, idx) =>
          new File([`img-${idx + 1}`], `photo-${idx + 1}.jpg`, { type: 'image/jpeg' })
        ),
        new File(['heic-raw'], 'photo-16.HEIC', { type: 'image/heic' }),
      ];

      fireEvent.change(fileInput, { target: { files: initialFiles } });

      // 16 JPEGs created object URLs; 1 HEIC uses upload-heic-badge fallback without object URL
      expect(createObjectUrlMock).toHaveBeenCalledTimes(16);
      expect(screen.getAllByTestId('upload-thumbnail-preview')).toHaveLength(16);
      expect(screen.getAllByTestId('upload-heic-badge')).toHaveLength(1);

      // Remove 1 item -> immediately revokes its object URL
      fireEvent.click(screen.getByLabelText('Remove remove-me.jpg'));
      expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:http://localhost/preview-1');
      expect(screen.getByTestId('staged-batch-pill')).toHaveTextContent('16 · 2 Batches');

      // Enter distinct captions on photo-1.jpg (batch 1 index 0) and photo-12.jpg (batch 2 index 1)
      fireEvent.change(screen.getByLabelText('Caption for photo-1.jpg'), {
        target: { value: 'Ceremony aisle walk' },
      });
      fireEvent.change(screen.getByLabelText('Caption for photo-12.jpg'), {
        target: { value: 'Sparkler send-off' },
      });

      expect(await axe(container)).toHaveNoViolations();

      // Confirm upload -> sends 2 POST requests (10 + 6)
      fireEvent.click(screen.getByTestId('confirm-upload-btn'));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(screen.getAllByTestId('upload-success-badge')).toHaveLength(16);
      });

      expect(postedBatches).toHaveLength(2);
      expect(postedBatches[0].filenames).toHaveLength(10);
      expect(postedBatches[0].captions).toHaveLength(10);
      expect(postedBatches[0].captions[0]).toBe('Ceremony aisle walk');
      expect(postedBatches[0].captions[1]).toBe('');

      expect(postedBatches[1].filenames).toHaveLength(6);
      expect(postedBatches[1].captions).toHaveLength(6);
      expect(postedBatches[1].filenames[1]).toBe('photo-12.jpg');
      expect(postedBatches[1].captions[1]).toBe('Sparkler send-off');

      // Clear status -> revokes all remaining 15 object URLs
      fireEvent.click(screen.getByTestId('clear-status-button'));
      expect(revokeObjectUrlMock).toHaveBeenCalledTimes(16);

      // Stage 1 more JPEG and unmount -> revokes its object URL on unmount
      fireEvent.change(fileInput, {
        target: { files: [new File(['extra'], 'after-clear.jpg', { type: 'image/jpeg' })] },
      });
      expect(createObjectUrlMock).toHaveBeenCalledTimes(17);
      unmount();
      expect(revokeObjectUrlMock).toHaveBeenCalledTimes(17);
    } finally {
      URL.createObjectURL = origCreateObjectURL;
      URL.revokeObjectURL = origRevokeObjectURL;
    }
  });
});
