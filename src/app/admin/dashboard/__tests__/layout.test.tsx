import { render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe } from 'jest-axe';
import AdminDashboardLayout from '../layout';
import { AdminNav } from '../AdminNav';
import RootLayoutClient from '@/components/layout/RootLayoutClient';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { a11yConfig } from '@/a11y-config';
import { getAppConfig, type PublicAppConfig } from '@/lib/config';

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

  it('renders a semantic <main> landmark element with id="main-content" and tabIndex="-1" in layout', async () => {
    const layoutElement = await AdminDashboardLayout({
      children: <div data-testid="test-child">Admin Content</div>,
    });

    render(<ToastProvider>{layoutElement}</ToastProvider>);

    const mainElement = screen.getByRole('main', { name: 'Admin Dashboard Content' });
    expect(mainElement).toBeInTheDocument();
    expect(mainElement).toHaveAttribute('id', 'main-content');
    expect(mainElement).toHaveAttribute('tabindex', '-1');
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

  it('composes with RootLayoutClient to expose one top-level main#main-content after Navbar, AdminNav, and SampleDataBanner with zero axe violations', async () => {
    mockPathname = '/admin/dashboard';
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        hasSampleData: true,
        counts: { guests: 5, weddingParty: 3, faqs: 4 },
      }),
    }) as jest.Mock;

    try {
      const publicConfig = {
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        brideName: 'Alex',
        groomName: 'Taylor',
        weddingDate: new Date('2026-10-18T16:00:00Z'),
        venueName: 'Grand Conservatory',
        venueAddress: '100 Main St',
        venueCity: 'Chicago',
        venueState: 'IL',
        venueZip: '60601',
        latitude: 41.8781,
        longitude: -87.6298,
        storyText: 'Our story',
        venueDescription: 'Venue details',
        travelAdvice: 'Travel advice',
        heroTitle: 'Alex & Taylor',
        heroSubtitle: 'Celebrate with us',
        seoTitle: 'Alex & Taylor Wedding',
        seoDescription: 'Wedding details',
        showCountdown: true,
        showAddToCalendar: true,
        rsvpOpen: true,
        isRsvpOpen: true,
        baseUrl: 'https://alexandtaylor.example',
        timezone: 'America/Chicago',
        modules: {},
        features: [],
      } as unknown as PublicAppConfig;

      const layoutElement = await AdminDashboardLayout({
        children: (
          <section aria-labelledby="dashboard-overview-heading">
            <h2 id="dashboard-overview-heading">Overview Metrics</h2>
            <p>Active RSVPs</p>
          </section>
        ),
      });

      const { container } = render(
        <ThemeProvider config={publicConfig}>
          <ToastProvider>
            <RootLayoutClient config={publicConfig}>
              {layoutElement}
            </RootLayoutClient>
          </ToastProvider>
        </ThemeProvider>
      );

      await waitFor(() => {
        expect(screen.getByRole('region', { name: 'Sample Data Notification' })).toBeInTheDocument();
      });

      const mains = screen.getAllByRole('main');
      expect(mains).toHaveLength(1);
      const mainElement = mains[0]!;
      expect(mainElement).toHaveAttribute('id', 'main-content');
      expect(mainElement).toHaveAttribute('tabindex', '-1');
      expect(container.querySelectorAll('main main')).toHaveLength(0);

      const banners = screen.getAllByRole('banner');
      expect(banners).toHaveLength(1);
      expect(banners[0]).toHaveAttribute('aria-label', 'Site header');

      const adminRegion = screen.getByRole('region', { name: 'Admin Dashboard' });
      const adminNav = screen.getByRole('navigation', { name: 'Admin Navigation' });
      const sampleBanner = screen.getByRole('region', { name: 'Sample Data Notification' });

      expect(
        banners[0]!.compareDocumentPosition(mainElement) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        adminRegion.compareDocumentPosition(mainElement) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        adminNav.compareDocumentPosition(mainElement) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        sampleBanner.compareDocumentPosition(mainElement) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();

      const axeResults = await axe(container, a11yConfig);
      expect(axeResults).toHaveNoViolations();
    } finally {
      global.fetch = originalFetch;
    }
  });
});
