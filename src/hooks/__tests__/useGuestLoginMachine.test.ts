import { renderHook, act } from '@testing-library/react';
import {
  useGuestLoginMachine,
  guestLoginMachineReducer,
  initialGuestLoginMachineState,
  isAbortError,
  getSafeCallbackUrl,
  selectIsLoading,
  selectIsLookupLoading,
  selectIsBusy,
  selectIsLoginDisabled,
  selectIsLookupDisabled,
  selectIsAuthenticated,
  selectHasMatchedGuest,
  type GuestLoginMachineState,
  type GuestLoginMachineAction,
} from '../useGuestLoginMachine';
import { useRouter, useSearchParams } from 'next/navigation';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

const globalWithFetch = global as unknown as { fetch?: typeof fetch };
const originalFetch = globalWithFetch.fetch;

describe('guestLoginMachineReducer', () => {
  it('returns initial state for unknown action', () => {
    const state = guestLoginMachineReducer(initialGuestLoginMachineState, {
      type: 'UNKNOWN' as unknown as GuestLoginMachineAction['type'],
    } as unknown as GuestLoginMachineAction);
    expect(state).toEqual(initialGuestLoginMachineState);
  });

  it('handles LOGIN_START, LOGIN_SUCCESS, and LOGIN_FAILURE', () => {
    let state = guestLoginMachineReducer(initialGuestLoginMachineState, { type: 'LOGIN_START' });
    expect(state.status).toBe('logging_in');
    expect(state.error).toBe('');

    state = guestLoginMachineReducer(state, { type: 'LOGIN_SUCCESS' });
    expect(state.status).toBe('authenticated');
    expect(state.error).toBe('');

    state = guestLoginMachineReducer(state, {
      type: 'LOGIN_FAILURE',
      error: 'Incorrect passcode.',
    });
    expect(state.status).toBe('idle');
    expect(state.error).toBe('Incorrect passcode.');
  });

  it('handles LOOKUP_START, LOOKUP_SUCCESS, LOOKUP_FAILURE, LOOKUP_RATE_LIMITED, and LOOKUP_UNMATCHED', () => {
    let state = guestLoginMachineReducer(initialGuestLoginMachineState, { type: 'LOOKUP_START' });
    expect(state.status).toBe('looking_up');
    expect(state.lookupError).toBe('');
    expect(state.unmatched).toBe(false);
    expect(state.lookupRateLimited).toBe(false);
    expect(state.matchedGuest).toBeNull();

    // Success transition
    state = guestLoginMachineReducer(state, {
      type: 'LOOKUP_SUCCESS',
      matchedGuest: { guestName: 'Alice', code: 'SECRET1' },
    });
    expect(state.status).toBe('lookup_success');
    expect(state.matchedGuest).toEqual({ guestName: 'Alice', code: 'SECRET1' });

    // Failure transition
    state = guestLoginMachineReducer(initialGuestLoginMachineState, {
      type: 'LOOKUP_FAILURE',
      error: 'Network failure',
    });
    expect(state.status).toBe('idle');
    expect(state.lookupError).toBe('Network failure');

    // Rate limit transition
    state = guestLoginMachineReducer(initialGuestLoginMachineState, {
      type: 'LOOKUP_RATE_LIMITED',
      error: 'Too many requests',
    });
    expect(state.status).toBe('idle');
    expect(state.lookupRateLimited).toBe(true);
    expect(state.lookupError).toBe('Too many requests');

    // Unmatched transition
    state = guestLoginMachineReducer(initialGuestLoginMachineState, {
      type: 'LOOKUP_UNMATCHED',
      error: 'No invitation found',
    });
    expect(state.status).toBe('idle');
    expect(state.unmatched).toBe(true);
    expect(state.lookupError).toBe('No invitation found');
  });

  it('resets lookup errors and resets looking_up status to idle on SET_ACTIVE_TAB', () => {
    const dirtyState: GuestLoginMachineState = {
      ...initialGuestLoginMachineState,
      status: 'looking_up',
      activeTab: 'lookup',
      lookupError: 'Some error',
      lookupRateLimited: true,
      unmatched: true,
    };

    const nextState = guestLoginMachineReducer(dirtyState, {
      type: 'SET_ACTIVE_TAB',
      tab: 'instructions',
    });

    expect(nextState.activeTab).toBe('instructions');
    expect(nextState.status).toBe('idle');
    expect(nextState.lookupError).toBe('');
    expect(nextState.lookupRateLimited).toBe(false);
    expect(nextState.unmatched).toBe(false);
  });

  it('clears errors when SET_LOOKUP_QUERY or RESET_LOOKUP_ERRORS is dispatched', () => {
    const errorState: GuestLoginMachineState = {
      ...initialGuestLoginMachineState,
      lookupQuery: 'old',
      lookupError: 'Some error',
      lookupRateLimited: true,
      unmatched: true,
    };

    const queriedState = guestLoginMachineReducer(errorState, {
      type: 'SET_LOOKUP_QUERY',
      query: 'new query',
    });
    expect(queriedState.lookupQuery).toBe('new query');
    expect(queriedState.lookupError).toBe('');
    expect(queriedState.lookupRateLimited).toBe(false);
    expect(queriedState.unmatched).toBe(false);

    const resetState = guestLoginMachineReducer(errorState, {
      type: 'RESET_LOOKUP_ERRORS',
    });
    expect(resetState.lookupError).toBe('');
    expect(resetState.lookupRateLimited).toBe(false);
    expect(resetState.unmatched).toBe(false);
  });

  it('handles field changes: SET_PASSCODE, SET_SHOW_PASSCODE, TOGGLE_SHOW_PASSCODE, SET_SHOW_HELP, CLEAR_MATCHED_GUEST, RESET', () => {
    let state = guestLoginMachineReducer(initialGuestLoginMachineState, {
      type: 'SET_PASSCODE',
      passcode: 'pass123',
    });
    expect(state.passcode).toBe('pass123');

    state = guestLoginMachineReducer(state, {
      type: 'SET_SHOW_PASSCODE',
      show: true,
    });
    expect(state.showPasscode).toBe(true);

    state = guestLoginMachineReducer(state, {
      type: 'TOGGLE_SHOW_PASSCODE',
    });
    expect(state.showPasscode).toBe(false);

    state = guestLoginMachineReducer(state, {
      type: 'SET_SHOW_HELP',
      show: true,
    });
    expect(state.showHelp).toBe(true);

    const matchedState: GuestLoginMachineState = {
      ...state,
      status: 'lookup_success',
      matchedGuest: { guestName: 'Bob', code: 'CODE' },
    };
    const clearedMatched = guestLoginMachineReducer(matchedState, {
      type: 'CLEAR_MATCHED_GUEST',
    });
    expect(clearedMatched.matchedGuest).toBeNull();
    expect(clearedMatched.status).toBe('idle');

    const resetState = guestLoginMachineReducer(state, { type: 'RESET' });
    expect(resetState).toEqual(initialGuestLoginMachineState);
  });
});

describe('Selectors and Helper Utilities', () => {
  it('computes selectors accurately across states', () => {
    const idleState: GuestLoginMachineState = {
      ...initialGuestLoginMachineState,
      status: 'idle',
    };
    expect(selectIsLoading(idleState)).toBe(false);
    expect(selectIsLookupLoading(idleState)).toBe(false);
    expect(selectIsBusy(idleState)).toBe(false);
    expect(selectIsLoginDisabled(idleState)).toBe(false);
    expect(selectIsLookupDisabled(idleState)).toBe(false);
    expect(selectIsAuthenticated(idleState)).toBe(false);
    expect(selectHasMatchedGuest(idleState)).toBe(false);

    const loginState: GuestLoginMachineState = {
      ...initialGuestLoginMachineState,
      status: 'logging_in',
    };
    expect(selectIsLoading(loginState)).toBe(true);
    expect(selectIsBusy(loginState)).toBe(true);
    expect(selectIsLoginDisabled(loginState)).toBe(true);
    expect(selectIsLookupDisabled(loginState)).toBe(true);

    const lookupState: GuestLoginMachineState = {
      ...initialGuestLoginMachineState,
      status: 'looking_up',
    };
    expect(selectIsLookupLoading(lookupState)).toBe(true);
    expect(selectIsBusy(lookupState)).toBe(true);
    expect(selectIsLoginDisabled(lookupState)).toBe(true);
    expect(selectIsLookupDisabled(lookupState)).toBe(true);

    const rateLimitedState: GuestLoginMachineState = {
      ...initialGuestLoginMachineState,
      lookupRateLimited: true,
    };
    expect(selectIsLookupDisabled(rateLimitedState)).toBe(true);

    const authState: GuestLoginMachineState = {
      ...initialGuestLoginMachineState,
      status: 'authenticated',
    };
    expect(selectIsAuthenticated(authState)).toBe(true);

    const matchedState: GuestLoginMachineState = {
      ...initialGuestLoginMachineState,
      matchedGuest: { guestName: 'Alice', code: 'ABC' },
    };
    expect(selectHasMatchedGuest(matchedState)).toBe(true);
  });

  it('validates safe callback URLs', () => {
    expect(getSafeCallbackUrl(null)).toBe('/');
    expect(getSafeCallbackUrl(undefined)).toBe('/');
    expect(getSafeCallbackUrl('')).toBe('/');
    expect(getSafeCallbackUrl('/rsvp')).toBe('/rsvp');
    expect(getSafeCallbackUrl('//malicious.com')).toBe('/');
    expect(getSafeCallbackUrl('/\\malicious.com')).toBe('/');
    expect(getSafeCallbackUrl('https://malicious.com')).toBe('/');
  });

  it('identifies AbortError objects correctly', () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('error')).toBe(false);
    expect(isAbortError(new Error('Normal error'))).toBe(false);
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';
    expect(isAbortError(abortErr)).toBe(true);
  });
});

describe('useGuestLoginMachine hook lifecycle and coordination', () => {
  const mockPush = jest.fn();
  const mockGetParam = jest.fn().mockReturnValue(null);

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useSearchParams as jest.Mock).mockReturnValue({ get: mockGetParam });
  });

  afterEach(() => {
    if (originalFetch) {
      globalWithFetch.fetch = originalFetch;
    } else {
      delete globalWithFetch.fetch;
    }
    jest.restoreAllMocks();
  });

  it('performs direct passcode login with AbortSignal and navigates on success', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine({ callbackUrl: '/dashboard' }));

    act(() => {
      result.current.setPasscode('correctpass');
    });

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'correctpass' }),
      signal: expect.any(AbortSignal),
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.status).toBe('authenticated');
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('handles login failure and records error message', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid passcode provided' }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setPasscode('wrong');
    });

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBe('Invalid passcode provided');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('validates lookup query and rejects empty, short name, or invalid email', async () => {
    const fetchMock = jest.fn<typeof fetch>();
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    // Empty query
    await act(async () => {
      await result.current.handleLookup();
    });
    expect(result.current.lookupError).toBe('Please enter your name or email address.');
    expect(fetchMock).not.toHaveBeenCalled();

    // Short name
    act(() => {
      result.current.setLookupQuery('A');
    });
    await act(async () => {
      await result.current.handleLookup();
    });
    expect(result.current.lookupError).toBe('Name must be at least 2 characters.');
    expect(fetchMock).not.toHaveBeenCalled();

    // Invalid email
    act(() => {
      result.current.setLookupQuery('test@');
    });
    await act(async () => {
      await result.current.handleLookup();
    });
    expect(result.current.lookupError).toBe('Invalid email format.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('performs lookup, handles success, and auto-redirects after delay', async () => {
    jest.useFakeTimers();

    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        guestName: 'Jane Bennett',
        code: 'NETHERFIELD',
      }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine({ redirectDelayMs: 4000 }));

    act(() => {
      result.current.setLookupQuery('Jane Bennett');
    });

    await act(async () => {
      await result.current.handleLookup();
    });

    expect(result.current.matchedGuest).toEqual({
      guestName: 'Jane Bennett',
      code: 'NETHERFIELD',
    });
    expect(result.current.status).toBe('lookup_success');
    expect(mockPush).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(3999);
    });
    expect(mockPush).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/');

    jest.useRealTimers();
  });

  it('cancels scheduled redirect timer when handleContinueToPortal is clicked', async () => {
    jest.useFakeTimers();

    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        guestName: 'Jane Bennett',
        code: 'NETHERFIELD',
      }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setLookupQuery('Jane Bennett');
    });

    await act(async () => {
      await result.current.handleLookup();
    });

    act(() => {
      result.current.handleContinueToPortal();
    });

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/');

    // Advancing timers should not cause duplicate push
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('aborts active lookup request before initiating passcode login', async () => {
    let capturedLookupSignal: AbortSignal | null = null;
    let resolveLookup: ((_val: unknown) => void) | null = null;

    const fetchMock = jest.fn<typeof fetch>().mockImplementation((url, init) => {
      if (url === '/api/guest/lookup') {
        capturedLookupSignal = init?.signal as AbortSignal;
        return new Promise((resolve) => {
          resolveLookup = resolve;
        });
      }
      if (url === '/api/guest/login') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as unknown as Response);
      }
      return Promise.reject(new Error('Unknown url'));
    });
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setLookupQuery('Elizabeth Bennet');
    });

    // Start lookup without awaiting completion
    let lookupPromise: Promise<void>;
    act(() => {
      lookupPromise = result.current.handleLookup();
    });

    expect(result.current.isLookupLoading).toBe(true);
    expect(capturedLookupSignal).not.toBeNull();
    expect(capturedLookupSignal!.aborted).toBe(false);

    // Now start login while lookup is still in flight
    act(() => {
      result.current.setPasscode('wedding2026');
    });

    await act(async () => {
      await result.current.handleLogin();
    });

    // The previous lookup signal MUST be aborted
    expect(capturedLookupSignal!.aborted).toBe(true);
    expect(result.current.isAuthenticated).toBe(true);

    // Resolve the dangling lookup promise
    if (resolveLookup) {
      resolveLookup({
        ok: true,
        status: 200,
        json: async () => ({ success: true, guestName: 'Late Arrival', code: 'LATE' }),
      });
      await act(async () => {
        await lookupPromise;
      });
    }

    // The late lookup must not overwrite authenticated state
    expect(result.current.status).toBe('authenticated');
    expect(result.current.matchedGuest).toBeNull();
  });

  it('clears redirect timer when user initiates manual login', async () => {
    jest.useFakeTimers();

    const fetchMock = jest.fn<typeof fetch>().mockImplementation((url) => {
      if (url === '/api/guest/lookup') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, guestName: 'Charles', code: 'BINGLEY' }),
        } as unknown as Response);
      }
      if (url === '/api/guest/login') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true }),
        } as unknown as Response);
      }
      return Promise.reject(new Error('Unknown url'));
    });
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setLookupQuery('Charles');
    });

    await act(async () => {
      await result.current.handleLookup();
    });

    expect(result.current.status).toBe('lookup_success');

    // Trigger manual login before 4000ms expires
    act(() => {
      result.current.setPasscode('wedding2026');
    });
    await act(async () => {
      await result.current.handleLogin();
    });

    expect(mockPush).toHaveBeenCalledTimes(1);

    // Advancing timers should not cause a duplicate navigation
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('aborts active lookup request, clears timer, and resets errors when switching tabs', async () => {
    let capturedSignal: AbortSignal | null = null;

    const fetchMock = jest.fn<typeof fetch>().mockImplementation((url, init) => {
      if (url === '/api/guest/lookup') {
        capturedSignal = init?.signal as AbortSignal;
        return new Promise(() => {
          // Keep unresolved
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setLookupQuery('Jane Doe');
    });

    act(() => {
      void result.current.handleLookup();
    });

    expect(result.current.isLookupLoading).toBe(true);
    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);

    // Switch tabs
    act(() => {
      result.current.setActiveTab('instructions');
    });

    expect(capturedSignal!.aborted).toBe(true);
    expect(result.current.activeTab).toBe('instructions');
    expect(result.current.isLookupLoading).toBe(false);
    expect(result.current.lookupError).toBe('');
    expect(result.current.lookupRateLimited).toBe(false);
    expect(result.current.unmatched).toBe(false);
  });

  it('aborts in-flight requests and clears timer on unmount', async () => {
    jest.useFakeTimers();

    let capturedSignal: AbortSignal | null = null;
    const fetchMock = jest.fn<typeof fetch>().mockImplementation((url, init) => {
      if (url === '/api/guest/lookup') {
        capturedSignal = init?.signal as AbortSignal;
        return new Promise(() => {});
      }
      return Promise.reject(new Error('Unknown url'));
    });
    globalWithFetch.fetch = fetchMock;

    const { result, unmount } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setLookupQuery('Pending Guest');
    });

    act(() => {
      void result.current.handleLookup();
    });

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);

    unmount();

    expect(capturedSignal!.aborted).toBe(true);

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPush).not.toHaveBeenCalled();

    jest.useRealTimers();
  });

  it('supports functional updates for showPasscode and toggling helper', () => {
    const { result } = renderHook(() => useGuestLoginMachine());

    expect(result.current.showPasscode).toBe(false);

    act(() => {
      result.current.toggleShowPasscode();
    });
    expect(result.current.showPasscode).toBe(true);

    act(() => {
      result.current.setShowPasscode((prev) => !prev);
    });
    expect(result.current.showPasscode).toBe(false);

    act(() => {
      result.current.setShowHelp(true);
    });
    expect(result.current.showHelp).toBe(true);
  });
});
