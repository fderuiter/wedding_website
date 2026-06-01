'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type ThemeName = 'rose' | 'gold' | 'silver';

export interface ThemeConfig {
  name: ThemeName;
  colors: {
    background: string;
    foreground: string;
    primary: {
      50: string;
      100: string;
      200: string;
      300: string;
      400: string;
      500: string;
      600: string;
      700: string;
      800: string;
      900: string;
      950: string;
    };
    secondary: {
      400: string;
    };
    materialPrimary: string;
    materialSecondary: string;
    sparkles: string;
  };
}

const themes: Record<ThemeName, ThemeConfig> = {
  rose: {
    name: 'rose',
    colors: {
      background: '#111827',
      foreground: '#f9fafb',
      primary: {
        50: '#fff1f2',
        100: '#ffe4e6',
        200: '#fecdd3',
        300: '#fda4af',
        400: '#fb7185',
        500: '#f43f5e',
        600: '#e11d48',
        700: '#be123c',
        800: '#9f1239',
        900: '#881337',
        950: '#4c0519',
      },
      secondary: {
        400: '#fbbf24',
      },
      materialPrimary: '#f43f5e',
      materialSecondary: '#fbbf24',
      sparkles: '#fda4af',
    },
  },
  gold: {
    name: 'gold',
    colors: {
      background: '#1c1917',
      foreground: '#fafaf9',
      primary: {
        50: '#fefce8',
        100: '#fef9c3',
        200: '#fef08a',
        300: '#fde047',
        400: '#facc15',
        500: '#eab308',
        600: '#ca8a04',
        700: '#a16207',
        800: '#854d0e',
        900: '#713f12',
        950: '#422006',
      },
      secondary: {
        400: '#f87171',
      },
      materialPrimary: '#eab308',
      materialSecondary: '#a16207',
      sparkles: '#fde047',
    },
  },
  silver: {
    name: 'silver',
    colors: {
      background: '#0f172a',
      foreground: '#f8fafc',
      primary: {
        50: '#f8fafc',
        100: '#f1f5f9',
        200: '#e2e8f0',
        300: '#cbd5e1',
        400: '#94a3b8',
        500: '#64748b',
        600: '#475569',
        700: '#334155',
        800: '#1e293b',
        900: '#0f172a',
        950: '#020617',
      },
      secondary: {
        400: '#38bdf8',
      },
      materialPrimary: '#94a3b8',
      materialSecondary: '#475569',
      sparkles: '#cbd5e1',
    },
  },
};

interface ThemeContextType {
  theme: ThemeConfig;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>('rose');
  const theme = themes[themeName];

  useEffect(() => {
    const root = document.documentElement;
    const c = theme.colors;

    root.style.setProperty('--theme-background', c.background);
    root.style.setProperty('--theme-foreground', c.foreground);
    root.style.setProperty('--theme-primary-50', c.primary[50]);
    root.style.setProperty('--theme-primary-100', c.primary[100]);
    root.style.setProperty('--theme-primary-200', c.primary[200]);
    root.style.setProperty('--theme-primary-300', c.primary[300]);
    root.style.setProperty('--theme-primary-400', c.primary[400]);
    root.style.setProperty('--theme-primary-500', c.primary[500]);
    root.style.setProperty('--theme-primary-600', c.primary[600]);
    root.style.setProperty('--theme-primary-700', c.primary[700]);
    root.style.setProperty('--theme-primary-800', c.primary[800]);
    root.style.setProperty('--theme-primary-900', c.primary[900]);
    root.style.setProperty('--theme-primary-950', c.primary[950]);
    root.style.setProperty('--theme-secondary-400', c.secondary[400]);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeName }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
