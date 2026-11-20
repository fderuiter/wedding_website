import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminDashboardLayout from '../layout';
import { AdminNav } from '../AdminNav';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { getAppConfig } from '@/lib/config';

let mockPathname = '/admin/dashboard';

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: {},
  }),
}));

const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

describe('AdminDashboardLayout and AdminNav', () => {
  beforeEach(() => {
    mockPathname = '/admin/dashboard';
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
});
