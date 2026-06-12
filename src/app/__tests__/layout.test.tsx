import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RootLayoutClient from '@/components/layout/RootLayoutClient';
import type { PublicAppConfig } from '@/lib/config';

const pushMock = jest.fn();

jest.mock('@vercel/analytics/next', () => ({
  Analytics: () => <div />,
}));

jest.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: () => <div />,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/',
}));

jest.mock('@/components/ThemeProvider', () => ({
  useAppConfig: () => null,
}));

const defaultPublicAppConfig: PublicAppConfig = {
  id: 'global',
  brideName: 'Abbigayle',
  groomName: 'Frederick',
  weddingDate: new Date('2026-06-20T16:00:00.000Z'),
  baseUrl: 'https://abbifred.com',
  venueName: 'Plummer House',
  venueAddress: '1091 Plummer Ln SW',
  venueCity: 'Rochester',
  venueState: 'MN',
  venueZip: '55902',
  latitude: 44.0079,
  longitude: -92.4938,
  storyText: '',
  venueDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN.',
  travelAdvice: '',
  heroTitle: '',
  heroSubtitle: '',
  seoTitle: '',
  seoDescription: 'Join Abbigayle and Frederick for their wedding celebration.',
  faviconUrl: '/assets/favicon.png',
  ogImageUrl: '/images/sunset-embrace.jpg',
  seoKeywords: "Abbigayle and Frederick's wedding",
  themePrimary: '#000000',
  themeSecondary: '#ffffff',
  themeAccent: '#d4af37',
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockConfig = defaultPublicAppConfig;

describe('RootLayoutClient', () => {
  beforeEach(() => {
    pushMock.mockClear();
    localStorage.clear();
  });

  it('handles admin logout', async () => {
    localStorage.setItem('isAdminLoggedIn', 'true');

    render(
      <RootLayoutClient config={mockConfig}>
        <div>Child content</div>
      </RootLayoutClient>
    );

    expect(await screen.findByText('Admin Mode')).toBeInTheDocument();
    const logoutButton = screen.getByRole('button', { name: 'Logout' });

    fireEvent.click(logoutButton);
    expect(localStorage.getItem('isAdminLoggedIn')).toBeNull();
    expect(pushMock).toHaveBeenCalledWith('/');
  });
});
