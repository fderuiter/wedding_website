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

interface HSL {
  h: number;
  s: number;
  l: number;
}

const hexColorRegex = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i;
const layoutTokenRegex = /^\d+(\.\d+)?(px|rem|em|%|ch)$/;
const fontTokenRegex = /^[a-zA-Z0-9_\-\s,'"\(\)]+$/;

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

export function sanitizeFontToken(token: string | undefined | null, fallback: string): string {
  if (token && fontTokenRegex.test(token) && !token.includes(';') && !token.includes('<') && !token.includes('>')) {
    return token.trim();
  }
  return fallback;
}

export function sanitizeTokenValue(val: string | undefined | null): string {
  if (!val || typeof val !== 'string') return '';
  return val.replace(/[;{}<>\r\n]|\/\*|\*\//g, '');
}

export function hexToRgb(hex: string): RGB {
  if (!hex || typeof hex !== 'string') {
    throw new Error('Invalid hex color');
  }
  const cleanHex = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(cleanHex)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  let r = 0;
  let g = 0;
  let b = 0;
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
  return (
    '#' +
    [clamp(r), clamp(g), clamp(b)]
      .map((x) => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('')
  );
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

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function getLuminance(rgb: RGB): number {
  const parts = [rgb.r, rgb.g, rgb.b].map((val) => {
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
  if (!baseHex || typeof baseHex !== 'string') {
    return baseHex;
  }
  const safeBgHex = typeof bgHex === 'string' ? bgHex : '';
  const cacheKey = `${baseHex.toLowerCase()}:${safeBgHex.toLowerCase()}:${minRatio}`;
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
      const boundaryHex = isLightBg ? '#000000' : '#ffffff';
      let bestHex = boundaryHex;

      let low = isLightBg ? 0 : l;
      let high = isLightBg ? l : 1;

      for (let i = 0; i < 7; i++) {
        const mid = (low + high) / 2;
        const testRgb = hslToRgb(h, s, mid);
        const testHex = rgbToHex(testRgb.r, testRgb.g, testRgb.b);
        if (getContrastRatio(testRgb, bgRgb) >= minRatio) {
          bestHex = testHex;
          if (isLightBg) {
            low = mid;
          } else {
            high = mid;
          }
        } else {
          if (isLightBg) {
            high = mid;
          } else {
            low = mid;
          }
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
  },
  fontTokens?: {
    fontHeading?: string | null;
    fontBody?: string | null;
    fontMono?: string | null;
  },
  nonColorTokens?: Record<string, string>
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

  if (nonColorTokens && typeof nonColorTokens === 'object') {
    for (const [k, v] of Object.entries(nonColorTokens)) {
      if (v && typeof v === 'string') {
        const tokenKey = k.startsWith('--') ? k : `--${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
        sanitizedCustomTokens[tokenKey] = sanitizeTokenValue(v);
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

  const safeFontHeading = sanitizeFontToken(fontTokens?.fontHeading, lightPresetTokens['--font-heading']);
  const safeFontBody = sanitizeFontToken(fontTokens?.fontBody, lightPresetTokens['--font-body']);
  const safeFontMono = sanitizeFontToken(fontTokens?.fontMono, lightPresetTokens['--font-mono']);

  const primaryTextLight = optimizeContrast(safePrimary, '#FFFFFF', 4.5);
  const secondaryTextLight = optimizeContrast(safeSecondary, '#FFFFFF', 4.5);
  const errorTextLight = optimizeContrast('#DC2626', '#FFFFFF', 4.5);
  const focusRingLight = optimizeContrast(safePrimary, '#FFFFFF', 3.0);
  const surfaceBorderLight = optimizeContrast('#6B7280', '#FFFFFF', 3.0);
  const mutedTextLight = optimizeContrast('#4B5563', '#FFFFFF', 4.5);

  const warningBgLight = 'rgba(245, 158, 11, 0.1)';
  const warningBorderLight = 'rgba(245, 158, 11, 0.3)';
  const warningTextLight = optimizeContrast('#78350F', '#FFFFFF', 4.5);

  const statusWarningTextLight = optimizeContrast('#92400E', '#FEF3C7', 4.5);
  const statusSuccessTextLight = optimizeContrast('#166534', '#F0FDF4', 4.5);
  const statusInfoTextLight = optimizeContrast('#1E40AF', '#EFF6FF', 4.5);

  const primaryTextDark = optimizeContrast(safePrimary, '#111827', 4.5);
  const secondaryTextDark = optimizeContrast(safeSecondary, '#111827', 4.5);
  const errorTextDark = optimizeContrast('#EF4444', '#111827', 4.5);
  const focusRingDark = optimizeContrast(safePrimary, '#111827', 3.0);
  const surfaceBorderDark = optimizeContrast('#9CA3AF', '#111827', 3.0);
  const mutedTextDark = optimizeContrast('#9CA3AF', '#111827', 4.5);

  const warningBgDark = 'rgba(245, 158, 11, 0.15)';
  const warningBorderDark = 'rgba(245, 158, 11, 0.35)';
  const warningTextDark = optimizeContrast('#FDE68A', '#111827', 4.5);

  const statusWarningTextDark = optimizeContrast('#FCD34D', '#111827', 4.5);
  const statusSuccessTextDark = optimizeContrast('#86EFAC', '#111827', 4.5);
  const statusInfoTextDark = optimizeContrast('#93C5FD', '#111827', 4.5);

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
      --color-muted-text: ${mutedTextDark};
      --color-text-muted: ${mutedTextDark};
      --color-warning-bg: ${warningBgDark};
      --color-warning-border: ${warningBorderDark};
      --color-warning-text: ${warningTextDark};
      --color-status-warning-text: ${statusWarningTextDark};
      --color-status-unsent-text: ${statusWarningTextDark};
      --color-status-success-text: ${statusSuccessTextDark};
      --color-status-sent-text: ${statusSuccessTextDark};
      --color-status-info-text: ${statusInfoTextDark};
      --color-status-not-needed-text: ${statusInfoTextDark};
${lightPresetCssRules}
      --font-heading: ${safeFontHeading};
      --font-body: ${safeFontBody};
      --font-mono: ${safeFontMono};
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
      --color-muted-text: ${mutedTextLight};
      --color-text-muted: ${mutedTextLight};
      --color-warning-bg: ${warningBgLight};
      --color-warning-border: ${warningBorderLight};
      --color-warning-text: ${warningTextLight};
      --color-status-warning-text: ${statusWarningTextLight};
      --color-status-unsent-text: ${statusWarningTextLight};
      --color-status-success-text: ${statusSuccessTextLight};
      --color-status-sent-text: ${statusSuccessTextLight};
      --color-status-info-text: ${statusInfoTextLight};
      --color-status-not-needed-text: ${statusInfoTextLight};
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
      --color-muted-text: ${mutedTextLight};
      --color-text-muted: ${mutedTextLight};
      --color-warning-bg: ${warningBgLight};
      --color-warning-border: ${warningBorderLight};
      --color-warning-text: ${warningTextLight};
      --color-status-warning-text: ${statusWarningTextLight};
      --color-status-unsent-text: ${statusWarningTextLight};
      --color-status-success-text: ${statusSuccessTextLight};
      --color-status-sent-text: ${statusSuccessTextLight};
      --color-status-info-text: ${statusInfoTextLight};
      --color-status-not-needed-text: ${statusInfoTextLight};
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
      --color-muted-text: ${mutedTextDark};
      --color-text-muted: ${mutedTextDark};
      --color-warning-bg: ${warningBgDark};
      --color-warning-border: ${warningBorderDark};
      --color-warning-text: ${warningTextDark};
      --color-status-warning-text: ${statusWarningTextDark};
      --color-status-unsent-text: ${statusWarningTextDark};
      --color-status-success-text: ${statusSuccessTextDark};
      --color-status-sent-text: ${statusSuccessTextDark};
      --color-status-info-text: ${statusInfoTextDark};
      --color-status-not-needed-text: ${statusInfoTextDark};
    }

    .dark {
      --color-primary: ${safePrimary};
      --color-secondary: ${safeSecondary};
      --color-primary-text: ${primaryTextDark};
      --color-secondary-text: ${secondaryTextDark};
      --color-error-text: ${errorTextDark};
      --color-focus-ring: ${focusRingDark};
      --color-surface-border: ${surfaceBorderDark};
      --color-muted-text: ${mutedTextDark};
      --color-text-muted: ${mutedTextDark};
      --color-warning-bg: ${warningBgDark};
      --color-warning-border: ${warningBorderDark};
      --color-warning-text: ${warningTextDark};
      --color-status-warning-text: ${statusWarningTextDark};
      --color-status-unsent-text: ${statusWarningTextDark};
      --color-status-success-text: ${statusSuccessTextDark};
      --color-status-sent-text: ${statusSuccessTextDark};
      --color-status-info-text: ${statusInfoTextDark};
      --color-status-not-needed-text: ${statusInfoTextDark};
${darkPresetCssRules}
      --container-max-w: ${safeContainerMaxWidth};
      --grid-gap: ${safeGridGap};
      --card-padding: ${safeCardPadding};
      --radius-card: ${safeBorderRadius};
    }
  `;
}

export type ThemeConfigInput = {
  colorPrimary?: string | null;
  colorSecondary?: string | null;
  themePreset?: string | null;
  themeTokens?: Record<string, string> | null;
  typographyScale?: Record<string, string> | null;
  spacingScale?: Record<string, string> | null;
  borderTreatment?: Record<string, string> | null;
  brandDimensions?: Record<string, string> | null;
  brandLogoWidth?: string | null;
  brandLogoHeight?: string | null;
  brandHeroHeight?: string | null;
  brandWatermarkWidth?: string | null;
  brandWatermarkOpacity?: string | null;
  brandBadgeSize?: string | null;
  layoutContainerMaxWidth?: string | null;
  layoutGridGap?: string | null;
  layoutCardPadding?: string | null;
  layoutBorderRadius?: string | null;
  fontHeading?: string | null;
  fontBody?: string | null;
  fontMono?: string | null;
};

export function generateThemeStylesheet(config?: ThemeConfigInput | null): string {
  const safeConfig = config || {};

  const nonColorTokens: Record<string, string> = {
    ...(safeConfig.typographyScale || {}),
    ...(safeConfig.spacingScale || {}),
    ...(safeConfig.borderTreatment || {}),
    ...(safeConfig.brandDimensions || {}),
  };
  if (safeConfig.brandLogoWidth) nonColorTokens['--brand-logo-width'] = safeConfig.brandLogoWidth;
  if (safeConfig.brandLogoHeight) nonColorTokens['--brand-logo-height'] = safeConfig.brandLogoHeight;
  if (safeConfig.brandHeroHeight) nonColorTokens['--brand-hero-height'] = safeConfig.brandHeroHeight;
  if (safeConfig.brandWatermarkWidth) nonColorTokens['--brand-watermark-width'] = safeConfig.brandWatermarkWidth;
  if (safeConfig.brandWatermarkOpacity) nonColorTokens['--brand-watermark-opacity'] = safeConfig.brandWatermarkOpacity;
  if (safeConfig.brandBadgeSize) nonColorTokens['--brand-badge-size'] = safeConfig.brandBadgeSize;

  return generateDynamicStyles(
    sanitizeColor(safeConfig.colorPrimary, '#B91C1C'),
    sanitizeColor(safeConfig.colorSecondary, '#B45309'),
    safeConfig.themePreset || undefined,
    safeConfig.themeTokens || undefined,
    {
      containerMaxWidth: safeConfig.layoutContainerMaxWidth || undefined,
      gridGap: safeConfig.layoutGridGap || undefined,
      cardPadding: safeConfig.layoutCardPadding || undefined,
      borderRadius: safeConfig.layoutBorderRadius || undefined,
    },
    {
      fontHeading: safeConfig.fontHeading,
      fontBody: safeConfig.fontBody,
      fontMono: safeConfig.fontMono,
    },
    nonColorTokens
  );
}
