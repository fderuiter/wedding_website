'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/ui/ToastProvider';
import { SessionRecoveryModal } from '../components/SessionRecoveryModal';

export type GuestSessionStatus = 'authenticated' | 'unauthenticated' | 'expired' | 'error';

export interface GuestSessionState {
  invitationCode: string;
  guestName: string;
  isVerified: boolean;
  isLoading: boolean;
  status: GuestSessionStatus;
  lastErrorCode: string | null;
  draftInvitationCode: string;
  isRecoveryModalOpen: boolean;
  rsvpStatus?: 'attending' | 'declined' | 'pending';
  mealSelection?: string;
  dietaryNotes?: string;
  plusOneAllocations?: number;
  plusOneResponses?: any[];
  menuOptions?: string[];
}

export interface GuestSessionContextType extends GuestSessionState {
  setSession: (session: {
    invitationCode: string;
    guestName: string;
    isVerified?: boolean;
    rsvpStatus?: 'attending' | 'declined' | 'pending';
    mealSelection?: string;
    dietaryNotes?: string;
    plusOneAllocations?: number;
    plusOneResponses?: any[];
    menuOptions?: string[];
  }) => void;
  clearSession: () => Promise<void>;
  refreshSession: () => Promise<void>;
  openRecoveryModal: () => void;
  closeRecoveryModal: () => void;
  recoverSession: (code?: string) => Promise<boolean>;
}

const defaultContextValue: GuestSessionContextType = {
  invitationCode: '',
  guestName: '',
  isVerified: false,
  isLoading: false,
  status: 'unauthenticated',
  lastErrorCode: null,
  draftInvitationCode: '',
  isRecoveryModalOpen: false,
  setSession: () => {},
  clearSession: async () => {},
  refreshSession: async () => {},
  openRecoveryModal: () => {},
  closeRecoveryModal: () => {},
  recoverSession: async () => false,
};

export const GuestSessionContext = createContext<GuestSessionContextType>(defaultContextValue);

function useOptionalToast() {
  try {
    return useToast();
  } catch {
    return null;
  }
}

export const GuestSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toast = useOptionalToast();

  const [sessionState, setSessionState] = useState<GuestSessionState>({
    invitationCode: '',
    guestName: '',
    isVerified: false,
    isLoading: true,
    status: 'unauthenticated',
    lastErrorCode: null,
    draftInvitationCode: '',
    isRecoveryModalOpen: false,
  });

  const openRecoveryModal = useCallback(() => {
    setSessionState(prev => ({ ...prev, isRecoveryModalOpen: true }));
  }, []);

  const closeRecoveryModal = useCallback(() => {
    setSessionState(prev => ({ ...prev, isRecoveryModalOpen: false }));
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/registry/session');
      if (data && (data.isVerified || data.invitationCode || data.code)) {
        const code = data.invitationCode || data.code || '';
        const name = data.guestName || '';
        setSessionState(prev => ({
          ...prev,
          invitationCode: code,
          guestName: name,
          isVerified: true,
          isLoading: false,
          status: 'authenticated',
          lastErrorCode: null,
          draftInvitationCode: code || prev.draftInvitationCode || prev.invitationCode,
          isRecoveryModalOpen: false,
        }));
      } else {
        setSessionState(prev => {
          const wasAuth =
            prev.isVerified ||
            prev.status === 'authenticated' ||
            Boolean(prev.invitationCode || prev.draftInvitationCode);
          const draftCode = prev.invitationCode || prev.draftInvitationCode || '';
          const currentName = prev.guestName || '';

          if (wasAuth) {
            return {
              ...prev,
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

        if (wasAuth) {
          return {
            ...prev,
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
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

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
      isVerified?: boolean;
      rsvpStatus?: 'attending' | 'declined' | 'pending';
      mealSelection?: string;
      dietaryNotes?: string;
      plusOneAllocations?: number;
      plusOneResponses?: any[];
      menuOptions?: string[];
    }) => {
      const verified = newSession.isVerified ?? true;
      setSessionState(prev => ({
        ...prev,
        invitationCode: newSession.invitationCode,
        guestName: newSession.guestName,
        isVerified: verified,
        isLoading: false,
        status: verified ? 'authenticated' : 'unauthenticated',
        draftInvitationCode: newSession.invitationCode || prev.draftInvitationCode,
        rsvpStatus: newSession.rsvpStatus ?? prev.rsvpStatus,
        mealSelection: newSession.mealSelection ?? prev.mealSelection,
        dietaryNotes: newSession.dietaryNotes ?? prev.dietaryNotes,
        plusOneAllocations: newSession.plusOneAllocations ?? prev.plusOneAllocations,
        plusOneResponses: newSession.plusOneResponses ?? prev.plusOneResponses,
        menuOptions: newSession.menuOptions ?? prev.menuOptions,
        lastErrorCode: null,
        isRecoveryModalOpen: false,
      }));
    },
    []
  );

  const clearSession = useCallback(async () => {
    try {
      await apiClient.delete('/api/registry/session');
    } catch {
      // Ignore API failure and clear client state
    } finally {
      setSessionState({
        invitationCode: '',
        guestName: '',
        isVerified: false,
        isLoading: false,
        status: 'unauthenticated',
        lastErrorCode: null,
        draftInvitationCode: '',
        isRecoveryModalOpen: false,
      });
    }
  }, []);

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
        const data = await apiClient.get(
          `/api/registry/validate-code?code=${encodeURIComponent(targetCode)}`
        );
        if (data && data.valid) {
          const verifiedCode = data.code || targetCode;

          setSessionState(prev => ({
            ...prev,
            invitationCode: verifiedCode,
            guestName: data.guestName || prev.guestName,
            isVerified: true,
            isLoading: false,
            status: 'authenticated',
            lastErrorCode: null,
            draftInvitationCode: verifiedCode,
            rsvpStatus: data.rsvpStatus || prev.rsvpStatus,
            mealSelection: data.mealSelection || prev.mealSelection,
            dietaryNotes: data.dietaryNotes || prev.dietaryNotes,
            plusOneAllocations: data.plusOneAllocations ?? prev.plusOneAllocations,
            plusOneResponses: data.plusOneResponses || prev.plusOneResponses,
            menuOptions: data.menuOptions || prev.menuOptions,
            isRecoveryModalOpen: false,
          }));

          if (toast) {
            toast.addToast('Session restored successfully!', 'success');
          }

          return true;
        } else {
          setSessionState(prev => ({ ...prev, lastErrorCode: 'INVALID_CODE' }));
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
    [toast, sessionState.draftInvitationCode, sessionState.invitationCode]
  );

  return (
    <GuestSessionContext.Provider
      value={{
        ...sessionState,
        setSession,
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
