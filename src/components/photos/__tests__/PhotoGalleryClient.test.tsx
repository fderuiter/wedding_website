import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { PhotoGalleryClient } from '../PhotoGalleryClient';

describe('PhotoGalleryClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(new Blob(['fake zip bytes'], { type: 'application/zip' })),
    } as unknown as Response);

    window.URL.createObjectURL = jest.fn().mockReturnValue('blob:http://localhost/test');
    window.URL.revokeObjectURL = jest.fn();
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
});
