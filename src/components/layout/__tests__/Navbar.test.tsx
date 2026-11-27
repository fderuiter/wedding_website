import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import Navbar from '../Navbar';
import React from 'react';

let currentPathname = '/';

jest.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

jest.mock('../../ui/ThemeSelector', () => ({
  ThemeSelector: () => <div data-testid="theme-selector">ThemeSelector</div>,
}));

const mockConfig = {
  id: 'global',
  brideName: 'Alice',
  groomName: 'Bob',
  partner1Name: 'Alice',
  partner2Name: 'Bob',
  weddingDate: '2026-06-20',
  baseUrl: 'http://localhost:3000',
  modules: {},
  features: [
    { id: 'story', type: 'story', title: 'Our Story', visible: true },
    { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
    { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
    { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
    { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
  ],
} as any;

describe('Navbar Component Brand Rendering', () => {
  const baseConfig: any = {
    id: 'global',
    partner1Name: 'Alice',
    partner2Name: 'Bob',
    baseUrl: 'https://example.com',
    modules: {},
    features: [],
  };

  const defaultProps = {
    isAdmin: false,
    handleLogout: jest.fn(),
    headerRef: React.createRef<HTMLElement>(),
  };

  it('renders computed monogram derived from partner names when no custom logo is set', () => {
    render(<Navbar {...defaultProps} config={{ ...baseConfig, partner1Name: 'Alice', partner2Name: 'Bob' }} />);

    expect(screen.getByText('A & B')).toBeInTheDocument();
  });

  it('renders explicit brandMonogram when provided', () => {
    render(<Navbar {...defaultProps} config={{ ...baseConfig, brandMonogram: 'C & D' }} />);

    expect(screen.getByText('C & D')).toBeInTheDocument();
  });

  it('renders custom brand logo image when brandLogoUrl is provided', () => {
    render(
      <Navbar
        {...defaultProps}
        config={{
          ...baseConfig,
          brandLogoUrl: '/images/tenant-logo.png',
          brandLogoAlt: 'Custom Brand Logo',
        }}
      />
    );

    const logoImg = screen.getByRole('img', { name: 'Custom Brand Logo' });
    expect(logoImg).toBeInTheDocument();
    expect(logoImg).toHaveAttribute('src', '/images/tenant-logo.png');
    expect(screen.queryByText('A & B')).not.toBeInTheDocument();
  });

  it('renders neutral Wedding Website label without fallback monogram when partner names and brandMonogram are redacted', () => {
    render(
      <Navbar
        {...defaultProps}
        config={{
          ...baseConfig,
          partner1Name: '',
          partner2Name: '',
          brideName: '',
          groomName: '',
          brandMonogram: '',
        }}
      />
    );

    expect(screen.getByText('Wedding Website')).toBeInTheDocument();
    expect(screen.queryByText('A & F')).not.toBeInTheDocument();
  });
});

describe('Navbar Component - Active aria-current Accessibility & Theme Tokens', () => {
  let headerRef: React.RefObject<HTMLElement | null>;

  beforeEach(() => {
    currentPathname = '/';
    window.location.hash = '';
    headerRef = React.createRef();
  });

  it('renders brand logo and nav links using dynamic CSS variable tokens', () => {
    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const brandLink = screen.getByText('A & B');
    expect(brandLink.closest('a')).toHaveClass('text-[var(--color-primary-text)]');
    expect(brandLink.closest('a')).toHaveClass('min-h-[24px]');
    expect(brandLink.closest('a')).toHaveClass('min-w-[24px]');
    expect(brandLink).toHaveClass('min-h-[24px]');
    expect(brandLink).toHaveClass('min-w-[24px]');
    expect(brandLink.closest('a')).not.toHaveClass('text-gray-800');
    expect(brandLink.closest('a')).not.toHaveClass('dark:text-white');
  });

  it('renders admin mode controls without hardcoded text-white and text-gray-700 classes', () => {
    render(
      <Navbar
        isAdmin={true}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const adminSpan = screen.getByText('Admin Mode');
    expect(adminSpan).toHaveClass('text-[var(--color-primary-text)]');
    expect(adminSpan).not.toHaveClass('text-gray-700');

    const logoutBtn = screen.getByRole('button', { name: /logout/i });
    expect(logoutBtn).toHaveClass('text-[var(--btn-primary-text,var(--color-primary-text,#ffffff))]');
    expect(logoutBtn).toHaveClass('min-h-[24px]');
    expect(logoutBtn).toHaveClass('min-w-[24px]');
    expect(logoutBtn).not.toHaveClass('text-white');
  });

  it('sets aria-current="page" on Home link when at root pathname without hash', () => {
    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const homeLink = screen.getByRole('link', { name: 'Home' });
    fireEvent.click(screen.getByRole('button', { name: /event guide/i }));
    const detailsLink = screen.getByRole('menuitem', { name: 'Wedding Day Details' });

    expect(homeLink).toHaveAttribute('aria-current', 'page');
    expect(detailsLink).not.toHaveAttribute('aria-current');
  });

  it('sets aria-current="location" on section link when hash matches section id and passes axe', async () => {
    window.location.hash = '#details';

    const { container } = render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const homeLink = screen.getByRole('link', { name: 'Home' });
    fireEvent.click(screen.getByRole('button', { name: /event guide/i }));
    const detailsLink = screen.getByRole('menuitem', { name: 'Wedding Day Details' });

    expect(homeLink).not.toHaveAttribute('aria-current');
    expect(detailsLink).toHaveAttribute('aria-current', 'location');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('updates aria-current="location" on section link when clicked', () => {
    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const homeLink = screen.getByRole('link', { name: 'Home' });
    const guideTrigger = screen.getByRole('button', { name: /event guide/i });
    fireEvent.click(guideTrigger);
    const detailsLink = screen.getByRole('menuitem', { name: 'Wedding Day Details' });

    expect(homeLink).toHaveAttribute('aria-current', 'page');
    expect(detailsLink).not.toHaveAttribute('aria-current');

    act(() => {
      fireEvent.click(detailsLink);
    });

    expect(homeLink).not.toHaveAttribute('aria-current');

    // Re-open menu to verify updated aria-current on section item
    fireEvent.click(guideTrigger);
    expect(screen.getByRole('menuitem', { name: 'Wedding Day Details' })).toHaveAttribute(
      'aria-current',
      'location'
    );
  });

  it('sets aria-current="page" on matching route link on non-home pages', () => {
    currentPathname = '/registry';

    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const registryLink = screen.getByRole('link', { name: 'Registry' });
    const homeLink = screen.getByRole('link', { name: 'Home' });

    expect(registryLink).toHaveAttribute('aria-current', 'page');
    expect(homeLink).not.toHaveAttribute('aria-current');
  });

  it('keeps top-level links consistent across / and subpages, closes menu on route transitions, and omits /archive and /admin/login', () => {
    currentPathname = '/';
    const { rerender } = render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const desktopNav = screen.getByRole('navigation', { name: 'Global Navigation' });
    const homeTopLevelLabels = within(desktopNav)
      .getAllByRole('link')
      .map((el) => el.textContent);
    expect(homeTopLevelLabels).toEqual(['Home', 'Guest Portal', 'Registry', 'Photos']);
    expect(within(desktopNav).getByRole('button', { name: /event guide/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /archive/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^admin$/i })).not.toBeInTheDocument();

    // Open Event Guide and simulate a pathname transition
    fireEvent.click(within(desktopNav).getByRole('button', { name: /event guide/i }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    currentPathname = '/photos';
    rerender(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const subpageTopLevelLabels = within(desktopNav)
      .getAllByRole('link')
      .map((el) => el.textContent);
    expect(subpageTopLevelLabels).toEqual(['Home', 'Guest Portal', 'Registry', 'Photos']);

    // Event Guide still provides homepage section links and guide pages on subpages
    fireEvent.click(within(desktopNav).getByRole('button', { name: /event guide/i }));
    expect(screen.getByRole('menuitem', { name: 'Wedding Day Details' })).toHaveAttribute(
      'href',
      '/#details'
    );
    expect(screen.getByRole('menuitem', { name: 'Things to Do' })).toHaveAttribute(
      'href',
      '/things-to-do'
    );
  });

  it('deduplicates /#travel when /things-to-do is enabled and falls back to /#travel when attractions is disabled', () => {
    const { unmount } = render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /event guide/i }));
    expect(screen.getByRole('menuitem', { name: 'Things to Do' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Travel & Things to Do' })).not.toBeInTheDocument();

    unmount();

    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={{
          ...mockConfig,
          modules: { attractions: false },
          features: [
            ...mockConfig.features,
            { id: 'travel', type: 'travel', title: 'Duplicate Travel', visible: true },
          ],
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /event guide/i }));
    expect(screen.queryByRole('menuitem', { name: 'Things to Do' })).not.toBeInTheDocument();
    const travelItems = screen.getAllByRole('menuitem', { name: /travel/i });
    expect(travelItems).toHaveLength(1);
    expect(travelItems[0]).toHaveAttribute('href', '/#travel');
  });

  it('supports keyboard navigation (ArrowDown, ArrowUp, Home, End) and Escape focus restoration on the grouped Event Guide menu and passes axe', async () => {
    const { container } = render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const guideTrigger = screen.getByRole('button', { name: /event guide/i });
    guideTrigger.focus();

    fireEvent.keyDown(guideTrigger, { key: 'ArrowDown' });
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBeGreaterThan(2);
    expect(menuItems[0]).toHaveFocus();

    fireEvent.keyDown(menuItems[0], { key: 'ArrowDown' });
    expect(menuItems[1]).toHaveFocus();

    fireEvent.keyDown(menuItems[1], { key: 'End' });
    expect(menuItems[menuItems.length - 1]).toHaveFocus();

    fireEvent.keyDown(menuItems[menuItems.length - 1], { key: 'Home' });
    expect(menuItems[0]).toHaveFocus();

    fireEvent.keyDown(menuItems[0], { key: 'ArrowUp' });
    expect(menuItems[menuItems.length - 1]).toHaveFocus();

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(guideTrigger).toHaveFocus();

    // Pressing ArrowUp on the closed trigger opens the menu and focuses the last menuitem
    fireEvent.keyDown(guideTrigger, { key: 'ArrowUp' });
    const reopenedItems = screen.getAllByRole('menuitem');
    expect(reopenedItems[reopenedItems.length - 1]).toHaveFocus();
  });

  it('exposes labeled modal dialog, internal close button in focus order, aria-current="location" on hash links, and toggle click dismissal on #mobile-menu', async () => {
    window.location.hash = '#accommodations';

    const { container } = render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const toggleButton = screen.getByRole('button', { name: /open main menu/i });
    toggleButton.focus();
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');

    const mobileOverlay = document.getElementById('mobile-menu')!;
    expect(mobileOverlay).toHaveClass('bottom-0');
    expect(mobileOverlay).toHaveAttribute('role', 'dialog');
    expect(mobileOverlay).toHaveAttribute('aria-modal', 'true');
    expect(mobileOverlay).toHaveAttribute('aria-label', 'Mobile navigation menu');

    // Internal close button is first in dialog focus order
    const internalCloseButton = within(mobileOverlay).getByRole('button', {
      name: 'Close navigation menu',
    });
    expect(internalCloseButton).toHaveFocus();

    const mobileNav = screen.getByRole('navigation', { name: 'Mobile Navigation' });
    const mobilePanel = mobileNav.parentElement;
    expect(mobilePanel).toHaveClass('overflow-y-auto');
    expect(mobilePanel).toHaveClass('max-h-full');
    expect(mobilePanel).toHaveClass('overscroll-contain');
    const accommodationsMobileLink = within(mobileNav).getByRole('link', {
      name: 'Accommodations',
    });
    expect(accommodationsMobileLink).toHaveAttribute('aria-current', 'location');

    expect(await axe(container)).toHaveNoViolations();

    // Clicking the internal close button closes the dialog and restores focus to toggleButton
    fireEvent.click(internalCloseButton);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    expect(toggleButton).toHaveFocus();

    // Reopen and click the external toggle button (mousedown + mouseup + click) -> closes cleanly on first click
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Mobile navigation menu' })).toBeInTheDocument();

    fireEvent.mouseDown(toggleButton);
    fireEvent.mouseUp(toggleButton);
    fireEvent.click(toggleButton);

    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('renders persistent Help button in navigation bar, opens contextual dietary help on schedule view, and restores focus on Escape', async () => {
    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={{ ...mockConfig, contactEmail: 'hosts@example.com' }}
      />
    );

    const helpButton = screen.getByRole('button', { name: /^Help$/i });
    helpButton.focus();
    fireEvent.click(helpButton);

    const dialog = screen.getByRole('dialog', { name: /Guest Help & Support/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText(/Event RSVPs & Severe Allergy Notes/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /hosts@example\.com/i })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(helpButton);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('displays Switch Household action when /api/guest/session reports invitation status and calls DELETE on click', async () => {
    const originalFetch = global.fetch;
    let deleted = false;
    global.fetch = jest.fn().mockImplementation(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/guest/session') && init?.method === 'DELETE') {
        deleted = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: { status: 'passcode', isVerified: false, hasPasscodeSession: true },
          }),
        };
      }
      if (url.includes('/api/guest/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: deleted
              ? { status: 'passcode', isVerified: false, hasPasscodeSession: true }
              : {
                status: 'invitation',
                isVerified: true,
                code: 'DARCY26',
                guestName: 'Fitzwilliam Darcy',
                hasPasscodeSession: true,
              },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }) as any;

    try {
      render(
        <Navbar
          isAdmin={false}
          handleLogout={jest.fn()}
          headerRef={headerRef}
          config={mockConfig}
        />
      );

      const switchBtn = await screen.findByTestId('navbar-switch-household-button');
      expect(switchBtn).toHaveTextContent('Switch Household');

      fireEvent.click(switchBtn);

      await waitFor(() => {
        expect(deleted).toBe(true);
        expect(screen.queryByTestId('navbar-switch-household-button')).not.toBeInTheDocument();
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('prefixes /api/guest/session GET and DELETE requests with NEXT_PUBLIC_BASE_PATH when configured', async () => {
    const originalFetch = global.fetch;
    const previousBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
    const requestedUrls: Array<{ url: string; method: string }> = [];

    global.fetch = jest.fn().mockImplementation(async (input: unknown, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input && typeof input.url === 'string'
            ? input.url
            : '';
      const method = init?.method || 'GET';
      requestedUrls.push({ url, method });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data:
            method === 'DELETE'
              ? { status: 'passcode', isVerified: false, hasPasscodeSession: true }
              : {
                status: 'invitation',
                isVerified: true,
                code: 'DARCY26',
                guestName: 'Fitzwilliam Darcy',
                hasPasscodeSession: true,
              },
        }),
      };
    }) as unknown as typeof fetch;

    try {
      render(
        <Navbar
          isAdmin={false}
          handleLogout={jest.fn()}
          headerRef={headerRef}
          config={mockConfig}
        />
      );

      const switchBtn = await screen.findByTestId('navbar-switch-household-button');
      expect(requestedUrls[0]).toEqual({
        url: '/wedding_website/demo/api/guest/session',
        method: 'GET',
      });

      fireEvent.click(switchBtn);

      await waitFor(() => {
        expect(requestedUrls).toContainEqual({
          url: '/wedding_website/demo/api/guest/session',
          method: 'DELETE',
        });
      });
    } finally {
      global.fetch = originalFetch;
      if (previousBasePath === undefined) {
        delete process.env.NEXT_PUBLIC_BASE_PATH;
      } else {
        process.env.NEXT_PUBLIC_BASE_PATH = previousBasePath;
      }
    }
  });

  it('labels header landmark with aria-label="Site header" per ARIA14, uses theme background surface token, and suppresses header/nav landmarks in preview mode', async () => {
    const { container, rerender } = render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const banner = screen.getByRole('banner', { name: 'Site header' });
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveClass('bg-[var(--color-background,#ffffff)]');
    expect(headerRef.current).toBe(banner);
    expect(screen.getByRole('navigation', { name: 'Global Navigation' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    rerender(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
        isPreview
      />
    );

    expect(screen.queryByRole('banner')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(headerRef.current).toBeInstanceOf(HTMLDivElement);
    expect(screen.getByText('A & B')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('switches to scoped QR mode when /api/guest/session returns status: photo_qr, hiding gated links and passing axe', async () => {
    const originalFetch = global.fetch;
    currentPathname = '/photos';

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          status: 'photo_qr',
          isVerified: false,
          invitationCode: null,
          code: null,
          guestName: null,
          hasPasscodeSession: false,
        },
      }),
    }) as unknown as typeof fetch;

    try {
      const { container } = render(
        <Navbar
          isAdmin={false}
          handleLogout={jest.fn()}
          headerRef={headerRef}
          config={{
            ...mockConfig,
            modules: {
              gallery: true,
              rsvp: true,
              schedule: true,
              registry: true,
              guestbook: true,
              bridalParty: true,
              faq: true,
              meal: true,
            },
          }}
        />
      );

      const inviteCodeLinks = await screen.findAllByRole('link', { name: 'Enter Invite Code' });
      expect(inviteCodeLinks.length).toBeGreaterThan(0);
      expect(inviteCodeLinks[0]).toHaveAttribute('href', '/guest/login');

      // Monogram brand link points to /photos in QR mode
      const brandLink = screen.getByText('A & B').closest('a');
      expect(brandLink).toHaveAttribute('href', '/photos');

      // Only Photos, Live Slideshow, and Enter Invite Code links appear
      const photosLink = screen.getByRole('link', { name: 'Photos' });
      expect(photosLink).toHaveAttribute('href', '/photos');
      expect(photosLink).toHaveAttribute('aria-current', 'page');

      const slideshowLink = screen.getByRole('link', { name: 'Live Slideshow' });
      expect(slideshowLink).toHaveAttribute('href', '/photos/slideshow');

      // Gated routes and Event Guide dropdown are hidden
      expect(screen.queryByRole('link', { name: 'Home' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /event guide/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'RSVP' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Registry' })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Guestbook' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /more/i })).not.toBeInTheDocument();

      // Open mobile drawer and verify mobile links are also scoped to QR mode
      const mobileToggle = screen.getByRole('button', { name: /open main menu/i });
      fireEvent.click(mobileToggle);
      const mobileMenu = screen.getByRole('navigation', { name: /mobile navigation/i });
      expect(within(mobileMenu).getByRole('link', { name: 'Photos' })).toHaveAttribute('href', '/photos');
      expect(within(mobileMenu).getByRole('link', { name: 'Live Slideshow' })).toHaveAttribute(
        'href',
        '/photos/slideshow'
      );
      expect(within(mobileMenu).getByRole('link', { name: 'Enter Invite Code' })).toHaveAttribute(
        'href',
        '/guest/login'
      );
      expect(within(mobileMenu).queryByRole('link', { name: 'RSVP' })).not.toBeInTheDocument();

      expect(await axe(container)).toHaveNoViolations();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('omits closed aria-controls, closes Event Guide on Tab advancing focus sequentially, and marks header inert while #mobile-menu is open', async () => {
    render(
      <Navbar
        isAdmin={true}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const guideTrigger = screen.getByRole('button', { name: /event guide/i });
    const mobileToggle = screen.getByRole('button', { name: /open main menu/i });
    const headerEl = screen.getByRole('banner', { name: /site header/i });

    expect(guideTrigger).not.toHaveAttribute('aria-controls');
    expect(mobileToggle).not.toHaveAttribute('aria-controls');
    expect(headerEl).not.toHaveAttribute('inert');

    // Open Event Guide and press Tab -> closes menu and moves focus sequentially to next nav link
    fireEvent.click(guideTrigger);
    expect(guideTrigger).toHaveAttribute('aria-controls', 'desktop-guide-menu');
    const menu = screen.getByRole('menu');
    const firstMenuItem = within(menu).getAllByRole('menuitem')[0];
    expect(firstMenuItem).toHaveFocus();

    fireEvent.keyDown(firstMenuItem, { key: 'Tab' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(guideTrigger).not.toHaveAttribute('aria-controls');
    expect(document.activeElement).not.toBe(guideTrigger);
    expect(headerEl.contains(document.activeElement)).toBe(true);

    // Open mobile menu -> sets aria-controls on toggle and marks header inert
    fireEvent.click(mobileToggle);
    expect(mobileToggle).toHaveAttribute('aria-controls', 'mobile-menu');
    expect(headerEl).toHaveAttribute('inert');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Mobile navigation menu' })).not.toBeInTheDocument();
    });
    expect(headerEl).not.toHaveAttribute('inert');
    expect(mobileToggle).not.toHaveAttribute('aria-controls');
  });
});
