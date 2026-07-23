'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

type ThemeContextType = {
  themePrimary: string;
  themeSecondary: string;
  themeAccent: string;
  themeOutline: string;
};

const ThemeContext = createContext<ThemeContextType>({
  themePrimary: '#B91C1C',
  themeSecondary: '#B45309',
  themeAccent: '#D4AF37',
  themeOutline: '#000000',
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

function sanitizeColor(color: string | undefined | null, fallback: string): string {
  if (color && hexColorRegex.test(color)) {
    return color;
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
  } catch (e) {
    return baseHex;
  }
}

function generateDynamicStyles(primaryColor: string, secondaryColor: string): string {
  const safePrimary = sanitizeColor(primaryColor, '#B91C1C');
  const safeSecondary = sanitizeColor(secondaryColor, '#B45309');

  const primaryTextLight = optimizeContrast(safePrimary, '#FFFFFF', 4.5);
  const secondaryTextLight = optimizeContrast(safeSecondary, '#FFFFFF', 4.5);
  const primaryTextDark = optimizeContrast(safePrimary, '#111827', 4.5);
  const secondaryTextDark = optimizeContrast(safeSecondary, '#111827', 4.5);

  return `
    :root {
      --color-primary: ${safePrimary};
      --color-secondary: ${safeSecondary};
      --color-primary-text: ${primaryTextDark};
      --color-secondary-text: ${secondaryTextDark};
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
    }
  `;
}

type ThemeProviderProps = {
  children: React.ReactNode;
  config?: {
    colorPrimary?: string;
    colorSecondary?: string;
  };
};

export function ThemeProvider({ 
  children,
  config: propConfig
}: ThemeProviderProps) {
  const [config, setConfig] = useState(() => ({
    colorPrimary: sanitizeColor(propConfig?.colorPrimary, '#B91C1C'),
    colorSecondary: sanitizeColor(propConfig?.colorSecondary, '#B45309'),
  }));

  const [theme, setTheme] = useState({
    themePrimary: '#B91C1C',
    themeSecondary: '#B45309',
    themeAccent: '#D4AF37',
    themeOutline: '#000000',
  });

  useEffect(() => {
    if (propConfig) {
      setConfig({
        colorPrimary: sanitizeColor(propConfig.colorPrimary, '#B91C1C'),
        colorSecondary: sanitizeColor(propConfig.colorSecondary, '#B45309'),
      });
    }
  }, [propConfig]);

  useEffect(() => {
    // Only listen for messages if inside an iframe
    if (typeof window !== 'undefined' && window !== window.parent) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'DRAFT_UPDATE' && event.data.draftType === 'config') {
          const draftData = event.data.draftData || {};
          setConfig((prev: any) => {
            const next = { ...prev, ...draftData };
            return {
              ...next,
              colorPrimary: sanitizeColor(next.colorPrimary, '#B91C1C'),
              colorSecondary: sanitizeColor(next.colorSecondary, '#B45309'),
            };
          });
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, []);

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue('--color-primary').trim() || '#B91C1C';
    const secondary = styles.getPropertyValue('--color-secondary').trim() || '#B45309';
    const accent = styles.getPropertyValue('--color-accent').trim() || '#D4AF37';
    const outline = styles.getPropertyValue('--color-outline').trim() || '#000000';

    setTheme({
      themePrimary: sanitizeColor(config?.colorPrimary, sanitizeColor(primary, '#B91C1C')),
      themeSecondary: sanitizeColor(config?.colorSecondary, sanitizeColor(secondary, '#B45309')),
      themeAccent: sanitizeColor(accent, '#D4AF37'),
      themeOutline: sanitizeColor(outline, '#000000'),
    });
  }, [config]);

  const stylesString = generateDynamicStyles(
    sanitizeColor(config?.colorPrimary, '#B91C1C'),
    sanitizeColor(config?.colorSecondary, '#B45309')
  );

  return (
    <ThemeContext.Provider value={theme}>
      <style id="dynamic-theme-style">{stylesString}</style>
      {children}
    </ThemeContext.Provider>
  );
}
