import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuestPhotoDropzone } from '../GuestPhotoDropzone';

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

  it('renders dropzone with instructions and acceptable file formats', () => {
    render(<GuestPhotoDropzone />);

    expect(screen.getByText('Share Your Wedding Photos')).toBeInTheDocument();
    expect(screen.getByText(/Supports JPEG, PNG, and WebP/i)).toBeInTheDocument();
    expect(screen.getByTestId('guest-photo-dropzone')).toBeInTheDocument();
    const fileInput = screen.getByLabelText('Upload wedding photos');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('type', 'file');
    expect(fileInput).toHaveAttribute('id', 'guest-photo-file-input');
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

  it('successfully uploads valid photo file and invokes onUploadSuccess callback', async () => {
    const handleSuccess = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          id: 'media-999',
          url: '/uploads/photos/photo1.png',
          altText: 'My Ceremony Photo',
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

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/guest/photos/upload',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId('upload-success-badge')).toHaveTextContent('Uploaded');
    });

    expect(handleSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'media-999',
        url: '/uploads/photos/photo1.png',
      })
    );
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

  it('throttles concurrent uploads to at most 2 active requests and processes remaining queued files as slots free up', async () => {
    const resolvers: Array<(_resolveValue: unknown) => void> = [];
    (global.fetch as jest.Mock).mockImplementation(() => {
      return new Promise((resolve) => {
        resolvers.push(resolve);
      });
    });

    render(<GuestPhotoDropzone />);
    const fileInput = screen.getByTestId('guest-photo-file-input');

    const files = [
      new File(['f1'], 'file1.jpg', { type: 'image/jpeg' }),
      new File(['f2'], 'file2.jpg', { type: 'image/jpeg' }),
      new File(['f3'], 'file3.jpg', { type: 'image/jpeg' }),
      new File(['f4'], 'file4.jpg', { type: 'image/jpeg' }),
    ];

    fireEvent.change(fileInput, { target: { files } });

    // Exactly 2 active uploads should be triggered initially
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    // 2 uploading badges and 2 queued badges
    expect(screen.getAllByText('Uploading...')).toHaveLength(2);
    expect(screen.getAllByText('Queued')).toHaveLength(2);

    // Resolve the first upload
    resolvers[0]({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: 'media-1', url: '/uploads/file1.jpg' },
      }),
    });

    // Slot freed -> 3rd upload starts
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });

    // Resolve the second upload
    resolvers[1]({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: 'media-2', url: '/uploads/file2.jpg' },
      }),
    });

    // Slot freed -> 4th upload starts
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(4);
    });

    // Resolve remaining 2 uploads
    resolvers[2]({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: 'media-3', url: '/uploads/file3.jpg' },
      }),
    });
    resolvers[3]({
      ok: true,
      json: async () => ({
        success: true,
        data: { id: 'media-4', url: '/uploads/file4.jpg' },
      }),
    });

    // All 4 uploads complete successfully
    await waitFor(() => {
      expect(screen.getAllByTestId('upload-success-badge')).toHaveLength(4);
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

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Click remove button
    const removeButton = screen.getByLabelText('Remove item');
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
    const files = [
      new File(['d1'], 'unmount1.jpg', { type: 'image/jpeg' }),
      new File(['d2'], 'unmount2.jpg', { type: 'image/jpeg' }),
    ];

    fireEvent.change(fileInput, { target: { files } });

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
    const files = [
      new File(['d1'], 'clear1.jpg', { type: 'image/jpeg' }),
      new File(['d2'], 'clear2.jpg', { type: 'image/jpeg' }),
      new File(['d3'], 'clear3.jpg', { type: 'image/jpeg' }),
    ];

    fireEvent.change(fileInput, { target: { files } });

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
});
