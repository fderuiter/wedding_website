'use client';

import React, { useMemo } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { useTheme, optimizeContrast } from '@/components/ThemeProvider';
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

function hexToRgb(hex: string) {
  const cleanHex = hex.replace(/^#/, '');
  let r = 0,
    g = 0,
    b = 0;
  if (cleanHex.length === 6) {
    r = parseInt(cleanHex.substring(0, 2), 16);
    g = parseInt(cleanHex.substring(2, 4), 16);
    b = parseInt(cleanHex.substring(4, 6), 16);
  } else if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  }
  return { r, g, b };
}

function getLuminance(rgb: { r: number; g: number; b: number }): number {
  const parts = [rgb.r, rgb.g, rgb.b].map((val) => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

function getContrastRatio(hex1: string, hex2: string): number {
  try {
    const l1 = getLuminance(hexToRgb(hex1));
    const l2 = getLuminance(hexToRgb(hex2));
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  } catch {
    return 1;
  }
}

/**
 * @component ThemedQRCode
 * @description A theme-aware QR code component that automatically computes module
 * and background colors using central theme tokens and enforces WCAG AA contrast standards.
 */
export const ThemedQRCode: React.FC<ThemedQRCodeProps> = ({
  fgColor: explicitFgColor,
  bgColor: explicitBgColor,
  bgToken = '--card-bg',
  minContrastRatio = 4.5,
  ...props
}) => {
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
    const ratio = getContrastRatio(computedFg, resolvedBg);

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
      fgColor={fgColor}
      bgColor={bgColor}
      {...props}
    />
  );
};
