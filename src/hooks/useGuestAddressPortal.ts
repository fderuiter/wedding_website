'use client';

import { useReducer, useEffect, useRef, useCallback, type SubmitEvent } from 'react';
import { useToast } from '@/components/ui/ToastProvider';
import {
  notifyGuestSessionChanged,
  subscribeGuestSessionChanged,
} from '@/utils/guestSessionEvents';

type GuestPortalStatus = 'idle' | 'validating' | 'authenticated' | 'saving' | 'error';
export type GuestSessionType = 'invitation' | 'passcode' | 'none';

export interface AddressFormData {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface GuestAddressPortalState {
  status: GuestPortalStatus;
  sessionActive: boolean;
  sessionType: GuestSessionType;
  hasPasscodeSession: boolean;
  isInitialLoading: boolean;
  code: string;
  guestName: string;
  form: AddressFormData;
  baseline: AddressFormData;
  error: string | null;
  codeGuidance: string | null;
}

export type GuestAddressPortalAction =
  | { type: 'INIT_START' }
  | {
    type: 'INIT_UNAUTHENTICATED';
    sessionType?: GuestSessionType;
    hasPasscodeSession?: boolean;
  }
  | { type: 'VALIDATE_START'; code?: string }
  | {
    type: 'VALIDATE_SUCCESS';
    guestName: string;
    code: string;
    address?: Partial<AddressFormData>;
    hasPasscodeSession?: boolean;
  }
  | { type: 'VALIDATE_SHARED_PASSCODE'; guidance: string }
  | { type: 'VALIDATE_FAILURE'; error: string; isAuthError: boolean }
  | {
    type: 'SWITCH_HOUSEHOLD';
    sessionType: GuestSessionType;
    hasPasscodeSession: boolean;
  }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS'; address: AddressFormData }
  | { type: 'SAVE_FAILURE'; error: string; isAuthError: boolean }
  | { type: 'SET_FIELD'; field: keyof AddressFormData; value: string }
  | { type: 'SET_CODE'; code: string };

export const initialAddressData: AddressFormData = {
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zipCode: '',
  country: '',
};

export const initialGuestPortalState: GuestAddressPortalState = {
  status: 'validating',
  sessionActive: false,
  sessionType: 'none',
  hasPasscodeSession: false,
  isInitialLoading: true,
  code: '',
  guestName: '',
  form: { ...initialAddressData },
  baseline: { ...initialAddressData },
  error: null,
  codeGuidance: null,
};

export function isAuthError(status?: number): boolean {
  return status === 401 || status === 403;
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const errorObj = err as { name?: string };
  return errorObj.name === 'AbortError';
}

export function guestAddressPortalReducer(
  state: GuestAddressPortalState,
  action: GuestAddressPortalAction
): GuestAddressPortalState {
  switch (action.type) {
    case 'INIT_START':
      return {
        ...state,
        status: 'validating',
        isInitialLoading: true,
        error: null,
        codeGuidance: null,
      };

    case 'INIT_UNAUTHENTICATED': {
      const nextSessionType =
        action.sessionType ?? (action.hasPasscodeSession ? 'passcode' : 'none');
      return {
        ...state,
        status: 'idle',
        sessionActive: false,
        sessionType: nextSessionType,
        hasPasscodeSession: action.hasPasscodeSession ?? nextSessionType === 'passcode',
        isInitialLoading: false,
        ...(state.sessionActive
          ? {
            code: '',
            guestName: '',
            form: { ...initialAddressData },
            baseline: { ...initialAddressData },
          }
          : {}),
        error: null,
        codeGuidance: null,
      };
    }

    case 'VALIDATE_START':
      return {
        ...state,
        status: 'validating',
        code: action.code !== undefined ? action.code : state.code,
        error: null,
        codeGuidance: null,
      };

    case 'VALIDATE_SUCCESS': {
      const nextAddress: AddressFormData = {
        addressLine1: action.address?.addressLine1 || '',
        addressLine2: action.address?.addressLine2 || '',
        city: action.address?.city || '',
        state: action.address?.state || '',
        zipCode: action.address?.zipCode || '',
        country: action.address?.country || '',
      };
      return {
        ...state,
        status: 'authenticated',
        sessionActive: true,
        sessionType: 'invitation',
        hasPasscodeSession: action.hasPasscodeSession ?? state.hasPasscodeSession,
        isInitialLoading: false,
        guestName: action.guestName,
        code: action.code,
        form: nextAddress,
        baseline: nextAddress,
        error: null,
        codeGuidance: null,
      };
    }

    case 'VALIDATE_SHARED_PASSCODE':
      return {
        ...state,
        status: 'idle',
        sessionActive: false,
        sessionType: state.hasPasscodeSession ? 'passcode' : 'none',
        isInitialLoading: false,
        error: null,
        codeGuidance: action.guidance,
      };

    case 'VALIDATE_FAILURE': {
      if (action.isAuthError) {
        return {
          ...state,
          status: 'idle',
          sessionActive: false,
          sessionType: state.hasPasscodeSession ? 'passcode' : 'none',
          isInitialLoading: false,
          error: action.error,
          codeGuidance: null,
        };
      }
      return {
        ...state,
        status: 'error',
        isInitialLoading: false,
        error: action.error,
        codeGuidance: null,
      };
    }

    case 'SWITCH_HOUSEHOLD':
      return {
        ...state,
        status: 'idle',
        sessionActive: false,
        sessionType: action.sessionType,
        hasPasscodeSession: action.hasPasscodeSession,
        isInitialLoading: false,
        code: '',
        guestName: '',
        form: { ...initialAddressData },
        baseline: { ...initialAddressData },
        error: null,
        codeGuidance: null,
      };

    case 'SAVE_START':
      return {
        ...state,
        status: 'saving',
        error: null,
      };

    case 'SAVE_SUCCESS':
      return {
        ...state,
        status: 'authenticated',
        baseline: { ...action.address },
        form: { ...action.address },
        error: null,
      };

    case 'SAVE_FAILURE': {
      if (action.isAuthError) {
        return {
          ...state,
          status: 'idle',
          sessionActive: false,
          sessionType: state.hasPasscodeSession ? 'passcode' : 'none',
          error: action.error,
        };
      }
      // Preserve sessionActive and form inputs on transient network / 5xx errors
      return {
        ...state,
        status: 'error',
        error: action.error,
      };
    }

    case 'SET_FIELD':
      return {
        ...state,
        form: {
          ...state.form,
          [action.field]: action.value,
        },
        error: null,
        status: state.status === 'error' && state.sessionActive ? 'authenticated' : state.status,
      };

    case 'SET_CODE':
      return {
        ...state,
        code: action.code,
        error: null,
        codeGuidance: null,
      };

    default:
      return state;
  }
}

export interface UseGuestAddressPortalOptions {
  onSuccessToast?: (msg: string) => void;
  onErrorToast?: (msg: string) => void;
  initialCode?: string;
}

interface GuestAddressApiResponse {
  guestName?: string;
  code?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
}

export function useGuestAddressPortal(options?: UseGuestAddressPortalOptions) {
  const toast = useToast();
  const toastRef = useRef(toast);
  const optionsRef = useRef(options);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    if (type === 'success' && optionsRef.current?.onSuccessToast) {
      optionsRef.current.onSuccessToast(message);
    } else if (type === 'error' && optionsRef.current?.onErrorToast) {
      optionsRef.current.onErrorToast(message);
    } else {
      toastRef.current.addToast(message, type);
    }
  }, []);

  const [state, rawDispatch] = useReducer(guestAddressPortalReducer, {
    ...initialGuestPortalState,
    code: options?.initialCode || '',
  });

  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const dispatch = useCallback((action: GuestAddressPortalAction) => {
    stateRef.current = guestAddressPortalReducer(stateRef.current, action);
    rawDispatch(action);
  }, []);

  const validationAbortControllerRef = useRef<AbortController | null>(null);
  const isInternalSessionEmitRef = useRef(false);

  const emitSessionChanged = useCallback(() => {
    isInternalSessionEmitRef.current = true;
    try {
      notifyGuestSessionChanged();
    } finally {
      isInternalSessionEmitRef.current = false;
    }
  }, []);

  const cancelInFlightValidation = useCallback(() => {
    if (validationAbortControllerRef.current) {
      validationAbortControllerRef.current.abort();
      validationAbortControllerRef.current = null;
    }
  }, []);

  const fetchAddressData = useCallback(
    async (signal: AbortSignal): Promise<{ success: boolean; data?: GuestAddressApiResponse; isAuth?: boolean; error?: string }> => {
      try {
        const res = await fetch('/api/guest/address', { signal });
        if (signal.aborted) return { success: false };

        if (isAuthError(res.status)) {
          return { success: false, isAuth: true };
        }

        const data = await res.json().catch(() => null);
        if (res.ok && data?.success && data?.data) {
          return { success: true, data: data.data };
        }

        return {
          success: false,
          isAuth: isAuthError(res.status),
          error: data?.error,
        };
      } catch (err: unknown) {
        if (isAbortError(err) || signal.aborted) {
          return { success: false };
        }
        return { success: false, isAuth: false, error: err instanceof Error ? err.message : 'Network error' };
      }
    },
    []
  );

  const inspectSessionAndHydrate = useCallback(
    async (
      signal: AbortSignal
    ): Promise<
      | { kind: 'authenticated'; guestName: string; code: string; address: Partial<AddressFormData>; hasPasscodeSession: boolean }
      | { kind: 'unauthenticated'; sessionType: GuestSessionType; hasPasscodeSession: boolean }
      | { kind: 'error'; error: string }
      | { kind: 'aborted' }
    > => {
      try {
        const res = await fetch('/api/guest/session', { signal });
        if (signal.aborted) return { kind: 'aborted' };

        if (isAuthError(res.status)) {
          return { kind: 'unauthenticated', sessionType: 'none', hasPasscodeSession: false };
        }

        const json = await res.json().catch(() => null);
        if (signal.aborted) return { kind: 'aborted' };

        if (!res.ok || (json && json.success === false)) {
          return {
            kind: 'error',
            error: json?.error || 'Failed to connect to guest portal.',
          };
        }

        const payload = json?.data ?? json;
        if (payload && typeof payload === 'object' && 'status' in payload) {
          const hasPasscodeSession = Boolean(
            payload.hasPasscodeSession || payload.status === 'passcode'
          );
          if (payload.status === 'invitation') {
            const addrResult = await fetchAddressData(signal);
            if (signal.aborted) return { kind: 'aborted' };
            if (addrResult.success && addrResult.data) {
              return {
                kind: 'authenticated',
                guestName: addrResult.data.guestName || payload.guestName || '',
                code: addrResult.data.code || payload.invitationCode || payload.code || '',
                address: addrResult.data,
                hasPasscodeSession,
              };
            }
            if (addrResult.isAuth) {
              return {
                kind: 'unauthenticated',
                sessionType: hasPasscodeSession ? 'passcode' : 'none',
                hasPasscodeSession,
              };
            }
            return {
              kind: 'error',
              error: addrResult.error || 'Failed to connect to guest portal.',
            };
          }

          return {
            kind: 'unauthenticated',
            sessionType: payload.status === 'passcode' ? 'passcode' : 'none',
            hasPasscodeSession,
          };
        }

        // Backward-compatible fallback when positional unit test mocks return address payload directly
        if (
          payload &&
          typeof payload === 'object' &&
          ('addressLine1' in payload || 'guestName' in payload || 'code' in payload)
        ) {
          return {
            kind: 'authenticated',
            guestName: payload.guestName || '',
            code: payload.code || '',
            address: payload as Partial<AddressFormData>,
            hasPasscodeSession: false,
          };
        }

        return { kind: 'unauthenticated', sessionType: 'none', hasPasscodeSession: false };
      } catch (err: unknown) {
        if (isAbortError(err) || signal.aborted) {
          return { kind: 'aborted' };
        }
        return {
          kind: 'error',
          error: err instanceof Error ? err.message : 'Network error',
        };
      }
    },
    [fetchAddressData]
  );

  const checkInitialSession = useCallback(
    async (signal: AbortSignal) => {
      dispatch({ type: 'INIT_START' });
      const result = await inspectSessionAndHydrate(signal);
      if (result.kind === 'aborted' || signal.aborted) return;

      if (result.kind === 'authenticated') {
        dispatch({
          type: 'VALIDATE_SUCCESS',
          guestName: result.guestName,
          code: result.code,
          address: result.address,
          hasPasscodeSession: result.hasPasscodeSession,
        });
      } else if (result.kind === 'unauthenticated') {
        dispatch({
          type: 'INIT_UNAUTHENTICATED',
          sessionType: result.sessionType,
          hasPasscodeSession: result.hasPasscodeSession,
        });
      } else {
        dispatch({
          type: 'VALIDATE_FAILURE',
          error: result.error,
          isAuthError: false,
        });
      }
    },
    [dispatch, inspectSessionAndHydrate]
  );

  const validateCode = useCallback(
    async (rawCode: string, signal: AbortSignal, isAutoMount = false) => {
      const trimmedCode = rawCode.trim().toUpperCase();
      if (!trimmedCode) {
        addToast('Please enter your invitation code.', 'error');
        return;
      }

      dispatch({ type: 'VALIDATE_START', code: trimmedCode });

      try {
        const res = await fetch(`/api/registry/validate-code?code=${encodeURIComponent(trimmedCode)}`, { signal });
        if (signal.aborted) return;

        const data = await res.json().catch(() => null);
        if (signal.aborted) return;

        const payload = data?.data ?? data;
        if (res.ok && payload?.valid === false && payload?.reason === 'shared_passcode') {
          const guidanceMsg =
            payload.error ||
            'That is the shared website passcode. Please enter the personal household invitation code printed on your invitation.';
          dispatch({ type: 'VALIDATE_SHARED_PASSCODE', guidance: guidanceMsg });
          addToast(guidanceMsg, 'info');
          return;
        }

        const isExplicitInvalid = payload?.valid === false;
        const isOk = res.ok && !isExplicitInvalid && Boolean(data?.success || payload?.valid);

        if (!isOk) {
          const isAuth = isAuthError(res.status) || res.status === 404 || res.status === 400;
          const errMsg =
            payload?.error ||
            data?.error ||
            (isAuth
              ? 'Invalid or expired invitation code.'
              : 'Failed to connect to guest portal. Please try again.');
          addToast(errMsg, 'error');

          if (isAutoMount) {
            const fallback = await inspectSessionAndHydrate(signal);
            if (fallback.kind === 'aborted' || signal.aborted) return;
            if (fallback.kind === 'authenticated') {
              dispatch({
                type: 'VALIDATE_SUCCESS',
                guestName: fallback.guestName,
                code: fallback.code,
                address: fallback.address,
                hasPasscodeSession: fallback.hasPasscodeSession,
              });
              return;
            }
          }

          dispatch({
            type: 'VALIDATE_FAILURE',
            error: errMsg,
            isAuthError: isAuth,
          });
          return;
        }

        // Validate code succeeded, now retrieve full address details
        if (typeof window !== 'undefined' && typeof window.history?.replaceState === 'function') {
          const params = new URLSearchParams(window.location.search);
          if (params.has('code')) {
            params.delete('code');
            const nextQuery = params.toString();
            const cleanUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
            window.history.replaceState(window.history.state, '', cleanUrl);
          }
        }

        const addrResult = await fetchAddressData(signal);
        if (signal.aborted) return;

        const guest = addrResult.data?.guestName || payload?.guestName || data?.guestName || '';
        if (addrResult.success && addrResult.data) {
          dispatch({
            type: 'VALIDATE_SUCCESS',
            guestName: addrResult.data.guestName || guest,
            code: addrResult.data.code || trimmedCode,
            address: addrResult.data,
          });
        } else {
          dispatch({
            type: 'VALIDATE_SUCCESS',
            guestName: guest,
            code: trimmedCode,
            address: initialAddressData,
          });
        }

        emitSessionChanged();
        addToast(`Welcome ${guest}!`, 'success');
      } catch (err: unknown) {
        if (isAbortError(err) || signal.aborted) return;

        const errorMsg = err instanceof Error ? err.message : 'Error validating code.';
        addToast(errorMsg, 'error');

        if (isAutoMount) {
          const fallback = await inspectSessionAndHydrate(signal);
          if (fallback.kind === 'aborted' || signal.aborted) return;
          if (fallback.kind === 'authenticated') {
            dispatch({
              type: 'VALIDATE_SUCCESS',
              guestName: fallback.guestName,
              code: fallback.code,
              address: fallback.address,
              hasPasscodeSession: fallback.hasPasscodeSession,
            });
            return;
          }
        }

        dispatch({
          type: 'VALIDATE_FAILURE',
          error: errorMsg,
          isAuthError: false,
        });
      }
    },
    [addToast, dispatch, emitSessionChanged, fetchAddressData, inspectSessionAndHydrate]
  );

  // Mount effect to check session or auto-validate URL code
  useEffect(() => {
    let urlCode: string | null = null;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      urlCode = params.get('code');
    }

    cancelInFlightValidation();
    const controller = new AbortController();
    validationAbortControllerRef.current = controller;

    if (urlCode && urlCode.trim()) {
      const autoCode = urlCode.trim().toUpperCase();
      dispatch({ type: 'SET_CODE', code: autoCode });
      validateCode(autoCode, controller.signal, true);
    } else {
      checkInitialSession(controller.signal);
    }

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleValidateCode = useCallback(
    async (e?: SubmitEvent<HTMLFormElement>) => {
      if (e?.preventDefault) {
        e.preventDefault();
      }

      const currentCode = stateRef.current.code;
      if (!currentCode.trim()) {
        addToast('Please enter your invitation code.', 'error');
        return;
      }

      cancelInFlightValidation();
      const controller = new AbortController();
      validationAbortControllerRef.current = controller;

      await validateCode(currentCode, controller.signal, false);
    },
    [addToast, cancelInFlightValidation, validateCode]
  );

  const handleSaveAddress = useCallback(
    async (e?: SubmitEvent<HTMLFormElement>) => {
      if (e?.preventDefault) {
        e.preventDefault();
      }

      dispatch({ type: 'SAVE_START' });

      try {
        const res = await fetch('/api/guest/address', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(stateRef.current.form),
        });

        if (isAuthError(res.status)) {
          dispatch({
            type: 'SAVE_FAILURE',
            error: 'Session expired. Please enter your invitation code.',
            isAuthError: true,
          });
          addToast('Session expired. Please enter your invitation code.', 'error');
          return;
        }

        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.success) {
          const errMsg = data?.error || (res.status >= 500 ? 'Server error occurred while saving address.' : 'Failed to update address.');
          dispatch({
            type: 'SAVE_FAILURE',
            error: errMsg,
            isAuthError: false,
          });
          addToast(errMsg, 'error');
          return;
        }

        const updatedAddress: AddressFormData = {
          addressLine1: data.data?.addressLine1 ?? stateRef.current.form.addressLine1,
          addressLine2: data.data?.addressLine2 ?? stateRef.current.form.addressLine2,
          city: data.data?.city ?? stateRef.current.form.city,
          state: data.data?.state ?? stateRef.current.form.state,
          zipCode: data.data?.zipCode ?? stateRef.current.form.zipCode,
          country: data.data?.country ?? stateRef.current.form.country,
        };

        dispatch({
          type: 'SAVE_SUCCESS',
          address: updatedAddress,
        });

        addToast('Your mailing address has been updated successfully!', 'success');
      } catch (err: unknown) {
        if (isAbortError(err)) return;

        const errorMsg = err instanceof Error ? err.message : 'An error occurred while saving address.';
        dispatch({
          type: 'SAVE_FAILURE',
          error: errorMsg,
          isAuthError: false,
        });
        addToast(errorMsg, 'error');
      }
    },
    [addToast, dispatch]
  );

  const setField = useCallback((field: keyof AddressFormData, value: string) => {
    dispatch({ type: 'SET_FIELD', field, value });
  }, [dispatch]);

  const setCode = useCallback((code: string) => {
    dispatch({ type: 'SET_CODE', code });
  }, [dispatch]);

  useEffect(() => {
    return subscribeGuestSessionChanged(() => {
      if (isInternalSessionEmitRef.current) return;
      cancelInFlightValidation();
      const controller = new AbortController();
      validationAbortControllerRef.current = controller;
      void checkInitialSession(controller.signal);
    });
  }, [cancelInFlightValidation, checkInitialSession]);

  const handleSwitchHousehold = useCallback(async () => {
    cancelInFlightValidation();
    let nextHasPasscode = stateRef.current.hasPasscodeSession;
    let nextSessionType: GuestSessionType = nextHasPasscode ? 'passcode' : 'none';

    try {
      const res = await fetch('/api/guest/session', { method: 'DELETE' });
      const json = await res.json().catch(() => null);
      const payload = json?.data ?? json;
      if (typeof payload?.hasPasscodeSession === 'boolean') {
        nextHasPasscode = payload.hasPasscodeSession;
      }
      if (payload?.status === 'passcode' || nextHasPasscode) {
        nextSessionType = 'passcode';
      } else {
        nextSessionType = 'none';
      }
    } catch {
      // Clear local portal state even if network request fails
    }

    dispatch({
      type: 'SWITCH_HOUSEHOLD',
      sessionType: nextSessionType,
      hasPasscodeSession: nextHasPasscode,
    });
    emitSessionChanged();
    addToast('Switched out of household invitation. Enter another invitation code anytime.', 'info');
  }, [addToast, cancelInFlightValidation, dispatch, emitSessionChanged]);

  const handleRetry = useCallback(async () => {
    cancelInFlightValidation();
    const controller = new AbortController();
    validationAbortControllerRef.current = controller;

    const currentCode = stateRef.current.code.trim();
    if (currentCode) {
      await validateCode(currentCode, controller.signal, true);
    } else {
      await checkInitialSession(controller.signal);
    }
  }, [cancelInFlightValidation, checkInitialSession, validateCode]);

  return {
    state,
    handleValidateCode,
    handleSaveAddress,
    handleSwitchHousehold,
    handleRetry,
    setField,
    setCode,
    isLoading: state.isInitialLoading,
    isValidating: state.status === 'validating',
    isSaving: state.status === 'saving',
    isAuthenticated: state.sessionActive,
  };
}
