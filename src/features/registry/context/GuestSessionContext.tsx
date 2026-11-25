'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useOptionalToast } from '@/components/ui/ToastProvider';
import { notifyGuestSessionChanged, subscribeGuestSessionChanged } from '@/utils/guestSessionEvents';
import { SessionRecoveryModal } from '../components/SessionRecoveryModal';

type GuestSessionStatus = 'authenticated' | 'unauthenticated' | 'expired' | 'error';

export interface GuestPostalAddress {
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

const WIPED_HOUSEHOLD_FIELDS = {
  email: null,
  householdName: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  zipCode: null,
  country: null,
  returnAddress: null,
} as const;

function normalizeOptionalString(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

interface GuestSessionState {
  invitationCode: string;
  guestName: string;
  email?: string | null;
  householdName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
  returnAddress?: Partial<GuestPostalAddress> | null;
  isVerified: boolean;
  isLoading: boolean;
  status: GuestSessionStatus;
  lastErrorCode: string | null;
  draftInvitationCode: string;
  isRecoveryModalOpen: boolean;
}

export interface GuestSessionContextType extends GuestSessionState {
  setSession: (session: {
    invitationCode: string;
    guestName: string;
    email?: string | null;
    householdName?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    country?: string | null;
    isVerified?: boolean;
  }) => void;
  setReturnAddress?: (address: Partial<GuestPostalAddress> | null) => void;
  clearReturnAddress?: () => void;
  clearSession: () => Promise<void>;
  refreshSession: () => Promise<void>;
  openRecoveryModal: () => void;
  closeRecoveryModal: () => void;
  recoverSession: (code?: string) => Promise<boolean>;
}

export const ActiveInviteSessionContext = createContext<boolean>(false);

export function useHasActiveInviteSession(): boolean {
  return useContext(ActiveInviteSessionContext);
}

const defaultContextValue: GuestSessionContextType = {
  invitationCode: '',
  guestName: '',
  ...WIPED_HOUSEHOLD_FIELDS,
  isVerified: false,
  isLoading: false,
  status: 'unauthenticated',
  lastErrorCode: null,
  draftInvitationCode: '',
  isRecoveryModalOpen: false,
  setSession: () => {},
  setReturnAddress: () => {},
  clearReturnAddress: () => {},
  clearSession: async () => {},
  refreshSession: async () => {},
  openRecoveryModal: () => {},
  closeRecoveryModal: () => {},
  recoverSession: async () => false,
};

export const GuestSessionContext = createContext<GuestSessionContextType>(defaultContextValue);

export const GuestSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toast = useOptionalToast();

  const [sessionState, setSessionState] = useState<GuestSessionState>({
    invitationCode: '',
    guestName: '',
    ...WIPED_HOUSEHOLD_FIELDS,
    isVerified: false,
    isLoading: true,
    status: 'unauthenticated',
    lastErrorCode: null,
    draftInvitationCode: '',
    isRecoveryModalOpen: false,
  });

  const isInternalSessionEmitRef = useRef(false);
  const emitSessionChanged = useCallback(() => {
    isInternalSessionEmitRef.current = true;
    try {
      notifyGuestSessionChanged();
    } finally {
      isInternalSessionEmitRef.current = false;
    }
  }, []);

  const openRecoveryModal = useCallback(() => {
    setSessionState(prev => ({ ...prev, isRecoveryModalOpen: true }));
  }, []);

  const closeRecoveryModal = useCallback(() => {
    setSessionState(prev => ({ ...prev, isRecoveryModalOpen: false }));
  }, []);

  const setReturnAddress = useCallback((nextAddress: Partial<GuestPostalAddress> | null) => {
    setSessionState(prev => {
      if (nextAddress === null) {
        return { ...prev, returnAddress: null };
      }
      return {
        ...prev,
        returnAddress: {
          ...(prev.returnAddress ?? {}),
          ...nextAddress,
        },
      };
    });
  }, []);

  const clearReturnAddress = useCallback(() => {
    setSessionState(prev => ({ ...prev, returnAddress: null }));
  }, []);

  const fetchAndApplySession = useCallback(
    async (options?: { preserveExpiryPrompt?: boolean }) => {
      const preserveExpiryPrompt = options?.preserveExpiryPrompt ?? true;
      try {
        const data = await apiClient.get('/api/registry/session');
        if (data && (data.isVerified || data.invitationCode || data.code)) {
          const code = data.invitationCode || data.code || '';
          const name = data.guestName || '';
          const sessionEmail = normalizeOptionalString(data.email);
          const sessionHouseholdName = normalizeOptionalString(data.householdName);
          const sessionAddressLine1 = normalizeOptionalString(data.addressLine1);
          const sessionAddressLine2 = normalizeOptionalString(data.addressLine2);
          const sessionCity = normalizeOptionalString(data.city);
          const sessionStateVal = normalizeOptionalString(data.state);
          const sessionZipCode = normalizeOptionalString(data.zipCode);
          const sessionCountry = normalizeOptionalString(data.country);
          setSessionState(prev => {
            const switchedHousehold = Boolean(
              prev.invitationCode &&
                code &&
                prev.invitationCode.trim().toUpperCase() !== String(code).trim().toUpperCase()
            );
            return {
              ...prev,
              invitationCode: code,
              guestName: name,
              email: sessionEmail,
              householdName: sessionHouseholdName,
              addressLine1: sessionAddressLine1,
              addressLine2: sessionAddressLine2,
              city: sessionCity,
              state: sessionStateVal,
              zipCode: sessionZipCode,
              country: sessionCountry,
              returnAddress: switchedHousehold ? null : (prev.returnAddress ?? null),
              isVerified: true,
              isLoading: false,
              status: 'authenticated',
              lastErrorCode: null,
              draftInvitationCode: code || prev.draftInvitationCode || prev.invitationCode,
              isRecoveryModalOpen: false,
            };
          });
        } else {
          setSessionState(prev => {
            const wasAuth =
              prev.isVerified ||
              prev.status === 'authenticated' ||
              Boolean(prev.invitationCode || prev.draftInvitationCode);
            const draftCode = prev.invitationCode || prev.draftInvitationCode || '';
            const currentName = prev.guestName || '';

            if (wasAuth && preserveExpiryPrompt) {
              return {
                ...prev,
                ...WIPED_HOUSEHOLD_FIELDS,
                invitationCode: draftCode,
                guestName: currentName,
                isVerified: false,
                isLoading: false,
                status: 'expired',
                lastErrorCode: 'SESSION_EXPIRED',
                draftInvitationCode: draftCode,
                isRecoveryModalOpen: true,
              };
            } else {
              return {
                ...prev,
                ...WIPED_HOUSEHOLD_FIELDS,
                invitationCode: '',
                guestName: '',
                isVerified: false,
                isLoading: false,
                status: 'unauthenticated',
                lastErrorCode: null,
                draftInvitationCode: '',
                isRecoveryModalOpen: false,
              };
            }
          });
        }
      } catch (err: unknown) {
        const errorCode = err instanceof Error ? err.message : 'NETWORK_ERROR';
        setSessionState(prev => {
          const wasAuth =
            prev.isVerified ||
            prev.status === 'authenticated' ||
            Boolean(prev.invitationCode || prev.draftInvitationCode);
          const draftCode = prev.invitationCode || prev.draftInvitationCode || '';
          const currentName = prev.guestName || '';

          if (wasAuth && preserveExpiryPrompt) {
            return {
              ...prev,
              ...WIPED_HOUSEHOLD_FIELDS,
              invitationCode: draftCode,
              guestName: currentName,
              isVerified: false,
              isLoading: false,
              status: 'expired',
              lastErrorCode: errorCode,
              draftInvitationCode: draftCode,
              isRecoveryModalOpen: true,
            };
          } else {
            return {
              ...prev,
              ...WIPED_HOUSEHOLD_FIELDS,
              invitationCode: '',
              guestName: '',
              isVerified: false,
              isLoading: false,
              status: 'error',
              lastErrorCode: errorCode,
              draftInvitationCode: '',
              isRecoveryModalOpen: false,
            };
          }
        });
      }
    },
    []
  );

  const refreshSession = useCallback(async () => {
    await fetchAndApplySession({ preserveExpiryPrompt: true });
  }, [fetchAndApplySession]);

  const syncExternalSession = useCallback(async () => {
    await fetchAndApplySession({ preserveExpiryPrompt: false });
  }, [fetchAndApplySession]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    return subscribeGuestSessionChanged(() => {
      if (isInternalSessionEmitRef.current) {
        return;
      }
      void syncExternalSession();
    });
  }, [syncExternalSession]);

  const prevStatusRef = useRef<GuestSessionStatus>(sessionState.status);
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    if (prevStatus !== sessionState.status) {
      prevStatusRef.current = sessionState.status;
      if (sessionState.status === 'expired') {
        if (toast) {
          toast.addToast(
            'Session expired. Re-verify invitation code',
            'error',
            undefined,
            undefined,
            {
              label: 'Re-verify',
              onClick: () => {
                openRecoveryModal();
              },
            }
          );
        }
      } else if (sessionState.status === 'error') {
        if (toast) {
          toast.addToast(
            'Unable to check session state. Retry?',
            'error',
            undefined,
            undefined,
            {
              label: 'Retry',
              onClick: () => {
                refreshSession();
              },
            }
          );
        }
      }
    }
  }, [sessionState.status, toast, openRecoveryModal, refreshSession]);

  const setSession = useCallback(
    (newSession: {
      invitationCode: string;
      guestName: string;
      email?: string | null;
      householdName?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      city?: string | null;
      state?: string | null;
      zipCode?: string | null;
      country?: string | null;
      isVerified?: boolean;
    }) => {
      const verified = newSession.isVerified ?? true;
      if (!verified) {
        setSessionState(prev => ({
          ...prev,
          ...WIPED_HOUSEHOLD_FIELDS,
          invitationCode: newSession.invitationCode,
          guestName: newSession.guestName,
          isVerified: false,
          isLoading: false,
          status: 'unauthenticated',
          draftInvitationCode: '',
          lastErrorCode: null,
          isRecoveryModalOpen: false,
        }));
        emitSessionChanged();
        return;
      }

      setSessionState(prev => {
        const switchedHousehold = Boolean(
          prev.invitationCode &&
            newSession.invitationCode &&
            prev.invitationCode.trim().toUpperCase() !==
              newSession.invitationCode.trim().toUpperCase()
        );
        const resolveField = (
          incoming: string | null | undefined,
          fallback: string | null | undefined
        ): string | null => {
          if (incoming !== undefined) {
            return normalizeOptionalString(incoming);
          }
          return switchedHousehold ? null : (fallback ?? null);
        };
        return {
          ...prev,
          invitationCode: newSession.invitationCode,
          guestName: newSession.guestName,
          email: resolveField(newSession.email, prev.email),
          householdName: resolveField(newSession.householdName, prev.householdName),
          addressLine1: resolveField(newSession.addressLine1, prev.addressLine1),
          addressLine2: resolveField(newSession.addressLine2, prev.addressLine2),
          city: resolveField(newSession.city, prev.city),
          state: resolveField(newSession.state, prev.state),
          zipCode: resolveField(newSession.zipCode, prev.zipCode),
          country: resolveField(newSession.country, prev.country),
          returnAddress: switchedHousehold ? null : (prev.returnAddress ?? null),
          isVerified: true,
          isLoading: false,
          status: 'authenticated',
          draftInvitationCode: newSession.invitationCode || prev.draftInvitationCode,
          lastErrorCode: null,
          isRecoveryModalOpen: false,
        };
      });
      emitSessionChanged();
    },
    [emitSessionChanged]
  );

  const clearSession = useCallback(async () => {
    setSessionState({
      invitationCode: '',
      guestName: '',
      ...WIPED_HOUSEHOLD_FIELDS,
      isVerified: false,
      isLoading: false,
      status: 'unauthenticated',
      lastErrorCode: null,
      draftInvitationCode: '',
      isRecoveryModalOpen: false,
    });
    try {
      await apiClient.delete('/api/registry/session');
    } catch {
      // Ignore API failure and clear client state
    } finally {
      setSessionState({
        invitationCode: '',
        guestName: '',
        ...WIPED_HOUSEHOLD_FIELDS,
        isVerified: false,
        isLoading: false,
        status: 'unauthenticated',
        lastErrorCode: null,
        draftInvitationCode: '',
        isRecoveryModalOpen: false,
      });
      emitSessionChanged();
    }
  }, [emitSessionChanged]);

  const recoverSession = useCallback(
    async (codeToVerify?: string): Promise<boolean> => {
      const targetCode = (
        codeToVerify ||
        sessionState.draftInvitationCode ||
        sessionState.invitationCode
      )
        .trim()
        .toUpperCase();

      if (!targetCode) {
        setSessionState(prev => ({ ...prev, lastErrorCode: 'MISSING_CODE' }));
        return false;
      }

      try {
        const data = await apiClient.post('/api/registry/validate-code', {
          code: targetCode,
        });
        if (data && data.valid) {
          const verifiedCode = data.code || targetCode;
          const verifiedEmail = normalizeOptionalString(data.email);
          const verifiedHouseholdName = normalizeOptionalString(data.householdName);
          const verifiedAddressLine1 = normalizeOptionalString(data.addressLine1);
          const verifiedAddressLine2 = normalizeOptionalString(data.addressLine2);
          const verifiedCity = normalizeOptionalString(data.city);
          const verifiedState = normalizeOptionalString(data.state);
          const verifiedZipCode = normalizeOptionalString(data.zipCode);
          const verifiedCountry = normalizeOptionalString(data.country);

          setSessionState(prev => {
            const priorCode = (prev.invitationCode || prev.draftInvitationCode || '')
              .trim()
              .toUpperCase();
            const switchedHousehold = Boolean(
              priorCode &&
                verifiedCode &&
                priorCode !== String(verifiedCode).trim().toUpperCase()
            );
            return {
              ...prev,
              invitationCode: verifiedCode,
              guestName: data.guestName || (switchedHousehold ? '' : prev.guestName),
              email: verifiedEmail ?? (switchedHousehold ? null : (prev.email ?? null)),
              householdName:
                verifiedHouseholdName ?? (switchedHousehold ? null : (prev.householdName ?? null)),
              addressLine1:
                verifiedAddressLine1 ?? (switchedHousehold ? null : (prev.addressLine1 ?? null)),
              addressLine2:
                verifiedAddressLine2 ?? (switchedHousehold ? null : (prev.addressLine2 ?? null)),
              city: verifiedCity ?? (switchedHousehold ? null : (prev.city ?? null)),
              state: verifiedState ?? (switchedHousehold ? null : (prev.state ?? null)),
              zipCode: verifiedZipCode ?? (switchedHousehold ? null : (prev.zipCode ?? null)),
              country: verifiedCountry ?? (switchedHousehold ? null : (prev.country ?? null)),
              returnAddress: switchedHousehold ? null : (prev.returnAddress ?? null),
              isVerified: true,
              isLoading: false,
              status: 'authenticated',
              lastErrorCode: null,
              draftInvitationCode: verifiedCode,
              isRecoveryModalOpen: false,
            };
          });

          if (toast) {
            toast.addToast('Session restored successfully!', 'success');
          }
          emitSessionChanged();

          return true;
        } else {
          setSessionState(prev => ({
            ...prev,
            lastErrorCode:
              data?.reason === 'shared_passcode' && typeof data?.error === 'string' && data.error.trim()
                ? data.error
                : 'INVALID_CODE',
          }));
          return false;
        }
      } catch (err: unknown) {
        setSessionState(prev => ({
          ...prev,
          lastErrorCode: err instanceof Error ? err.message : 'RECOVERY_FAILED',
        }));
        return false;
      }
    },
    [toast, sessionState.draftInvitationCode, sessionState.invitationCode, emitSessionChanged]
  );

  return (
    <GuestSessionContext.Provider
      value={{
        ...sessionState,
        setSession,
        setReturnAddress,
        clearReturnAddress,
        clearSession,
        refreshSession,
        openRecoveryModal,
        closeRecoveryModal,
        recoverSession,
      }}
    >
      {children}
      <SessionRecoveryModal />
    </GuestSessionContext.Provider>
  );
};

export function useGuestSession(): GuestSessionContextType {
  const context = useContext(GuestSessionContext);
  return context || defaultContextValue;
}
