'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  ThemePreset,
  getPresetTokens,
  isThemePreset,
  DEFAULT_THEME_PRESET,
} from '@/lib/theme/presets';

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
});

export const useTheme = () => useContext(ThemeContext);

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i;
const layoutTokenRegex = /^\d+(\.\d+)?(px|rem|em|%|ch)$/;

function sanitizeColor(color: string | undefined | null, fallback: string): string {
  if (color && hexColorRegex.test(color)) {
    return color;
  }
  return fallback;
}

function sanitizePreset(preset: string | undefined | null, fallback: ThemePreset = DEFAULT_THEME_PRESET): ThemePreset {
  if (preset && isThemePreset(preset)) {
    return preset;
  }
  return fallback;
}

function sanitizeLayoutToken(token: string | undefined | null, fallback: string): string {
  if (token && layoutTokenRegex.test(token)) {
    return token;
  }
  return fallback;
}

function hexToRgb(hex: string): RGB {
  const cleanHex = hex.replace(/^#/, '');
  let r = 0, g = 0, b = 0;
  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  }
  return { r, g, b };
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  let r = l;
  let g = l;
  let b = l;

  if (s !== 0) {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

function getLuminance(rgb: RGB): number {
  const parts = [rgb.r, rgb.g, rgb.b].map(val => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

function getContrastRatio(color1: RGB, color2: RGB): number {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function optimizeContrast(baseHex: string, bgHex: string, minRatio: number = 4.5): string {
  try {
    const baseRgb = hexToRgb(baseHex);
    const bgRgb = hexToRgb(bgHex);
    
    if (getContrastRatio(baseRgb, bgRgb) >= minRatio) {
      return baseHex;
    }
    
    const bgLuminance = getLuminance(bgRgb);
    const { h, s, l } = rgbToHsl(baseRgb.r, baseRgb.g, baseRgb.b);
    
    const isLightBg = bgLuminance > 0.5;
    let currentL = l;
    let bestHex = baseHex;
    const step = 0.01; 

    if (isLightBg) {
      while (currentL > 0) {
        currentL -= step;
        if (currentL < 0) currentL = 0;
        const testRgb = hslToRgb(h, s, currentL);
        const testHex = rgbToHex(testRgb.r, testRgb.g, testRgb.b);
        if (getContrastRatio(testRgb, bgRgb) >= minRatio) {
          return testHex;
        }
        bestHex = testHex;
      }
    } else {
      while (currentL < 1) {
        currentL += step;
        if (currentL > 1) currentL = 1;
        const testRgb = hslToRgb(h, s, currentL);
        const testHex = rgbToHex(testRgb.r, testRgb.g, testRgb.b);
        if (getContrastRatio(testRgb, bgRgb) >= minRatio) {
          return testHex;
        }
        bestHex = testHex;
      }
    }
    
    return bestHex;
  } catch {
    return baseHex;
  }
}

function generateDynamicStyles(
  primaryColor: string,
  secondaryColor: string,
  themePreset?: string,
  layoutTokens?: {
    containerMaxWidth?: string;
    gridGap?: string;
    cardPadding?: string;
    borderRadius?: string;
  }
): string {
  const safePrimary = sanitizeColor(primaryColor, '#B91C1C');
  const safeSecondary = sanitizeColor(secondaryColor, '#B45309');
  const preset = sanitizePreset(themePreset, DEFAULT_THEME_PRESET);
  const presetTokens = getPresetTokens(preset);

  const safeContainerMaxWidth = sanitizeLayoutToken(layoutTokens?.containerMaxWidth, '64rem');
  const safeGridGap = sanitizeLayoutToken(layoutTokens?.gridGap, '1.5rem');
  const safeCardPadding = sanitizeLayoutToken(layoutTokens?.cardPadding, '2rem');
  const safeBorderRadius = sanitizeLayoutToken(layoutTokens?.borderRadius, '1rem');

  const primaryTextLight = optimizeContrast(safePrimary, '#FFFFFF', 4.5);
  const secondaryTextLight = optimizeContrast(safeSecondary, '#FFFFFF', 4.5);
  const primaryTextDark = optimizeContrast(safePrimary, '#111827', 4.5);
  const secondaryTextDark = optimizeContrast(safeSecondary, '#111827', 4.5);

  const presetCssRules = Object.entries(presetTokens)
    .map(([key, value]) => `      ${key}: ${value};`)
    .join('\n');

  return `
    :root {
      --color-primary: ${safePrimary};
      --color-secondary: ${safeSecondary};
      --color-primary-text: ${primaryTextDark};
      --color-secondary-text: ${secondaryTextDark};
${presetCssRules}
      --container-max-w: ${safeContainerMaxWidth};
      --grid-gap: ${safeGridGap};
      --card-padding: ${safeCardPadding};
      --radius-card: ${safeBorderRadius};
    }

    /* Light mode document */
    html:not(.dark) {
      --color-primary: ${primaryTextLight};
      --color-secondary: ${secondaryTextLight};
      --color-primary-text: ${primaryTextLight};
      --color-secondary-text: ${secondaryTextLight};
    }

    /* Light containers in any document mode */
    .bg-white,
    .bg-gray-50,
    .bg-gray-100,
    .bg-slate-50,
    .bg-slate-100 {
      --color-primary: ${primaryTextLight};
      --color-secondary: ${secondaryTextLight};
      --color-primary-text: ${primaryTextLight};
      --color-secondary-text: ${secondaryTextLight};
    }

    /* Re-assert dark mode variables for dark backgrounds under dark mode */
    .dark .dark\\:bg-gray-800,
    .dark .dark\\:bg-zinc-800,
    .dark .dark\\:bg-gray-900,
    .dark .dark\\:bg-zinc-900,
    .dark .dark\\:bg-black {
      --color-primary: ${safePrimary};
      --color-secondary: ${safeSecondary};
      --color-primary-text: ${primaryTextDark};
      --color-secondary-text: ${secondaryTextDark};
      --container-max-w: ${safeContainerMaxWidth};
      --grid-gap: ${safeGridGap};
      --card-padding: ${safeCardPadding};
      --radius-card: ${safeBorderRadius};
    }

    .dark {
      --container-max-w: ${safeContainerMaxWidth};
      --grid-gap: ${safeGridGap};
      --card-padding: ${safeCardPadding};
      --radius-card: ${safeBorderRadius};
    }
  `;
}

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
    root.classList.add('dark');
    root.classList.remove('light');
  } else {
    root.classList.add('light');
    root.classList.remove('dark');
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
      resolved = getSystemTheme();
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

  const contextValue: ThemeContextType = {
    ...theme,
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
