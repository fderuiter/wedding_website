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
});
