'use client';

import { useReducer, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type GuestLoginMachineStatus =
  | 'idle'
  | 'logging_in'
  | 'authenticated';

export interface GuestLoginMachineState {
  status: GuestLoginMachineStatus;
  passcode: string;
  showPasscode: boolean;
  error: string;
  showHelp: boolean;
}

export type GuestLoginMachineAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS' }
  | { type: 'LOGIN_FAILURE'; error: string }
  | { type: 'SET_PASSCODE'; passcode: string }
  | { type: 'SET_SHOW_PASSCODE'; show: boolean }
  | { type: 'TOGGLE_SHOW_PASSCODE' }
  | { type: 'SET_SHOW_HELP'; show: boolean }
  | { type: 'RESET' };

export const initialGuestLoginMachineState: GuestLoginMachineState = {
  status: 'idle',
  passcode: '',
  showPasscode: false,
  error: '',
  showHelp: false,
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

export function stripCodeFromCallbackUrl(url: string): string {
  const hashIdx = url.indexOf('#');
  const hash = hashIdx !== -1 ? url.slice(hashIdx) : '';
  const withoutHash = hashIdx !== -1 ? url.slice(0, hashIdx) : url;
  const queryIdx = withoutHash.indexOf('?');
  if (queryIdx === -1) {
    return url;
  }

  const pathname = withoutHash.slice(0, queryIdx);
  const params = new URLSearchParams(withoutHash.slice(queryIdx + 1));
  if (!params.has('code')) {
    return url;
  }

  params.delete('code');
  const nextQuery = params.toString();
  return `${pathname}${nextQuery ? `?${nextQuery}` : ''}${hash}`;
}

function stripCodeFromBrowserHistory(): void {
  if (typeof window === 'undefined' || typeof window.history?.replaceState !== 'function') {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code')) {
    return;
  }
  params.delete('code');
  const nextQuery = params.toString();
  const cleanUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
  window.history.replaceState(window.history.state, '', cleanUrl);
}

function extractInitialCodeFromParams(
  searchParams: Pick<URLSearchParams, 'get'> | null | undefined,
  explicitCallbackUrl?: string | null
): string | null {
  const directCode = searchParams?.get('code');
  if (typeof directCode === 'string') {
    const trimmed = directCode.trim();
    if (trimmed && !trimmed.startsWith('/')) {
      return trimmed;
    }
  }

  const rawCallback =
    explicitCallbackUrl !== undefined
      ? explicitCallbackUrl
      : searchParams?.get('callbackUrl');
  if (typeof rawCallback === 'string' && rawCallback.includes('?')) {
    const queryPart = rawCallback.slice(rawCallback.indexOf('?') + 1).split('#')[0];
    const embeddedCode = new URLSearchParams(queryPart).get('code')?.trim();
    if (embeddedCode && !embeddedCode.startsWith('/')) {
      return embeddedCode;
    }
  }

  if (typeof window !== 'undefined' && window.location?.search) {
    const winCode = new URLSearchParams(window.location.search).get('code')?.trim();
    if (winCode && !winCode.startsWith('/')) {
      return winCode;
    }
  }

  return null;
}

export function selectIsLoading(state: GuestLoginMachineState): boolean {
  return state.status === 'logging_in';
}

export function selectIsBusy(state: GuestLoginMachineState): boolean {
  return state.status === 'logging_in';
}

export function selectIsLoginDisabled(state: GuestLoginMachineState): boolean {
  return selectIsBusy(state);
}

export function selectIsAuthenticated(state: GuestLoginMachineState): boolean {
  return state.status === 'authenticated';
}

function toPlainLoginErrorMessage(rawError: unknown, status: number): string {
  const trimmed = typeof rawError === 'string' ? rawError.trim() : '';
  if (status >= 500 || /^internal server error$/i.test(trimmed)) {
    return 'Something went wrong while signing you in. Please try again in a moment.';
  }
  if (!trimmed || /^unauthorized$/i.test(trimmed)) {
    return 'Incorrect passcode or invitation code. Please check your invitation and try again.';
  }
  return trimmed;
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
  initialState?: Partial<GuestLoginMachineState>;
}

export function useGuestLoginMachine(options?: UseGuestLoginMachineOptions) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const initialUrlCode =
    options?.initialState?.passcode === undefined
      ? extractInitialCodeFromParams(searchParams, options?.callbackUrl)
      : null;

  const [state, rawDispatch] = useReducer(guestLoginMachineReducer, {
    ...initialGuestLoginMachineState,
    ...(initialUrlCode ? { passcode: initialUrlCode } : {}),
    ...options?.initialState,
  });

  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((action: GuestLoginMachineAction) => {
    stateRef.current = guestLoginMachineReducer(stateRef.current, action);
    rawDispatch(action);
  }, []);

  const loginAbortControllerRef = useRef<AbortController | null>(null);
  const autoSubmittedCodeRef = useRef<string | null>(null);

  const cancelInFlightLogin = useCallback(() => {
    if (loginAbortControllerRef.current) {
      loginAbortControllerRef.current.abort();
      loginAbortControllerRef.current = null;
    }
  }, []);

  const navigateToDestination = useCallback((url: string) => {
    if (optionsRef.current?.onNavigate) {
      optionsRef.current.onNavigate(url);
    } else {
      router.refresh?.();
      router.push(url);
    }
  }, [router]);

  const getTargetCallbackUrl = useCallback((): string => {
    if (optionsRef.current?.callbackUrl !== undefined) {
      return stripCodeFromCallbackUrl(getSafeCallbackUrl(optionsRef.current.callbackUrl));
    }
    return stripCodeFromCallbackUrl(
      getSafeCallbackUrl(searchParams?.get('callbackUrl') ?? null)
    );
  }, [searchParams]);

  const submitPasscode = useCallback(
    async (passcodeValue: string) => {
      cancelInFlightLogin();

      const controller = new AbortController();
      loginAbortControllerRef.current = controller;

      dispatch({ type: 'LOGIN_START' });

      try {
        const res = await fetch('/api/guest/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passcode: passcodeValue }),
          signal: controller.signal,
        });

        const data = await res.json().catch(() => ({}));

        if (controller.signal.aborted) {
          return;
        }

        if (!res.ok) {
          dispatch({
            type: 'LOGIN_FAILURE',
            error: toPlainLoginErrorMessage(data.error, res.status),
          });
        } else {
          stripCodeFromBrowserHistory();
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
    [cancelInFlightLogin, dispatch, navigateToDestination, getTargetCallbackUrl]
  );

  const handleLogin = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();
      await submitPasscode(stateRef.current.passcode);
    },
    [submitPasscode]
  );

  useEffect(() => {
    if (optionsRef.current?.initialState?.passcode !== undefined) {
      return;
    }

    const urlCode = extractInitialCodeFromParams(
      searchParams,
      optionsRef.current?.callbackUrl
    );
    if (!urlCode || autoSubmittedCodeRef.current === urlCode) {
      return;
    }

    autoSubmittedCodeRef.current = urlCode;
    if (stateRef.current.passcode !== urlCode) {
      dispatch({ type: 'SET_PASSCODE', passcode: urlCode });
    }
    void submitPasscode(urlCode);
  }, [searchParams, dispatch, submitPasscode]);

  const setPasscode = useCallback((passcode: string) => {
    dispatch({ type: 'SET_PASSCODE', passcode });
  }, [dispatch]);

  const setShowPasscode = useCallback((show: boolean | ((_prev: boolean) => boolean)) => {
    if (typeof show === 'function') {
      dispatch({ type: 'SET_SHOW_PASSCODE', show: show(stateRef.current.showPasscode) });
    } else {
      dispatch({ type: 'SET_SHOW_PASSCODE', show });
    }
  }, [dispatch]);

  const toggleShowPasscode = useCallback(() => {
    dispatch({ type: 'TOGGLE_SHOW_PASSCODE' });
  }, [dispatch]);

  const setShowHelp = useCallback((show: boolean) => {
    dispatch({ type: 'SET_SHOW_HELP', show });
  }, [dispatch]);

  useEffect(() => {
    return () => {
      if (loginAbortControllerRef.current) {
        autoSubmittedCodeRef.current = null;
      }
      cancelInFlightLogin();
    };
  }, [cancelInFlightLogin]);

  const isLoading = selectIsLoading(state);
  const isBusy = selectIsBusy(state);
  const isLoginDisabled = selectIsLoginDisabled(state);
  const isAuthenticated = selectIsAuthenticated(state);

  return {
    state,
    dispatch,
    handleLogin,
    setPasscode,
    setShowPasscode,
    toggleShowPasscode,
    setShowHelp,
    cancelInFlightLogin,
    isLoading,
    isBusy,
    isLoginDisabled,
    isAuthenticated,
    passcode: state.passcode,
    showPasscode: state.showPasscode,
    error: state.error,
    loading: isLoading,
    showHelp: state.showHelp,
    status: state.status,
  };
}
