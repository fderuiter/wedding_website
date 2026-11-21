'use client';

import { useReducer, useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { useToast } from '@/components/ui/ToastProvider';

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
  addressVerified?: boolean;
  householdName?: string;
}

export type GuestAddressPortalAction =
  | { type: 'INIT_START' }
  | { type: 'INIT_UNAUTHENTICATED' }
  | {
    type: 'INIT_RSVP_ONLY_SESSION';
    guestName: string;
    householdName?: string;
  }
  | { type: 'VALIDATE_START'; code?: string }
  | {
    type: 'VALIDATE_SUCCESS';
    guestName: string;
    code: string;
    address?: Partial<AddressFormData>;
    householdName?: string;
  }
  | { type: 'VALIDATE_FAILURE'; error: string; isAuthError: boolean }
  | { type: 'SAVE_START' }
  | { type: 'SAVE_SUCCESS'; address: AddressFormData }
  | { type: 'SAVE_FAILURE'; error: string; isAuthError: boolean }
  | { type: 'SET_FIELD'; field: keyof AddressFormData; value: string }
  | { type: 'SET_CODE'; code: string }
  | { type: 'RESET_ERROR' };

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

    case 'INIT_RSVP_ONLY_SESSION':
      return {
        ...state,
        status: 'authenticated',
        sessionActive: true,
        isInitialLoading: false,
        guestName: action.guestName,
        householdName: action.householdName || '',
        code: '',
        addressVerified: false,
        form: { ...initialAddressData },
        baseline: { ...initialAddressData },
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
        addressVerified: true,
        ...(action.householdName !== undefined ? { householdName: action.householdName } : {}),
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

    case 'RESET_ERROR':
      return {
        ...state,
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

  const cancelInFlightValidation = useCallback(() => {
    if (validationAbortControllerRef.current) {
      validationAbortControllerRef.current.abort();
      validationAbortControllerRef.current = null;
    }
  }, []);

  const fetchAddressData = useCallback(
    async (
      signal: AbortSignal
    ): Promise<{
      success: boolean;
      data?: GuestAddressApiResponse;
      isAuth?: boolean;
      requiresAddressVerification?: boolean;
      guestName?: string;
      error?: string;
    }> => {
      try {
        const res = await fetch('/api/guest/address', { signal });
        if (signal.aborted) return { success: false };

        const data = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
        if (signal.aborted) return { success: false };

        if (res.status === 401 && data?.details?.requiresAddressVerification) {
          return {
            success: false,
            isAuth: false,
            requiresAddressVerification: true,
            guestName: typeof data.details.guestName === 'string' ? data.details.guestName : '',
          };
        }

        if (isAuthError(res.status)) {
          return { success: false, isAuth: true };
        }

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
      } else if (result.requiresAddressVerification) {
        dispatch({
          type: 'INIT_RSVP_ONLY_SESSION',
          guestName: result.guestName || '',
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
        addToast('Please enter your invitation code.', 'error');
        return;
      }

      dispatch({ type: 'VALIDATE_START', code: trimmedCode });

      try {
        const res = await fetch(`/api/registry/validate-code?code=${encodeURIComponent(trimmedCode)}`, { signal });
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
          addToast(errMsg, 'error');

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
        addToast(errorMsg, 'error');

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
      }
    },
    [addToast, dispatch, fetchAddressData]
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
    async (e?: FormEvent) => {
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
    async (e?: FormEvent) => {
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

  const resetError = useCallback(() => {
    dispatch({ type: 'RESET_ERROR' });
  }, [dispatch]);

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

  const [showNameLookup, setShowNameLookup] = useState(false);
  const [lookupPasscode, setLookupPasscode] = useState('');
  const [lookupFirstName, setLookupFirstName] = useState('');
  const [lookupLastName, setLookupLastName] = useState('');
  const [lookupEmail, setLookupEmail] = useState('');
  const [lookupZip, setLookupZip] = useState('');
  const [requiresDisambiguation, setRequiresDisambiguation] = useState(false);
  const [lookupNotFound, setLookupNotFound] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUpName, setIsLookingUpName] = useState(false);
  const [needsPasscodeForLookup, setNeedsPasscodeForLookup] = useState(false);

  const [verifyCodeInput, setVerifyCodeInput] = useState('');
  const [verifyZipInput, setVerifyZipInput] = useState('');
  const [isVerifyingAddress, setIsVerifyingAddress] = useState(false);
  const [verifyAddressError, setVerifyAddressError] = useState<string | null>(null);

  const handleLookupByName = useCallback(
    async (e?: FormEvent) => {
      if (e?.preventDefault) {
        e.preventDefault();
      }

      const firstName = lookupFirstName.trim();
      const lastName = lookupLastName.trim();
      const passcode = lookupPasscode.trim();
      const email = lookupEmail.trim();
      const zipCode = lookupZip.trim();

      if (!firstName || !lastName) {
        setLookupError('Please enter both your first and last name to unlock your invitation.');
        return;
      }

      setIsLookingUpName(true);
      setLookupError(null);
      setLookupNotFound(false);

      try {
        if (passcode) {
          const loginRes = await fetch('/api/guest/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode }),
          });
          const loginData = await loginRes.json().catch(() => null);
          if (!loginRes.ok) {
            setLookupError(
              loginData?.error ||
                'Incorrect event passcode. Please check your invitation and try again.'
            );
            return;
          }
        }

        const res = await fetch('/api/guest/lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName,
            lastName,
            ...(email ? { email } : {}),
            ...(zipCode ? { zipCode } : {}),
          }),
        });

        const data = await res.json().catch(() => null);

        if (res.status === 401) {
          setNeedsPasscodeForLookup(true);
          setLookupError(
            'Please enter the shared event passcode to look up your invitation by name.'
          );
          return;
        }

        if (res.status === 409 && data?.details?.requiresDisambiguation) {
          setRequiresDisambiguation(true);
          setLookupError(
            data?.error ||
              'Multiple invitations match that name. Please enter your email address or postal ZIP code to confirm your household.'
          );
          return;
        }

        if (res.status === 404) {
          setLookupNotFound(true);
          setLookupError(
            data?.error || 'We could not find an invitation matching that first and last name.'
          );
          return;
        }

        if (!res.ok || !data?.success) {
          setLookupError(
            data?.error || 'Unable to look up your invitation right now. Please try again.'
          );
          return;
        }

        const resolvedGuestName =
          typeof data.guestName === 'string' && data.guestName.trim()
            ? data.guestName
            : `${firstName} ${lastName}`;
        const resolvedHouseholdName =
          typeof data.householdName === 'string' ? data.householdName : '';

        dispatch({
          type: 'INIT_RSVP_ONLY_SESSION',
          guestName: resolvedGuestName,
          householdName: resolvedHouseholdName,
        });
        setRequiresDisambiguation(false);
        setLookupNotFound(false);
        setNeedsPasscodeForLookup(false);
        addToast(`Welcome ${resolvedGuestName}!`, 'success');
      } catch {
        setLookupError('A network error occurred while looking up your invitation.');
      } finally {
        setIsLookingUpName(false);
      }
    },
    [
      addToast,
      dispatch,
      lookupEmail,
      lookupFirstName,
      lookupLastName,
      lookupPasscode,
      lookupZip,
    ]
  );

  const handleVerifyAddressAccess = useCallback(
    async (e?: FormEvent) => {
      if (e?.preventDefault) {
        e.preventDefault();
      }

      const cleanCode = verifyCodeInput.trim().toUpperCase();
      const cleanZip = verifyZipInput.trim();

      if (!cleanCode && !cleanZip) {
        setVerifyAddressError(
          'Please enter your personal invitation code or saved postal ZIP code.'
        );
        return;
      }

      setIsVerifyingAddress(true);
      setVerifyAddressError(null);

      try {
        const res = await fetch('/api/guest/address/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(cleanCode ? { code: cleanCode } : {}),
            ...(cleanZip ? { zipCode: cleanZip } : {}),
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || !data?.data) {
          setVerifyAddressError(
            data?.error ||
              'Could not verify mailing address access. Check your invitation code or saved ZIP code.'
          );
          return;
        }

        dispatch({
          type: 'VALIDATE_SUCCESS',
          guestName: data.data.guestName || stateRef.current.guestName,
          code: data.data.code || cleanCode,
          address: {
            addressLine1: data.data.addressLine1 || '',
            addressLine2: data.data.addressLine2 || '',
            city: data.data.city || '',
            state: data.data.state || '',
            zipCode: data.data.zipCode || '',
            country: data.data.country || '',
          },
        });
        setVerifyCodeInput('');
        setVerifyZipInput('');
        addToast('Mailing address access verified!', 'success');
      } catch {
        setVerifyAddressError(
          'A network error occurred while verifying mailing address access.'
        );
      } finally {
        setIsVerifyingAddress(false);
      }
    },
    [addToast, dispatch, verifyCodeInput, verifyZipInput]
  );

  const isDirty =
    state.form.addressLine1 !== state.baseline.addressLine1 ||
    state.form.addressLine2 !== state.baseline.addressLine2 ||
    state.form.city !== state.baseline.city ||
    state.form.state !== state.baseline.state ||
    state.form.zipCode !== state.baseline.zipCode ||
    state.form.country !== state.baseline.country;

  return {
    state,
    dispatch,
    handleValidateCode,
    handleLookupByName,
    handleVerifyAddressAccess,
    handleSaveAddress,
    handleRetry,
    setField,
    setCode,
    resetError,
    showNameLookup,
    setShowNameLookup,
    lookupPasscode,
    setLookupPasscode,
    lookupFirstName,
    setLookupFirstName,
    lookupLastName,
    setLookupLastName,
    lookupEmail,
    setLookupEmail,
    lookupZip,
    setLookupZip,
    requiresDisambiguation,
    lookupNotFound,
    lookupError,
    isLookingUpName,
    needsPasscodeForLookup,
    isAddressVerified: state.addressVerified !== false,
    verifyCodeInput,
    setVerifyCodeInput,
    verifyZipInput,
    setVerifyZipInput,
    isVerifyingAddress,
    verifyAddressError,
    isDirty,
    isLoading: state.isInitialLoading,
    isValidating: state.status === 'validating',
    isSaving: state.status === 'saving',
    isAuthenticated: state.sessionActive,
  };
}
