import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Navbar from '../Navbar';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  usePathname: () => '/',
}));

const mockConfig = {
  brideName: 'A',
  groomName: 'F',
  partner1Name: 'A',
  partner2Name: 'F',
  weddingDate: '2026-06-20',
  venueName: 'Venue',
  venueCity: 'City',
  venueState: 'State',
  features: JSON.stringify([
    { id: 'story', type: 'story', title: 'Our Story', visible: true },
    { id: 'details', type: 'details', title: 'Details', visible: true },
  ]),
};

describe('Navbar Component Dynamic Theme Tokens', () => {
  const headerRef = React.createRef<HTMLElement>();

  it('renders brand logo and nav links using dynamic CSS variable tokens', () => {
    render(
      <Navbar
        isAdmin={false}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig as any}
      />
    );

    const brandLink = screen.getByText('A & F');
    expect(brandLink).toHaveClass('text-[var(--color-primary-text)]');
    expect(brandLink).not.toHaveClass('text-gray-800');
    expect(brandLink).not.toHaveClass('dark:text-white');
  });

  it('renders nav links without hardcoded text-white and text-gray-700 classes', () => {
    render(
      <Navbar
        isAdmin={true}
        handleLogout={jest.fn()}
        headerRef={headerRef}
        config={mockConfig as any}
      />
    );

    const adminSpan = screen.getByText('Admin Mode');
    expect(adminSpan).toHaveClass('text-[var(--color-primary-text)]');
    expect(adminSpan).not.toHaveClass('text-gray-700');

    const logoutBtn = screen.getByRole('button', { name: /logout/i });
    expect(logoutBtn).toHaveClass('text-[var(--btn-primary-text,var(--color-primary-text,#ffffff))]');
    expect(logoutBtn).not.toHaveClass('text-white');
  });
});
