import { THEME_PRESET_KEYS, getPresetTokens } from '../presets';

describe('Spatial Theme Tokens', () => {
  it('defines required spatial tokens for all theme presets in light and dark modes', () => {
    const requiredSpatialTokens = [
      '--map-tile-url',
      '--map-tile-url-dark',
      '--map-tile-attribution',
      '--map-tile-filter',
      '--map-marker-pin-color',
      '--map-marker-border-color',
      '--map-marker-shadow-color',
    ] as const;

    THEME_PRESET_KEYS.forEach((presetKey) => {
      const lightTokens = getPresetTokens(presetKey, 'light');
      const darkTokens = getPresetTokens(presetKey, 'dark');

      requiredSpatialTokens.forEach((token) => {
        expect(lightTokens[token]).toBeDefined();
        expect(typeof lightTokens[token]).toBe('string');
        expect(lightTokens[token].length).toBeGreaterThan(0);

        expect(darkTokens[token]).toBeDefined();
        expect(typeof darkTokens[token]).toBe('string');
        expect(darkTokens[token].length).toBeGreaterThan(0);
      });

      // Verify tile URLs point to CartoDB endpoints
      expect(lightTokens['--map-tile-url']).toContain('cartocdn.com');
      expect(darkTokens['--map-tile-url']).toContain('cartocdn.com/dark_all');
    });
  });
});
