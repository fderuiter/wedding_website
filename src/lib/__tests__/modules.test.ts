import {
  ModuleConfigSchema,
  resolveModuleConfig,
  isFeatureEnabled,
  getDisabledFeatures,
  validateModuleDependencies,
  DEFAULT_MODULE_CONFIG,
  FEATURE_METADATA,
  FEATURE_DEPENDENCIES,
} from '../modules';
import { getNavLinks, getRequiredModuleForRoute } from '../routes';

describe('Feature / Module Configuration Model', () => {
  describe('ModuleConfigSchema & Defaults', () => {
    it('defaults all 10 features to true', () => {
      const parsed = ModuleConfigSchema.parse({});
      expect(parsed).toEqual(DEFAULT_MODULE_CONFIG);
      expect(parsed.registry).toBe(true);
      expect(parsed.groupGifting).toBe(true);
      expect(parsed.guestPasscode).toBe(true);
      expect(parsed.weather).toBe(true);
      expect(parsed.weddingParty).toBe(true);
      expect(parsed.attractions).toBe(true);
      expect(parsed.gallery).toBe(true);
      expect(parsed.countdown).toBe(true);
      expect(parsed.addToCalendar).toBe(true);
      expect(parsed.interactive3D).toBe(true);
    });

    it('enumerates metadata for all 10 supported features', () => {
      expect(FEATURE_DEPENDENCIES.groupGifting).toEqual(['registry']);
      const featureKeys = Object.keys(FEATURE_METADATA);
      expect(featureKeys).toHaveLength(10);
      expect(featureKeys).toEqual(
        expect.arrayContaining([
          'registry',
          'groupGifting',
          'guestPasscode',
          'weather',
          'weddingParty',
          'attractions',
          'gallery',
          'countdown',
          'addToCalendar',
          'interactive3D',
        ])
      );
    });
  });

  describe('resolveModuleConfig & Dependency Rules', () => {
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

  describe('isFeatureEnabled & getDisabledFeatures', () => {
    it('correctly reports enabled and disabled status', () => {
      const config = { weather: false, interactive3D: false };

      expect(isFeatureEnabled('weather', config)).toBe(false);
      expect(isFeatureEnabled('interactive3D', config)).toBe(false);
      expect(isFeatureEnabled('registry', config)).toBe(true);

      const disabled = getDisabledFeatures(config);
      expect(disabled).toEqual(['weather', 'interactive3D']);
    });
  });

  describe('validateModuleDependencies', () => {
    it('returns error if groupGifting is enabled while registry is disabled', () => {
      const check = validateModuleDependencies({ groupGifting: true, registry: false });
      expect(check.valid).toBe(false);
      expect(check.errors).toContain("Feature 'groupGifting' requires feature 'registry' to be enabled.");
    });

    it('returns valid if groupGifting and registry are both enabled or disabled', () => {
      expect(validateModuleDependencies({ groupGifting: true, registry: true }).valid).toBe(true);
      expect(validateModuleDependencies({ groupGifting: false, registry: false }).valid).toBe(true);
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
      expect(hrefs).toContain('/archive');
      expect(hrefs).not.toContain('/weather');
      expect(hrefs).not.toContain('/photos');
      expect(hrefs).not.toContain('/wedding-party');
    });

    it('identifies required feature modules for specific routes', () => {
      expect(getRequiredModuleForRoute('/registry')).toBe('registry');
      expect(getRequiredModuleForRoute('/photos')).toBe('gallery');
      expect(getRequiredModuleForRoute('/wedding-party')).toBe('weddingParty');
      expect(getRequiredModuleForRoute('/things-to-do')).toBe('attractions');
      expect(getRequiredModuleForRoute('/weather')).toBe('weather');
      expect(getRequiredModuleForRoute('/heart')).toBe('interactive3D');
      expect(getRequiredModuleForRoute('/api/weather')).toBe('weather');
      expect(getRequiredModuleForRoute('/archive')).toBeUndefined();
    });
  });
});
