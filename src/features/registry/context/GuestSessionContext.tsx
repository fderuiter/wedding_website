'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/apiClient';

export interface GuestSessionState {
  invitationCode: string;
  guestName: string;
  isVerified: boolean;
  isLoading: boolean;
}

export interface GuestSessionContextType extends GuestSessionState {
  setSession: (session: { invitationCode: string; guestName: string; isVerified?: boolean }) => void;
  clearSession: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const defaultContextValue: GuestSessionContextType = {
  invitationCode: '',
  guestName: '',
  isVerified: false,
  isLoading: false,
  setSession: () => {},
  clearSession: async () => {},
  refreshSession: async () => {},
};

export const GuestSessionContext = createContext<GuestSessionContextType>(defaultContextValue);

export const GuestSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessionState, setSessionState] = useState<GuestSessionState>({
    invitationCode: '',
    guestName: '',
    isVerified: false,
    isLoading: true,
  });

  const refreshSession = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/registry/session');
      if (data && (data.isVerified || data.invitationCode || data.code)) {
        setSessionState({
          invitationCode: data.invitationCode || data.code || '',
          guestName: data.guestName || '',
          isVerified: data.isVerified ?? true,
          isLoading: false,
        });
      } else {
        setSessionState({
          invitationCode: '',
          guestName: '',
          isVerified: false,
          isLoading: false,
        });
      }
    } catch {
      setSessionState({
        invitationCode: '',
        guestName: '',
        isVerified: false,
        isLoading: false,
      });
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const setSession = useCallback((newSession: { invitationCode: string; guestName: string; isVerified?: boolean }) => {
    setSessionState({
      invitationCode: newSession.invitationCode,
      guestName: newSession.guestName,
      isVerified: newSession.isVerified ?? true,
      isLoading: false,
    });
  }, []);

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
      });
    }
  }, []);

  return (
    <GuestSessionContext.Provider
      value={{
        ...sessionState,
        setSession,
        clearSession,
        refreshSession,
      }}
    >
      {children}
    </GuestSessionContext.Provider>
  );
};

export function useGuestSession(): GuestSessionContextType {
  const context = useContext(GuestSessionContext);
  return context || defaultContextValue;
}
