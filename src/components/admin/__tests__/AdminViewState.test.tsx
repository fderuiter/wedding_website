import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AdminViewState } from '../AdminViewState';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

const CrashingChild: React.FC<{ shouldCrash?: boolean }> = ({ shouldCrash }) => {
  if (shouldCrash) {
    throw new Error('Crashing child exception');
  }
  return <div>Ready Child Content</div>;
};

describe('AdminViewState Component', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders children when not loading and no error exists', () => {
    render(
      <AdminViewState isLoading={false} error={null}>
        <div>Dashboard Child Content</div>
      </AdminViewState>
    );

    expect(screen.getByText('Dashboard Child Content')).toBeInTheDocument();
  });

  it('renders default skeleton and polite live region when loading', () => {
    render(
      <AdminViewState isLoading={true}>
        <div>Dashboard Child Content</div>
      </AdminViewState>
    );

    expect(screen.queryByText('Dashboard Child Content')).not.toBeInTheDocument();
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders custom loading skeleton when provided', () => {
    render(
      <AdminViewState
        isLoading={true}
        loadingSkeleton={<div data-testid="custom-skeleton">Custom Skeleton Loader</div>}
      >
        <div>Dashboard Child Content</div>
      </AdminViewState>
    );

    expect(screen.getByTestId('custom-skeleton')).toBeInTheDocument();
    expect(screen.getByText('Custom Skeleton Loader')).toBeInTheDocument();
  });

  it('renders standardized error card when error is provided', () => {
    const handleRetry = jest.fn();

    render(
      <AdminViewState
        isLoading={false}
        error={new Error('Database connection failed')}
        onRetry={handleRetry}
      >
        <div>Dashboard Child Content</div>
      </AdminViewState>
    );

    expect(screen.queryByText('Dashboard Child Content')).not.toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('Error: Database connection failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to dashboard/i })).toBeInTheDocument();
  });

  it('disables retry button while retry action is executing', async () => {
    let resolvePromise: () => void = () => {};
    const retryPromise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });
    const handleRetry = jest.fn().mockImplementation(() => retryPromise);

    render(
      <AdminViewState
        isLoading={false}
        error="Network timeout"
        onRetry={handleRetry}
      />
    );

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).not.toBeDisabled();

    fireEvent.click(retryBtn);

    expect(handleRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /retrying/i })).toBeDisabled();

    // Resolving retry promise re-enables or completes
    resolvePromise();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /retrying/i })).not.toBeInTheDocument();
    });
  });

  it('navigates to /admin/dashboard when Back to Dashboard is clicked', () => {
    render(
      <AdminViewState
        isLoading={false}
        error="Cannot load data"
      />
    );

    const dashboardBtn = screen.getByRole('button', { name: /back to dashboard/i });
    fireEvent.click(dashboardBtn);

    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('supports custom dashboard navigation callback and custom href', () => {
    const customNav = jest.fn();

    render(
      <AdminViewState
        isLoading={false}
        error="Server error"
        dashboardHref="/admin/dashboard/custom"
        dashboardLabel="Return to Overview"
        onNavigateDashboard={customNav}
      />
    );

    const returnBtn = screen.getByRole('button', { name: 'Return to Overview' });
    fireEvent.click(returnBtn);

    expect(customNav).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('catches unhandled rendering errors in child tree with ErrorBoundary', () => {
    const handleRetry = jest.fn();

    render(
      <AdminViewState
        onRetry={handleRetry}
        enableErrorBoundary={true}
      >
        <CrashingChild shouldCrash={true} />
      </AdminViewState>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Error: Crashing child exception')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);
    expect(handleRetry).toHaveBeenCalledTimes(1);

    const dashboardBtn = screen.getByRole('button', { name: /back to dashboard/i });
    fireEvent.click(dashboardBtn);
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });
});
