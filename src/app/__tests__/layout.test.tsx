import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RootLayout from '../layout';

const pushMock = jest.fn();

jest.mock('@vercel/analytics/next', () => ({
  Analytics: () => <div />,
}));

jest.mock('@vercel/speed-insights/next', () => ({
  SpeedInsights: () => <div />,
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

describe('RootLayout', () => {
  beforeEach(() => {
    pushMock.mockClear();
    localStorage.clear();
  });

  it('handles loading screen and admin logout', async () => {
    const readyStateSpy = jest.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    localStorage.setItem('isAdminLoggedIn', 'true');

    render(
      <RootLayout>
        <div>Child content</div>
      </RootLayout>
    );

    expect(screen.getByText('Loading...')).toBeInTheDocument();

    expect(await screen.findByText('Admin Mode Active')).toBeInTheDocument();
    const logoutButton = screen.getByRole('button', { name: 'Logout' });

    fireEvent(window, new Event('load'));
    await waitFor(() => expect(screen.queryByText('Loading...')).not.toBeInTheDocument());

    fireEvent.click(logoutButton);
    expect(localStorage.getItem('isAdminLoggedIn')).toBeNull();
    expect(pushMock).toHaveBeenCalledWith('/');

    readyStateSpy.mockRestore();
  });
});
