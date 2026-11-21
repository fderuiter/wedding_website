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
  unlockByName?: boolean;
  firstName?: string;
  lastName?: string;
  disambiguationEmail?: string;
  disambiguationZip?: string;
  requiresDisambiguation?: boolean;
  lookupNotFound?: boolean;
}

export type GuestLoginMachineAction =
  | { type: 'LOGIN_START' }
  | { type: 'LOGIN_SUCCESS' }
  | { type: 'LOGIN_FAILURE'; error: string }
  | { type: 'LOOKUP_DISAMBIGUATION_REQUIRED'; error: string }
  | { type: 'LOOKUP_NOT_FOUND'; error: string }
  | { type: 'SET_PASSCODE'; passcode: string }
  | { type: 'SET_SHOW_PASSCODE'; show: boolean }
  | { type: 'TOGGLE_SHOW_PASSCODE' }
  | { type: 'SET_SHOW_HELP'; show: boolean }
  | { type: 'SET_UNLOCK_BY_NAME'; unlockByName: boolean }
  | { type: 'SET_FIRST_NAME'; firstName: string }
  | { type: 'SET_LAST_NAME'; lastName: string }
  | { type: 'SET_DISAMBIGUATION_EMAIL'; email: string }
  | { type: 'SET_DISAMBIGUATION_ZIP'; zipCode: string }
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
        lookupNotFound: false,
      };

    case 'LOGIN_SUCCESS':
      return {
        ...state,
        status: 'authenticated',
        error: '',
        requiresDisambiguation: false,
        lookupNotFound: false,
      };

    case 'LOGIN_FAILURE':
      return {
        ...state,
        status: 'idle',
        error: action.error,
      };

    case 'LOOKUP_DISAMBIGUATION_REQUIRED':
      return {
        ...state,
        status: 'idle',
        error: action.error,
        requiresDisambiguation: true,
        lookupNotFound: false,
      };

    case 'LOOKUP_NOT_FOUND':
      return {
        ...state,
        status: 'idle',
        error: action.error,
        lookupNotFound: true,
        requiresDisambiguation: false,
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

    case 'SET_UNLOCK_BY_NAME':
      return {
        ...state,
        unlockByName: action.unlockByName,
        error: '',
        requiresDisambiguation: false,
        lookupNotFound: false,
      };

    case 'SET_FIRST_NAME':
      return {
        ...state,
        firstName: action.firstName,
        lookupNotFound: false,
      };

    case 'SET_LAST_NAME':
      return {
        ...state,
        lastName: action.lastName,
        lookupNotFound: false,
      };

    case 'SET_DISAMBIGUATION_EMAIL':
      return {
        ...state,
        disambiguationEmail: action.email,
      };

    case 'SET_DISAMBIGUATION_ZIP':
      return {
        ...state,
        disambiguationZip: action.zipCode,
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

  const getNameLookupCallbackUrl = useCallback((): string => {
    const explicitCallback =
      optionsRef.current?.callbackUrl !== undefined
        ? optionsRef.current.callbackUrl
        : searchParams?.get('callbackUrl') ?? null;
    if (explicitCallback && explicitCallback.trim()) {
      return stripCodeFromCallbackUrl(getSafeCallbackUrl(explicitCallback));
    }
    return '/guest';
  }, [searchParams]);

  const submitNameLookup = useCallback(async () => {
    const current = stateRef.current;
    const passcodeValue = current.passcode.trim();
    const firstName = (current.firstName || '').trim();
    const lastName = (current.lastName || '').trim();
    const email = (current.disambiguationEmail || '').trim();
    const zipCode = (current.disambiguationZip || '').trim();

    if (!passcodeValue) {
      dispatch({
        type: 'LOGIN_FAILURE',
        error: 'Please enter the shared event passcode.',
      });
      return;
    }

    if (!firstName || !lastName) {
      dispatch({
        type: 'LOGIN_FAILURE',
        error: 'Please enter both your first and last name to unlock your invitation.',
      });
      return;
    }

    cancelInFlightLogin();

    const controller = new AbortController();
    loginAbortControllerRef.current = controller;

    dispatch({ type: 'LOGIN_START' });

    try {
      const loginRes = await fetch('/api/guest/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcodeValue }),
        signal: controller.signal,
      });

      const loginData = await loginRes.json().catch(() => ({}));
      if (controller.signal.aborted) {
        return;
      }

      if (!loginRes.ok) {
        dispatch({
          type: 'LOGIN_FAILURE',
          error: toPlainLoginErrorMessage(loginData.error, loginRes.status),
        });
        return;
      }

      const lookupRes = await fetch('/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName,
          lastName,
          ...(email ? { email } : {}),
          ...(zipCode ? { zipCode } : {}),
        }),
        signal: controller.signal,
      });

      const lookupData = await lookupRes.json().catch(() => ({}));
      if (controller.signal.aborted) {
        return;
      }

      if (lookupRes.status === 409 && lookupData?.details?.requiresDisambiguation) {
        dispatch({
          type: 'LOOKUP_DISAMBIGUATION_REQUIRED',
          error:
            typeof lookupData.error === 'string' && lookupData.error.trim()
              ? lookupData.error
              : 'Multiple invitations match that name. Please enter your email address or postal ZIP code to confirm your household.',
        });
        return;
      }

      if (lookupRes.status === 404) {
        dispatch({
          type: 'LOOKUP_NOT_FOUND',
          error:
            typeof lookupData.error === 'string' && lookupData.error.trim()
              ? lookupData.error
              : 'We could not find an invitation matching that first and last name.',
        });
        return;
      }

      if (!lookupRes.ok) {
        dispatch({
          type: 'LOGIN_FAILURE',
          error: toPlainLoginErrorMessage(lookupData.error, lookupRes.status),
        });
        return;
      }

      stripCodeFromBrowserHistory();
      dispatch({ type: 'LOGIN_SUCCESS' });
      navigateToDestination(getNameLookupCallbackUrl());
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
  }, [cancelInFlightLogin, dispatch, navigateToDestination, getNameLookupCallbackUrl]);

  const handleLogin = useCallback(
    async (e?: FormEvent) => {
      if (e) e.preventDefault();
      if (stateRef.current.unlockByName) {
        await submitNameLookup();
        return;
      }
      await submitPasscode(stateRef.current.passcode);
    },
    [submitNameLookup, submitPasscode]
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

  const setUnlockByName = useCallback((unlockByName: boolean) => {
    dispatch({ type: 'SET_UNLOCK_BY_NAME', unlockByName });
  }, [dispatch]);

  const setFirstName = useCallback((firstName: string) => {
    dispatch({ type: 'SET_FIRST_NAME', firstName });
  }, [dispatch]);

  const setLastName = useCallback((lastName: string) => {
    dispatch({ type: 'SET_LAST_NAME', lastName });
  }, [dispatch]);

  const setDisambiguationEmail = useCallback((email: string) => {
    dispatch({ type: 'SET_DISAMBIGUATION_EMAIL', email });
  }, [dispatch]);

  const setDisambiguationZip = useCallback((zipCode: string) => {
    dispatch({ type: 'SET_DISAMBIGUATION_ZIP', zipCode });
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
    setUnlockByName,
    setFirstName,
    setLastName,
    setDisambiguationEmail,
    setDisambiguationZip,
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
    unlockByName: Boolean(state.unlockByName),
    firstName: state.firstName || '',
    lastName: state.lastName || '',
    disambiguationEmail: state.disambiguationEmail || '',
    disambiguationZip: state.disambiguationZip || '',
    requiresDisambiguation: Boolean(state.requiresDisambiguation),
    lookupNotFound: Boolean(state.lookupNotFound),
    status: state.status,
  };
}
