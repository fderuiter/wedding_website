'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/lib/apiClient';
import { useOptionalToast } from '@/components/ui/ToastProvider';
import { SessionRecoveryModal } from '../components/SessionRecoveryModal';

export type GuestSessionStatus = 'authenticated' | 'unauthenticated' | 'expired' | 'error';

export interface GuestSessionState {
  invitationCode: string;
  guestName: string;
  guestEmail?: string;
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
    guestEmail?: string | null;
    isVerified?: boolean;
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
  guestEmail: '',
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

export const GuestSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toast = useOptionalToast();

  const [sessionState, setSessionState] = useState<GuestSessionState>({
    invitationCode: '',
    guestName: '',
    guestEmail: '',
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
        const email = typeof data.email === 'string' ? data.email : '';
        setSessionState(prev => ({
          ...prev,
          invitationCode: code,
          guestName: name,
          guestEmail: email,
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
          const currentEmail = prev.guestEmail || '';

          if (wasAuth) {
            return {
              ...prev,
              invitationCode: draftCode,
              guestName: currentName,
              guestEmail: currentEmail,
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
              guestEmail: '',
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
        const currentEmail = prev.guestEmail || '';

        if (wasAuth) {
          return {
            ...prev,
            invitationCode: draftCode,
            guestName: currentName,
            guestEmail: currentEmail,
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
            guestEmail: '',
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
      guestEmail?: string | null;
      isVerified?: boolean;
    }) => {
      const verified = newSession.isVerified ?? true;
      setSessionState(prev => ({
        ...prev,
        invitationCode: newSession.invitationCode,
        guestName: newSession.guestName,
        guestEmail:
          newSession.guestEmail !== undefined
            ? newSession.guestEmail || ''
            : prev.guestEmail || '',
        isVerified: verified,
        isLoading: false,
        status: verified ? 'authenticated' : 'unauthenticated',
        draftInvitationCode: newSession.invitationCode || prev.draftInvitationCode,
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
        guestEmail: '',
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
          const resolvedEmail =
            typeof data.email === 'string' ? data.email : undefined;

          setSessionState(prev => ({
            ...prev,
            invitationCode: verifiedCode,
            guestName: data.guestName || prev.guestName,
            guestEmail: resolvedEmail !== undefined ? resolvedEmail : prev.guestEmail || '',
            isVerified: true,
            isLoading: false,
            status: 'authenticated',
            lastErrorCode: null,
            draftInvitationCode: verifiedCode,
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
