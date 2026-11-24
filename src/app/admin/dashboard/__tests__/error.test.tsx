import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminDashboardError from '../error';
import AdminDashboardLayout from '../layout';
import { ToastProvider } from '@/components/ui/ToastProvider';

jest.mock('next/navigation', () => ({
  usePathname: () => '/admin/dashboard',
  useRouter: () => ({ push: jest.fn() }),
  redirect: jest.fn(),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: {},
  }),
}));

describe('AdminDashboardError Boundary', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('renders scoped error fallback with contextual admin guidance and retry control', () => {
    const mockReset = jest.fn();
    const testError = new Error('Admin view failed to load');

    render(
      <ToastProvider>
        <AdminDashboardError error={testError} reset={mockReset} />
      </ToastProvider>
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Admin Dashboard Error' })).toBeInTheDocument();
    expect(screen.getAllByText(/unexpected error occurred while loading this administrative view/i).length).toBeGreaterThanOrEqual(1);

    const retryBtn = screen.getByRole('button', { name: 'Try Again' });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(mockReset).toHaveBeenCalledTimes(1);

    const secondaryLink = screen.getByRole('link', { name: 'Dashboard Overview' });
    expect(secondaryLink).toBeInTheDocument();
    expect(secondaryLink).toHaveAttribute('href', '/admin/dashboard');
  });

  it('preserves admin layout shell and navigation when error boundary is rendered inside layout', async () => {
    const mockReset = jest.fn();
    const testError = new Error('Sub-route crash');

    const layoutElement = await AdminDashboardLayout({
      children: <AdminDashboardError error={testError} reset={mockReset} />,
    });

    render(<ToastProvider>{layoutElement}</ToastProvider>);

    // Header landmark and shell label are preserved without duplicating h1
    expect(screen.getByText('Admin Control Panel')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin Control Panel' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Admin Navigation' })).toBeInTheDocument();

    // Main section renders the localized error boundary inside MainLandmark as the single page h1
    const mainElement = screen.getByRole('main', { name: 'Admin Dashboard Content' });
    expect(mainElement).toBeInTheDocument();
    expect(mainElement).toHaveAttribute('id', 'main-content');
    expect(mainElement).toHaveAttribute('tabindex', '-1');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Admin Dashboard Error' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dashboard Overview' })).toBeInTheDocument();
  });
});
