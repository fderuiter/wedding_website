'use client';

import React, { useMemo } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useTheme } from '@/components/ThemeProvider';
import { optimizeContrast, hexToRgb, getContrastRatio } from '@/lib/theme/stylesheet';
import { getPresetTokens } from '@/lib/theme/presets';

export interface ThemedQRCodeProps
  extends Omit<React.ComponentPropsWithoutRef<typeof QRCodeCanvas>, 'fgColor' | 'bgColor'> {
  fgColor?: string;
  bgColor?: string;
  bgToken?: '--card-bg' | '--container-bg' | string;
  minContrastRatio?: number;
}

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i;

function extractHexColor(val: string | undefined | null): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (HEX_COLOR_REGEX.test(trimmed)) {
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return trimmed;
  }
  const match = trimmed.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
  if (match) {
    let hex = match[0];
    if (hex.length === 4) {
      hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    return hex;
  }
  return null;
}

/**
 * @component ThemedQRCode
 * @description A theme-aware QR code component that automatically computes module
 * and background colors using central theme tokens and enforces WCAG AA contrast standards.
 */
export const ThemedQRCode = React.forwardRef<HTMLCanvasElement, ThemedQRCodeProps>(({
  fgColor: explicitFgColor,
  bgColor: explicitBgColor,
  bgToken = '--card-bg',
  minContrastRatio = 4.5,
  ...props
}, ref) => {
  const { themePrimary, themePreset, resolvedTheme } = useTheme();

  const { fgColor, bgColor } = useMemo(() => {
    let resolvedFg = extractHexColor(explicitFgColor);
    let resolvedBg = extractHexColor(explicitBgColor);

    if (!resolvedBg) {
      const presetTokens = getPresetTokens(themePreset, resolvedTheme);
      const rawTokenVal =
        (presetTokens as unknown as Record<string, string>)[bgToken] ||
        presetTokens['--card-bg'] ||
        presetTokens['--container-bg'];
      resolvedBg = extractHexColor(rawTokenVal);
    }

    if (!resolvedBg && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
      try {
        const rootStyles = window.getComputedStyle(document.documentElement);
        const computedBgVal = rootStyles.getPropertyValue(bgToken) || rootStyles.getPropertyValue('--card-bg');
        resolvedBg = extractHexColor(computedBgVal);
      } catch {}
    }

    if (!resolvedBg) {
      resolvedBg = resolvedTheme === 'dark' ? '#1f2937' : '#ffffff';
    }

    if (!resolvedFg) {
      resolvedFg = extractHexColor(themePrimary);
      if (!resolvedFg && typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        try {
          const rootStyles = window.getComputedStyle(document.documentElement);
          const computedPrimary = rootStyles.getPropertyValue('--color-primary');
          resolvedFg = extractHexColor(computedPrimary);
        } catch {}
      }
    }

    if (!resolvedFg) {
      resolvedFg = '#000000';
    }

    // Compute dynamic WCAG-compliant contrast color
    const computedFg = optimizeContrast(resolvedFg, resolvedBg, minContrastRatio);

    // Verify final contrast ratio
    let ratio = 1;
    try {
      ratio = getContrastRatio(hexToRgb(computedFg), hexToRgb(resolvedBg));
    } catch {
      ratio = 1;
    }

    if (ratio < minContrastRatio) {
      // Fallback to static high-contrast defaults if theme computation fails or contrast is low (Guardrail 2)
      return {
        fgColor: '#000000',
        bgColor: '#ffffff',
      };
    }

    return {
      fgColor: computedFg,
      bgColor: resolvedBg,
    };
  }, [explicitFgColor, explicitBgColor, bgToken, minContrastRatio, themePrimary, themePreset, resolvedTheme]);

  return (
    <QRCodeCanvas
      ref={ref}
      fgColor={fgColor}
      bgColor={bgColor}
      {...props}
    />
  );
});

ThemedQRCode.displayName = 'ThemedQRCode';
