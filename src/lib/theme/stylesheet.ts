import {
  type ThemePreset,
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

const DISALLOWED_CSS_TOKEN_VALUE_REGEX =
  /(?:^|[^a-zA-Z0-9_-])(?:url|expression)\s*\(|@import|\\/i;

export function sanitizeTokenValue(val: string | undefined | null): string {
  if (!val || typeof val !== 'string') return '';
  if (DISALLOWED_CSS_TOKEN_VALUE_REGEX.test(val)) return '';
  const cleaned = val
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/[;{}<>\r\n]|\/\*|\*\//g, '')
    .trim();
  if (!cleaned || DISALLOWED_CSS_TOKEN_VALUE_REGEX.test(cleaned)) return '';
  return cleaned;
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
    const cached = contrastCache.get(cacheKey)!;
    return cached.toLowerCase() === baseHex.toLowerCase() ? baseHex : cached;
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

      const isLightBg = bgLuminance > 0.179;
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

const NEUTRAL_SURFACE_FAMILIES = ['gray', 'slate', 'zinc', 'stone', 'neutral'] as const;
const BASE_DARK_SHADES = ['800', '900', '950'] as const;

function resolveDarkSurfaceBg(minDarkBgHex: string, candidateBgHex?: string | null): string {
  const minLum = getLuminance(hexToRgb(minDarkBgHex));
  if (!candidateBgHex || !hexColorRegex.test(candidateBgHex)) {
    return minDarkBgHex;
  }
  const candLum = getLuminance(hexToRgb(candidateBgHex));
  if (candLum > minLum && candLum <= 0.5) {
    return candidateBgHex;
  }
  return minDarkBgHex;
}

function resolveLightSurfaceBg(fallbackBgHex: string, candidateBgHex?: string | null): string {
  if (!candidateBgHex || !hexColorRegex.test(candidateBgHex)) {
    return fallbackBgHex;
  }
  const candLum = getLuminance(hexToRgb(candidateBgHex));
  if (candLum >= 0.5) {
    return candidateBgHex;
  }
  return fallbackBgHex;
}

function resolveMinLightSurfaceBg(
  maxLightBgHex: string,
  candidateBgHex?: string | null,
  minLumThreshold: number = 0.5
): string {
  const maxLum = getLuminance(hexToRgb(maxLightBgHex));
  if (!candidateBgHex || !hexColorRegex.test(candidateBgHex)) {
    return maxLightBgHex;
  }
  const candLum = getLuminance(hexToRgb(candidateBgHex));
  if (candLum < maxLum && candLum >= minLumThreshold) {
    return candidateBgHex;
  }
  return maxLightBgHex;
}

interface LightSurfaceTokenSet {
  primaryText: string;
  secondaryText: string;
  errorText: string;
  focusRing: string;
  surfaceBorder: string;
  mutedText: string;
  warningBg: string;
  warningBorder: string;
  warningText: string;
  statusWarningText: string;
  statusSuccessText: string;
  statusInfoText: string;
}

function calibrateLightSurfaceTokensForBg(
  safePrimary: string,
  safeSecondary: string,
  surfaceBgHex: string
): LightSurfaceTokenSet {
  return {
    primaryText: optimizeContrast(safePrimary, surfaceBgHex, 4.5),
    secondaryText: optimizeContrast(safeSecondary, surfaceBgHex, 4.5),
    errorText: optimizeContrast('#DC2626', surfaceBgHex, 4.5),
    focusRing: optimizeContrast(safePrimary, surfaceBgHex, 3.0),
    surfaceBorder: optimizeContrast('#6B7280', surfaceBgHex, 3.0),
    mutedText: optimizeContrast('#4B5563', surfaceBgHex, 4.5),
    warningBg: 'rgba(245, 158, 11, 0.1)',
    warningBorder: 'rgba(245, 158, 11, 0.3)',
    warningText: optimizeContrast('#78350F', surfaceBgHex, 4.5),
    statusWarningText: optimizeContrast(
      '#92400E',
      resolveMinLightSurfaceBg('#FEF3C7', surfaceBgHex, 0.18),
      4.5
    ),
    statusSuccessText: optimizeContrast(
      '#166534',
      resolveMinLightSurfaceBg('#F0FDF4', surfaceBgHex, 0.18),
      4.5
    ),
    statusInfoText: optimizeContrast(
      '#1E40AF',
      resolveMinLightSurfaceBg('#EFF6FF', surfaceBgHex, 0.18),
      4.5
    ),
  };
}

function renderLightContainerDeclarations(
  solidPrimary: string,
  solidSecondary: string,
  tokens: LightSurfaceTokenSet
): string {
  return `      --color-primary: ${solidPrimary};
      --color-secondary: ${solidSecondary};
      --color-primary-text: ${tokens.primaryText};
      --color-secondary-text: ${tokens.secondaryText};
      --color-error-text: ${tokens.errorText};
      --color-focus-ring: ${tokens.focusRing};
      --color-surface-border: ${tokens.surfaceBorder};
      --color-muted-text: ${tokens.mutedText};
      --color-text-muted: ${tokens.mutedText};
      --color-warning-bg: ${tokens.warningBg};
      --color-warning-border: ${tokens.warningBorder};
      --color-warning-text: ${tokens.warningText};
      --color-status-warning-text: ${tokens.statusWarningText};
      --color-status-unsent-text: ${tokens.statusWarningText};
      --color-status-success-text: ${tokens.statusSuccessText};
      --color-status-sent-text: ${tokens.statusSuccessText};
      --color-status-info-text: ${tokens.statusInfoText};
      --color-status-not-needed-text: ${tokens.statusInfoText};
      --color-foreground: #111827;
      --foreground: #111827;`;
}

function buildLightShadeSelectors(shades: readonly string[]): string[] {
  const base: string[] = [];
  const variants: string[] = [];

  for (const family of NEUTRAL_SURFACE_FAMILIES) {
    for (const shade of shades) {
      base.push(`    .bg-${family}-${shade}`);
      variants.push(`    html:not(.dark) .hover\\:bg-${family}-${shade}:hover`);
      variants.push(`    [class^="bg-${family}-${shade}/"]`);
      variants.push(`    [class*=" bg-${family}-${shade}/"]`);
    }
  }

  return [...base, ...variants];
}

interface DarkSurfaceTokenSet {
  primaryText: string;
  secondaryText: string;
  errorText: string;
  focusRing: string;
  surfaceBorder: string;
  mutedText: string;
  warningBg: string;
  warningBorder: string;
  warningText: string;
  statusWarningText: string;
  statusSuccessText: string;
  statusInfoText: string;
}

function calibrateDarkSurfaceTokens(
  safePrimary: string,
  safeSecondary: string,
  surfaceBgHex: string
): DarkSurfaceTokenSet {
  return {
    primaryText: optimizeContrast(safePrimary, surfaceBgHex, 4.5),
    secondaryText: optimizeContrast(safeSecondary, surfaceBgHex, 4.5),
    errorText: optimizeContrast('#EF4444', surfaceBgHex, 4.5),
    focusRing: optimizeContrast(safePrimary, surfaceBgHex, 3.0),
    surfaceBorder: optimizeContrast('#9CA3AF', surfaceBgHex, 3.0),
    mutedText: optimizeContrast('#9CA3AF', surfaceBgHex, 4.5),
    warningBg: 'rgba(245, 158, 11, 0.15)',
    warningBorder: 'rgba(245, 158, 11, 0.35)',
    warningText: optimizeContrast('#FDE68A', surfaceBgHex, 4.5),
    statusWarningText: optimizeContrast('#FCD34D', surfaceBgHex, 4.5),
    statusSuccessText: optimizeContrast('#86EFAC', surfaceBgHex, 4.5),
    statusInfoText: optimizeContrast('#93C5FD', surfaceBgHex, 4.5),
  };
}

function renderDarkContainerDeclarations(
  solidPrimary: string,
  solidSecondary: string,
  tokens: DarkSurfaceTokenSet
): string {
  return `      --color-primary: ${solidPrimary};
      --color-secondary: ${solidSecondary};
      --color-primary-text: ${tokens.primaryText};
      --color-secondary-text: ${tokens.secondaryText};
      --color-error-text: ${tokens.errorText};
      --color-focus-ring: ${tokens.focusRing};
      --color-surface-border: ${tokens.surfaceBorder};
      --color-muted-text: ${tokens.mutedText};
      --color-text-muted: ${tokens.mutedText};
      --color-warning-bg: ${tokens.warningBg};
      --color-warning-border: ${tokens.warningBorder};
      --color-warning-text: ${tokens.warningText};
      --color-status-warning-text: ${tokens.statusWarningText};
      --color-status-unsent-text: ${tokens.statusWarningText};
      --color-status-success-text: ${tokens.statusSuccessText};
      --color-status-sent-text: ${tokens.statusSuccessText};
      --color-status-info-text: ${tokens.statusInfoText};
      --color-status-not-needed-text: ${tokens.statusInfoText};
      --color-foreground: #F9FAFB;
      --foreground: #F9FAFB;`;
}

function buildShadeSelectors(shades: readonly string[]): string[] {
  const darkPrefixed: string[] = [];
  const unprefixed: string[] = [];

  for (const family of NEUTRAL_SURFACE_FAMILIES) {
    for (const shade of shades) {
      darkPrefixed.push(`    .dark .dark\\:bg-${family}-${shade}`);
      darkPrefixed.push(`    .dark [class^="dark:bg-${family}-${shade}/"]`);
      darkPrefixed.push(`    .dark [class*=" dark:bg-${family}-${shade}/"]`);
      unprefixed.push(`    .bg-${family}-${shade}`);
      unprefixed.push(`    [class^="bg-${family}-${shade}/"]`);
      unprefixed.push(`    [class*=" bg-${family}-${shade}/"]`);
    }
  }

  return [...darkPrefixed, ...unprefixed];
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
  const solidPrimary = optimizeContrast(safePrimary, '#FFFFFF', 4.5);
  const solidSecondary = optimizeContrast(safeSecondary, '#FFFFFF', 4.5);
  const preset = sanitizePreset(themePreset, DEFAULT_THEME_PRESET);
  const baseLightTokens = getPresetTokens(preset, 'light');
  const baseDarkTokens = getPresetTokens(preset, 'dark');

  const sanitizedCustomTokens: Record<string, string> = {};
  if (customTokens && typeof customTokens === 'object') {
    for (const [k, v] of Object.entries(customTokens)) {
      if (k.startsWith('--')) {
        const sanitized = sanitizeTokenValue(v);
        if (sanitized) {
          sanitizedCustomTokens[k] = sanitized;
        }
      }
    }
  }

  if (nonColorTokens && typeof nonColorTokens === 'object') {
    for (const [k, v] of Object.entries(nonColorTokens)) {
      if (v && typeof v === 'string') {
        const tokenKey = k.startsWith('--') ? k : `--${k.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
        const sanitized = sanitizeTokenValue(v);
        if (sanitized) {
          sanitizedCustomTokens[tokenKey] = sanitized;
        }
      }
    }
  }

  const parseColorRgb = (raw: string): { r: number; g: number; b: number } | null => {
    const trimmed = raw.trim();
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(trimmed)) {
      return hexToRgb(trimmed);
    }
    const rgbMatch = trimmed.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i
    );
    if (rgbMatch) {
      const r = Math.min(255, Number(rgbMatch[1]));
      const g = Math.min(255, Number(rgbMatch[2]));
      const b = Math.min(255, Number(rgbMatch[3]));
      return { r, g, b };
    }
    return null;
  };

  const resolveTokenColorHex = (raw: string | undefined, fallbackHex: string): string => {
    if (!raw) return fallbackHex;
    const trimmed = raw.trim();
    const directRgb = parseColorRgb(trimmed);
    if (directRgb) {
      return rgbToHex(directRgb.r, directRgb.g, directRgb.b);
    }
    if (/^var\(\s*--color-primary\b/i.test(trimmed)) {
      return solidPrimary;
    }
    if (/^var\(\s*--color-secondary\b/i.test(trimmed)) {
      return solidSecondary;
    }
    const varFallbackMatch = trimmed.match(/^var\([^,]+,\s*([^)]+)\)$/i);
    if (varFallbackMatch) {
      return resolveTokenColorHex(varFallbackMatch[1], fallbackHex);
    }
    const mixMatch = trimmed.match(
      /^color-mix\(\s*in\s+srgb\s*,\s*(.+?)\s+(\d+(?:\.\d+)?)%\s*,\s*(.+?)(?:\s+(\d+(?:\.\d+)?)%)?\s*\)$/i
    );
    if (mixMatch) {
      const c1 = hexToRgb(resolveTokenColorHex(mixMatch[1], fallbackHex));
      const p1 = Math.max(0, Math.min(100, Number(mixMatch[2]))) / 100;
      const c2 = hexToRgb(resolveTokenColorHex(mixMatch[3], '#000000'));
      const p2 = mixMatch[4] !== undefined ? Math.max(0, Math.min(100, Number(mixMatch[4]))) / 100 : 1 - p1;
      const sum = p1 + p2 > 0 ? p1 + p2 : 1;
      const w1 = p1 / sum;
      const w2 = p2 / sum;
      return rgbToHex(c1.r * w1 + c2.r * w2, c1.g * w1 + c2.g * w2, c1.b * w1 + c2.b * w2);
    }
    return fallbackHex;
  };

  const darkSurfaceBgTokenKeys = new Set([
    '--container-bg',
    '--card-bg',
    '--dialog-bg',
    '--input-bg',
    '--schedule-card-bg',
    '--schedule-filter-bg',
    '--schedule-tag-bg',
    '--canvas-bg',
    '--floorplan-table-bg',
    '--floorplan-seat-dimmed-bg',
    '--floorplan-status-overcapacity-bg',
  ]);

  const darkSurfaceBorderTokenKeys = new Set([
    '--card-border',
    '--dialog-border-color',
    '--input-border',
    '--schedule-card-border',
    '--floorplan-table-border',
    '--floorplan-seat-dimmed-border',
  ]);

  const darkForegroundRgb = hexToRgb('#F9FAFB');

  const darkCustomTokenOverrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(sanitizedCustomTokens)) {
    const defaultLightRaw = (baseLightTokens as unknown as Record<string, unknown>)[k];
    const defaultLightSanitized =
      typeof defaultLightRaw === 'string' ? sanitizeTokenValue(defaultLightRaw) : undefined;
    if (defaultLightSanitized !== undefined && v === defaultLightSanitized) {
      continue;
    }

    if (darkSurfaceBgTokenKeys.has(k)) {
      const parsedBg = parseColorRgb(v);
      if (!parsedBg || getContrastRatio(darkForegroundRgb, parsedBg) < 4.5) {
        continue;
      }
    } else if (darkSurfaceBorderTokenKeys.has(k)) {
      const parsedBorder = parseColorRgb(v);
      if (parsedBorder && getLuminance(parsedBorder) > 0.7) {
        continue;
      }
    }

    darkCustomTokenOverrides[k] = v;
  }

  const lightPresetTokens: Record<string, string> = {
    ...(baseLightTokens as unknown as Record<string, string>),
    ...sanitizedCustomTokens,
  };

  const darkPresetTokens: Record<string, string> = {
    ...(baseDarkTokens as unknown as Record<string, string>),
    ...darkCustomTokenOverrides,
  };

  const calibrateSolidButtonPair = (
    targetTokens: Record<string, string>,
    customOverrides: Record<string, string>,
    bgKey: string,
    hoverBgKey: string,
    textKey: string,
    fallbackBgHex: string
  ) => {
    const rawLabelHex = resolveTokenColorHex(targetTokens[textKey], '#ffffff');
    const evaluatedBgHex = resolveTokenColorHex(targetTokens[bgKey], fallbackBgHex);
    const evaluatedHoverBgHex = resolveTokenColorHex(targetTokens[hoverBgKey], evaluatedBgHex);

    const hasCustomBg = bgKey in customOverrides;
    const hasCustomHoverBg = hoverBgKey in customOverrides;
    const hasCustomText = textKey in customOverrides;

    let finalBgHex = evaluatedBgHex;
    let finalHoverBgHex = evaluatedHoverBgHex;

    if (
      hasCustomBg ||
      (!hasCustomText &&
        getContrastRatio(hexToRgb(rawLabelHex), hexToRgb(evaluatedBgHex)) < 4.5)
    ) {
      finalBgHex = optimizeContrast(evaluatedBgHex, rawLabelHex, 4.5);
      targetTokens[bgKey] = finalBgHex;
    }

    if (
      hasCustomHoverBg ||
      (!hasCustomText &&
        getContrastRatio(hexToRgb(rawLabelHex), hexToRgb(evaluatedHoverBgHex)) < 4.5)
    ) {
      finalHoverBgHex = optimizeContrast(evaluatedHoverBgHex, rawLabelHex, 4.5);
      targetTokens[hoverBgKey] = finalHoverBgHex;
    }

    if (
      getContrastRatio(hexToRgb(rawLabelHex), hexToRgb(finalBgHex)) < 4.5 ||
      getContrastRatio(hexToRgb(rawLabelHex), hexToRgb(finalHoverBgHex)) < 4.5
    ) {
      let calibratedLabelHex = optimizeContrast(
        optimizeContrast(rawLabelHex, finalBgHex, 4.5),
        finalHoverBgHex,
        4.5
      );
      if (getContrastRatio(hexToRgb(calibratedLabelHex), hexToRgb(finalBgHex)) < 4.5) {
        finalBgHex = optimizeContrast(finalBgHex, rawLabelHex, 4.5);
        finalHoverBgHex = optimizeContrast(finalHoverBgHex, rawLabelHex, 4.5);
        targetTokens[bgKey] = finalBgHex;
        targetTokens[hoverBgKey] = finalHoverBgHex;
        calibratedLabelHex = optimizeContrast(
          optimizeContrast(rawLabelHex, finalBgHex, 4.5),
          finalHoverBgHex,
          4.5
        );
      }
      targetTokens[textKey] = calibratedLabelHex;
    }
  };

  const calibrateInverseAndToastTokens = (
    targetTokens: Record<string, string>,
    customOverrides: Record<string, string>,
    hasCustomBadgeText: boolean
  ) => {
    const resolveHex = (raw: string | undefined, fallback: string): string => {
      if (!raw) return fallback;
      const parsed = parseColorRgb(raw);
      return parsed ? rgbToHex(parsed.r, parsed.g, parsed.b) : fallback;
    };

    const actionBgHex = resolveHex(targetTokens['--toast-action-bg'], '#ffffff');
    const actionHoverBgHex = resolveHex(targetTokens['--toast-action-hover-bg'], '#e5e7eb');
    const rawActionTextHex = resolveHex(targetTokens['--toast-action-text'], '#111827');

    let calibratedActionText = optimizeContrast(rawActionTextHex, actionBgHex, 4.5);
    calibratedActionText = optimizeContrast(calibratedActionText, actionHoverBgHex, 4.5);
    let finalHoverBgHex = actionHoverBgHex;
    if (getContrastRatio(hexToRgb(calibratedActionText), hexToRgb(actionBgHex)) < 4.5) {
      const bgLum = getLuminance(hexToRgb(actionBgHex));
      finalHoverBgHex = bgLum > 0.179 ? '#e5e7eb' : '#1f2937';
      calibratedActionText = optimizeContrast(
        optimizeContrast(rawActionTextHex, actionBgHex, 4.5),
        finalHoverBgHex,
        4.5
      );
    }

    targetTokens['--toast-action-bg'] = actionBgHex;
    targetTokens['--toast-action-hover-bg'] = finalHoverBgHex;
    targetTokens['--toast-action-text'] = calibratedActionText;

    const badgeInverseBgHex = resolveHex(targetTokens['--badge-inverse-bg'], '#ffffff');
    const useCustomPrimaryForBadge =
      !hasCustomBadgeText && safePrimary.toLowerCase() !== '#b91c1c' && preset === 'classic';
    const rawBadgeTextHex = useCustomPrimaryForBadge
      ? safePrimary
      : resolveHex(targetTokens['--badge-inverse-text'], safePrimary);

    targetTokens['--badge-inverse-bg'] = badgeInverseBgHex;
    targetTokens['--badge-inverse-text'] = optimizeContrast(rawBadgeTextHex, badgeInverseBgHex, 4.5);

    const isDarkTarget = targetTokens === darkPresetTokens;
    const dimmedBgFallback = isDarkTarget ? '#374151' : '#e5e7eb';
    const dimmedTextFallback = isDarkTarget ? '#f3f4f6' : '#374151';
    const dimmedBorderFallback = isDarkTarget ? '#6b7280' : '#9ca3af';

    const dimmedBgHex = resolveHex(targetTokens['--floorplan-seat-dimmed-bg'], dimmedBgFallback);
    const rawDimmedTextHex = resolveHex(targetTokens['--floorplan-seat-dimmed-text'], dimmedTextFallback);
    const dimmedBorderHex = resolveHex(targetTokens['--floorplan-seat-dimmed-border'], dimmedBorderFallback);

    targetTokens['--floorplan-seat-dimmed-bg'] = dimmedBgHex;
    targetTokens['--floorplan-seat-dimmed-text'] = optimizeContrast(rawDimmedTextHex, dimmedBgHex, 4.5);
    targetTokens['--floorplan-seat-dimmed-border'] = dimmedBorderHex;

    const rawSuccessBgHex = resolveHex(targetTokens['--btn-success-bg'], '#15803d');
    const rawSuccessHoverBgHex = resolveHex(targetTokens['--btn-success-hover-bg'], '#166534');
    const rawSuccessTextHex = resolveHex(targetTokens['--btn-success-text'], '#ffffff');
    const isLightSuccessLabel = getLuminance(hexToRgb(rawSuccessTextHex)) > 0.5;

    let calibratedSuccessBgHex = rawSuccessBgHex;
    let calibratedSuccessHoverBgHex = rawSuccessHoverBgHex;
    let calibratedSuccessTextHex = rawSuccessTextHex;

    if (isLightSuccessLabel) {
      calibratedSuccessBgHex = optimizeContrast(rawSuccessBgHex, rawSuccessTextHex, 4.5);
      calibratedSuccessHoverBgHex = optimizeContrast(rawSuccessHoverBgHex, rawSuccessTextHex, 4.5);
      calibratedSuccessTextHex = optimizeContrast(
        optimizeContrast(rawSuccessTextHex, calibratedSuccessBgHex, 4.5),
        calibratedSuccessHoverBgHex,
        4.5
      );
    } else {
      calibratedSuccessTextHex = optimizeContrast(
        optimizeContrast(rawSuccessTextHex, calibratedSuccessBgHex, 4.5),
        calibratedSuccessHoverBgHex,
        4.5
      );
    }

    targetTokens['--btn-success-bg'] = calibratedSuccessBgHex;
    targetTokens['--btn-success-hover-bg'] = calibratedSuccessHoverBgHex;
    targetTokens['--btn-success-text'] = calibratedSuccessTextHex;
    targetTokens['--btn-success-border'] = targetTokens['--btn-success-border'] || 'transparent';

    calibrateSolidButtonPair(
      targetTokens,
      customOverrides,
      '--btn-primary-bg',
      '--btn-primary-hover-bg',
      '--btn-primary-text',
      solidPrimary
    );
    calibrateSolidButtonPair(
      targetTokens,
      customOverrides,
      '--btn-secondary-bg',
      '--btn-secondary-hover-bg',
      '--btn-secondary-text',
      solidSecondary
    );
  };

  calibrateInverseAndToastTokens(
    lightPresetTokens,
    sanitizedCustomTokens,
    '--badge-inverse-text' in sanitizedCustomTokens
  );
  calibrateInverseAndToastTokens(
    darkPresetTokens,
    darkCustomTokenOverrides,
    '--badge-inverse-text' in darkCustomTokenOverrides
  );

  const compositeOverlayOnLight = (baseBgHex: string, rawOverlay?: string): string => {
    if (!rawOverlay) return baseBgHex;
    let candidate = rawOverlay.trim();
    const varFallback = candidate.match(/^var\([^,]+,\s*([^)]+)\)$/i);
    if (varFallback) {
      candidate = varFallback[1].trim();
    }
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(candidate)) {
      const rgb = hexToRgb(candidate);
      const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      return resolveLightSurfaceBg(baseBgHex, hex);
    }
    const rgbaMatch = candidate.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i
    );
    if (rgbaMatch) {
      const baseRgb = hexToRgb(baseBgHex);
      const r = Math.min(255, Number(rgbaMatch[1]));
      const g = Math.min(255, Number(rgbaMatch[2]));
      const b = Math.min(255, Number(rgbaMatch[3]));
      const a = rgbaMatch[4] !== undefined ? Math.max(0, Math.min(1, Number(rgbaMatch[4]))) : 1;
      const blendedHex = rgbToHex(
        r * a + baseRgb.r * (1 - a),
        g * a + baseRgb.g * (1 - a),
        b * a + baseRgb.b * (1 - a)
      );
      return resolveLightSurfaceBg(baseBgHex, blendedHex);
    }
    return baseBgHex;
  };

  const blendAlphaOnLight = (fgHex: string, alpha: number, baseBgHex: string): string => {
    const fg = hexToRgb(fgHex);
    const bg = hexToRgb(baseBgHex);
    return rgbToHex(
      fg.r * alpha + bg.r * (1 - alpha),
      fg.g * alpha + bg.g * (1 - alpha),
      fg.b * alpha + bg.b * (1 - alpha)
    );
  };

  const lightContainerBg = compositeOverlayOnLight('#ffffff', lightPresetTokens['--container-bg']);
  const lightCardBg = resolveLightSurfaceBg(
    '#ffffff',
    compositeOverlayOnLight(lightContainerBg, lightPresetTokens['--card-bg'])
  );
  const lightDialogBg = resolveLightSurfaceBg(
    '#ffffff',
    compositeOverlayOnLight('#ffffff', lightPresetTokens['--dialog-bg'])
  );
  const lightInputBg = resolveLightSurfaceBg(
    lightCardBg,
    compositeOverlayOnLight(lightCardBg, lightPresetTokens['--input-bg'])
  );
  const lightScheduleCardBg = compositeOverlayOnLight(
    lightContainerBg,
    lightPresetTokens['--schedule-card-bg']
  );
  const lightScheduleFilterBg = compositeOverlayOnLight(
    '#f3f4f6',
    lightPresetTokens['--schedule-filter-bg']
  );
  const lightScheduleFilterHoverBg = compositeOverlayOnLight(
    lightScheduleFilterBg,
    lightPresetTokens['--schedule-filter-hover-bg']
  );
  const lightScheduleTagBg = compositeOverlayOnLight(
    '#f3f4f6',
    lightPresetTokens['--schedule-tag-bg']
  );
  const lightCanvasBg = compositeOverlayOnLight('#ffffff', lightPresetTokens['--canvas-bg']);
  const lightFloorplanTableBg = compositeOverlayOnLight(
    '#ffffff',
    lightPresetTokens['--floorplan-table-bg']
  );

  // Lower-bound light surface across active preset tints, ghost/outline hovers, bg-primary/10, bg-red-50, and .bg-*-100
  const baseLightCandidates = [
    '#FFFFFF',
    '#FEF2F2', // bg-red-50
    '#FFF1F2', // bg-rose-50
    '#F3F4F6', // darkest .bg-*-100 across gray/slate/zinc/stone/neutral
    lightContainerBg,
    lightCardBg,
    lightDialogBg,
    lightInputBg,
    lightScheduleCardBg,
    lightScheduleFilterBg,
    lightScheduleTagBg,
    lightCanvasBg,
    lightFloorplanTableBg,
    compositeOverlayOnLight(lightCardBg, lightPresetTokens['--btn-ghost-hover-bg']),
    compositeOverlayOnLight(lightContainerBg, lightPresetTokens['--btn-ghost-hover-bg']),
    compositeOverlayOnLight(lightCardBg, lightPresetTokens['--btn-outline-hover-bg']),
    compositeOverlayOnLight(lightContainerBg, lightPresetTokens['--btn-outline-hover-bg']),
    blendAlphaOnLight(solidPrimary, 0.1, lightCardBg),
    blendAlphaOnLight(solidPrimary, 0.1, lightContainerBg),
    blendAlphaOnLight(solidPrimary, 0.1, '#F3F4F6'),
    blendAlphaOnLight(safePrimary, 0.1, lightCardBg),
    blendAlphaOnLight(safePrimary, 0.1, lightContainerBg),
    blendAlphaOnLight(safePrimary, 0.1, '#F3F4F6'),
  ];

  let baseLightSurfaceBg = '#FFFFFF';
  for (const candidateBg of baseLightCandidates) {
    baseLightSurfaceBg = resolveMinLightSurfaceBg(baseLightSurfaceBg, candidateBg, 0.5);
  }

  const lightFormSurfaceBg = resolveMinLightSurfaceBg(
    resolveMinLightSurfaceBg(lightCardBg, lightInputBg, 0.5),
    lightContainerBg,
    0.5
  );
  const lightTextSurfaceMap: Record<string, string> = {
    '--heading-color': baseLightSurfaceBg,
    '--btn-outline-text': baseLightSurfaceBg,
    '--btn-ghost-text': baseLightSurfaceBg,
    '--dialog-title-color': resolveMinLightSurfaceBg(lightDialogBg, baseLightSurfaceBg, 0.5),
    '--form-label-text': lightFormSurfaceBg,
    '--form-message-text': lightFormSurfaceBg,
    '--form-error-text': lightFormSurfaceBg,
    '--form-success-text': lightFormSurfaceBg,
    '--form-warning-text': lightFormSurfaceBg,
    '--dialog-desc-color': lightDialogBg,
    '--schedule-filter-text': resolveMinLightSurfaceBg(
      lightScheduleFilterBg,
      lightScheduleFilterHoverBg,
      0.5
    ),
    '--schedule-tag-text': lightScheduleTagBg,
  };

  for (const [textKey, surfaceBg] of Object.entries(lightTextSurfaceMap)) {
    const rawVal = lightPresetTokens[textKey];
    if (!rawVal) continue;
    if (/var\(\s*--color-primary(?![a-z0-9-])/i.test(rawVal)) {
      lightPresetTokens[textKey] = rawVal.replace(
        /var\(\s*--color-primary(?![a-z0-9-])/gi,
        'var(--color-primary-text'
      );
      continue;
    }
    if (/var\(\s*--color-secondary(?![a-z0-9-])/i.test(rawVal)) {
      lightPresetTokens[textKey] = rawVal.replace(
        /var\(\s*--color-secondary(?![a-z0-9-])/gi,
        'var(--color-secondary-text'
      );
      continue;
    }
    const parsedText = parseColorRgb(rawVal);
    if (parsedText) {
      const rawHex = rgbToHex(parsedText.r, parsedText.g, parsedText.b);
      lightPresetTokens[textKey] = optimizeContrast(rawHex, surfaceBg, 4.5);
    }
  }

  const darkCardAndInputBg = resolveDarkSurfaceBg(
    resolveDarkSurfaceBg('#18181b', darkPresetTokens['--card-bg']),
    darkPresetTokens['--input-bg']
  );
  const darkTextSurfaceMap: Record<string, string> = {
    '--heading-color': resolveDarkSurfaceBg('#18181b', darkPresetTokens['--card-bg']),
    '--btn-outline-text': resolveDarkSurfaceBg('#18181b', darkPresetTokens['--card-bg']),
    '--btn-ghost-text': resolveDarkSurfaceBg('#18181b', darkPresetTokens['--card-bg']),
    '--form-label-text': darkCardAndInputBg,
    '--form-message-text': resolveDarkSurfaceBg('#18181b', darkPresetTokens['--card-bg']),
    '--form-error-text': resolveDarkSurfaceBg('#18181b', darkPresetTokens['--card-bg']),
    '--form-success-text': resolveDarkSurfaceBg('#18181b', darkPresetTokens['--card-bg']),
    '--form-warning-text': resolveDarkSurfaceBg('#18181b', darkPresetTokens['--card-bg']),
    '--dialog-title-color': resolveDarkSurfaceBg('#18181b', darkPresetTokens['--dialog-bg']),
    '--dialog-desc-color': resolveDarkSurfaceBg('#18181b', darkPresetTokens['--dialog-bg']),
    '--schedule-filter-text': resolveDarkSurfaceBg('#27272a', darkPresetTokens['--schedule-filter-bg']),
    '--schedule-tag-text': resolveDarkSurfaceBg('#27272a', darkPresetTokens['--schedule-tag-bg']),
  };

  for (const [textKey, surfaceBg] of Object.entries(darkTextSurfaceMap)) {
    if (textKey in darkCustomTokenOverrides) {
      const customVal = darkCustomTokenOverrides[textKey];
      const parsedText = parseColorRgb(customVal);
      if (parsedText) {
        const customHex = rgbToHex(parsedText.r, parsedText.g, parsedText.b);
        darkPresetTokens[textKey] = optimizeContrast(customHex, surfaceBg, 4.5);
      } else if (!customVal.startsWith('var(--color-')) {
        const baseFallback = (baseDarkTokens as unknown as Record<string, unknown>)[textKey];
        if (typeof baseFallback === 'string') {
          darkPresetTokens[textKey] = baseFallback;
        }
      }
    } else {
      const rawVal = darkPresetTokens[textKey];
      if (!rawVal) continue;
      const parsedText = parseColorRgb(rawVal);
      if (parsedText) {
        const rawHex = rgbToHex(parsedText.r, parsedText.g, parsedText.b);
        darkPresetTokens[textKey] = optimizeContrast(rawHex, surfaceBg, 4.5);
      }
    }
  }

  const safeContainerMaxWidth = sanitizeLayoutToken(layoutTokens?.containerMaxWidth, '64rem');
  const safeGridGap = sanitizeLayoutToken(layoutTokens?.gridGap, '1.5rem');
  const safeCardPadding = sanitizeLayoutToken(layoutTokens?.cardPadding, '2rem');
  const safeBorderRadius = sanitizeLayoutToken(layoutTokens?.borderRadius, '1rem');

  const safeFontHeading = sanitizeFontToken(fontTokens?.fontHeading, lightPresetTokens['--font-heading']);
  const safeFontBody = sanitizeFontToken(fontTokens?.fontBody, lightPresetTokens['--font-body']);
  const safeFontMono = sanitizeFontToken(fontTokens?.fontMono, lightPresetTokens['--font-mono']);

  const baseLightTokensCalibrated = calibrateLightSurfaceTokensForBg(
    safePrimary,
    safeSecondary,
    baseLightSurfaceBg
  );

  // Neutral light container shade tiers: 200 (#E4E4E7), 300 (#CBD5E1 bounded by Tailwind v4 stone-300 #D6D3D1),
  // and 400 (#94A3B8 bounded by Tailwind v4 slate-400 #90A1B9)
  const light200SurfaceBg = resolveMinLightSurfaceBg('#E4E4E7', baseLightSurfaceBg, 0.18);
  const light300SurfaceBg = resolveMinLightSurfaceBg(
    resolveMinLightSurfaceBg('#CBD5E1', '#D6D3D1', 0.18),
    light200SurfaceBg,
    0.18
  );
  const light400SurfaceBg = resolveMinLightSurfaceBg(
    resolveMinLightSurfaceBg('#94A3B8', '#90A1B9', 0.18),
    light300SurfaceBg,
    0.18
  );

  const light200TokensCalibrated = calibrateLightSurfaceTokensForBg(
    safePrimary,
    safeSecondary,
    light200SurfaceBg
  );
  const light300TokensCalibrated = calibrateLightSurfaceTokensForBg(
    safePrimary,
    safeSecondary,
    light300SurfaceBg
  );
  const light400TokensCalibrated = calibrateLightSurfaceTokensForBg(
    safePrimary,
    safeSecondary,
    light400SurfaceBg
  );

  const darkCardSurfaceBg = resolveDarkSurfaceBg(
    resolveDarkSurfaceBg('#1D293D', darkPresetTokens['--card-bg']),
    darkPresetTokens['--schedule-card-bg']
  );

  const compositeOverlayOnDark = (baseBgHex: string, rawOverlay?: string): string => {
    if (!rawOverlay) return baseBgHex;
    const trimmed = rawOverlay.trim();
    if (/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(trimmed)) {
      return resolveDarkSurfaceBg(baseBgHex, trimmed);
    }
    const rgbaMatch = trimmed.match(
      /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i
    );
    if (rgbaMatch) {
      const baseRgb = hexToRgb(baseBgHex);
      const r = Math.min(255, Number(rgbaMatch[1]));
      const g = Math.min(255, Number(rgbaMatch[2]));
      const b = Math.min(255, Number(rgbaMatch[3]));
      const a = Math.max(0, Math.min(1, Number(rgbaMatch[4])));
      const blendedHex = rgbToHex(
        r * a + baseRgb.r * (1 - a),
        g * a + baseRgb.g * (1 - a),
        b * a + baseRgb.b * (1 - a)
      );
      return resolveDarkSurfaceBg(baseBgHex, blendedHex);
    }
    return baseBgHex;
  };

  const darkGhostHoverBg = resolveDarkSurfaceBg(
    compositeOverlayOnDark(darkCardSurfaceBg, darkPresetTokens['--btn-ghost-hover-bg']),
    compositeOverlayOnDark(darkCardSurfaceBg, darkPresetTokens['--btn-outline-hover-bg'])
  );

  // #44403B (Tailwind v4 stone-700) bounds #374151, #364153, and ghost/outline dark hover overlays so all 700 surfaces >= 4.5:1
  const dark700SurfaceBg = resolveDarkSurfaceBg(
    resolveDarkSurfaceBg('#44403B', darkCardSurfaceBg),
    darkGhostHoverBg
  );
  const dark600SurfaceBg = resolveDarkSurfaceBg('#4B5563', dark700SurfaceBg);

  const baseDarkTokensCalibrated = calibrateDarkSurfaceTokens(safePrimary, safeSecondary, darkCardSurfaceBg);
  const dark700TokensCalibrated = calibrateDarkSurfaceTokens(safePrimary, safeSecondary, dark700SurfaceBg);
  const dark600TokensCalibrated = calibrateDarkSurfaceTokens(safePrimary, safeSecondary, dark600SurfaceBg);

  // Translucent bg-white/* light containers composited over dark backdrops (#B3B3B3 for 70/75%, #CCCCCC for 80–95%)
  const translucent80LightTokens = calibrateLightSurfaceTokensForBg(
    safePrimary,
    safeSecondary,
    resolveMinLightSurfaceBg('#CCCCCC', baseLightSurfaceBg, 0.18)
  );
  const translucent70LightTokens = calibrateLightSurfaceTokensForBg(
    safePrimary,
    safeSecondary,
    resolveMinLightSurfaceBg('#B3B3B3', baseLightSurfaceBg, 0.18)
  );

  const seatAssignedTextLight = optimizeContrast('#ffffff', solidPrimary, 4.5);
  const seatAssignedTextDark = optimizeContrast('#ffffff', solidPrimary, 4.5);

  const lightPresetCssRules = Object.entries(lightPresetTokens)
    .filter(([key, value]) => key.startsWith('--') && typeof value === 'string')
    .map(([key, value]) => `      ${key}: ${value};`)
    .join('\n');

  const darkPresetCssRules = Object.entries(darkPresetTokens)
    .filter(([key, value]) => key.startsWith('--') && typeof value === 'string')
    .map(([key, value]) => `      ${key}: ${value};`)
    .join('\n');

  const baseLightContainerSelectors = [
    '    .bg-white',
    '    [data-surface="light"]',
    ...buildLightShadeSelectors(['50', '100']),
  ].join(',\n');
  const light200ContainerSelectors = buildLightShadeSelectors(['200']).join(',\n');
  const light300ContainerSelectors = buildLightShadeSelectors(['300']).join(',\n');
  const light400ContainerSelectors = buildLightShadeSelectors(['400']).join(',\n');

  const baseDarkContainerSelectors = [
    '    .dark .dark\\:bg-black',
    '    .dark [class^="dark:bg-black/"]',
    '    .dark [class*=" dark:bg-black/"]',
    '    .dark [data-surface="dark"]',
    ...buildShadeSelectors(BASE_DARK_SHADES).filter((sel) => sel.startsWith('    .dark ')),
    '    .bg-black',
    '    [data-surface="dark"]',
    ...buildShadeSelectors(BASE_DARK_SHADES).filter((sel) => !sel.startsWith('    .dark ')),
  ].join(',\n');

  const dark700ContainerSelectors = [
    ...buildShadeSelectors(['700']),
    '    .dark .bg-primary\\/5',
    '    .dark .bg-primary\\/10',
    '    .dark .bg-primary\\/20',
    '    .dark .dark\\:bg-primary\\/10',
    '    .dark .dark\\:bg-primary\\/20',
    '    .dark [class^="dark:bg-red-900/"]',
    '    .dark [class*=" dark:bg-red-900/"]',
    '    .dark [class^="dark:bg-red-950/"]',
    '    .dark [class*=" dark:bg-red-950/"]',
    '    .dark [class^="bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class*=" bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class^="hover:bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class*=" hover:bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class^="hover:bg-[var(--btn-ghost-hover-bg"]:hover',
    '    .dark [class*=" hover:bg-[var(--btn-ghost-hover-bg"]:hover',
    '    .dark [class^="focus-visible:bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class*=" focus-visible:bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class^="focus-visible:bg-[var(--btn-ghost-hover-bg"]:focus-visible',
    '    .dark [class*=" focus-visible:bg-[var(--btn-ghost-hover-bg"]:focus-visible',
    '    .dark [class^="dark:bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class*=" dark:bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class^="dark:hover:bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class*=" dark:hover:bg-[var(--btn-ghost-hover-bg"]',
    '    .dark [class^="dark:hover:bg-[var(--btn-ghost-hover-bg"]:hover',
    '    .dark [class*=" dark:hover:bg-[var(--btn-ghost-hover-bg"]:hover',
    '    .dark [class^="bg-[var(--btn-outline-hover-bg"]',
    '    .dark [class*=" bg-[var(--btn-outline-hover-bg"]',
    '    .dark [class^="hover:bg-[var(--btn-outline-hover-bg"]',
    '    .dark [class*=" hover:bg-[var(--btn-outline-hover-bg"]',
    '    .dark [class^="hover:bg-[var(--btn-outline-hover-bg"]:hover',
    '    .dark [class*=" hover:bg-[var(--btn-outline-hover-bg"]:hover',
    '    .dark [class^="dark:bg-[var(--btn-outline-hover-bg"]',
    '    .dark [class*=" dark:bg-[var(--btn-outline-hover-bg"]',
    '    .dark [class^="dark:hover:bg-[var(--btn-outline-hover-bg"]',
    '    .dark [class*=" dark:hover:bg-[var(--btn-outline-hover-bg"]',
    '    .dark [class^="dark:hover:bg-[var(--btn-outline-hover-bg"]:hover',
    '    .dark [class*=" dark:hover:bg-[var(--btn-outline-hover-bg"]:hover',
  ].join(',\n');

  const dark600ContainerSelectors = buildShadeSelectors(['600']).join(',\n');

  return `
    :root {
${renderDarkContainerDeclarations(solidPrimary, solidSecondary, baseDarkTokensCalibrated)}
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
      --color-primary: ${solidPrimary};
      --color-secondary: ${solidSecondary};
      --color-primary-text: ${baseLightTokensCalibrated.primaryText};
      --color-secondary-text: ${baseLightTokensCalibrated.secondaryText};
      --color-error-text: ${baseLightTokensCalibrated.errorText};
      --color-focus-ring: ${baseLightTokensCalibrated.focusRing};
      --color-surface-border: ${baseLightTokensCalibrated.surfaceBorder};
      --color-muted-text: ${baseLightTokensCalibrated.mutedText};
      --color-text-muted: ${baseLightTokensCalibrated.mutedText};
      --color-warning-bg: ${baseLightTokensCalibrated.warningBg};
      --color-warning-border: ${baseLightTokensCalibrated.warningBorder};
      --color-warning-text: ${baseLightTokensCalibrated.warningText};
      --color-status-warning-text: ${baseLightTokensCalibrated.statusWarningText};
      --color-status-unsent-text: ${baseLightTokensCalibrated.statusWarningText};
      --color-status-success-text: ${baseLightTokensCalibrated.statusSuccessText};
      --color-status-sent-text: ${baseLightTokensCalibrated.statusSuccessText};
      --color-status-info-text: ${baseLightTokensCalibrated.statusInfoText};
      --color-status-not-needed-text: ${baseLightTokensCalibrated.statusInfoText};
      --color-foreground: #111827;
      --foreground: #111827;
      --floorplan-seat-assigned-text: ${seatAssignedTextLight};
      --floorplan-seat-dimmed-bg: ${lightPresetTokens['--floorplan-seat-dimmed-bg']};
      --floorplan-seat-dimmed-text: ${lightPresetTokens['--floorplan-seat-dimmed-text']};
      --floorplan-seat-dimmed-border: ${lightPresetTokens['--floorplan-seat-dimmed-border']};
    }

    .dark {
${renderDarkContainerDeclarations(solidPrimary, solidSecondary, baseDarkTokensCalibrated)}
${darkPresetCssRules}
      --container-max-w: ${safeContainerMaxWidth};
      --grid-gap: ${safeGridGap};
      --card-padding: ${safeCardPadding};
      --radius-card: ${safeBorderRadius};
    }

    /* Light containers in any document mode (white / 50 / 100 tier) */
${baseLightContainerSelectors} {
${renderLightContainerDeclarations(solidPrimary, solidSecondary, baseLightTokensCalibrated)}
    }

    /* Elevated light surfaces (200 tier: #E4E4E7) */
${light200ContainerSelectors} {
${renderLightContainerDeclarations(solidPrimary, solidSecondary, light200TokensCalibrated)}
    }

    /* Elevated light surfaces (300 tier: #CBD5E1 / #D6D3D1) */
${light300ContainerSelectors} {
${renderLightContainerDeclarations(solidPrimary, solidSecondary, light300TokensCalibrated)}
    }

    /* Elevated light surfaces (400 tier: #94A3B8 / #90A1B9) */
${light400ContainerSelectors} {
${renderLightContainerDeclarations(solidPrimary, solidSecondary, light400TokensCalibrated)}
    }

    /* Translucent high-opacity light containers (bg-white/80..95) */
    .bg-white\\/80,
    .bg-white\\/85,
    .bg-white\\/90,
    .bg-white\\/95,
    .hover\\:bg-white:hover {
${renderLightContainerDeclarations(solidPrimary, solidSecondary, translucent80LightTokens)}
    }

    /* Translucent medium-high light containers (bg-white/70..75) */
    .bg-white\\/70,
    .bg-white\\/75 {
${renderLightContainerDeclarations(solidPrimary, solidSecondary, translucent70LightTokens)}
    }

    /* Re-assert dark mode variables for base dark backgrounds (black / 800–950) */
${baseDarkContainerSelectors} {
${renderDarkContainerDeclarations(solidPrimary, solidSecondary, baseDarkTokensCalibrated)}
    }

    /* Elevated dark surfaces (700 tier: #374151 and low-alpha accent badges) */
${dark700ContainerSelectors} {
${renderDarkContainerDeclarations(solidPrimary, solidSecondary, dark700TokensCalibrated)}
    }

    /* Elevated dark surfaces (600 tier: #4B5563) */
${dark600ContainerSelectors} {
${renderDarkContainerDeclarations(solidPrimary, solidSecondary, dark600TokensCalibrated)}
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
