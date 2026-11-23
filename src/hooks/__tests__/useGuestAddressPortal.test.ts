import { renderHook, act, waitFor } from '@testing-library/react';
import { notifyGuestSessionChanged } from '@/utils/guestSessionEvents';
import {
  useGuestAddressPortal,
  guestAddressPortalReducer,
  initialGuestPortalState,
  initialAddressData,
  isAuthError,
  isAbortError,
  type GuestAddressPortalState,
} from '../useGuestAddressPortal';

const mockAddToast = jest.fn();
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: mockAddToast,
  }),
}));

const globalFetch = jest.fn();
global.fetch = globalFetch;

describe('guestAddressPortalReducer', () => {
  it('handles INIT_START and INIT_UNAUTHENTICATED transitions', () => {
    let state = guestAddressPortalReducer(initialGuestPortalState, { type: 'INIT_START' });
    expect(state.status).toBe('validating');
    expect(state.isInitialLoading).toBe(true);

    state = guestAddressPortalReducer(state, { type: 'INIT_UNAUTHENTICATED' });
    expect(state.status).toBe('idle');
    expect(state.isInitialLoading).toBe(false);
    expect(state.sessionActive).toBe(false);
  });

  it('handles VALIDATE_START and VALIDATE_SUCCESS transitions', () => {
    let state = guestAddressPortalReducer(initialGuestPortalState, {
      type: 'VALIDATE_START',
      code: 'SUMMER2026',
    });
    expect(state.status).toBe('validating');
    expect(state.code).toBe('SUMMER2026');

    state = guestAddressPortalReducer(state, {
      type: 'VALIDATE_SUCCESS',
      guestName: 'Jane Bennett',
      code: 'SUMMER2026',
      address: {
        addressLine1: 'Netherfield Park',
        city: 'Hertfordshire',
      },
    });
    expect(state.status).toBe('authenticated');
    expect(state.sessionActive).toBe(true);
    expect(state.guestName).toBe('Jane Bennett');
    expect(state.form.addressLine1).toBe('Netherfield Park');
    expect(state.baseline.addressLine1).toBe('Netherfield Park');
    expect(state.form.city).toBe('Hertfordshire');
  });

  it('handles VALIDATE_FAILURE for auth vs non-auth errors', () => {
    // Auth error (401/403/invalid code)
    const authFail = guestAddressPortalReducer(initialGuestPortalState, {
      type: 'VALIDATE_FAILURE',
      error: 'Invalid code',
      isAuthError: true,
    });
    expect(authFail.status).toBe('idle');
    expect(authFail.sessionActive).toBe(false);
    expect(authFail.error).toBe('Invalid code');

    // Transient / server error
    const serverFail = guestAddressPortalReducer(initialGuestPortalState, {
      type: 'VALIDATE_FAILURE',
      error: 'Network timeout',
      isAuthError: false,
    });
    expect(serverFail.status).toBe('error');
    expect(serverFail.error).toBe('Network timeout');
  });

  it('preserves sessionActive and form inputs on transient SAVE_FAILURE', () => {
    const authenticatedState: GuestAddressPortalState = {
      ...initialGuestPortalState,
      status: 'authenticated',
      sessionActive: true,
      sessionType: 'invitation',
      isInitialLoading: false,
      code: 'SUMMER2026',
      guestName: 'Elizabeth Bennet',
      form: {
        addressLine1: 'Longbourn Estate',
        addressLine2: 'Main Hall',
        city: 'Hertfordshire',
        state: 'England',
        zipCode: 'AL1',
        country: 'UK',
      },
      baseline: {
        ...initialAddressData,
        addressLine1: 'Old Address',
      },
      error: null,
    };

    const savingState = guestAddressPortalReducer(authenticatedState, { type: 'SAVE_START' });
    expect(savingState.status).toBe('saving');

    const errorState = guestAddressPortalReducer(savingState, {
      type: 'SAVE_FAILURE',
      error: '504 Gateway Timeout',
      isAuthError: false,
    });

    // Validates that session is NOT reset and form inputs are preserved
    expect(errorState.status).toBe('error');
    expect(errorState.sessionActive).toBe(true);
    expect(errorState.form.addressLine1).toBe('Longbourn Estate');
    expect(errorState.form.city).toBe('Hertfordshire');
    expect(errorState.error).toBe('504 Gateway Timeout');
  });

  it('resets sessionActive to false on auth-related SAVE_FAILURE (401/403)', () => {
    const authenticatedState: GuestAddressPortalState = {
      ...initialGuestPortalState,
      status: 'authenticated',
      sessionActive: true,
      sessionType: 'invitation',
      isInitialLoading: false,
      code: 'SUMMER2026',
      guestName: 'Elizabeth Bennet',
      form: { ...initialAddressData },
      baseline: { ...initialAddressData },
      error: null,
    };

    const authErrorState = guestAddressPortalReducer(authenticatedState, {
      type: 'SAVE_FAILURE',
      error: 'Session expired',
      isAuthError: true,
    });

    expect(authErrorState.status).toBe('idle');
    expect(authErrorState.sessionActive).toBe(false);
  });

  it('updates baseline and form upon SAVE_SUCCESS', () => {
    const authenticatedState: GuestAddressPortalState = {
      ...initialGuestPortalState,
      status: 'saving',
      sessionActive: true,
      sessionType: 'invitation',
      isInitialLoading: false,
      code: 'SUMMER2026',
      guestName: 'Elizabeth Bennet',
      form: {
        addressLine1: 'Pemberley House',
        addressLine2: '',
        city: 'Derbyshire',
        state: '',
        zipCode: 'DE4',
        country: 'UK',
      },
      baseline: { ...initialAddressData },
      error: null,
    };

    const updatedState = guestAddressPortalReducer(authenticatedState, {
      type: 'SAVE_SUCCESS',
      address: {
        addressLine1: 'Pemberley House',
        addressLine2: '',
        city: 'Derbyshire',
        state: '',
        zipCode: 'DE4',
        country: 'UK',
      },
    });

    expect(updatedState.status).toBe('authenticated');
    expect(updatedState.baseline.addressLine1).toBe('Pemberley House');
    expect(updatedState.form.addressLine1).toBe('Pemberley House');
  });

  it('handles SET_FIELD and SET_CODE', () => {
    let state = guestAddressPortalReducer(initialGuestPortalState, {
      type: 'SET_CODE',
      code: 'ABC',
    });
    expect(state.code).toBe('ABC');

    state = guestAddressPortalReducer(state, {
      type: 'SET_FIELD',
      field: 'city',
      value: 'London',
    });
    expect(state.form.city).toBe('London');
  });
});

describe('useGuestAddressPortal hook', () => {
  beforeEach(() => {
    global.fetch = globalFetch;
    globalFetch.mockReset();
    mockAddToast.mockReset();
    window.history.pushState({}, '', '/guest');
  });

  it('initializes in loading state and transitions to idle on 401', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Unauthorized' }),
    });

    const { result } = renderHook(() => useGuestAddressPortal());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.state.status).toBe('validating');

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.state.status).toBe('idle');
      expect(result.current.isAuthenticated).toBe(false);
    });
  });

  it('initializes in loading state and authenticates when session cookie exists', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Fitzwilliam Darcy',
          code: 'DARCY2026',
          addressLine1: 'Pemberley Estate',
          addressLine2: '',
          city: 'Bakewell',
          state: 'Derbyshire',
          zipCode: 'DE45',
          country: 'UK',
        },
      }),
    });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.state.status).toBe('authenticated');
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.state.guestName).toBe('Fitzwilliam Darcy');
      expect(result.current.state.form.addressLine1).toBe('Pemberley Estate');
    });
  });

  it('auto-validates when URL has code query parameter', async () => {
    window.history.pushState({}, '', '/guest?code=INVITE2026');

    // validate-code call
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        valid: true,
        guestName: 'Charles Bingley',
        code: 'INVITE2026',
      }),
    });

    // fetch address call
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Charles Bingley',
          code: 'INVITE2026',
          addressLine1: 'Netherfield Park',
          city: 'Meryton',
        },
      }),
    });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
      expect(result.current.state.guestName).toBe('Charles Bingley');
      expect(result.current.state.form.addressLine1).toBe('Netherfield Park');
      expect(mockAddToast).toHaveBeenCalledWith('Welcome Charles Bingley!', 'success');
    });
  });

  it('cancels in-flight validation when new validation is triggered via AbortController', async () => {
    const signals: { mount: AbortSignal | null; manual: AbortSignal | null } = {
      mount: null,
      manual: null,
    };

    globalFetch.mockImplementation(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      const signal = (init?.signal || input?.signal) as AbortSignal;

      if (url.includes('validate-code?code=SLOWMOUNT')) {
        signals.mount = signal;
        // Never resolve slowly to test cancellation
        return new Promise(() => {});
      }
      if (url.includes('validate-code?code=FASTMANUAL')) {
        signals.manual = signal;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            valid: true,
            guestName: 'Fast Guest',
            code: 'FASTMANUAL',
          }),
        };
      }
      if (url.includes('/api/guest/address')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              guestName: 'Fast Guest',
              code: 'FASTMANUAL',
              addressLine1: 'Fast Street',
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    window.history.pushState({}, '', '/guest?code=SLOWMOUNT');
    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(signals.mount).not.toBeNull();
    });

    expect(signals.mount?.aborted).toBe(false);

    // Manually trigger validateCode with FASTMANUAL
    act(() => {
      result.current.setCode('FASTMANUAL');
    });

    await act(async () => {
      await result.current.handleValidateCode();
    });

    // Mount signal should have been aborted cleanly!
    expect(signals.mount?.aborted).toBe(true);
    expect(signals.manual?.aborted).toBe(false);

    await waitFor(() => {
      expect(result.current.state.guestName).toBe('Fast Guest');
      expect(result.current.isAuthenticated).toBe(true);
    });
  });

  it('aborts in-flight validation when unmounted', async () => {
    const signalRef: { current: AbortSignal | null } = { current: null };

    globalFetch.mockImplementation(async (input: any, init?: RequestInit) => {
      signalRef.current = (init?.signal || input?.signal) as AbortSignal;
      return new Promise(() => {});
    });

    const { unmount } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(signalRef.current).not.toBeNull();
    });

    expect(signalRef.current?.aborted).toBe(false);

    unmount();

    expect(signalRef.current?.aborted).toBe(true);
  });

  it('preserves address inputs and authenticated status on network timeout / 5xx error during save', async () => {
    // 1. Authenticate guest
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Anne Elliot',
          code: 'KELLY2026',
          addressLine1: 'Kellynch Hall',
          city: 'Somerset',
        },
      }),
    });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    // 2. Guest modifies address line 1
    act(() => {
      result.current.setField('addressLine1', 'Camden Place');
    });

    expect(result.current.state.form.addressLine1).toBe('Camden Place');

    // 3. Save fails with 500 error
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        success: false,
        error: 'Database connection failed',
      }),
    });

    await act(async () => {
      await result.current.handleSaveAddress();
    });

    // Acceptance criteria: 5xx responses preserve authenticated state and retain all typed address inputs
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.form.addressLine1).toBe('Camden Place');
    expect(mockAddToast).toHaveBeenCalledWith('Database connection failed', 'error');

    // 4. Save fails with network drop (throw TypeError)
    globalFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await act(async () => {
      await result.current.handleSaveAddress();
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.state.status).toBe('error');
    expect(result.current.state.form.addressLine1).toBe('Camden Place');
    expect(mockAddToast).toHaveBeenCalledWith('Failed to fetch', 'error');
  });

  it('transitions to idle and unauthenticated when save receives HTTP 401', async () => {
    // 1. Authenticate guest
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Anne Elliot',
          code: 'KELLY2026',
        },
      }),
    });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    // 2. Save fails with 401 Unauthorized
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: 'Unauthorized',
      }),
    });

    await act(async () => {
      await result.current.handleSaveAddress();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.state.status).toBe('idle');
    expect(mockAddToast).toHaveBeenCalledWith('Session expired. Please enter your invitation code.', 'error');
  });

  it('updates baseline and dirty state upon successful address save', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Emma Woodhouse',
          code: 'HARTFIELD26',
          addressLine1: 'Hartfield',
          city: 'Highbury',
        },
      }),
    });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    act(() => {
      result.current.setField('addressLine1', 'Donwell Abbey');
    });
    expect(result.current.state.form.addressLine1).toBe('Donwell Abbey');

    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          addressLine1: 'Donwell Abbey',
          city: 'Highbury',
        },
      }),
    });

    await act(async () => {
      await result.current.handleSaveAddress();
    });

    expect(result.current.state.status).toBe('authenticated');
    expect(result.current.state.baseline.addressLine1).toBe('Donwell Abbey');
    expect(mockAddToast).toHaveBeenCalledWith(
      'Your mailing address has been updated successfully!',
      'success'
    );
  });

  it('surfaces error status on initial 5xx failure and recovers when handleRetry is invoked', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({
        success: false,
        error: 'Service temporarily unavailable',
      }),
    });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.state.status).toBe('error');
      expect(result.current.state.error).toBe('Service temporarily unavailable');
    });

    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          guestName: 'Recovered Guest',
          code: 'RECOVER26',
          addressLine1: '100 Main St',
        },
      }),
    });

    await act(async () => {
      await result.current.handleRetry();
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.state.guestName).toBe('Recovered Guest');
    expect(result.current.state.error).toBeNull();
  });

  it('auto-validates ?code= on mount and strips code from browser history once authenticated', async () => {
    window.history.replaceState({}, '', '/guest?code=INVITE77&utm=email');
    const replaceStateSpy = jest.spyOn(window.history, 'replaceState');

    globalFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          valid: true,
          guestName: ' Clara Oswald ',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            guestName: 'Clara Oswald',
            code: 'INVITE77',
            addressLine1: '12 Bannerman Rd',
            city: 'London',
          },
        }),
      });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    const firstFetchArg = globalFetch.mock.calls[0]?.[0] as string | Request | undefined;
    const firstFetchUrl =
      typeof firstFetchArg === 'string' ? firstFetchArg : firstFetchArg?.url ?? '';
    expect(firstFetchUrl).toContain('/api/registry/validate-code?code=INVITE77');
    expect(replaceStateSpy).toHaveBeenCalledWith(
      expect.anything(),
      '',
      '/guest?utm=email'
    );

    replaceStateSpy.mockRestore();
    window.history.replaceState({}, '', '/');
  });

  it('sets sessionType to passcode without calling /api/guest/address when /api/guest/session reports passcode', async () => {
    globalFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          status: 'passcode',
          isVerified: false,
          invitationCode: null,
          code: null,
          guestName: null,
          hasPasscodeSession: true,
        },
      }),
    });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.state.sessionType).toBe('passcode');
    expect(result.current.state.hasPasscodeSession).toBe(true);

    const calledUrls = globalFetch.mock.calls.map((c) => String(c[0]));
    expect(calledUrls).toEqual(['/api/guest/session']);
    expect(calledUrls.some((u) => u.includes('/api/guest/address'))).toBe(false);
  });

  it('surfaces friendly guidance without error toast when validate-code returns reason: shared_passcode', async () => {
    globalFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { status: 'passcode', isVerified: false, hasPasscodeSession: true },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            valid: false,
            reason: 'shared_passcode',
            error: 'That is the shared website passcode. Please enter your unique household invitation code.',
          },
        }),
      });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    act(() => {
      result.current.setCode('WEDDING2026');
    });

    await act(async () => {
      await result.current.handleValidateCode();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.state.error).toBeNull();
    expect(result.current.state.codeGuidance).toContain('shared website passcode');
    expect(mockAddToast).not.toHaveBeenCalledWith(expect.anything(), 'error');
  });

  it('clears household session via handleSwitchHousehold while preserving passcode sessionType', async () => {
    globalFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            status: 'invitation',
            isVerified: true,
            code: 'DARCY2026',
            guestName: 'Fitzwilliam Darcy',
            hasPasscodeSession: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            guestName: 'Fitzwilliam Darcy',
            code: 'DARCY2026',
            addressLine1: 'Pemberley',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            status: 'passcode',
            isVerified: false,
            hasPasscodeSession: true,
          },
        }),
      });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.handleSwitchHousehold();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.state.sessionType).toBe('passcode');
    expect(result.current.state.guestName).toBe('');
    expect(globalFetch).toHaveBeenLastCalledWith('/api/guest/session', { method: 'DELETE' });
  });

  it('clears household code and address when an external session switch event transitions to passcode', async () => {
    globalFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            status: 'invitation',
            isVerified: true,
            code: 'DARCY2026',
            guestName: 'Fitzwilliam Darcy',
            hasPasscodeSession: true,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            guestName: 'Fitzwilliam Darcy',
            code: 'DARCY2026',
            addressLine1: 'Pemberley',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            status: 'passcode',
            isVerified: false,
            hasPasscodeSession: true,
          },
        }),
      });

    const { result } = renderHook(() => useGuestAddressPortal());

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });
    expect(result.current.state.code).toBe('DARCY2026');
    expect(result.current.state.form.addressLine1).toBe('Pemberley');

    await act(async () => {
      notifyGuestSessionChanged();
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
    });
    expect(result.current.state.sessionType).toBe('passcode');
    expect(result.current.state.code).toBe('');
    expect(result.current.state.guestName).toBe('');
    expect(result.current.state.form.addressLine1).toBe('');
  });

  it('prefixes /api/guest/session GET and DELETE requests with NEXT_PUBLIC_BASE_PATH when configured', async () => {
    const previousBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';

    try {
      globalFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              status: 'invitation',
              isVerified: true,
              invitationCode: 'SUBPATH26',
              code: 'SUBPATH26',
              guestName: 'Subpath Household',
              hasPasscodeSession: true,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              guestName: 'Subpath Household',
              code: 'SUBPATH26',
              addressLine1: '1 Demo Way',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              status: 'passcode',
              isVerified: false,
              hasPasscodeSession: true,
            },
          }),
        });

      const { result } = renderHook(() => useGuestAddressPortal());

      await waitFor(() => {
        expect(result.current.isAuthenticated).toBe(true);
      });

      const getUrl = String(globalFetch.mock.calls[0]?.[0] ?? '');
      const addrUrl = String(globalFetch.mock.calls[1]?.[0] ?? '');
      expect(getUrl).toBe('/wedding_website/demo/api/guest/session');
      expect(addrUrl).toBe('/wedding_website/demo/api/guest/address');

      await act(async () => {
        await result.current.handleSwitchHousehold();
      });

      const deleteUrl = String(globalFetch.mock.calls[2]?.[0] ?? '');
      expect(deleteUrl).toBe('/wedding_website/demo/api/guest/session');
      expect(globalFetch.mock.calls[2]?.[1]).toEqual({ method: 'DELETE' });
    } finally {
      if (previousBasePath === undefined) {
        delete process.env.NEXT_PUBLIC_BASE_PATH;
      } else {
        process.env.NEXT_PUBLIC_BASE_PATH = previousBasePath;
      }
    }
  });
});

describe('Helper error utilities', () => {
  it('isAuthError identifies 401 and 403 correctly', () => {
    expect(isAuthError(401)).toBe(true);
    expect(isAuthError(403)).toBe(true);
    expect(isAuthError(404)).toBe(false);
    expect(isAuthError(500)).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });

  it('isAbortError identifies AbortError objects', () => {
    const abortErr = new DOMException('Aborted', 'AbortError');
    expect(isAbortError(abortErr)).toBe(true);
    expect(isAbortError(new Error('Network error'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});
