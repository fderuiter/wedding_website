import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import Dropzone from '../Dropzone';
import { apiClient } from '@/lib/apiClient';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

describe('Dropzone Component', () => {
  const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders default labels and hint text', () => {
    render(<Dropzone />);

    expect(
      screen.getByText('Drag and drop an image file here, or click to browse')
    ).toBeInTheDocument();
    expect(screen.getByText('Supports JPG, PNG, and ICO files up to 5MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /file upload dropzone/i })).toBeInTheDocument();
  });

  it('forwards ref and applies custom className', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Dropzone ref={ref} className="custom-dropzone-class" />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('custom-dropzone-class');
  });

  it('handles drag over, drag leave, and visual state updates', () => {
    render(<Dropzone />);
    const dropzone = screen.getByRole('button', { name: /file upload dropzone/i });

    fireEvent.dragOver(dropzone);
    expect(dropzone).toHaveClass('border-rose-500');

    fireEvent.dragLeave(dropzone);
    expect(dropzone).not.toHaveClass('border-rose-500');
  });

  it('shows inline error message when dropped file exceeds size limit (5MB)', async () => {
    const onUploadError = jest.fn();
    render(<Dropzone onUploadError={onUploadError} />);

    const dropzone = screen.getByRole('button', { name: /file upload dropzone/i });
    const largeFile = new File(['a'.repeat(6 * 1024 * 1024)], 'too-large.png', {
      type: 'image/png',
    });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [largeFile],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('File size exceeds 5MB limit');
    });

    expect(onUploadError).toHaveBeenCalledWith('File size exceeds 5MB limit');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows inline error message when dropped file format is unsupported', async () => {
    const onUploadError = jest.fn();
    render(<Dropzone onUploadError={onUploadError} />);

    const dropzone = screen.getByRole('button', { name: /file upload dropzone/i });
    const invalidFile = new File(['dummy content'], 'document.pdf', {
      type: 'application/pdf',
    });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [invalidFile],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Invalid file format. Only JPG, PNG, and ICO are supported'
      );
    });

    expect(onUploadError).toHaveBeenCalledWith(
      'Invalid file format. Only JPG, PNG, and ICO are supported'
    );
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('uploads valid dropped image and triggers onUploadSuccess', async () => {
    const onUploadSuccess = jest.fn();
    mockPost.mockResolvedValueOnce({ url: '/uploads/sample.png' });

    render(<Dropzone onUploadSuccess={onUploadSuccess} />);
    const dropzone = screen.getByRole('button', { name: /file upload dropzone/i });
    const validFile = new File(['valid content'], 'photo.png', { type: 'image/png' });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [validFile],
      },
    });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/admin/upload', expect.any(FormData));
    });

    await waitFor(() => {
      expect(onUploadSuccess).toHaveBeenCalledWith('/uploads/sample.png', validFile);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('triggers file selection dialog when clicked or Enter key pressed', async () => {
    render(<Dropzone />);
    const dropzone = screen.getByRole('button', { name: /file upload dropzone/i });
    const input = screen.getByTestId('dropzone-file-input') as HTMLInputElement;

    const clickSpy = jest.spyOn(input, 'click').mockImplementation(() => {});

    fireEvent.click(dropzone);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(dropzone, { key: 'Enter' });
    expect(clickSpy).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(dropzone, { key: ' ' });
    expect(clickSpy).toHaveBeenCalledTimes(3);

    clickSpy.mockRestore();
  });

  it('displays inline error when upload API call fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('Network error during upload'));
    const onUploadError = jest.fn();

    render(<Dropzone onUploadError={onUploadError} />);
    const dropzone = screen.getByRole('button', { name: /file upload dropzone/i });
    const validFile = new File(['valid content'], 'photo.jpg', { type: 'image/jpeg' });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [validFile],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error during upload');
    });

    expect(onUploadError).toHaveBeenCalledWith('Network error during upload');
  });
});
