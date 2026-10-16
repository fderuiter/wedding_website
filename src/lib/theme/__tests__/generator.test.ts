import {
  sanitizeColor,
  sanitizePreset,
  sanitizeLayoutToken,
  sanitizeTokenValue,
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  getLuminance,
  getContrastRatio,
  optimizeContrast,
  generateDynamicStyles,
} from '../generator';

describe('Theme Generator Utilities', () => {
  describe('Sanitization Functions', () => {
    it('sanitizes valid hex colors and provides fallback for invalid inputs', () => {
      expect(sanitizeColor('#B91C1C', '#000000')).toBe('#B91C1C');
      expect(sanitizeColor('#abc', '#000000')).toBe('#abc');
      expect(sanitizeColor('invalid', '#000000')).toBe('#000000');
      expect(sanitizeColor(null, '#000000')).toBe('#000000');
      expect(sanitizeColor('</style><script>alert(1)</script>', '#000000')).toBe('#000000');
    });

    it('sanitizes valid theme presets and provides fallback', () => {
      expect(sanitizePreset('romantic')).toBe('romantic');
      expect(sanitizePreset('modern')).toBe('modern');
      expect(sanitizePreset('unknown-preset')).toBe('classic');
      expect(sanitizePreset(null)).toBe('classic');
    });

    it('sanitizes layout CSS tokens', () => {
      expect(sanitizeLayoutToken('64rem', '64rem')).toBe('64rem');
      expect(sanitizeLayoutToken('100px', '64rem')).toBe('100px');
      expect(sanitizeLayoutToken('invalid token', '64rem')).toBe('64rem');
      expect(sanitizeLayoutToken(undefined, '1.5rem')).toBe('1.5rem');
    });

    it('sanitizes token values against CSS injection', () => {
      expect(sanitizeTokenValue('red; background: blue')).toBe('red background: blue');
      expect(sanitizeTokenValue(null)).toBe('');
    });
  });

  describe('Color Math & Contrast Optimization', () => {
    it('converts hex to RGB accurately', () => {
      expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
      expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
      expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('converts RGB to Hex accurately', () => {
      expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
      expect(rgbToHex(0, 0, 0)).toBe('#000000');
      expect(rgbToHex(185, 28, 28)).toBe('#b91c1c');
    });

    it('converts RGB to HSL and back', () => {
      const rgb = { r: 185, g: 28, b: 28 };
      const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
      const convertedBack = hslToRgb(hsl.h, hsl.s, hsl.l);
      expect(convertedBack.r).toBeCloseTo(rgb.r, 0);
      expect(convertedBack.g).toBeCloseTo(rgb.g, 0);
      expect(convertedBack.b).toBeCloseTo(rgb.b, 0);
    });

    it('calculates luminance and contrast ratio without DOM dependencies', () => {
      const white = { r: 255, g: 255, b: 255 };
      const black = { r: 0, g: 0, b: 0 };
      expect(getLuminance(white)).toBeCloseTo(1, 2);
      expect(getLuminance(black)).toBeCloseTo(0, 2);
      expect(getContrastRatio(white, black)).toBeCloseTo(21, 0);
    });

    it('optimizes low-contrast colors to meet minimum WCAG contrast ratio', () => {
      // Light yellow on white has low contrast
      const lightYellow = '#FFFFE0';
      const optimized = optimizeContrast(lightYellow, '#FFFFFF', 4.5);
      const optRgb = hexToRgb(optimized);
      const whiteRgb = hexToRgb('#FFFFFF');
      expect(getContrastRatio(optRgb, whiteRgb)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe('generateDynamicStyles', () => {
    it('generates complete CSS variables, preset tokens, and dark mode selectors', () => {
      const css = generateDynamicStyles('#B91C1C', '#B45309', 'modern', undefined, {
        containerMaxWidth: '80rem',
        gridGap: '2rem',
        cardPadding: '2.5rem',
        borderRadius: '0.5rem',
      });

      expect(css).toContain(':root {');
      expect(css).toContain('--color-primary: #B91C1C;');
      expect(css).toContain('--color-secondary: #B45309;');
      expect(css).toContain('--btn-radius: 0.5rem;'); // modern preset token
      expect(css).toContain('--container-max-w: 80rem;');
      expect(css).toContain('html:not(.dark)');
      expect(css).toContain('.dark {');
      expect(css).toContain('--dialog-bg: #0f172a;'); // modern preset dark token
    });

    it('falls back to default preset tokens on invalid input', () => {
      const css = generateDynamicStyles('invalid-color', 'invalid-color', 'invalid-preset');

      expect(css).toContain('--color-primary: #B91C1C;');
      expect(css).toContain('--color-secondary: #B45309;');
      expect(css).toContain('--btn-radius: 0.375rem;'); // classic default token
    });
  });
});
