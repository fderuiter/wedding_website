import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { RouteErrorFallback } from '../RouteErrorFallback';
import { ToastProvider, useToast } from '../ToastProvider';

// Helper component to spy on toast calls
const ToastCapture = ({ onCapture }: { onCapture: (toasts: unknown[]) => void }) => {
  const { toasts } = useToast();
  React.useEffect(() => {
    onCapture(toasts);
  }, [toasts, onCapture]);
  return null;
};

describe('RouteErrorFallback Component', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders default error fallback UI with accessibility attributes and retry button', () => {
    const mockReset = jest.fn();
    const testError = new Error('Test crash');

    render(<RouteErrorFallback error={testError} reset={mockReset} />);

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute('aria-live', 'assertive');

    expect(screen.getByRole('heading', { level: 2, name: /something went wrong!/i })).toBeInTheDocument();
    expect(screen.getByText(/an unexpected error occurred while loading this page/i)).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: /try again/i });
    expect(retryButton).toBeInTheDocument();

    fireEvent.click(retryButton);
    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('renders custom title, message, and reset label', () => {
    const mockReset = jest.fn();
    const testError = new Error('Custom error');

    render(
      <RouteErrorFallback
        error={testError}
        reset={mockReset}
        title="Custom Header"
        message="A custom error explanation."
        resetLabel="Retry Action"
      />
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Custom Header' })).toBeInTheDocument();
    expect(screen.getByText('A custom error explanation.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Action' })).toBeInTheDocument();
  });

  it('renders secondary navigation link when href is supplied in secondaryAction', () => {
    const mockReset = jest.fn();
    const mockClick = jest.fn();
    const testError = new Error('Link test');

    render(
      <RouteErrorFallback
        error={testError}
        reset={mockReset}
        secondaryAction={{
          label: 'Return Home',
          href: '/',
          onClick: mockClick,
        }}
      />
    );

    const link = screen.getByRole('link', { name: 'Return Home' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');

    fireEvent.click(link);
    expect(mockClick).toHaveBeenCalledTimes(1);
  });

  it('renders secondary button when onClick is provided without href', () => {
    const mockReset = jest.fn();
    const handleSecondary = jest.fn();
    const testError = new Error('Button test');

    render(
      <RouteErrorFallback
        error={testError}
        reset={mockReset}
        secondaryAction={{
          label: 'Alternate Option',
          onClick: handleSecondary,
        }}
      />
    );

    const secondaryBtn = screen.getByRole('button', { name: 'Alternate Option' });
    expect(secondaryBtn).toBeInTheDocument();

    fireEvent.click(secondaryBtn);
    expect(handleSecondary).toHaveBeenCalledTimes(1);
  });

  it('dispatches an error toast notification when rendered within ToastProvider', () => {
    const mockReset = jest.fn();
    const testError = new Error('Toast test error');
    const capturedToasts: unknown[] = [];

    render(
      <ToastProvider>
        <ToastCapture onCapture={(toasts) => capturedToasts.push(...toasts)} />
        <RouteErrorFallback
          error={testError}
          reset={mockReset}
          toastMessage="Route crashed unexpectedly"
        />
      </ToastProvider>
    );

    const alerts = screen.getAllByRole('alert');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(capturedToasts.some((t: any) => t.type === 'error' && t.message === 'Route crashed unexpectedly')).toBe(true);
    expect(screen.getByText('Route crashed unexpectedly')).toBeInTheDocument();
  });

  it('gracefully renders without crashing when rendered outside of ToastProvider', () => {
    const mockReset = jest.fn();
    const testError = new Error('No toast provider error');

    expect(() => {
      render(<RouteErrorFallback error={testError} reset={mockReset} />);
    }).not.toThrow();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
