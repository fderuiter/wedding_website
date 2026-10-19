import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PhotoGalleryClient } from '../PhotoGalleryClient';

// Global fetch mock
const originalFetch = global.fetch;

describe('PhotoGalleryClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    global.fetch = originalFetch;
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
});
