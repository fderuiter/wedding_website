import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RootLayoutClient from '@/components/layout/RootLayoutClient';
import { ToastProvider } from '@/components/ui/ToastProvider';

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
      <ToastProvider>
        <RootLayoutClient config={{ brideName: 'Alice', groomName: 'Bob', weddingDate: '2026-06-20', baseUrl: 'http://localhost' } as any}>
          <div>Child content</div>
        </RootLayoutClient>
      </ToastProvider>
    );

    expect(await screen.findByText('Admin Mode')).toBeInTheDocument();
    const logoutButton = screen.getByRole('button', { name: 'Logout' });

    fireEvent.click(logoutButton);
    await waitFor(() => {
      expect(localStorage.getItem('isAdminLoggedIn')).toBeNull();
    });
    expect(pushMock).toHaveBeenCalledWith('/admin/login');
  });
});
