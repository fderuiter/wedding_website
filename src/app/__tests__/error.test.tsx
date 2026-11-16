import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import RootErrorBoundary from '../error';
import { ToastProvider } from '@/components/ui/ToastProvider';

describe('Root Error Boundary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders root error fallback with retry and return home navigation', () => {
    const mockReset = jest.fn();
    const testError = new Error('Root app failure');

    render(
      <ToastProvider>
        <RootErrorBoundary error={testError} reset={mockReset} />
      </ToastProvider>
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Something went wrong!' })).toBeInTheDocument();
    expect(screen.getAllByText(/unexpected error occurred while loading this page/i).length).toBeGreaterThanOrEqual(1);

    const retryBtn = screen.getByRole('button', { name: 'Try Again' });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockReset).toHaveBeenCalledTimes(1);

    const homeLink = screen.getByRole('link', { name: 'Return Home' });
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '/');
  });
});
