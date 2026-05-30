import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import RootLayoutClient from '@/components/layout/RootLayoutClient';

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

describe('RootLayoutClient', () => {
  beforeEach(() => {
    pushMock.mockClear();
    localStorage.clear();
  });

  it('handles admin logout', async () => {
    localStorage.setItem('isAdminLoggedIn', 'true');

    render(
      <RootLayoutClient>
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
