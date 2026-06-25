"use client";

import React, { createContext, useContext, useEffect } from 'react';

// WCAG relative luminance calculation
function getLuminance(r: number, g: number, b: number) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function rgbToHex(r: number, g: number, b: number) {
  return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).padStart(6, '0');
}

export function getContrastRatio(hex1: string, hex2: string) {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return 1;
  const l1 = getLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = getLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (lightest + 0.05) / (darkest + 0.05);
}

export function getAccessibleVariant(colorHex: string, bgHex: string = '#111827', targetRatio = 4.5) {
  let currentRatio = getContrastRatio(colorHex, bgHex);
  if (currentRatio >= targetRatio) return colorHex;

  const rgb = hexToRgb(colorHex);
  if (!rgb) return colorHex;

  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const bgRgb = hexToRgb(bgHex);
  if (!bgRgb) return colorHex;
  const bgLuminance = getLuminance(bgRgb.r, bgRgb.g, bgRgb.b);
  const isDarkBg = bgLuminance < 0.5;

  let step = isDarkBg ? 0.02 : -0.02;
  let newL = hsl.l;

  while (currentRatio < targetRatio && newL >= 0 && newL <= 1) {
    newL += step;
    if (newL < 0) newL = 0;
    if (newL > 1) newL = 1;

    const newRgb = hslToRgb(hsl.h, hsl.s, newL);
    const newHex = rgbToHex(newRgb.r, newRgb.g, newRgb.b);
    currentRatio = getContrastRatio(newHex, bgHex);

    if (newL === 0 || newL === 1) {
      return newHex;
    }
  }

  const finalRgb = hslToRgb(hsl.h, hsl.s, newL);
  return rgbToHex(finalRgb.r, finalRgb.g, finalRgb.b);
}

type ThemeContextType = {
  themePrimary: string;
  themeSecondary: string;
  themeAccent: string;
};

const ThemeContext = createContext<ThemeContextType>({
  themePrimary: '#f43f5e',
  themeSecondary: '#fbbf24',
  themeAccent: '#e11d48',
});

export const useTheme = () => useContext(ThemeContext);

export function ThemeProvider({ 
  children, 
  themePrimary, 
  themeSecondary, 
  themeAccent 
}: { 
  children: React.ReactNode; 
  themePrimary?: string; 
  themeSecondary?: string; 
  themeAccent?: string; 
}) {
  const primary = themePrimary || '#f43f5e';
  const secondary = themeSecondary || '#fbbf24';
  const accent = themeAccent || '#e11d48';

  useEffect(() => {
    // Generate accessible variants for text against dark background
    const bgDark = '#111827';
    const primaryText = getAccessibleVariant(primary, bgDark);
    const secondaryText = getAccessibleVariant(secondary, bgDark);
    const accentText = getAccessibleVariant(accent, bgDark);

    document.documentElement.style.setProperty('--color-primary', primary);
    document.documentElement.style.setProperty('--color-secondary', secondary);
    document.documentElement.style.setProperty('--color-accent', accent);

    // Inject accessible variants for text usage
    document.documentElement.style.setProperty('--color-primary-text', primaryText);
    document.documentElement.style.setProperty('--color-secondary-text', secondaryText);
    document.documentElement.style.setProperty('--color-accent-text', accentText);
  }, [primary, secondary, accent]);

  return (
    <ThemeContext.Provider value={{ themePrimary: primary, themeSecondary: secondary, themeAccent: accent }}>
      {children}
    </ThemeContext.Provider>
  );
}
