import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import Dropzone from '../Dropzone';
import { apiClient } from '@/lib/apiClient';

expect.extend(toHaveNoViolations);

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

describe('Dropzone Component', () => {
  const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
  const defaultPrompt = /Drag and drop an image file here, or click to browse/i;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders default labels and hint text linked via aria-labelledby and aria-describedby and passes jest-axe', async () => {
    const { container } = render(<Dropzone />);

    expect(
      screen.getByText('Drag and drop an image file here, or click to browse')
    ).toBeInTheDocument();
    const hint = screen.getByText('Supports JPG, PNG, and ICO files up to 5MB');
    expect(hint).toBeInTheDocument();
    const dropzone = screen.getByRole('button', { name: defaultPrompt });
    expect(dropzone.contains(hint)).toBe(false);
    expect(hint.parentElement).toHaveClass('pointer-events-none');
    expect(dropzone).toHaveAccessibleDescription('Supports JPG, PNG, and ICO files up to 5MB');
    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();
  });

  it('forwards ref and applies custom className', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(<Dropzone ref={ref} className="custom-dropzone-class" />);

    expect(ref.current).toBeInstanceOf(HTMLDivElement);
    expect(ref.current).toHaveClass('custom-dropzone-class');
  });

  it('handles drag over, drag leave, and visual state updates', () => {
    render(<Dropzone />);
    const dropzone = screen.getByRole('button', { name: defaultPrompt });

    fireEvent.dragOver(dropzone);
    expect(dropzone).toHaveClass('border-rose-500');

    fireEvent.dragLeave(dropzone);
    expect(dropzone).not.toHaveClass('border-rose-500');
  });

  it('shows inline error message when dropped file exceeds size limit (5MB)', async () => {
    const onUploadError = jest.fn();
    const { container } = render(<Dropzone onUploadError={onUploadError} />);

    const dropzone = screen.getByRole('button', { name: defaultPrompt });
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

    expect(dropzone).toHaveAccessibleDescription(
      'Supports JPG, PNG, and ICO files up to 5MB File size exceeds 5MB limit'
    );
    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();
    expect(onUploadError).toHaveBeenCalledWith('File size exceeds 5MB limit');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('shows inline error message when dropped file format is unsupported', async () => {
    const onUploadError = jest.fn();
    render(<Dropzone onUploadError={onUploadError} />);

    const dropzone = screen.getByRole('button', { name: defaultPrompt });
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

  it('updates programmatic accessible name to Uploading image... during upload and triggers onUploadSuccess', async () => {
    const onUploadSuccess = jest.fn();
    let resolveUpload!: (value: { url: string }) => void;
    mockPost.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        })
    );

    const { container } = render(<Dropzone onUploadSuccess={onUploadSuccess} />);
    const dropzone = screen.getByRole('button', { name: defaultPrompt });
    const validFile = new File(['valid content'], 'photo.png', { type: 'image/png' });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [validFile],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Uploading image...' })).toBeInTheDocument();
    });
    expect(
      screen.queryByText('Supports JPG, PNG, and ICO files up to 5MB')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Uploading image...' })).not.toHaveAttribute(
      'aria-describedby'
    );
    expect(
      await axe(container, { rules: { 'label-content-name-mismatch': { enabled: true } } })
    ).toHaveNoViolations();

    resolveUpload({ url: '/uploads/sample.png' });

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/admin/upload', expect.any(FormData));
      expect(onUploadSuccess).toHaveBeenCalledWith('/uploads/sample.png', validFile);
    });

    expect(screen.getByRole('button', { name: defaultPrompt })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('triggers file selection dialog when clicked or Enter key pressed', async () => {
    render(<Dropzone />);
    const dropzone = screen.getByRole('button', { name: defaultPrompt });
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
    const dropzone = screen.getByRole('button', { name: defaultPrompt });
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

  it('exposes shared UploadAlert semantics and sibling file input and passes jest-axe in resting and error states', async () => {
    const { container } = render(<Dropzone />);
    const axeRules = { rules: { 'label-content-name-mismatch': { enabled: true } } };
    expect(await axe(container, axeRules)).toHaveNoViolations();

    const dropzone = screen.getByRole('button', { name: defaultPrompt });
    const fileInput = screen.getByTestId('dropzone-file-input');
    expect(dropzone.contains(fileInput)).toBe(false);

    const invalidFile = new File(['dummy content'], 'document.pdf', {
      type: 'application/pdf',
    });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [invalidFile],
      },
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveClass('text-[var(--color-error-text,#dc2626)]');
    });
    expect(await axe(container, axeRules)).toHaveNoViolations();
  });
});
