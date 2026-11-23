import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhotosError from '../error';
import { ToastProvider } from '@/components/ui/ToastProvider';

describe('PhotosError Boundary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders photo gallery error boundary with retry and return home actions', () => {
    const mockReset = jest.fn();
    const testError = new Error('Photo album network failure');

    render(
      <ToastProvider>
        <PhotosError error={testError} reset={mockReset} />
      </ToastProvider>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Photo Gallery Error' })).toBeInTheDocument();
    expect(screen.getAllByText(/loading the photo gallery/i).length).toBeGreaterThanOrEqual(1);

    const retryBtn = screen.getByRole('button', { name: 'Try Again' });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockReset).toHaveBeenCalledTimes(1);

    const homeLink = screen.getByRole('link', { name: 'Return Home' });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });
});
