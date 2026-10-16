import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import { GuestSessionProvider, useGuestSession } from '../GuestSessionContext';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { apiClient } from '@/lib/apiClient';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    delete: jest.fn(),
  },
}));

const TestComponent = () => {
  const {
    invitationCode,
    guestName,
    isVerified,
    isLoading,
    status,
    lastErrorCode,
    draftInvitationCode,
    isRecoveryModalOpen,
    setSession,
    clearSession,
    refreshSession,
    openRecoveryModal,
    closeRecoveryModal,
    recoverSession,
  } = useGuestSession();

  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'ready'}</div>
      <div data-testid="verified">{isVerified ? 'yes' : 'no'}</div>
      <div data-testid="code">{invitationCode}</div>
      <div data-testid="name">{guestName}</div>
      <div data-testid="status">{status}</div>
      <div data-testid="lastErrorCode">{lastErrorCode || 'none'}</div>
      <div data-testid="draftCode">{draftInvitationCode}</div>
      <div data-testid="modalOpen">{isRecoveryModalOpen ? 'open' : 'closed'}</div>
      <button onClick={() => setSession({ invitationCode: 'TEST1234', guestName: 'Test Guest', isVerified: true })}>
        Set Session
      </button>
      <button onClick={() => clearSession()}>Clear Session</button>
      <button onClick={() => refreshSession()}>Refresh Session</button>
      <button onClick={() => openRecoveryModal()}>Open Modal</button>
      <button onClick={() => closeRecoveryModal()}>Close Modal</button>
      <button onClick={() => recoverSession('RECOVER123')}>Recover Session</button>
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
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    expect(apiClient.get).toHaveBeenCalledWith('/api/registry/session');
  });

  it('handles unverified initial session from API', async () => {
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
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
    });
  });

  it('transitions to expired status and keeps draft code when active session drops', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      isVerified: true,
      invitationCode: 'EXPIRED123',
      guestName: 'John Guest',
    });

    render(
      <ToastProvider>
        <GuestSessionProvider>
          <TestComponent />
        </GuestSessionProvider>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('code')).toHaveTextContent('EXPIRED123');
    });

    // Mock next refresh returning expired / unverified session
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      isVerified: false,
      invitationCode: null,
      guestName: null,
    });

    await act(async () => {
      screen.getByText('Refresh Session').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('expired');
      expect(screen.getByTestId('verified')).toHaveTextContent('no');
      expect(screen.getByTestId('lastErrorCode')).toHaveTextContent('SESSION_EXPIRED');
      expect(screen.getByTestId('draftCode')).toHaveTextContent('EXPIRED123');
      expect(screen.getByTestId('modalOpen')).toHaveTextContent('open');
    });

    // Verify warning toast message was shown
    expect(screen.getByRole('alert')).toHaveTextContent('Session expired. Re-verify invitation code');
  });

  it('restores authenticated status when recoverSession succeeds', async () => {
    (apiClient.get as jest.Mock)
      .mockResolvedValueOnce({
        isVerified: true,
        invitationCode: 'DRAFT123',
        guestName: 'Jane Doe',
      })
      .mockResolvedValueOnce({
        isVerified: false,
      })
      .mockResolvedValueOnce({
        valid: true,
        code: 'RECOVER123',
        guestName: 'Jane Restored',
      });

    render(
      <ToastProvider>
        <GuestSessionProvider>
          <TestComponent />
        </GuestSessionProvider>
      </ToastProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    // Cause session to drop
    await act(async () => {
      screen.getByText('Refresh Session').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('expired');
    });

    // Call recoverSession
    await act(async () => {
      screen.getByText('Recover Session').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('verified')).toHaveTextContent('yes');
      expect(screen.getByTestId('code')).toHaveTextContent('RECOVER123');
      expect(screen.getByTestId('name')).toHaveTextContent('Jane Restored');
      expect(screen.getByTestId('modalOpen')).toHaveTextContent('closed');
    });

    expect(apiClient.get).toHaveBeenCalledWith('/api/registry/validate-code?code=RECOVER123');
  });

  it('safely degrades when rendered outside ToastProvider', async () => {
    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      isVerified: true,
      invitationCode: 'SAFEDEG123',
      guestName: 'Safe User',
    }).mockResolvedValueOnce({
      isVerified: false,
    });

    render(
      <GuestSessionProvider>
        <TestComponent />
      </GuestSessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    await act(async () => {
      screen.getByText('Refresh Session').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('expired');
      expect(screen.getByTestId('draftCode')).toHaveTextContent('SAFEDEG123');
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
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');

    await act(async () => {
      screen.getByText('Clear Session').click();
    });

    expect(apiClient.delete).toHaveBeenCalledWith('/api/registry/session');
    expect(screen.getByTestId('verified')).toHaveTextContent('no');
    expect(screen.getByTestId('code')).toHaveTextContent('');
    expect(screen.getByTestId('name')).toHaveTextContent('');
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
  });
});
