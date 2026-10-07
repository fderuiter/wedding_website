import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { GuestSessionProvider, useGuestSession } from '../GuestSessionContext';
import { apiClient } from '@/lib/apiClient';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

const TestComponent = () => {
  const { invitationCode, guestName, isVerified, isLoading, setSession, clearSession } = useGuestSession();

  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'ready'}</div>
      <div data-testid="verified">{isVerified ? 'yes' : 'no'}</div>
      <div data-testid="code">{invitationCode}</div>
      <div data-testid="name">{guestName}</div>
      <button onClick={() => setSession({ invitationCode: 'TEST1234', guestName: 'Test Guest', isVerified: true })}>
        Set Session
      </button>
      <button onClick={() => clearSession()}>Clear Session</button>
    </div>
  );
};

describe('GuestSessionContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hydrates active session details from /api/registry/session on mount', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      isVerified: true,
      invitationCode: 'WEDDING2026',
      guestName: 'Jane Doe',
    });

    render(
      <GuestSessionProvider>
        <TestComponent />
      </GuestSessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('ready');
      expect(screen.getByTestId('verified')).toHaveTextContent('yes');
      expect(screen.getByTestId('code')).toHaveTextContent('WEDDING2026');
      expect(screen.getByTestId('name')).toHaveTextContent('Jane Doe');
    });

    expect(apiClient.get).toHaveBeenCalledWith('/api/registry/session');
  });

  it('handles unverified session from API', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      isVerified: false,
      invitationCode: null,
      guestName: null,
    });

    render(
      <GuestSessionProvider>
        <TestComponent />
      </GuestSessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('ready');
      expect(screen.getByTestId('verified')).toHaveTextContent('no');
      expect(screen.getByTestId('code')).toHaveTextContent('');
    });
  });

  it('allows setting session and clearing session', async () => {
    (apiClient.get as jest.Mock).mockResolvedValue({
      isVerified: false,
      invitationCode: null,
      guestName: null,
    });
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });

    render(
      <GuestSessionProvider>
        <TestComponent />
      </GuestSessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('ready');
    });

    act(() => {
      screen.getByText('Set Session').click();
    });

    expect(screen.getByTestId('verified')).toHaveTextContent('yes');
    expect(screen.getByTestId('code')).toHaveTextContent('TEST1234');
    expect(screen.getByTestId('name')).toHaveTextContent('Test Guest');

    await act(async () => {
      screen.getByText('Clear Session').click();
    });

    expect(apiClient.delete).toHaveBeenCalledWith('/api/registry/session');
    expect(screen.getByTestId('verified')).toHaveTextContent('no');
    expect(screen.getByTestId('code')).toHaveTextContent('');
    expect(screen.getByTestId('name')).toHaveTextContent('');
  });
});
