import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import GuestError from '../error';
import { ToastProvider } from '@/components/ui/ToastProvider';

describe('GuestError Boundary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders guest portal error boundary with retry and return home actions', () => {
    const mockReset = jest.fn();
    const testError = new Error('Guest form failed');

    render(
      <ToastProvider>
        <GuestError error={testError} reset={mockReset} />
      </ToastProvider>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Guest Portal Error' })).toBeInTheDocument();
    expect(screen.getAllByText(/loading the guest mailing address portal/i).length).toBeGreaterThanOrEqual(1);

    const retryBtn = screen.getByRole('button', { name: 'Try Again' });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockReset).toHaveBeenCalledTimes(1);

    const homeLink = screen.getByRole('link', { name: 'Return Home' });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });
});
