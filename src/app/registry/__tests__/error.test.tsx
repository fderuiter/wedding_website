import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import RegistryError from '../error';
import { ToastProvider } from '@/components/ui/ToastProvider';

describe('RegistryError Boundary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders registry error boundary with retry and return home actions', () => {
    const mockReset = jest.fn();
    const testError = new Error('Registry failed to fetch items');

    render(
      <ToastProvider>
        <RegistryError error={testError} reset={mockReset} />
      </ToastProvider>
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Registry Error' })).toBeInTheDocument();
    expect(screen.getAllByText(/loading the wedding registry/i).length).toBeGreaterThanOrEqual(1);

    const retryBtn = screen.getByRole('button', { name: 'Try Again' });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockReset).toHaveBeenCalledTimes(1);

    const homeLink = screen.getByRole('link', { name: 'Return Home' });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });
});
