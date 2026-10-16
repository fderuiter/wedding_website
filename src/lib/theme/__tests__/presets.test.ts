import {
  THEME_PRESETS,
  THEME_PRESET_KEYS,
  getPresetTokens,
  isThemePreset,
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
      expect(tokens.darkTokens?.['--btn-outline-border']).toBeDefined();

      // Check standardized print tokens
      expect(tokens['--print-bg']).toBeDefined();
      expect(tokens['--print-text']).toBeDefined();
      expect(tokens['--print-border']).toBeDefined();
      expect(tokens['--print-header-border']).toBeDefined();
      expect(tokens['--print-badge-bg']).toBeDefined();
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
});
