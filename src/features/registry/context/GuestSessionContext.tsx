'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '@/lib/apiClient';
import { ApiError } from '@/utils/ApiError';
import { useOptionalToast } from '@/components/ui/ToastProvider';
import { notifyGuestSessionChanged, subscribeGuestSessionChanged } from '@/utils/guestSessionEvents';
import { SessionRecoveryModal } from '../components/SessionRecoveryModal';

type GuestSessionStatus = 'authenticated' | 'unauthenticated' | 'expired' | 'error';

interface GuestSessionState {
  invitationCode: string;
  guestName: string;
  email?: string | null;
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
  email: null,
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
    email: null,
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

  const fetchAndApplySession = useCallback(
    async (options?: { preserveExpiryPrompt?: boolean }) => {
      const preserveExpiryPrompt = options?.preserveExpiryPrompt ?? true;
      try {
        const data = await apiClient.get('/api/registry/session');
        if (data && (data.isVerified || data.invitationCode || data.code)) {
          const code = data.invitationCode || data.code || '';
          const name = data.guestName || '';
          const sessionEmail =
            typeof data.email === 'string' && data.email.trim().length > 0
              ? data.email.trim()
              : null;
          setSessionState(prev => ({
            ...prev,
            invitationCode: code,
            guestName: name,
            email: sessionEmail,
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

            if (wasAuth && preserveExpiryPrompt) {
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
                email: null,
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
              email: null,
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
      isVerified?: boolean;
    }) => {
      const verified = newSession.isVerified ?? true;
      setSessionState(prev => ({
        ...prev,
        invitationCode: newSession.invitationCode,
        guestName: newSession.guestName,
        email:
          newSession.email !== undefined
            ? typeof newSession.email === 'string' && newSession.email.trim().length > 0
              ? newSession.email.trim()
              : null
            : prev.email ?? null,
        isVerified: verified,
        isLoading: false,
        status: verified ? 'authenticated' : 'unauthenticated',
        draftInvitationCode: newSession.invitationCode || prev.draftInvitationCode,
        lastErrorCode: null,
        isRecoveryModalOpen: false,
      }));
      emitSessionChanged();
    },
    [emitSessionChanged]
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
        email: null,
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
      const rawTargetCode = (
        codeToVerify ||
        sessionState.draftInvitationCode ||
        sessionState.invitationCode
      ).trim();

      if (!rawTargetCode) {
        setSessionState(prev => ({ ...prev, lastErrorCode: 'MISSING_CODE' }));
        return false;
      }

      const fallbackUpperCode = rawTargetCode.toUpperCase();

      try {
        const data = await apiClient.post<{
          success?: boolean;
          valid?: boolean;
          sessionType?: string;
          guestName?: string;
          code?: string;
          reason?: string;
          error?: string;
        }>('/api/guest/login', {
          passcode: rawTargetCode,
          requireInvitation: true,
        });

        const isInvitationVerified =
          Boolean(data) &&
          data.valid !== false &&
          (data.sessionType === 'invitation' ||
            data.sessionType === 'invite' ||
            data.valid === true ||
            (data.success === true && data.sessionType !== 'guest' && data.sessionType !== 'shared'));

        if (isInvitationVerified) {
          let verifiedCode = typeof data.code === 'string' && data.code.trim() ? data.code.trim().toUpperCase() : '';
          let verifiedGuestName = typeof data.guestName === 'string' ? data.guestName : '';
          let verifiedEmail: string | null = null;

          if (!verifiedCode) {
            try {
              const guestSession = await apiClient.get<{
                code?: string | null;
                invitationCode?: string | null;
                guestName?: string | null;
              }>('/api/guest/session');
              if (guestSession?.code) {
                verifiedCode = guestSession.code.trim().toUpperCase();
              } else if (guestSession?.invitationCode) {
                verifiedCode = guestSession.invitationCode.trim().toUpperCase();
              }
              if (!verifiedGuestName && guestSession?.guestName) {
                verifiedGuestName = guestSession.guestName;
              }
            } catch {
              // Fall back to normalized target code when session hydration endpoint is unavailable
            }
          }

          try {
            const registrySession = await apiClient.get<{
              isVerified?: boolean;
              email?: string | null;
              code?: string;
              invitationCode?: string;
              guestName?: string;
            }>('/api/registry/session');
            if (
              registrySession &&
              typeof registrySession.email === 'string' &&
              registrySession.email.trim().length > 0
            ) {
              verifiedEmail = registrySession.email.trim();
            }
            if (!verifiedCode && registrySession?.code) {
              verifiedCode = registrySession.code.trim().toUpperCase();
            } else if (!verifiedCode && registrySession?.invitationCode) {
              verifiedCode = registrySession.invitationCode.trim().toUpperCase();
            }
            if (!verifiedGuestName && registrySession?.guestName) {
              verifiedGuestName = registrySession.guestName;
            }
          } catch {
            // Optional email hydration; ignore failures
          }

          const finalCode = verifiedCode || fallbackUpperCode;

          setSessionState(prev => ({
            ...prev,
            invitationCode: finalCode,
            guestName: verifiedGuestName || prev.guestName,
            email: verifiedEmail ?? prev.email ?? null,
            isVerified: true,
            isLoading: false,
            status: 'authenticated',
            lastErrorCode: null,
            draftInvitationCode: finalCode,
            isRecoveryModalOpen: false,
          }));

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
        const apiErrData =
          err instanceof ApiError && err.data && typeof err.data === 'object'
            ? (err.data as { reason?: string; error?: string })
            : null;
        const sharedGuidance =
          apiErrData?.reason === 'shared_passcode' && typeof apiErrData.error === 'string' && apiErrData.error.trim()
            ? apiErrData.error.trim()
            : null;
        setSessionState(prev => ({
          ...prev,
          lastErrorCode:
            sharedGuidance || (err instanceof Error ? err.message : 'RECOVERY_FAILED'),
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
