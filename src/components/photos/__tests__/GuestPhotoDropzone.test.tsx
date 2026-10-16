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
});
