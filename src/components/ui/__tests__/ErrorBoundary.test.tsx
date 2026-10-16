import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBoundary } from '../ErrorBoundary';
import { useFormPersist } from '@/hooks/useFormPersist';

const ProblemChild: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test component crashed');
  }
  return <div>Component working normally</div>;
};

const PersistentFormChild: React.FC<{ shouldThrow?: boolean }> = ({ shouldThrow }) => {
  const [form, setForm] = useFormPersist('test_eb_form', { text: '' });
  if (shouldThrow) {
    throw new Error('Form child crash');
  }
  return (
    <input
      aria-label="Test Input"
      value={form.text}
      onChange={(e) => setForm({ text: e.target.value })}
    />
  );
};

describe('ErrorBoundary Component', () => {
  // Prevent console.error clutter during intentionally thrown error tests
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    window.sessionStorage.clear();
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

  it('retains form state across error boundary reset and component remount', () => {
    let shouldThrow = false;
    const { rerender } = render(
      <ErrorBoundary>
        <PersistentFormChild shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    const input = screen.getByLabelText('Test Input');
    fireEvent.change(input, { target: { value: 'hello recovery' } });
    expect(input).toHaveValue('hello recovery');

    // Trigger error boundary
    shouldThrow = true;
    rerender(
      <ErrorBoundary>
        <PersistentFormChild shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Reset error boundary: update props first so children won't throw when remounted
    shouldThrow = false;
    rerender(
      <ErrorBoundary>
        <PersistentFormChild shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    const retryButton = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(retryButton);

    expect(screen.getByLabelText('Test Input')).toHaveValue('hello recovery');
  });
});

