'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  ThemePreset,
  getPresetTokens,
  DEFAULT_THEME_PRESET,
} from '@/lib/theme/presets';
import {
  generateDynamicStyles,
  sanitizeColor,
  sanitizePreset,
  sanitizeLayoutToken,
} from '@/lib/theme/generator';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

type ThemeContextType = {
  themePrimary: string;
  themeSecondary: string;
  themeAccent: string;
  themeOutline: string;
  themePreset: ThemePreset;
  themeMode: ThemeMode;
  mode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  resolvedTheme: ResolvedTheme;
  layoutContainerMaxWidth: string;
  layoutGridGap: string;
  layoutCardPadding: string;
  layoutBorderRadius: string;
  metalness: number;
  roughness: number;
  envMapIntensity: number;
  cardPerspective: number;
  cardMaxRotation: number;
  cardSpringStiffness: number;
  cardSpringDamping: number;
};

const ThemeContext = createContext<ThemeContextType>({
  themePrimary: '#B91C1C',
  themeSecondary: '#B45309',
  themeAccent: '#D4AF37',
  themeOutline: '#000000',
  themePreset: DEFAULT_THEME_PRESET,
  themeMode: 'system',
  mode: 'system',
  setThemeMode: () => {},
  resolvedTheme: 'dark',
  layoutContainerMaxWidth: '64rem',
  layoutGridGap: '1.5rem',
  layoutCardPadding: '2rem',
  layoutBorderRadius: '1rem',
  metalness: 1,
  roughness: 0.2,
  envMapIntensity: 1.2,
  cardPerspective: 1000,
  cardMaxRotation: 10,
  cardSpringStiffness: 300,
  cardSpringDamping: 20,
});

export const useTheme = () => useContext(ThemeContext);

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') {
    if (!root.classList.contains('dark')) {
      root.classList.add('dark');
    }
    if (root.classList.contains('light')) {
      root.classList.remove('light');
    }
  } else {
    if (!root.classList.contains('light')) {
      root.classList.add('light');
    }
    if (root.classList.contains('dark')) {
      root.classList.remove('dark');
    }
  }
}

type ThemeProviderProps = {
  children: React.ReactNode;
  config?: {
    colorPrimary?: string;
    colorSecondary?: string;
    themePreset?: ThemePreset | string;
    layoutContainerMaxWidth?: string;
    layoutGridGap?: string;
    layoutCardPadding?: string;
    layoutBorderRadius?: string;
  };
  initialThemeMode?: ThemeMode;
};

export function ThemeProvider({ 
  children,
  config: propConfig,
  initialThemeMode = 'system'
}: ThemeProviderProps) {
  const [config, setConfig] = useState(() => ({
    colorPrimary: sanitizeColor(propConfig?.colorPrimary, '#B91C1C'),
    colorSecondary: sanitizeColor(propConfig?.colorSecondary, '#B45309'),
    themePreset: sanitizePreset(propConfig?.themePreset, DEFAULT_THEME_PRESET),
    layoutContainerMaxWidth: sanitizeLayoutToken(propConfig?.layoutContainerMaxWidth, '64rem'),
    layoutGridGap: sanitizeLayoutToken(propConfig?.layoutGridGap, '1.5rem'),
    layoutCardPadding: sanitizeLayoutToken(propConfig?.layoutCardPadding, '2rem'),
    layoutBorderRadius: sanitizeLayoutToken(propConfig?.layoutBorderRadius, '1rem'),
  }));

  const [themeMode, setThemeModeState] = useState<ThemeMode>(initialThemeMode);

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    if (initialThemeMode === 'light') return 'light';
    if (initialThemeMode === 'dark') return 'dark';
    return 'dark';
  });

  const [theme, setTheme] = useState({
    themePrimary: '#B91C1C',
    themeSecondary: '#B45309',
    themeAccent: '#D4AF37',
    themeOutline: '#000000',
    themePreset: DEFAULT_THEME_PRESET,
    layoutContainerMaxWidth: '64rem',
    layoutGridGap: '1.5rem',
    layoutCardPadding: '2rem',
    layoutBorderRadius: '1rem',
  });

  // Client hydration check & sync with localStorage if no explicit initialThemeMode was supplied
  useEffect(() => {
    let currentMode = themeMode;
    try {
      const saved = localStorage.getItem('theme_mode');
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        if (!initialThemeMode || initialThemeMode === 'system') {
          currentMode = saved as ThemeMode;
          setThemeModeState(currentMode);
        }
      }
    } catch {}

    let resolved: ResolvedTheme = 'dark';
    if (currentMode === 'light') {
      resolved = 'light';
    } else if (currentMode === 'dark') {
      resolved = 'dark';
    } else {
      if (
        typeof document !== 'undefined' &&
        (document.documentElement.classList.contains('dark') ||
          document.documentElement.classList.contains('light'))
      ) {
        resolved = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
      } else {
        resolved = getSystemTheme();
      }
    }

    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);
  }, [initialThemeMode]);

  // System preference change listener when mode is 'system'
  useEffect(() => {
    if (themeMode !== 'system') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      const newResolved: ResolvedTheme = e.matches ? 'dark' : 'light';
      setResolvedTheme(newResolved);
      applyResolvedTheme(newResolved);
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
    }

    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else if (mediaQuery.removeListener) {
        mediaQuery.removeListener(handleChange);
      }
    };
  }, [themeMode]);

  const setThemeMode = (newMode: ThemeMode) => {
    setThemeModeState(newMode);

    try {
      localStorage.setItem('theme_mode', newMode);
    } catch {}

    try {
      document.cookie = `theme_mode=${newMode}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {}

    let resolved: ResolvedTheme = 'dark';
    if (newMode === 'light') {
      resolved = 'light';
    } else if (newMode === 'dark') {
      resolved = 'dark';
    } else {
      resolved = getSystemTheme();
    }

    setResolvedTheme(resolved);
    applyResolvedTheme(resolved);
  };

  useEffect(() => {
    if (propConfig) {
      setConfig({
        colorPrimary: sanitizeColor(propConfig.colorPrimary, '#B91C1C'),
        colorSecondary: sanitizeColor(propConfig.colorSecondary, '#B45309'),
        themePreset: sanitizePreset(propConfig.themePreset, DEFAULT_THEME_PRESET),
        layoutContainerMaxWidth: sanitizeLayoutToken(propConfig.layoutContainerMaxWidth, '64rem'),
        layoutGridGap: sanitizeLayoutToken(propConfig.layoutGridGap, '1.5rem'),
        layoutCardPadding: sanitizeLayoutToken(propConfig.layoutCardPadding, '2rem'),
        layoutBorderRadius: sanitizeLayoutToken(propConfig.layoutBorderRadius, '1rem'),
      });
    }
  }, [propConfig]);

  useEffect(() => {
    // Only listen for messages if inside an iframe
    if (typeof window !== 'undefined' && window !== window.parent) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'DRAFT_UPDATE' && event.data.draftType === 'config') {
          const draftData = event.data.draftData || {};
          setConfig((prev) => {
            const next = { ...prev, ...draftData };
            return {
              ...next,
              colorPrimary: sanitizeColor(next.colorPrimary, '#B91C1C'),
              colorSecondary: sanitizeColor(next.colorSecondary, '#B45309'),
              themePreset: sanitizePreset(next.themePreset, DEFAULT_THEME_PRESET),
              layoutContainerMaxWidth: sanitizeLayoutToken(next.layoutContainerMaxWidth, '64rem'),
              layoutGridGap: sanitizeLayoutToken(next.layoutGridGap, '1.5rem'),
              layoutCardPadding: sanitizeLayoutToken(next.layoutCardPadding, '2rem'),
              layoutBorderRadius: sanitizeLayoutToken(next.layoutBorderRadius, '1rem'),
            };
          });
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  useEffect(() => {
    let primary = '#B91C1C';
    let secondary = '#B45309';
    let accent = '#D4AF37';
    let outline = '#000000';
    let containerMaxWidth = '64rem';
    let gridGap = '1.5rem';
    let cardPadding = '2rem';
    let borderRadius = '1rem';

    try {
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        const rootElement = typeof document !== 'undefined' ? document.documentElement : null;
        if (rootElement) {
          const styles = window.getComputedStyle(rootElement);
          if (styles && typeof styles.getPropertyValue === 'function') {
            primary = styles.getPropertyValue('--color-primary').trim() || '#B91C1C';
            secondary = styles.getPropertyValue('--color-secondary').trim() || '#B45309';
            accent = styles.getPropertyValue('--color-accent').trim() || '#D4AF37';
            outline = styles.getPropertyValue('--color-outline').trim() || '#000000';
            containerMaxWidth = styles.getPropertyValue('--container-max-w').trim() || '64rem';
            gridGap = styles.getPropertyValue('--grid-gap').trim() || '1.5rem';
            cardPadding = styles.getPropertyValue('--card-padding').trim() || '2rem';
            borderRadius = styles.getPropertyValue('--radius-card').trim() || '1rem';
          }
        }
      }
    } catch {
      // Gracefully recover from unreadable styling contexts or missing layout capabilities
    }

    setTheme({
      themePrimary: sanitizeColor(config?.colorPrimary, sanitizeColor(primary, '#B91C1C')),
      themeSecondary: sanitizeColor(config?.colorSecondary, sanitizeColor(secondary, '#B45309')),
      themeAccent: sanitizeColor(accent, '#D4AF37'),
      themeOutline: sanitizeColor(outline, '#000000'),
      themePreset: config.themePreset,
      layoutContainerMaxWidth: sanitizeLayoutToken(config?.layoutContainerMaxWidth, sanitizeLayoutToken(containerMaxWidth, '64rem')),
      layoutGridGap: sanitizeLayoutToken(config?.layoutGridGap, sanitizeLayoutToken(gridGap, '1.5rem')),
      layoutCardPadding: sanitizeLayoutToken(config?.layoutCardPadding, sanitizeLayoutToken(cardPadding, '2rem')),
      layoutBorderRadius: sanitizeLayoutToken(config?.layoutBorderRadius, sanitizeLayoutToken(borderRadius, '1rem')),
    });
  }, [config]);

  const stylesString = generateDynamicStyles(
    sanitizeColor(config?.colorPrimary, '#B91C1C'),
    sanitizeColor(config?.colorSecondary, '#B45309'),
    config?.themePreset,
    {
      containerMaxWidth: config?.layoutContainerMaxWidth,
      gridGap: config?.layoutGridGap,
      cardPadding: config?.layoutCardPadding,
      borderRadius: config?.layoutBorderRadius,
    }
  );

  const activePresetTokens = getPresetTokens(config?.themePreset);
  const parseTokenNum = (val: string | undefined, fallback: number): number => {
    if (!val) return fallback;
    const parsed = parseFloat(val);
    return Number.isNaN(parsed) ? fallback : parsed;
  };
  const metalness = parseTokenNum(activePresetTokens['--3d-metalness'], 1);
  const roughness = parseTokenNum(activePresetTokens['--3d-roughness'], 0.2);
  const envMapIntensity = parseTokenNum(activePresetTokens['--3d-env-map-intensity'], 1.2);
  const cardPerspective = parseTokenNum(activePresetTokens['--card-perspective'], 1000);
  const cardMaxRotation = parseTokenNum(activePresetTokens['--card-max-rotation'], 10);
  const cardSpringStiffness = parseTokenNum(activePresetTokens['--card-spring-stiffness'], 300);
  const cardSpringDamping = parseTokenNum(activePresetTokens['--card-spring-damping'], 20);

  const contextValue: ThemeContextType = {
    ...theme,
    metalness,
    roughness,
    envMapIntensity,
    cardPerspective,
    cardMaxRotation,
    cardSpringStiffness,
    cardSpringDamping,
    themeMode,
    mode: themeMode,
    setThemeMode,
    resolvedTheme,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      <style id="dynamic-theme-style">{stylesString}</style>
      {children}
    </ThemeContext.Provider>
  );
}
