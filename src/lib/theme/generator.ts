import {
  ThemePreset,
  getPresetTokens,
  isThemePreset,
  DEFAULT_THEME_PRESET,
} from './presets';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i;
const layoutTokenRegex = /^\d+(\.\d+)?(px|rem|em|%|ch)$/;

export function sanitizeColor(color: string | undefined | null, fallback: string): string {
  if (color && hexColorRegex.test(color)) {
    return color;
  }
  return fallback;
}

export function sanitizePreset(
  preset: string | undefined | null,
  fallback: ThemePreset = DEFAULT_THEME_PRESET
): ThemePreset {
  if (preset && isThemePreset(preset)) {
    return preset;
  }
  return fallback;
}

export function sanitizeLayoutToken(token: string | undefined | null, fallback: string): string {
  if (token && layoutTokenRegex.test(token)) {
    return token;
  }
  return fallback;
}

export function sanitizeTokenValue(val: string | undefined | null): string {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[;{}<>\r\n]|\/\*|\*\//g, '');
}

export function hexToRgb(hex: string): RGB {
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

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
  return '#' + [clamp(r), clamp(g), clamp(b)].map(x => {
    const hex = x.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

export function rgbToHsl(r: number, g: number, b: number): HSL {
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

export function hslToRgb(h: number, s: number, l: number): RGB {
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
    b: Math.round(b * 255),
  };
}

export function getLuminance(rgb: RGB): number {
  const parts = [rgb.r, rgb.g, rgb.b].map(val => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

export function getContrastRatio(color1: RGB, color2: RGB): number {
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export const contrastCache = new Map<string, string>();

export function clearContrastCache(): void {
  contrastCache.clear();
}

export function optimizeContrast(baseHex: string, bgHex: string, minRatio: number = 4.5): string {
  const cacheKey = `${baseHex.toLowerCase()}:${bgHex.toLowerCase()}:${minRatio}`;
  if (contrastCache.has(cacheKey)) {
    return contrastCache.get(cacheKey)!;
  }

  let computedHex = baseHex;
  try {
    const baseRgb = hexToRgb(baseHex);
    const bgRgb = hexToRgb(bgHex);
    
    if (getContrastRatio(baseRgb, bgRgb) >= minRatio) {
      computedHex = baseHex;
    } else {
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
            bestHex = testHex;
            break;
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
            bestHex = testHex;
            break;
          }
          bestHex = testHex;
        }
      }
      computedHex = bestHex;
    }
  } catch {
    computedHex = baseHex;
  }

  if (contrastCache.size >= 1000) {
    contrastCache.clear();
  }
  contrastCache.set(cacheKey, computedHex);
  return computedHex;
}

export function generateDynamicStyles(
  primaryColor: string,
  secondaryColor: string,
  themePreset?: string,
  customTokens?: Record<string, string>,
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
  const baseLightTokens = getPresetTokens(preset, 'light');
  const baseDarkTokens = getPresetTokens(preset, 'dark');

  const sanitizedCustomTokens: Record<string, string> = {};
  if (customTokens && typeof customTokens === 'object') {
    for (const [k, v] of Object.entries(customTokens)) {
      if (k.startsWith('--')) {
        sanitizedCustomTokens[k] = sanitizeTokenValue(v);
      }
    }
  }

  const lightPresetTokens = {
    ...baseLightTokens,
    ...sanitizedCustomTokens,
  };

  const darkPresetTokens = {
    ...baseDarkTokens,
    ...sanitizedCustomTokens,
  };

  const safeContainerMaxWidth = sanitizeLayoutToken(layoutTokens?.containerMaxWidth, '64rem');
  const safeGridGap = sanitizeLayoutToken(layoutTokens?.gridGap, '1.5rem');
  const safeCardPadding = sanitizeLayoutToken(layoutTokens?.cardPadding, '2rem');
  const safeBorderRadius = sanitizeLayoutToken(layoutTokens?.borderRadius, '1rem');

  const primaryTextLight = optimizeContrast(safePrimary, '#FFFFFF', 4.5);
  const secondaryTextLight = optimizeContrast(safeSecondary, '#FFFFFF', 4.5);
  const errorTextLight = optimizeContrast('#DC2626', '#FFFFFF', 4.5);
  const focusRingLight = optimizeContrast(safePrimary, '#FFFFFF', 3.0);
  const surfaceBorderLight = optimizeContrast('#6B7280', '#FFFFFF', 3.0);

  const primaryTextDark = optimizeContrast(safePrimary, '#111827', 4.5);
  const secondaryTextDark = optimizeContrast(safeSecondary, '#111827', 4.5);
  const errorTextDark = optimizeContrast('#EF4444', '#111827', 4.5);
  const focusRingDark = optimizeContrast(safePrimary, '#111827', 3.0);
  const surfaceBorderDark = optimizeContrast('#9CA3AF', '#111827', 3.0);

  const seatAssignedTextLight = optimizeContrast('#ffffff', primaryTextLight, 4.5);
  const seatAssignedTextDark = optimizeContrast('#ffffff', safePrimary, 4.5);

  const lightPresetCssRules = Object.entries(lightPresetTokens)
    .filter(([key]) => key !== 'darkTokens')
    .map(([key, value]) => `      ${key}: ${value};`)
    .join('\n');

  const darkPresetCssRules = Object.entries(darkPresetTokens)
    .filter(([key]) => key !== 'darkTokens')
    .map(([key, value]) => `      ${key}: ${value};`)
    .join('\n');

  return `
    :root {
      --color-primary: ${safePrimary};
      --color-secondary: ${safeSecondary};
      --color-primary-text: ${primaryTextDark};
      --color-secondary-text: ${secondaryTextDark};
      --color-error-text: ${errorTextDark};
      --color-focus-ring: ${focusRingDark};
      --color-surface-border: ${surfaceBorderDark};
${lightPresetCssRules}
      --floorplan-seat-assigned-text: ${seatAssignedTextDark};
      --container-max-w: ${safeContainerMaxWidth};
      --grid-gap: ${safeGridGap};
      --card-padding: ${safeCardPadding};
      --radius-card: ${safeBorderRadius};
    }

    /* Light mode document context */
    html:not(.dark),
    html.light,
    [data-surface="light"] {
      --color-primary: ${primaryTextLight};
      --color-secondary: ${secondaryTextLight};
      --color-primary-text: ${primaryTextLight};
      --color-secondary-text: ${secondaryTextLight};
      --color-error-text: ${errorTextLight};
      --color-focus-ring: ${focusRingLight};
      --color-surface-border: ${surfaceBorderLight};
      --floorplan-seat-assigned-text: ${seatAssignedTextLight};
    }

    /* Light containers in any document mode */
    .bg-white,
    [data-surface="light"],
    .bg-gray-50,
    .bg-gray-100,
    .bg-gray-200,
    .bg-gray-300,
    .bg-gray-400,
    .bg-slate-50,
    .bg-slate-100,
    .bg-slate-200,
    .bg-slate-300,
    .bg-slate-400,
    .bg-zinc-50,
    .bg-zinc-100,
    .bg-zinc-200,
    .bg-zinc-300,
    .bg-zinc-400,
    .bg-stone-50,
    .bg-stone-100,
    .bg-stone-200,
    .bg-stone-300,
    .bg-stone-400,
    .bg-neutral-50,
    .bg-neutral-100,
    .bg-neutral-200,
    .bg-neutral-300,
    .bg-neutral-400 {
      --color-primary: ${primaryTextLight};
      --color-secondary: ${secondaryTextLight};
      --color-primary-text: ${primaryTextLight};
      --color-secondary-text: ${secondaryTextLight};
      --color-error-text: ${errorTextLight};
      --color-focus-ring: ${focusRingLight};
      --color-surface-border: ${surfaceBorderLight};
    }

    /* Re-assert dark mode variables for dark backgrounds under dark mode */
    .dark .dark\\:bg-black,
    .dark [data-surface="dark"],
    .dark .dark\\:bg-gray-600,
    .dark .dark\\:bg-gray-700,
    .dark .dark\\:bg-gray-800,
    .dark .dark\\:bg-gray-900,
    .dark .dark\\:bg-gray-950,
    .dark .dark\\:bg-slate-600,
    .dark .dark\\:bg-slate-700,
    .dark .dark\\:bg-slate-800,
    .dark .dark\\:bg-slate-900,
    .dark .dark\\:bg-slate-950,
    .dark .dark\\:bg-zinc-600,
    .dark .dark\\:bg-zinc-700,
    .dark .dark\\:bg-zinc-800,
    .dark .dark\\:bg-zinc-900,
    .dark .dark\\:bg-zinc-950,
    .dark .dark\\:bg-stone-600,
    .dark .dark\\:bg-stone-700,
    .dark .dark\\:bg-stone-800,
    .dark .dark\\:bg-stone-900,
    .dark .dark\\:bg-stone-950,
    .dark .dark\\:bg-neutral-600,
    .dark .dark\\:bg-neutral-700,
    .dark .dark\\:bg-neutral-800,
    .dark .dark\\:bg-neutral-900,
    .dark .dark\\:bg-neutral-950,
    .bg-black,
    [data-surface="dark"],
    .bg-gray-600,
    .bg-gray-700,
    .bg-gray-800,
    .bg-gray-900,
    .bg-gray-950,
    .bg-slate-600,
    .bg-slate-700,
    .bg-slate-800,
    .bg-slate-900,
    .bg-slate-950,
    .bg-zinc-600,
    .bg-zinc-700,
    .bg-zinc-800,
    .bg-zinc-900,
    .bg-zinc-950,
    .bg-stone-600,
    .bg-stone-700,
    .bg-stone-800,
    .bg-stone-900,
    .bg-stone-950,
    .bg-neutral-600,
    .bg-neutral-700,
    .bg-neutral-800,
    .bg-neutral-900,
    .bg-neutral-950 {
      --color-primary: ${safePrimary};
      --color-secondary: ${safeSecondary};
      --color-primary-text: ${primaryTextDark};
      --color-secondary-text: ${secondaryTextDark};
      --color-error-text: ${errorTextDark};
      --color-focus-ring: ${focusRingDark};
      --color-surface-border: ${surfaceBorderDark};
    }

    .dark {
      --color-primary: ${safePrimary};
      --color-secondary: ${safeSecondary};
      --color-primary-text: ${primaryTextDark};
      --color-secondary-text: ${secondaryTextDark};
      --color-error-text: ${errorTextDark};
      --color-focus-ring: ${focusRingDark};
      --color-surface-border: ${surfaceBorderDark};
${darkPresetCssRules}
      --container-max-w: ${safeContainerMaxWidth};
      --grid-gap: ${safeGridGap};
      --card-padding: ${safeCardPadding};
      --radius-card: ${safeBorderRadius};
    }
  `;
}
