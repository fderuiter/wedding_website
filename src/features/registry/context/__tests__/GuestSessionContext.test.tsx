import { render, screen, waitFor, act } from '@testing-library/react';
import { GuestSessionProvider, useGuestSession } from '../GuestSessionContext';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { apiClient } from '@/lib/apiClient';
import { notifyGuestSessionChanged } from '@/utils/guestSessionEvents';

jest.mock('@/lib/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
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
      });
    (apiClient.post as jest.Mock).mockResolvedValueOnce({
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

    expect(apiClient.post).toHaveBeenCalledWith('/api/registry/validate-code', {
      code: 'RECOVER123',
    });
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

  it('synchronizes session state quietly when notifyGuestSessionChanged fires externally without opening recovery modal', async () => {
    (apiClient.get as jest.Mock)
      .mockResolvedValueOnce({
        isVerified: true,
        invitationCode: 'WEDDING2026',
        guestName: 'Jane Doe',
      })
      .mockResolvedValueOnce({
        isVerified: false,
        invitationCode: null,
        guestName: null,
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
      expect(screen.getByTestId('code')).toHaveTextContent('WEDDING2026');
    });

    await act(async () => {
      notifyGuestSessionChanged();
    });

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
      expect(screen.getByTestId('verified')).toHaveTextContent('no');
      expect(screen.getByTestId('code')).toHaveTextContent('');
      expect(screen.getByTestId('modalOpen')).toHaveTextContent('closed');
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hydrates household postal fields, persists transient returnAddress, and wipes both immediately on clearSession or session expiry', async () => {
    const PostalConsumer = () => {
      const {
        invitationCode,
        householdName,
        addressLine1,
        city,
        state,
        zipCode,
        returnAddress,
        status,
        setSession,
        setReturnAddress,
        clearSession,
        refreshSession,
      } = useGuestSession();

      return (
        <div>
          <div data-testid="postal-status">{status}</div>
          <div data-testid="postal-code">{invitationCode}</div>
          <div data-testid="postal-household">{householdName || ''}</div>
          <div data-testid="postal-line1">{addressLine1 || ''}</div>
          <div data-testid="postal-city-state-zip">
            {[city, state, zipCode].filter(Boolean).join(',')}
          </div>
          <div data-testid="transient-return-line1">{returnAddress?.addressLine1 || ''}</div>
          <button
            onClick={() =>
              setReturnAddress?.({
                addressLine1: '999 Transient Way',
                addressLine2: 'Suite 5',
                city: 'Boston',
                state: 'MA',
                zipCode: '02110',
                country: 'United States',
              })
            }
          >
            Save Return Address
          </button>
          <button
            onClick={() =>
              setSession({
                invitationCode: 'OTHER999',
                guestName: 'Other Household',
                isVerified: true,
                addressLine1: '500 New Ave',
              })
            }
          >
            Switch Household
          </button>
          <button onClick={() => clearSession()}>Wipe Session</button>
          <button onClick={() => refreshSession()}>Trigger Refresh</button>
        </div>
      );
    };

    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      isVerified: true,
      invitationCode: 'HOUSEHOLD1',
      guestName: 'Pat & Chris',
      householdName: 'The Morgan Family',
      addressLine1: '101 Maple St',
      city: 'Portland',
      state: 'OR',
      zipCode: '97201',
      country: 'United States',
    });
    (apiClient.delete as jest.Mock).mockResolvedValue({ success: true });

    render(
      <GuestSessionProvider>
        <PostalConsumer />
      </GuestSessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('postal-status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('postal-household')).toHaveTextContent('The Morgan Family');
      expect(screen.getByTestId('postal-line1')).toHaveTextContent('101 Maple St');
      expect(screen.getByTestId('postal-city-state-zip')).toHaveTextContent('Portland,OR,97201');
    });

    // Persist guest-entered return address in memory
    act(() => {
      screen.getByText('Save Return Address').click();
    });
    expect(screen.getByTestId('transient-return-line1')).toHaveTextContent('999 Transient Way');

    // Switching to another household resets the previous household's transient returnAddress
    act(() => {
      screen.getByText('Switch Household').click();
    });
    expect(screen.getByTestId('postal-code')).toHaveTextContent('OTHER999');
    expect(screen.getByTestId('postal-line1')).toHaveTextContent('500 New Ave');
    expect(screen.getByTestId('transient-return-line1')).toHaveTextContent('');

    // Re-enter transient return address, then expire session -> wipes both immediately
    act(() => {
      screen.getByText('Save Return Address').click();
    });
    expect(screen.getByTestId('transient-return-line1')).toHaveTextContent('999 Transient Way');

    (apiClient.get as jest.Mock).mockResolvedValueOnce({
      isVerified: false,
      invitationCode: null,
      guestName: null,
    });
    await act(async () => {
      screen.getByText('Trigger Refresh').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('postal-status')).toHaveTextContent('expired');
      expect(screen.getByTestId('postal-household')).toHaveTextContent('');
      expect(screen.getByTestId('postal-line1')).toHaveTextContent('');
      expect(screen.getByTestId('postal-city-state-zip')).toHaveTextContent('');
      expect(screen.getByTestId('transient-return-line1')).toHaveTextContent('');
    });

    // Clear session also wipes all household & transient return-address fields immediately
    act(() => {
      screen.getByText('Switch Household').click();
      screen.getByText('Save Return Address').click();
    });
    expect(screen.getByTestId('postal-line1')).toHaveTextContent('500 New Ave');
    expect(screen.getByTestId('transient-return-line1')).toHaveTextContent('999 Transient Way');

    await act(async () => {
      screen.getByText('Wipe Session').click();
    });
    expect(screen.getByTestId('postal-status')).toHaveTextContent('unauthenticated');
    expect(screen.getByTestId('postal-line1')).toHaveTextContent('');
    expect(screen.getByTestId('transient-return-line1')).toHaveTextContent('');
  });
});
