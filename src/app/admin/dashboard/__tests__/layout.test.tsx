import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminDashboardLayout from '../layout';
import { AdminNav } from '../AdminNav';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';

let mockPathname = '/admin/dashboard';
const mockRedirect = jest.fn((url: string) => {
  const error = new Error('NEXT_REDIRECT') as Error & { digest?: string };
  error.digest = `NEXT_REDIRECT;replace;${url};307;`;
  throw error;
});

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn() }),
  redirect: (url: string) => mockRedirect(url),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: {},
  }),
}));

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

describe('AdminDashboardLayout and AdminNav', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/admin/dashboard';
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue({
      modules: {},
    } as unknown as Awaited<ReturnType<typeof getAppConfig>>);
  });

  const sampleItems = [
    { href: '/admin/dashboard', label: 'Overview' },
    { href: '/admin/dashboard/registry', label: 'Registry' },
    { href: '/admin/dashboard/invitation-codes', label: 'Invitation Codes' },
    { href: '/admin/dashboard/settings', label: 'Settings' },
  ];

  it('sets aria-current="page" on the active link for exact root path', () => {
    mockPathname = '/admin/dashboard';
    render(<AdminNav items={sampleItems} />);

    const overviewLink = screen.getByRole('link', { name: 'Overview' });
    const registryLink = screen.getByRole('link', { name: 'Registry' });
    const invitationLink = screen.getByRole('link', { name: 'Invitation Codes' });
    const settingsLink = screen.getByRole('link', { name: 'Settings' });

    expect(overviewLink).toHaveAttribute('aria-current', 'page');
    expect(registryLink).not.toHaveAttribute('aria-current');
    expect(invitationLink).not.toHaveAttribute('aria-current');
    expect(settingsLink).not.toHaveAttribute('aria-current');
  });

  it('sets aria-current="page" on sub-route link and not on root path', () => {
    mockPathname = '/admin/dashboard/invitation-codes';
    render(<AdminNav items={sampleItems} />);

    const overviewLink = screen.getByRole('link', { name: 'Overview' });
    const invitationLink = screen.getByRole('link', { name: 'Invitation Codes' });
    const settingsLink = screen.getByRole('link', { name: 'Settings' });

    expect(overviewLink).not.toHaveAttribute('aria-current');
    expect(invitationLink).toHaveAttribute('aria-current', 'page');
    expect(settingsLink).not.toHaveAttribute('aria-current');
  });

  it('renders a semantic <main> landmark element in layout', async () => {
    const layoutElement = await AdminDashboardLayout({
      children: <div data-testid="test-child">Admin Content</div>,
    });

    render(<ToastProvider>{layoutElement}</ToastProvider>);

    const mainElement = screen.getByRole('main');
    expect(mainElement).toBeInTheDocument();
    expect(mainElement).toHaveTextContent('Admin Content');
  });

  it('renders admin navigation with banner header in layout', async () => {
    const layoutElement = await AdminDashboardLayout({
      children: <div>Content</div>,
    });

    render(<ToastProvider>{layoutElement}</ToastProvider>);

    const navElement = screen.getByRole('navigation', { name: 'Admin Navigation' });
    expect(navElement).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view live site/i })).toHaveAttribute('href', '/');
    expect(within(navElement).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'href',
      '/admin/dashboard'
    );
    expect(within(navElement).getByRole('link', { name: 'Registry' })).toHaveAttribute(
      'href',
      '/admin/dashboard/registry'
    );
  });

  it('keeps Overview and Invitation Codes visible when registry module is disabled while hiding Registry and Thank-You Notes', async () => {
    mockGetAppConfig.mockResolvedValueOnce({
      modules: { registry: false },
    } as unknown as Awaited<ReturnType<typeof getAppConfig>>);

    const layoutElement = await AdminDashboardLayout({
      children: <div>Overview Content</div>,
    });

    render(<ToastProvider>{layoutElement}</ToastProvider>);

    const navElement = screen.getByRole('navigation', { name: 'Admin Navigation' });
    expect(within(navElement).getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(within(navElement).getByRole('link', { name: 'Invitation Codes' })).toBeInTheDocument();
    expect(within(navElement).queryByRole('link', { name: 'Registry' })).not.toBeInTheDocument();
    expect(within(navElement).queryByRole('link', { name: 'Thank-You Notes' })).not.toBeInTheDocument();
  });

  it('redirects unauthenticated callers to /admin/login with HTTP 303 without Edge middleware', async () => {
    mockIsAdminRequest.mockResolvedValueOnce(false);

    let caughtError: (Error & { digest?: string }) | null = null;
    try {
      await AdminDashboardLayout({ children: <div>Secret</div> });
    } catch (err) {
      caughtError = err as Error & { digest?: string };
    }

    expect(mockRedirect).toHaveBeenCalledWith('/admin/login');
    expect(caughtError?.digest).toBe('NEXT_REDIRECT;replace;/admin/login;303;');
  });

  it('keeps SSR admin guard inert during STATIC_EXPORT builds', async () => {
    const prevStaticExport = process.env.STATIC_EXPORT;
    process.env.STATIC_EXPORT = 'true';
    mockIsAdminRequest.mockResolvedValue(false);

    try {
      const layoutElement = await AdminDashboardLayout({
        children: <div>Static Demo Content</div>,
      });
      render(<ToastProvider>{layoutElement}</ToastProvider>);
      expect(screen.getByRole('main')).toHaveTextContent('Static Demo Content');
      expect(mockRedirect).not.toHaveBeenCalled();
    } finally {
      if (prevStaticExport === undefined) {
        delete process.env.STATIC_EXPORT;
      } else {
        process.env.STATIC_EXPORT = prevStaticExport;
      }
    }
  });
});
