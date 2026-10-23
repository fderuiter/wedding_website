import {
  THEME_PRESETS,
  THEME_PRESET_KEYS,
  getPresetTokens,
  getServerExportTokens,
  isThemePreset,
  parseDurationSec,
  DEFAULT_THEME_PRESET,
  ThemePreset,
} from '../presets';

describe('Theme Preset Catalog & Token Mapping', () => {
  it('defines token mappings for all 5 curated presets', () => {
    const expectedPresets: ThemePreset[] = ['classic', 'modern', 'romantic', 'minimal', 'editorial'];
    expect(THEME_PRESET_KEYS).toEqual(expectedPresets);

    for (const presetKey of expectedPresets) {
      const tokens = THEME_PRESETS[presetKey];
      expect(tokens).toBeDefined();

      // Check layout surface tokens
      expect(tokens['--container-bg']).toBeDefined();
      expect(tokens['--card-bg']).toBeDefined();
      expect(tokens['--card-border']).toBeDefined();
      expect(tokens['--card-shadow']).toBeDefined();
      expect(tokens['--heading-color']).toBeDefined();

      // Check typography tokens
      expect(tokens['--font-heading']).toBeDefined();
      expect(tokens['--font-body']).toBeDefined();
      expect(tokens['--font-mono']).toBeDefined();

      // Check key button and dialog component CSS variables
      expect(tokens['--btn-radius']).toBeDefined();
      expect(tokens['--btn-font-weight']).toBeDefined();
      expect(tokens['--btn-primary-bg']).toBeDefined();
      expect(tokens['--btn-primary-text']).toBeDefined();
      expect(tokens['--btn-secondary-bg']).toBeDefined();
      expect(tokens['--dialog-bg']).toBeDefined();
      expect(tokens['--dialog-border-radius']).toBeDefined();
      expect(tokens['--dialog-shadow']).toBeDefined();
      expect(tokens['--dialog-backdrop']).toBeDefined();
      expect(tokens['--dialog-border-color']).toBeDefined();

      // Check standardized schedule tokens
      expect(tokens['--schedule-card-bg']).toBeDefined();
      expect(tokens['--schedule-card-border']).toBeDefined();
      expect(tokens['--schedule-card-radius']).toBeDefined();
      expect(tokens['--schedule-filter-bg']).toBeDefined();
      expect(tokens['--schedule-filter-text']).toBeDefined();
      expect(tokens['--schedule-filter-hover-bg']).toBeDefined();
      expect(tokens['--schedule-filter-active-bg']).toBeDefined();
      expect(tokens['--schedule-filter-active-text']).toBeDefined();
      expect(tokens['--schedule-node-bg']).toBeDefined();
      expect(tokens['--schedule-node-border']).toBeDefined();
      expect(tokens['--schedule-tag-bg']).toBeDefined();
      expect(tokens['--schedule-tag-text']).toBeDefined();

      // Check toast feedback tokens
      expect(tokens['--toast-success-bg']).toBeDefined();
      expect(tokens['--toast-success-text']).toBeDefined();
      expect(tokens['--toast-error-bg']).toBeDefined();
      expect(tokens['--toast-error-text']).toBeDefined();
      expect(tokens['--toast-info-bg']).toBeDefined();
      expect(tokens['--toast-info-text']).toBeDefined();
      expect(tokens['--toast-confirm-bg']).toBeDefined();
      expect(tokens['--toast-confirm-text']).toBeDefined();
      expect(tokens['--toast-radius']).toBeDefined();
      expect(tokens['--toast-close-hover-bg']).toBeDefined();

      // Check dark tokens schema
      expect(tokens.darkTokens).toBeDefined();
      expect(tokens.darkTokens?.['--dialog-bg']).toBeDefined();
      expect(tokens.darkTokens?.['--dialog-border-color']).toBeDefined();
      expect(tokens.darkTokens?.['--dialog-title-color']).toBeDefined();
      expect(tokens.darkTokens?.['--dialog-desc-color']).toBeDefined();
      expect(tokens.darkTokens?.['--btn-focus-ring']).toBeDefined();
      expect(tokens.darkTokens?.['--btn-outline-border']).toBeDefined();
      expect(tokens.darkTokens?.['--btn-outline-text']).toBeDefined();
      expect(tokens.darkTokens?.['--container-bg']).toBeDefined();
      expect(tokens.darkTokens?.['--card-bg']).toBeDefined();
      expect(tokens.darkTokens?.['--card-border']).toBeDefined();

      // Check standardized print tokens
      expect(tokens['--print-bg']).toBeDefined();
      expect(tokens['--print-text']).toBeDefined();
      expect(tokens['--print-border']).toBeDefined();
      expect(tokens['--print-header-border']).toBeDefined();
      expect(tokens['--print-badge-bg']).toBeDefined();

      // Check floorplan canvas tokens
      expect(tokens['--canvas-bg']).toBeDefined();
      expect(tokens['--canvas-grid-dot']).toBeDefined();
      expect(tokens['--canvas-border']).toBeDefined();
      expect(tokens['--floorplan-table-bg']).toBeDefined();
      expect(tokens['--floorplan-table-border']).toBeDefined();
      expect(tokens['--floorplan-table-radius']).toBeDefined();
      expect(tokens['--floorplan-seat-assigned-bg']).toBeDefined();
      expect(tokens['--floorplan-seat-assigned-text']).toBeDefined();
      expect(tokens['--floorplan-seat-unassigned-hover']).toBeDefined();
      expect(tokens['--floorplan-status-overcapacity-bg']).toBeDefined();
      expect(tokens['--floorplan-status-overcapacity-border']).toBeDefined();

      // Check 3D and canvas tokens
      expect(tokens['--glow-color']).toBeDefined();
      expect(tokens['--glow-gradient']).toBeDefined();
      expect(tokens['--particle-color']).toBeDefined();
      expect(tokens['--3d-metalness']).toBeDefined();
      expect(tokens['--3d-roughness']).toBeDefined();
      expect(tokens['--3d-env-map-intensity']).toBeDefined();
      expect(tokens['--card-perspective']).toBeDefined();
      expect(tokens['--card-max-rotation']).toBeDefined();
      expect(tokens['--card-spring-stiffness']).toBeDefined();
      expect(tokens['--card-spring-damping']).toBeDefined();
    }
  });

  it('correctly identifies valid theme preset strings', () => {
    expect(isThemePreset('classic')).toBe(true);
    expect(isThemePreset('modern')).toBe(true);
    expect(isThemePreset('romantic')).toBe(true);
    expect(isThemePreset('minimal')).toBe(true);
    expect(isThemePreset('editorial')).toBe(true);

    expect(isThemePreset('invalid')).toBe(false);
    expect(isThemePreset('')).toBe(false);
    expect(isThemePreset(null)).toBe(false);
    expect(isThemePreset(undefined)).toBe(false);
    expect(isThemePreset(123)).toBe(false);
  });

  it('getPresetTokens returns expected preset tokens and falls back to classic on invalid preset', () => {
    const romanticTokens = getPresetTokens('romantic');
    expect(romanticTokens['--btn-radius']).toBe('9999px');
    expect(romanticTokens['--dialog-border-radius']).toBe('1.25rem');

    const minimalTokens = getPresetTokens('minimal');
    expect(minimalTokens['--btn-radius']).toBe('0px');
    expect(minimalTokens['--dialog-border-radius']).toBe('0px');

    const fallbackTokens = getPresetTokens('non-existent-preset');
    expect(fallbackTokens).toEqual(THEME_PRESETS[DEFAULT_THEME_PRESET]);

    const nullFallbackTokens = getPresetTokens(null);
    expect(nullFallbackTokens).toEqual(THEME_PRESETS[DEFAULT_THEME_PRESET]);
  });

  it('getPresetTokens returns resolved dark tokens when mode is dark', () => {
    for (const presetKey of THEME_PRESET_KEYS) {
      const lightTokens = getPresetTokens(presetKey, 'light');
      const darkTokens = getPresetTokens(presetKey, 'dark');

      // Check dark dialog background override
      expect(darkTokens['--dialog-bg']).not.toEqual(lightTokens['--dialog-bg']);

      // Layout tokens MUST remain shared between light and dark modes
      expect(darkTokens['--btn-radius']).toEqual(lightTokens['--btn-radius']);
      expect(darkTokens['--btn-font-weight']).toEqual(lightTokens['--btn-font-weight']);
      expect(darkTokens['--dialog-border-radius']).toEqual(lightTokens['--dialog-border-radius']);
      expect(darkTokens['--schedule-card-radius']).toEqual(lightTokens['--schedule-card-radius']);
    }
  });

  it('getPresetTokens falls back to default dark tokens for missing dark properties or invalid presets', () => {
    const darkFallback = getPresetTokens('invalid-preset', 'dark');
    expect(darkFallback['--dialog-bg']).toBe('#1f2937'); // classic preset dark override
    expect(darkFallback['--btn-radius']).toBe('0.375rem'); // classic base layout token
  });

  it('ensures all dark mode tokens achieve WCAG 2.1 AA compliant contrast ratios', () => {
    function getLuminance(hex: string): number {
      const cleanHex = hex.replace(/^#/, '');
      const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
      const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
      const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
      const transform = (val: number) => (val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4));
      return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
    }

    function getContrast(hex1: string, hex2: string): number {
      const l1 = getLuminance(hex1);
      const l2 = getLuminance(hex2);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }

    for (const presetKey of THEME_PRESET_KEYS) {
      const darkTokens = getPresetTokens(presetKey, 'dark');

      const dialogBg = darkTokens['--dialog-bg'];
      const containerBg = darkTokens['--container-bg'];
      const titleColor = darkTokens['--dialog-title-color'];
      const descColor = darkTokens['--dialog-desc-color'];
      const focusRing = darkTokens['--btn-focus-ring'];
      const outlineBorder = darkTokens['--btn-outline-border'];
      const outlineText = darkTokens['--btn-outline-text'];

      // Text contrast against modal background must be at least 4.5:1
      expect(getContrast(titleColor, dialogBg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(descColor, dialogBg)).toBeGreaterThanOrEqual(4.5);
      expect(getContrast(outlineText, dialogBg)).toBeGreaterThanOrEqual(4.5);

      // Focus ring and outline border contrast against modal/container backgrounds must be at least 3:1
      expect(getContrast(focusRing, dialogBg)).toBeGreaterThanOrEqual(3.0);
      expect(getContrast(outlineBorder, dialogBg)).toBeGreaterThanOrEqual(3.0);
      expect(getContrast(outlineBorder, containerBg)).toBeGreaterThanOrEqual(3.0);
    }
  });

  describe('parseDurationSec Utility', () => {
    it('converts duration strings ending in "s" to numeric seconds', () => {
      expect(parseDurationSec('0.8s')).toBe(0.8);
      expect(parseDurationSec('1.5s')).toBe(1.5);
      expect(parseDurationSec('0s')).toBe(0);
    });

    it('converts duration strings ending in "ms" to numeric seconds', () => {
      expect(parseDurationSec('200ms')).toBe(0.2);
      expect(parseDurationSec('1500ms')).toBe(1.5);
      expect(parseDurationSec('0ms')).toBe(0);
    });

    it('returns fallback value when input is missing or undefined', () => {
      expect(parseDurationSec(undefined)).toBe(0.8);
      expect(parseDurationSec(undefined, 0.2)).toBe(0.2);
      expect(parseDurationSec('')).toBe(0.8);
      expect(parseDurationSec('', 0.15)).toBe(0.15);
    });

    it('parses unitless numeric strings correctly', () => {
      expect(parseDurationSec('0.5')).toBe(0.5);
      expect(parseDurationSec('2')).toBe(2);
    });

    it('returns fallback for invalid or non-numeric strings', () => {
      expect(parseDurationSec('invalid')).toBe(0.8);
      expect(parseDurationSec('abc', 0.5)).toBe(0.5);
      expect(parseDurationSec('ms')).toBe(0.8);
      expect(parseDurationSec('s', 0.2)).toBe(0.2);
    });
  });

  describe('getServerExportTokens Utility', () => {
    it('defines explicit serverExportTokens for all 5 built-in theme presets', () => {
      for (const presetKey of THEME_PRESET_KEYS) {
        const tokens = THEME_PRESETS[presetKey].serverExportTokens;
        expect(tokens).toBeDefined();
        expect(tokens?.canvasBg).toBeDefined();
        expect(tokens?.cardBg).toBeDefined();
        expect(tokens?.colorPrimary).toBeDefined();
        expect(tokens?.colorSecondary).toBeDefined();
        expect(tokens?.textMuted).toBeDefined();
        expect(tokens?.borderAccent).toBeDefined();
        expect(tokens?.badgeBg).toBeDefined();
        expect(tokens?.badgeText).toBeDefined();
        expect(tokens?.fontHeading).toBeDefined();
        expect(tokens?.fontBody).toBeDefined();
        expect(tokens?.printBg).toBeDefined();
        expect(tokens?.printText).toBeDefined();
        expect(tokens?.printBorder).toBeDefined();
        expect(tokens?.printHeaderBorder).toBeDefined();
        expect(tokens?.printBadgeBg).toBeDefined();
      }
    });

    it('returns default classic server export tokens when called with no arguments', () => {
      const resolved = getServerExportTokens();
      expect(resolved).toEqual(THEME_PRESETS['classic'].serverExportTokens);
    });

    it('returns specific server export tokens for each preset key', () => {
      const romantic = getServerExportTokens('romantic');
      expect(romantic.canvasBg).toBe('#fdf2f8');
      expect(romantic.printText).toBe('#831843');

      const editorial = getServerExportTokens('editorial');
      expect(editorial.canvasBg).toBe('#f5f5f4');
      expect(editorial.printText).toBe('#000000');
    });

    it('falls back to default preset on invalid preset key', () => {
      const fallback = getServerExportTokens('invalid-key');
      expect(fallback).toEqual(THEME_PRESETS['classic'].serverExportTokens);
    });

    it('respects custom tokens and strips var(...) wrappers', () => {
      const customTokens = {
        '--color-primary': 'var(--color-primary, #123456)',
        '--container-bg': '#f0f0f0',
        '--print-bg': '#fafafa',
      };
      const resolved = getServerExportTokens('classic', customTokens);
      expect(resolved.colorPrimary).toBe('#123456');
      expect(resolved.canvasBg).toBe('#f0f0f0');
      expect(resolved.printBg).toBe('#fafafa');
    });

    it('respects overrides over custom tokens and preset defaults', () => {
      const overrides = {
        primary: '#ff0000',
        secondary: '#00ff00',
        printBg: '#000000',
      };
      const resolved = getServerExportTokens('romantic', null, overrides);
      expect(resolved.colorPrimary).toBe('#ff0000');
      expect(resolved.colorSecondary).toBe('#00ff00');
      expect(resolved.printBg).toBe('#000000');
      expect(resolved.canvasBg).toBe('#fdf2f8');
    });

    it('handles nested var() declarations, font families with commas, and var() without fallback', () => {
      const customTokens = {
        '--color-primary': 'var(--a, var(--b, #654321))',
        '--font-heading': 'var(--font-heading, Playfair Display, Georgia, serif)',
        '--color-secondary': 'var(--no-fallback)',
      };
      const resolved = getServerExportTokens('classic', customTokens);
      expect(resolved.colorPrimary).toBe('#654321');
      expect(resolved.fontHeading).toBe('Playfair Display, Georgia, serif');
      // --color-secondary had no fallback in var(), so it falls back to classic preset colorSecondary
      expect(resolved.colorSecondary).toBe(THEME_PRESETS['classic'].serverExportTokens.colorSecondary);
    });

    it('handles deeply nested or pathological var() strings safely without polynomial performance issues', () => {
      const pathologicalInput = 'var(' + 'var('.repeat(50) + '#123456' + ')'.repeat(51);
      const customTokens = {
        '--color-primary': pathologicalInput,
      };
      const resolved = getServerExportTokens('classic', customTokens);
      expect(resolved.colorPrimary).toBeDefined();
    });
  });
});
