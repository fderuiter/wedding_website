import { renderHook, act } from '@testing-library/react';
import {
  useGuestLoginMachine,
  guestLoginMachineReducer,
  initialGuestLoginMachineState,
  isAbortError,
  getSafeCallbackUrl,
  stripCodeFromCallbackUrl,
  type GuestLoginMachineState,
  type GuestLoginMachineAction,
  type UseGuestLoginMachineOptions,
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
      error: 'Incorrect passcode or invitation code.',
    });
    expect(state.status).toBe('idle');
    expect(state.error).toBe('Incorrect passcode or invitation code.');
  });

  it('handles field changes: SET_PASSCODE, SET_SHOW_PASSCODE, SET_SHOW_HELP', () => {
    let state: GuestLoginMachineState = guestLoginMachineReducer(initialGuestLoginMachineState, {
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
      type: 'SET_SHOW_HELP',
      show: true,
    });
    expect(state.showHelp).toBe(true);
  });
});

describe('Helper Utilities', () => {
  it('validates safe callback URLs', () => {
    expect(getSafeCallbackUrl(null)).toBe('/');
    expect(getSafeCallbackUrl(undefined)).toBe('/');
    expect(getSafeCallbackUrl('')).toBe('/');
    expect(getSafeCallbackUrl('/rsvp')).toBe('/rsvp');
    expect(getSafeCallbackUrl('/rsvp?tab=dinner#details')).toBe('/rsvp?tab=dinner#details');
    expect(getSafeCallbackUrl('//malicious.com')).toBe('/');
    expect(getSafeCallbackUrl('///evil.test')).toBe('/');
    expect(getSafeCallbackUrl('/\\malicious.com')).toBe('/');
    expect(getSafeCallbackUrl('/\\evil.test')).toBe('/');
    expect(getSafeCallbackUrl('/\t/evil.test')).toBe('/');
    expect(getSafeCallbackUrl('/\n/evil.test')).toBe('/');
    expect(getSafeCallbackUrl('/\r/evil.test')).toBe('/');
    expect(getSafeCallbackUrl('/\u0000/evil.test')).toBe('/');
    expect(getSafeCallbackUrl('/\u007F/evil.test')).toBe('/');
    expect(getSafeCallbackUrl('/foo/..///evil.test')).toBe('/');
    expect(getSafeCallbackUrl('https://malicious.com')).toBe('/');
    expect(getSafeCallbackUrl('/guest/login')).toBe('/');
    expect(getSafeCallbackUrl('/guest/login?callbackUrl=%2Frsvp')).toBe('/');
    expect(getSafeCallbackUrl('/guest/login#help')).toBe('/');
    expect(getSafeCallbackUrl('/rsvp/../guest/login')).toBe('/');
  });

  it('strips code query parameters from callbackUrl while preserving other query parameters and hashes', () => {
    expect(stripCodeFromCallbackUrl('/guest?code=ALICE2026')).toBe('/guest');
    expect(stripCodeFromCallbackUrl('/guest?tab=rsvp&code=ALICE2026&view=full#details')).toBe(
      '/guest?tab=rsvp&view=full#details'
    );
    expect(stripCodeFromCallbackUrl('/rsvp')).toBe('/rsvp');
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

  it('performs unified sign-in with AbortSignal and navigates on success', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const options: UseGuestLoginMachineOptions = { callbackUrl: '/dashboard' };
    const { result } = renderHook(() => useGuestLoginMachine(options));

    act(() => {
      result.current.setPasscode('LOVE2026');
    });

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'LOVE2026' }),
      signal: expect.any(AbortSignal),
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.isLoginDisabled).toBe(false);
    expect(result.current.error).toBe('');
    expect(mockPush).toHaveBeenCalledWith('/dashboard');
  });

  it('uses searchParams callbackUrl and custom onNavigate callback when provided', async () => {
    mockGetParam.mockReturnValue('/registry');
    const onNavigate = jest.fn();

    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() =>
      useGuestLoginMachine({
        onNavigate,
        initialState: { passcode: 'wedding2026' },
      })
    );

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(onNavigate).toHaveBeenCalledWith('/registry');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('handles login failure and records plain-language error message', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Incorrect passcode or invitation code.' }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setPasscode('wrong');
    });

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.isLoginDisabled).toBe(false);
    expect(result.current.error).toBe('Incorrect passcode or invitation code.');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('replaces raw technical Unauthorized or 500 error strings with plain user-facing copy', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal Server Error' }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setPasscode('wrong');
    });

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(result.current.error).toBe(
      'Incorrect passcode or invitation code. Please check your invitation and try again.'
    );
    expect(result.current.error).not.toMatch(/^unauthorized$/i);

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(result.current.error).toBe(
      'Something went wrong while signing you in. Please try again in a moment.'
    );
  });

  it('handles network connection failures gracefully', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockRejectedValue(new Error('Network down'));
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setPasscode('wedding2026');
    });

    await act(async () => {
      await result.current.handleLogin();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.isLoginDisabled).toBe(false);
    expect(result.current.error).toBe('A connection error occurred. Please try again.');
  });

  it('aborts in-flight login request on unmount', async () => {
    let capturedSignal: AbortSignal | null = null;
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockImplementation((_url, init) => {
      capturedSignal = init?.signal as AbortSignal;
      return new Promise(() => {});
    });
    globalWithFetch.fetch = fetchMock;

    const { result, unmount } = renderHook(() => useGuestLoginMachine());

    act(() => {
      result.current.setPasscode('wedding2026');
    });

    act(() => {
      void result.current.handleLogin();
    });

    expect(capturedSignal).not.toBeNull();
    expect(capturedSignal!.aborted).toBe(false);

    unmount();

    expect(capturedSignal!.aborted).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('supports boolean and functional updates for showPasscode and showHelp', () => {
    const { result } = renderHook(() => useGuestLoginMachine());

    expect(result.current.showPasscode).toBe(false);

    act(() => {
      result.current.setShowPasscode(true);
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

  it('prefills and auto-submits a code query parameter on mount, strips code from history and callbackUrl on success', async () => {
    window.history.pushState({}, '', '/guest/login?callbackUrl=%2Fguest%3Fcode%3DALICE2026&code=ALICE2026');
    const replaceStateSpy = jest.spyOn(window.history, 'replaceState');

    mockGetParam.mockImplementation((key: string) => {
      if (key === 'code') return 'ALICE2026';
      if (key === 'callbackUrl') return '/guest?code=ALICE2026';
      return null;
    });

    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/guest/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode: 'ALICE2026' }),
      signal: expect.any(AbortSignal),
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
    expect(replaceStateSpy).toHaveBeenCalledWith(
      expect.anything(),
      '',
      '/guest/login?callbackUrl=%2Fguest%3Fcode%3DALICE2026'
    );
    expect(mockPush).toHaveBeenCalledWith('/guest');
  });

  it('falls back to / when auto-submitting code with control-character or /guest/login callbackUrl', async () => {
    mockGetParam.mockImplementation((key: string) => {
      if (key === 'code') return 'ALICE2026';
      if (key === 'callbackUrl') return '/\t/127.0.0.1:4444/canary-target';
      return null;
    });

    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { result } = renderHook(() => useGuestLoginMachine());

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('');
    expect(mockPush).toHaveBeenCalledWith('/');
  });

  it('restores focus to #passcode after LOGIN_FAILURE when help dialog is closed', async () => {
    const passcodeEl = document.createElement('input');
    passcodeEl.id = 'passcode';
    document.body.appendChild(passcodeEl);

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid passcode' }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    try {
      const { result } = renderHook(() => useGuestLoginMachine());
      result.current.passcodeInputRef.current = passcodeEl;

      act(() => {
        result.current.setPasscode('BADPASS');
      });

      await act(async () => {
        await result.current.handleLogin();
      });

      expect(result.current.error).toBe('Invalid passcode');
      expect(result.current.loading).toBe(false);
      expect(document.activeElement).toBe(passcodeEl);
    } finally {
      passcodeEl.remove();
    }
  });
});
