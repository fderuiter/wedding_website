import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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
    const detailsLink = screen.getByRole('link', { name: 'Wedding Day Details' });

    expect(homeLink).toHaveAttribute('aria-current', 'page');
    expect(detailsLink).not.toHaveAttribute('aria-current');
  });

  it('sets aria-current="page" on section link when hash matches section id', () => {
    window.location.hash = '#details';

    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const homeLink = screen.getByRole('link', { name: 'Home' });
    const detailsLink = screen.getByRole('link', { name: 'Wedding Day Details' });

    expect(homeLink).not.toHaveAttribute('aria-current');
    expect(detailsLink).toHaveAttribute('aria-current', 'page');
  });

  it('updates aria-current="page" on section link when clicked', () => {
    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const homeLink = screen.getByRole('link', { name: 'Home' });
    const detailsLink = screen.getByRole('link', { name: 'Wedding Day Details' });

    expect(homeLink).toHaveAttribute('aria-current', 'page');
    expect(detailsLink).not.toHaveAttribute('aria-current');

    act(() => {
      fireEvent.click(detailsLink);
    });

    expect(homeLink).not.toHaveAttribute('aria-current');
    expect(detailsLink).toHaveAttribute('aria-current', 'page');
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

  it('correctly manages aria-current on mobile menu links', () => {
    window.location.hash = '#accommodations';

    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig}
      />
    );

    const toggleButton = screen.getByRole('button', { name: /open main menu/i });
    fireEvent.click(toggleButton);

    const accommodationsMobileLinks = screen.getAllByRole('link', { name: 'Accommodations' });

    // Both desktop and mobile navigation links matching active section have aria-current="page"
    accommodationsMobileLinks.forEach((link) => {
      expect(link).toHaveAttribute('aria-current', 'page');
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
