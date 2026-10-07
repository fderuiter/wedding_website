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
});
