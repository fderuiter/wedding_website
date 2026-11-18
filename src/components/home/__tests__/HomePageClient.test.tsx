import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomePageClient from '../HomePageClient';
import type { PublicAppConfig } from '@/lib/config';

// Mock framer-motion
jest.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    h1: ({ children, ...props }: any) => <h1 {...props}>{children}</h1>,
    p: ({ children, ...props }: any) => <p {...props}>{children}</p>,
    nav: ({ children, ...props }: any) => <nav {...props}>{children}</nav>,
    section: ({ children, ...props }: any) => <section {...props}>{children}</section>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

// Mock ThemeProvider
jest.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({
    themePreset: 'classic',
  }),
}));

const mockConfig: PublicAppConfig = {
  heroTitle: 'Test Wedding',
  heroSubtitle: 'Welcome to our wedding',
  weddingDate: '2026-12-31T18:00:00Z',
  timezone: 'UTC',
  venueName: 'The Grand Hall',
  venueAddress: '123 Main St',
  venueCity: 'New York',
  venueState: 'NY',
  venueDescription: 'A beautiful venue.',
  storyText: 'Our story began...',
  brideName: 'Alice',
  groomName: 'Bob',
  partner1Name: 'Alice',
  partner2Name: 'Bob',
  showCountdown: false,
  showAddToCalendar: false,
  modules: { countdown: true, gallery: true },
  features: [],
  heroImageUrl: '/images/hero.jpg',
  heroImageAlt: 'Hero image',
  brandWatermarkUrl: '/images/watermark.png',
  brandWatermarkAlt: 'Watermark',
  badgeGraphicUrl: '/images/badge.png',
  badgeGraphicAlt: 'Badge',
} as any;

describe('HomePageClient', () => {
  test('renders safe brand media URLs correctly', () => {
    render(<HomePageClient config={mockConfig} />);

    const watermark = screen.getByAltText('Watermark');
    expect(watermark).toBeInTheDocument();
    expect(watermark).toHaveAttribute('src', '/images/watermark.png');

    const badge = screen.getByAltText('Badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute('src', '/images/badge.png');
  });

  test('filters out unsafe brand media URLs (e.g., javascript: URIs)', () => {
    const maliciousConfig: PublicAppConfig = {
      ...mockConfig,
      brandWatermarkUrl: 'javascript:alert(1)',
      badgeGraphicUrl: 'javascript:alert(2)',
      heroImageUrl: 'javascript:alert(3)',
    };

    render(<HomePageClient config={maliciousConfig} />);

    expect(screen.queryByAltText('Watermark')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Badge')).not.toBeInTheDocument();
  });

  test('localizes hero formattedDate and AddToCalendar event to venue timezone', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);

    const chicagoConfig: PublicAppConfig = {
      ...mockConfig,
      heroSubtitle: '',
      weddingDate: '2026-09-20T00:00:00.000Z',
      timezone: 'America/Chicago',
      showAddToCalendar: true,
      modules: { countdown: true, gallery: true, addToCalendar: true },
    } as any;

    render(<HomePageClient config={chicagoConfig} />);

    expect(screen.getByText(/September 19, 2026/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add to Calendar' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Google' }));

    expect(openSpy).toHaveBeenCalledTimes(1);
    const googleUrl = new URL(openSpy.mock.calls[0][0] as string);
    expect(googleUrl.searchParams.get('dates')).toBe('20260919T190000/20260920T010000');
    expect(googleUrl.searchParams.get('ctz')).toBe('America/Chicago');

    openSpy.mockRestore();
  });
});

