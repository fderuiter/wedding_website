import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBoundary } from '../ErrorBoundary';

const ProblemChild: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test component crashed');
  }
  return <div>Component working normally</div>;
};

describe('ErrorBoundary Component', () => {
  // Prevent console.error clutter during intentionally thrown error tests
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Component working normally')).toBeInTheDocument();
  });

  it('catches thrown error and renders default fallback UI with retry button', () => {
    render(
      <ErrorBoundary title="Widget Error" message="Failed to load feature widget.">
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Widget Error')).toBeInTheDocument();
    expect(screen.getByText('Failed to load feature widget.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('calls onReset when retry button is clicked', () => {
    const handleReset = jest.fn();

    render(
      <ErrorBoundary onReset={handleReset}>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    const retryButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryButton);

    expect(handleReset).toHaveBeenCalledTimes(1);
  });

  it('renders custom fallback element when provided as ReactNode', () => {
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom Fallback UI</div>}>
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.getByText('Custom Fallback UI')).toBeInTheDocument();
  });

  it('renders custom fallback function with error and reset handler', () => {
    render(
      <ErrorBoundary
        fallback={(error, reset) => (
          <div>
            <p>Custom Error: {error.message}</p>
            <button onClick={reset}>Custom Reset</button>
          </div>
        )}
      >
        <ProblemChild shouldThrow={true} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom Error: Test component crashed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /custom reset/i })).toBeInTheDocument();
  });
});
