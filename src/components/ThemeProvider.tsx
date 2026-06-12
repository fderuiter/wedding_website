"use client";

import React, { createContext, useContext, useEffect, useState } from 'react';
import type { PublicAppConfig } from '@/lib/config';

type AppContextType = {
  config: PublicAppConfig | null;
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useAppConfig = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppConfig must be used within an AppProvider');
  }
  return context.config;
};

// Deprecated: for backwards compatibility with old ThemeProvider consumers.
export const useTheme = () => {
  const config = useAppConfig();
  return {
    themePrimary: config?.themePrimary || '#f43f5e',
    themeSecondary: config?.themeSecondary || '#fbbf24',
    themeAccent: config?.themeAccent || '#e11d48',
  };
};

export function ThemeProvider({ 
  children, 
  config 
}: { 
  children: React.ReactNode; 
  config: PublicAppConfig;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    const primary = config.themePrimary || '#f43f5e';
    const secondary = config.themeSecondary || '#fbbf24';
    const accent = config.themeAccent || '#e11d48';

    document.documentElement.style.setProperty('--color-primary', primary);
    document.documentElement.style.setProperty('--color-secondary', secondary);
    document.documentElement.style.setProperty('--color-accent', accent);
  }, [config.themePrimary, config.themeSecondary, config.themeAccent, mounted]);

  return (
    <AppContext.Provider value={{ config }}>
      {children}
    </AppContext.Provider>
  );
}

// Export it as AppProvider too.
export const AppProvider = ThemeProvider;
