import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminError from '../error';
import { ToastProvider } from '@/components/ui/ToastProvider';

describe('AdminError Boundary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders admin root error boundary with alert role, retry, and dashboard overview link', () => {
    const mockReset = jest.fn();
    const testError = new Error('Admin route failed to load');

    render(
      <ToastProvider>
        <AdminError error={testError} reset={mockReset} />
      </ToastProvider>
    );

    const alerts = screen.getAllByRole('alert');
    expect(alerts.some((el) => el.getAttribute('aria-live') === 'assertive')).toBe(true);

    expect(screen.getByRole('heading', { level: 2, name: 'Admin Portal Error' })).toBeInTheDocument();
    expect(screen.getAllByText(/unexpected error occurred while loading this administrative view/i).length).toBeGreaterThanOrEqual(1);

    const retryBtn = screen.getByRole('button', { name: 'Try Again' });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockReset).toHaveBeenCalledTimes(1);

    const dashboardLink = screen.getByRole('link', { name: 'Dashboard Overview' });
    expect(dashboardLink).toBeInTheDocument();
    expect(dashboardLink).toHaveAttribute('href', '/admin/dashboard');
  });

  it('renders safely when ToastProvider context is missing', () => {
    const mockReset = jest.fn();
    const testError = new Error('Missing toast context');

    expect(() => {
      render(<AdminError error={testError} reset={mockReset} />);
    }).not.toThrow();

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveAttribute('aria-live', 'assertive');
  });
});
