import {
  ModuleConfigSchema,
  resolveModuleConfig,
  isFeatureEnabled,
  DEFAULT_MODULE_CONFIG,
  FEATURE_METADATA,
} from '../modules';
import { getNavLinks } from '../routes';

describe('Feature / Module Configuration Model', () => {
  describe('ModuleConfigSchema & Defaults', () => {
    it('defaults all 9 features to true', () => {
      const parsed = ModuleConfigSchema.parse({});
      expect(parsed).toEqual(DEFAULT_MODULE_CONFIG);
      expect(parsed.registry).toBe(true);
      expect(parsed.groupGifting).toBe(true);
      expect(parsed.weather).toBe(true);
      expect(parsed.weddingParty).toBe(true);
      expect(parsed.attractions).toBe(true);
      expect(parsed.gallery).toBe(true);
      expect(parsed.countdown).toBe(true);
      expect(parsed.addToCalendar).toBe(true);
      expect(parsed.interactive3D).toBe(true);
      expect('guestPasscode' in parsed).toBe(false);
    });

    it('enumerates metadata for all 9 supported features without guestPasscode', () => {
      expect(FEATURE_METADATA.groupGifting.dependencies).toEqual(['registry']);
      const featureKeys = Object.keys(FEATURE_METADATA);
      expect(featureKeys).toHaveLength(9);
      expect(featureKeys).toEqual([
        'registry',
        'groupGifting',
        'weather',
        'weddingParty',
        'attractions',
        'gallery',
        'countdown',
        'addToCalendar',
        'interactive3D',
      ]);
      expect(featureKeys).not.toContain('guestPasscode');
    });
  });

  describe('resolveModuleConfig & Dependency Rules', () => {
    it('strips legacy guestPasscode keys without failing validation', () => {
      const resolved = resolveModuleConfig({
        guestPasscode: false,
        weather: false,
      });

      expect('guestPasscode' in resolved).toBe(false);
      expect(resolved.weather).toBe(false);
      expect(resolved.registry).toBe(true);
    });
    it('enforces groupGifting dependency on registry', () => {
      const resolved = resolveModuleConfig({
        registry: false,
        groupGifting: true,
      });

      expect(resolved.registry).toBe(false);
      expect(resolved.groupGifting).toBe(false);
    });

    it('allows groupGifting when registry is true', () => {
      const resolved = resolveModuleConfig({
        registry: true,
        groupGifting: true,
      });

      expect(resolved.registry).toBe(true);
      expect(resolved.groupGifting).toBe(true);
    });

    it('handles JSON string inputs gracefully', () => {
      const jsonStr = JSON.stringify({ weather: false, registry: false });
      const resolved = resolveModuleConfig(jsonStr);

      expect(resolved.weather).toBe(false);
      expect(resolved.registry).toBe(false);
      expect(resolved.groupGifting).toBe(false); // auto-disabled due to dependency
      expect(resolved.gallery).toBe(true);
    });

    it('falls back safely for invalid inputs', () => {
      const resolved = resolveModuleConfig('invalid json {{{');
      expect(resolved).toEqual(DEFAULT_MODULE_CONFIG);
    });
  });

  describe('isFeatureEnabled', () => {
    it('correctly reports enabled and disabled status', () => {
      const config = { weather: false, interactive3D: false };

      expect(isFeatureEnabled('weather', config)).toBe(false);
      expect(isFeatureEnabled('interactive3D', config)).toBe(false);
      expect(isFeatureEnabled('registry', config)).toBe(true);
    });
  });

  describe('Route Navigation Filtering with Feature Modules', () => {
    it('filters out public navigation links for disabled feature modules', () => {
      const disabledConfig = {
        weather: false,
        gallery: false,
        weddingParty: false,
      };

      const publicLinks = getNavLinks('public', disabledConfig);
      const hrefs = publicLinks.map((l) => l.href);

      expect(hrefs).toContain('/');
      expect(hrefs).toContain('/registry');
      expect(hrefs).not.toContain('/archive');
      expect(hrefs).not.toContain('/admin/login');
      expect(hrefs).not.toContain('/weather');
      expect(hrefs).not.toContain('/photos');
      expect(hrefs).not.toContain('/wedding-party');
    });
  });
});
