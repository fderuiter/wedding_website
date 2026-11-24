'use client';

import { useReducer, useEffect, useRef, useCallback, type SubmitEvent } from 'react';
import { focusFirstInvalidControl } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import { withBasePath } from '@/lib/basePath';

type GuestPortalStatus = 'idle' | 'validating' | 'authenticated' | 'saving' | 'error';

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
  isInitialLoading: boolean;
  code: string;
  guestName: string;
  form: AddressFormData;
  baseline: AddressFormData;
  error: string | null;
}

export type GuestAddressPortalAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_UNAUTHENTICATED' }
  | { type: 'VALIDATE_START'; code?: string }
  | {
    type: 'VALIDATE_SUCCESS';
    guestName: string;
    code: string;
    address?: Partial<AddressFormData>;
  }
  | { type: 'VALIDATE_FAILURE'; error: string; isAuthError: boolean }
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
  isInitialLoading: true,
  code: '',
  guestName: '',
  form: { ...initialAddressData },
  baseline: { ...initialAddressData },
  error: null,
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
      };

    case 'INIT_UNAUTHENTICATED':
      return {
        ...state,
        status: 'idle',
        sessionActive: false,
        isInitialLoading: false,
        error: null,
      };

    case 'VALIDATE_START':
      return {
        ...state,
        status: 'validating',
        code: action.code !== undefined ? action.code : state.code,
        error: null,
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
        isInitialLoading: false,
        guestName: action.guestName,
        code: action.code,
        form: nextAddress,
        baseline: nextAddress,
        error: null,
      };
    }

    case 'VALIDATE_FAILURE': {
      if (action.isAuthError) {
        return {
          ...state,
          status: 'idle',
          sessionActive: false,
          isInitialLoading: false,
          error: action.error,
        };
      }
      return {
        ...state,
        status: 'error',
        isInitialLoading: false,
        error: action.error,
      };
    }

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
  const activeValidationCodeRef = useRef<string | null>(null);
  const isSavingRef = useRef(false);
  const pendingCodeFocusRef = useRef(false);

  const focusCodeInputNow = useCallback((): boolean => {
    if (typeof document === 'undefined') return false;
    const codeInput = document.getElementById('guest-invitation-code');
    if (codeInput instanceof HTMLElement) {
      codeInput.focus();
      return true;
    }
    return Boolean(focusFirstInvalidControl(document));
  }, []);

  const requestCodeInputFocus = useCallback(() => {
    pendingCodeFocusRef.current = true;
    if (focusCodeInputNow()) {
      pendingCodeFocusRef.current = false;
    }
  }, [focusCodeInputNow]);

  useEffect(() => {
    if (!pendingCodeFocusRef.current) return;
    if (focusCodeInputNow()) {
      pendingCodeFocusRef.current = false;
    }
  }, [focusCodeInputNow, state]);

  const cancelInFlightValidation = useCallback(() => {
    if (validationAbortControllerRef.current) {
      validationAbortControllerRef.current.abort();
      validationAbortControllerRef.current = null;
    }
  }, []);

  const fetchAddressData = useCallback(
    async (signal: AbortSignal): Promise<{ success: boolean; data?: GuestAddressApiResponse; isAuth?: boolean; error?: string }> => {
      try {
        const res = await fetch(withBasePath('/api/guest/address'), { signal });
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

  const checkInitialSession = useCallback(
    async (signal: AbortSignal) => {
      dispatch({ type: 'INIT_START' });
      const result = await fetchAddressData(signal);
      if (signal.aborted) return;

      if (result.success && result.data) {
        dispatch({
          type: 'VALIDATE_SUCCESS',
          guestName: result.data.guestName || '',
          code: result.data.code || '',
          address: {
            addressLine1: result.data.addressLine1 || '',
            addressLine2: result.data.addressLine2 || '',
            city: result.data.city || '',
            state: result.data.state || '',
            zipCode: result.data.zipCode || '',
            country: result.data.country || '',
          },
        });
      } else if (result.isAuth) {
        dispatch({ type: 'INIT_UNAUTHENTICATED' });
      } else {
        // Transient network error or 5xx on initial load
        dispatch({
          type: 'VALIDATE_FAILURE',
          error: result.error || 'Failed to connect to guest portal.',
          isAuthError: false,
        });
      }
    },
    [dispatch, fetchAddressData]
  );

  const validateCode = useCallback(
    async (rawCode: string, signal: AbortSignal, isAutoMount = false) => {
      const trimmedCode = rawCode.trim().toUpperCase();
      if (!trimmedCode) {
        dispatch({
          type: 'VALIDATE_FAILURE',
          error: 'Please enter your invitation code.',
          isAuthError: true,
        });
        if (!isAutoMount) {
          requestCodeInputFocus();
        }
        return;
      }

      if (!isAutoMount) {
        activeValidationCodeRef.current = trimmedCode;
      }
      dispatch({ type: 'VALIDATE_START', code: trimmedCode });

      try {
        const res = await fetch(
          withBasePath(`/api/registry/validate-code?code=${encodeURIComponent(trimmedCode)}`),
          { signal }
        );
        if (signal.aborted) return;

        const data = await res.json().catch(() => null);
        if (signal.aborted) return;

        const isOk = res.ok && (data?.success || data?.valid);

        if (!isOk) {
          const isAuth = isAuthError(res.status) || res.status === 404 || res.status === 400;
          const errMsg =
            data?.error ||
            (isAuth
              ? 'Invalid or expired invitation code.'
              : 'Failed to connect to guest portal. Please try again.');

          if (isAutoMount) {
            // Check existing session as fallback on auto-mount invalid code
            const addrFallback = await fetchAddressData(signal);
            if (signal.aborted) return;
            if (addrFallback.success && addrFallback.data) {
              dispatch({
                type: 'VALIDATE_SUCCESS',
                guestName: addrFallback.data.guestName || '',
                code: addrFallback.data.code || '',
                address: addrFallback.data,
              });
              return;
            }
          }

          dispatch({
            type: 'VALIDATE_FAILURE',
            error: errMsg,
            isAuthError: isAuth,
          });
          if (!isAutoMount && isAuth) {
            requestCodeInputFocus();
          }
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

        const guest = addrResult.data?.guestName || data?.data?.guestName || data?.guestName || '';
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

        addToast(`Welcome ${guest}!`, 'success');
      } catch (err: unknown) {
        if (isAbortError(err) || signal.aborted) return;

        const errorMsg = err instanceof Error ? err.message : 'Error validating code.';

        if (isAutoMount) {
          const addrFallback = await fetchAddressData(signal);
          if (signal.aborted) return;
          if (addrFallback.success && addrFallback.data) {
            dispatch({
              type: 'VALIDATE_SUCCESS',
              guestName: addrFallback.data.guestName || '',
              code: addrFallback.data.code || '',
              address: addrFallback.data,
            });
            return;
          }
        }

        dispatch({
          type: 'VALIDATE_FAILURE',
          error: errorMsg,
          isAuthError: false,
        });
      } finally {
        if (!signal.aborted && !isAutoMount) {
          activeValidationCodeRef.current = null;
        }
      }
    },
    [addToast, dispatch, fetchAddressData, requestCodeInputFocus]
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

      if (stateRef.current.status === 'saving' || isSavingRef.current) {
        return;
      }

      const currentCode = stateRef.current.code;
      const normalizedCode = currentCode.trim().toUpperCase();
      if (
        stateRef.current.status === 'validating' &&
        !stateRef.current.isInitialLoading &&
        activeValidationCodeRef.current !== null &&
        normalizedCode === activeValidationCodeRef.current
      ) {
        return;
      }

      if (!normalizedCode) {
        dispatch({
          type: 'VALIDATE_FAILURE',
          error: 'Please enter your invitation code.',
          isAuthError: true,
        });
        requestCodeInputFocus();
        return;
      }

      cancelInFlightValidation();
      const controller = new AbortController();
      validationAbortControllerRef.current = controller;

      await validateCode(currentCode, controller.signal, false);
    },
    [cancelInFlightValidation, dispatch, requestCodeInputFocus, validateCode]
  );

  const handleSaveAddress = useCallback(
    async (e?: SubmitEvent<HTMLFormElement>) => {
      if (e?.preventDefault) {
        e.preventDefault();
      }

      if (
        isSavingRef.current ||
        stateRef.current.status === 'saving' ||
        stateRef.current.status === 'validating'
      ) {
        return;
      }

      isSavingRef.current = true;
      dispatch({ type: 'SAVE_START' });

      try {
        const res = await fetch(withBasePath('/api/guest/address'), {
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
          requestCodeInputFocus();
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
      } finally {
        isSavingRef.current = false;
      }
    },
    [addToast, dispatch, requestCodeInputFocus]
  );

  const setField = useCallback((field: keyof AddressFormData, value: string) => {
    dispatch({ type: 'SET_FIELD', field, value });
  }, [dispatch]);

  const setCode = useCallback((code: string) => {
    dispatch({ type: 'SET_CODE', code });
  }, [dispatch]);

  const handleRetry = useCallback(async () => {
    if (
      isSavingRef.current ||
      stateRef.current.status === 'saving' ||
      (stateRef.current.status === 'validating' && !stateRef.current.isInitialLoading)
    ) {
      return;
    }

    cancelInFlightValidation();
    const controller = new AbortController();
    validationAbortControllerRef.current = controller;

    const currentCode = stateRef.current.code.trim();
    if (currentCode) {
      await validateCode(currentCode, controller.signal, false);
    } else {
      await checkInitialSession(controller.signal);
    }
  }, [cancelInFlightValidation, checkInitialSession, validateCode]);

  return {
    state,
    handleValidateCode,
    handleSaveAddress,
    handleRetry,
    setField,
    setCode,
    isLoading: state.isInitialLoading,
    isValidating: state.status === 'validating',
    isSaving: state.status === 'saving',
    isAuthenticated: state.sessionActive,
  };
}
