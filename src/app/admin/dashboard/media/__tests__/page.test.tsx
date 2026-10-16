import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MediaDashboardPage from '../page';
import { apiClient } from '@/lib/apiClient';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('MediaDashboardPage', () => {
  const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
  const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
  const mockPut = apiClient.put as jest.MockedFunction<typeof apiClient.put>;
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

  it('handles media deletion', async () => {
    const existingMedia = [
      { id: '1', url: '/uploads/ring.jpg', altText: 'Wedding Ring', isDecorative: false },
    ];
    mockGet.mockResolvedValueOnce(existingMedia);
    mockDelete.mockResolvedValueOnce({});

    window.confirm = jest.fn().mockReturnValue(true);

    render(<MediaDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('/uploads/ring.jpg')).toBeInTheDocument();
    });

    const deleteButton = screen.getByRole('button', { name: 'Delete media: Wedding Ring' });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/api/media/1');
    });
  });
});
