'use client';

import { useReducer, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type GuestLoginMachineStatus =
  | 'idle'
  | 'logging_in'
  | 'looking_up'
  | 'lookup_success'
  | 'authenticated';

export interface GuestLoginMachineState {
  status: GuestLoginMachineStatus;
  passcode: string;
  showPasscode: boolean;
  error: string;
  showHelp: boolean;
  activeTab: 'instructions' | 'lookup';
  lookupQuery: string;
  lookupError: string;
  lookupRateLimited: boolean;
  unmatched: boolean;
  matchedGuest: { guestName: string; code: string } | null;
}

export type GuestLoginMachineAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS' }
  | { type: 'LOGIN_FAILURE'; error: string }
  | { type: 'LOOKUP_START' }
  | { type: 'LOOKUP_SUCCESS'; matchedGuest: { guestName: string; code: string } }
  | { type: 'LOOKUP_FAILURE'; error: string }
  | { type: 'LOOKUP_RATE_LIMITED'; error: string }
  | { type: 'LOOKUP_UNMATCHED'; error: string }
  | { type: 'SET_PASSCODE'; passcode: string }
  | { type: 'SET_SHOW_PASSCODE'; show: boolean }
  | { type: 'TOGGLE_SHOW_PASSCODE' }
  | { type: 'SET_SHOW_HELP'; show: boolean }
  | { type: 'SET_ACTIVE_TAB'; tab: 'instructions' | 'lookup' }
  | { type: 'SET_LOOKUP_QUERY'; query: string }
  | { type: 'RESET_LOOKUP_ERRORS' }
  | { type: 'CLEAR_MATCHED_GUEST' }
  | { type: 'RESET' };

export const initialGuestLoginMachineState: GuestLoginMachineState = {
  status: 'idle',
  passcode: '',
  showPasscode: false,
  error: '',
  showHelp: false,
  activeTab: 'instructions',
  lookupQuery: '',
  lookupError: '',
  lookupRateLimited: false,
  unmatched: false,
  matchedGuest: null,
};

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const errorObj = err as { name?: string };
  return errorObj.name === 'AbortError';
}

export function getSafeCallbackUrl(url: string | null | undefined): string {
  if (!url) return '/';
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) {
    return url;
  }
  return '/';
}

export function selectIsLoading(state: GuestLoginMachineState): boolean {
  return state.status === 'logging_in';
}

export function selectIsLookupLoading(state: GuestLoginMachineState): boolean {
  return state.status === 'looking_up';
}

export function selectIsBusy(state: GuestLoginMachineState): boolean {
  return state.status === 'logging_in' || state.status === 'looking_up';
}

export function selectIsLoginDisabled(state: GuestLoginMachineState): boolean {
  return selectIsBusy(state);
}

export function selectIsLookupDisabled(state: GuestLoginMachineState): boolean {
  return selectIsBusy(state) || state.lookupRateLimited;
}

export function selectIsAuthenticated(state: GuestLoginMachineState): boolean {
  return state.status === 'authenticated';
}

export function selectHasMatchedGuest(state: GuestLoginMachineState): boolean {
  return state.matchedGuest !== null;
}

export function guestLoginMachineReducer(
  state: GuestLoginMachineState,
  action: GuestLoginMachineAction
): GuestLoginMachineState {
  switch (action.type) {
    case 'LOGIN_START':
      return {
        ...state,
        status: 'logging_in',
        error: '',
      };

    case 'LOGIN_SUCCESS':
      return {
        ...state,
        status: 'authenticated',
        error: '',
      };

    case 'LOGIN_FAILURE':
      return {
        ...state,
        status: 'idle',
        error: action.error,
      };

    case 'LOOKUP_START':
      return {
        ...state,
        status: 'looking_up',
        lookupError: '',
        unmatched: false,
        lookupRateLimited: false,
        matchedGuest: null,
      };

    case 'LOOKUP_SUCCESS':
      return {
        ...state,
        status: 'lookup_success',
        matchedGuest: action.matchedGuest,
        lookupError: '',
        unmatched: false,
        lookupRateLimited: false,
      };

    case 'LOOKUP_FAILURE':
      return {
        ...state,
        status: 'idle',
        lookupError: action.error,
      };

    case 'LOOKUP_RATE_LIMITED':
      return {
        ...state,
        status: 'idle',
        lookupRateLimited: true,
        lookupError: action.error,
        matchedGuest: null,
      };

    case 'LOOKUP_UNMATCHED':
      return {
        ...state,
        status: 'idle',
        unmatched: true,
        lookupError: action.error,
        matchedGuest: null,
      };

    case 'SET_PASSCODE':
      return {
        ...state,
        passcode: action.passcode,
      };

    case 'SET_SHOW_PASSCODE':
      return {
        ...state,
        showPasscode: action.show,
      };

    case 'TOGGLE_SHOW_PASSCODE':
      return {
        ...state,
        showPasscode: !state.showPasscode,
      };

    case 'SET_SHOW_HELP':
      return {
        ...state,
        showHelp: action.show,
      };

    case 'SET_ACTIVE_TAB':
      return {
        ...state,
        activeTab: action.tab,
        lookupError: '',
        lookupRateLimited: false,
        unmatched: false,
        status: state.status === 'looking_up' ? 'idle' : state.status,
      };

    case 'SET_LOOKUP_QUERY':
      return {
        ...state,
        lookupQuery: action.query,
        lookupError: '',
        lookupRateLimited: false,
        unmatched: false,
      };

    case 'RESET_LOOKUP_ERRORS':
      return {
        ...state,
        lookupError: '',
        lookupRateLimited: false,
        unmatched: false,
      };

    case 'CLEAR_MATCHED_GUEST':
      return {
        ...state,
        matchedGuest: null,
        status: state.status === 'lookup_success' ? 'idle' : state.status,
      };

    case 'RESET':
      return {
        ...initialGuestLoginMachineState,
      };

    default:
      return state;
  }
}

export interface UseGuestLoginMachineOptions {
  callbackUrl?: string | null;
  onNavigate?: (_url: string) => void;
  redirectDelayMs?: number;
  initialState?: Partial<GuestLoginMachineState>;
}

export function useGuestLoginMachine(options?: UseGuestLoginMachineOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [state, dispatch] = useReducer(guestLoginMachineReducer, {
    ...initialGuestLoginMachineState,
    ...options?.initialState,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const loginAbortControllerRef = useRef<AbortController | null>(null);
  const lookupAbortControllerRef = useRef<AbortController | null>(null);
  const redirectTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearRedirectTimer = useCallback(() => {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  }, []);

  const cancelInFlightLookup = useCallback(() => {
    if (lookupAbortControllerRef.current) {
      lookupAbortControllerRef.current.abort();
      lookupAbortControllerRef.current = null;
    }
  }, []);

  const cancelInFlightLogin = useCallback(() => {
    if (loginAbortControllerRef.current) {
      loginAbortControllerRef.current.abort();
      loginAbortControllerRef.current = null;
    }
  }, []);

  const cancelAllInFlightRequests = useCallback(() => {
    cancelInFlightLookup();
    cancelInFlightLogin();
  }, [cancelInFlightLookup, cancelInFlightLogin]);

  const navigateToDestination = useCallback((url: string) => {
    if (optionsRef.current?.onNavigate) {
      optionsRef.current.onNavigate(url);
    } else {
      router.push(url);
    }
  }, [router]);

  const getTargetCallbackUrl = useCallback((): string => {
    if (optionsRef.current?.callbackUrl !== undefined) {
      return getSafeCallbackUrl(optionsRef.current.callbackUrl);
    }
    return getSafeCallbackUrl(searchParams?.get('callbackUrl') ?? null);
  }, [searchParams]);

  const handleLogin = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();

      // Cancel any active lookup request, active login request, and clear redirect timer
      cancelInFlightLookup();
      cancelInFlightLogin();
      clearRedirectTimer();

      const controller = new AbortController();
      loginAbortControllerRef.current = controller;

      dispatch({ type: 'LOGIN_START' });

      try {
        const res = await fetch('/api/guest/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: stateRef.current.passcode }),
          signal: controller.signal,
        });

        const data = await res.json().catch(() => ({}));

        if (controller.signal.aborted) {
          return;
        }

        if (!res.ok) {
          dispatch({
            type: 'LOGIN_FAILURE',
            error: data.error || 'Incorrect passcode. Please try again.',
          });
        } else {
          dispatch({ type: 'LOGIN_SUCCESS' });
          navigateToDestination(getTargetCallbackUrl());
        }
      } catch (err: unknown) {
        if (isAbortError(err) || controller.signal.aborted) {
          return;
        }
        dispatch({
          type: 'LOGIN_FAILURE',
          error: 'A connection error occurred. Please try again.',
        });
      } finally {
        if (loginAbortControllerRef.current === controller) {
          loginAbortControllerRef.current = null;
        }
      }
    },
    [cancelInFlightLookup, cancelInFlightLogin, clearRedirectTimer, navigateToDestination, getTargetCallbackUrl]
  );

  const handleLookup = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();

      // Cancel any active lookup request and clear redirect timer
      cancelInFlightLookup();
      cancelInFlightLogin();
      clearRedirectTimer();

      const query = stateRef.current.lookupQuery.trim();
      if (!query) {
        dispatch({
          type: 'LOOKUP_FAILURE',
          error: 'Please enter your name or email address.',
        });
        return;
      }

      if (query.includes('@')) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(query)) {
          dispatch({
            type: 'LOOKUP_FAILURE',
            error: 'Invalid email format.',
          });
          return;
        }
      } else if (query.length < 2) {
        dispatch({
          type: 'LOOKUP_FAILURE',
          error: 'Name must be at least 2 characters.',
        });
        return;
      }

      const controller = new AbortController();
      lookupAbortControllerRef.current = controller;

      dispatch({ type: 'LOOKUP_START' });

      try {
        const res = await fetch('/api/guest/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });

        const data = await res.json().catch(() => ({}));

        if (controller.signal.aborted) {
          return;
        }

        if (res.status === 429) {
          dispatch({
            type: 'LOOKUP_RATE_LIMITED',
            error: data.error || 'Too many requests, please try again later.',
          });
          return;
        }

        if (!res.ok || !data.success) {
          dispatch({
            type: 'LOOKUP_UNMATCHED',
            error: data.error || 'No invitation found matching the provided details.',
          });
          return;
        }

        const guestName = data.guestName || data.data?.guestName || '';
        const code = data.code || data.data?.code || '';
        dispatch({
          type: 'LOOKUP_SUCCESS',
          matchedGuest: { guestName, code },
        });

        clearRedirectTimer();
        const delay = optionsRef.current?.redirectDelayMs ?? 4000;
        redirectTimerRef.current = setTimeout(() => {
          navigateToDestination(getTargetCallbackUrl());
        }, delay);
      } catch (err: unknown) {
        if (isAbortError(err) || controller.signal.aborted) {
          return;
        }
        dispatch({
          type: 'LOOKUP_FAILURE',
          error: 'A connection error occurred. Please try again.',
        });
      } finally {
        if (lookupAbortControllerRef.current === controller) {
          lookupAbortControllerRef.current = null;
        }
      }
    },
    [cancelInFlightLookup, cancelInFlightLogin, clearRedirectTimer, navigateToDestination, getTargetCallbackUrl]
  );

  const setActiveTab = useCallback(
    (tab: 'instructions' | 'lookup') => {
      cancelInFlightLookup();
      clearRedirectTimer();
      dispatch({ type: 'SET_ACTIVE_TAB', tab });
    },
    [cancelInFlightLookup, clearRedirectTimer]
  );

  const handleContinueToPortal = useCallback(() => {
    clearRedirectTimer();
    navigateToDestination(getTargetCallbackUrl());
  }, [clearRedirectTimer, navigateToDestination, getTargetCallbackUrl]);

  const setPasscode = useCallback((passcode: string) => {
    dispatch({ type: 'SET_PASSCODE', passcode });
  }, []);

  const setShowPasscode = useCallback((show: boolean | ((_prev: boolean) => boolean)) => {
    if (typeof show === 'function') {
      dispatch({ type: 'SET_SHOW_PASSCODE', show: show(stateRef.current.showPasscode) });
    } else {
      dispatch({ type: 'SET_SHOW_PASSCODE', show });
    }
  }, []);

  const toggleShowPasscode = useCallback(() => {
    dispatch({ type: 'TOGGLE_SHOW_PASSCODE' });
  }, []);

  const setShowHelp = useCallback((show: boolean) => {
    dispatch({ type: 'SET_SHOW_HELP', show });
  }, []);

  const setLookupQuery = useCallback((query: string) => {
    dispatch({ type: 'SET_LOOKUP_QUERY', query });
  }, []);

  const resetLookupErrors = useCallback(() => {
    dispatch({ type: 'RESET_LOOKUP_ERRORS' });
  }, []);

  // Cleanup abort controllers and timers on unmount
  useEffect(() => {
    return () => {
      cancelAllInFlightRequests();
      clearRedirectTimer();
    };
  }, [cancelAllInFlightRequests, clearRedirectTimer]);

  const isLoading = selectIsLoading(state);
  const isLookupLoading = selectIsLookupLoading(state);
  const isBusy = selectIsBusy(state);
  const isLoginDisabled = selectIsLoginDisabled(state);
  const isLookupDisabled = selectIsLookupDisabled(state);
  const isAuthenticated = selectIsAuthenticated(state);
  const hasMatchedGuest = selectHasMatchedGuest(state);

  return {
    state,
    dispatch,
    // Actions & Handlers
    handleLogin,
    handleLookup,
    handleContinueToPortal,
    setPasscode,
    setShowPasscode,
    toggleShowPasscode,
    setShowHelp,
    setActiveTab,
    setLookupQuery,
    resetLookupErrors,
    cancelInFlightLookup,
    cancelInFlightLogin,
    cancelAllInFlightRequests,
    clearRedirectTimer,
    // Selectors & Derived State
    isLoading,
    isLookupLoading,
    isBusy,
    isLoginDisabled,
    isLookupDisabled,
    isAuthenticated,
    hasMatchedGuest,
    // State Convenience Accessors
    passcode: state.passcode,
    showPasscode: state.showPasscode,
    error: state.error,
    loading: isLoading,
    showHelp: state.showHelp,
    activeTab: state.activeTab,
    lookupQuery: state.lookupQuery,
    lookupLoading: isLookupLoading,
    lookupError: state.lookupError,
    lookupRateLimited: state.lookupRateLimited,
    unmatched: state.unmatched,
    matchedGuest: state.matchedGuest,
    status: state.status,
  };
}
