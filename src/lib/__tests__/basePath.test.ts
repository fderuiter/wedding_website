import fs from 'fs';
import path from 'path';
import {
  normalizeBasePath,
  getBasePath,
  getPortalBaseUrl,
  withBasePath,
  stripBasePath,
  getShowcasePortalBasePath,
  resolveShowcasePath,
} from '../basePath';
import { APP_DEFAULTS, STATIC_MOCK_CONFIG } from '../config';
import { ARCHETYPE_PRESETS } from '../sampleData/archetypes';
import { getLocalImageDimensions } from '@/utils/image-metadata';

describe('basePath helper utilities', () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

  afterEach(() => {
    if (originalBasePath === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    }
  });

  describe('normalizeBasePath & getBasePath', () => {
    it('returns empty string for unset, empty, whitespace, or root slash values', () => {
      expect(normalizeBasePath(undefined)).toBe('');
      expect(normalizeBasePath(null)).toBe('');
      expect(normalizeBasePath('')).toBe('');
      expect(normalizeBasePath('   ')).toBe('');
      expect(normalizeBasePath('/')).toBe('');
      expect(normalizeBasePath('///')).toBe('');
    });

    it('adds a leading slash and strips trailing slashes', () => {
      expect(normalizeBasePath('/wedding_website/demo')).toBe('/wedding_website/demo');
      expect(normalizeBasePath('/wedding_website/demo/')).toBe('/wedding_website/demo');
      expect(normalizeBasePath('wedding_website/demo///')).toBe('/wedding_website/demo');
    });

    it('reads process.env.NEXT_PUBLIC_BASE_PATH dynamically via getBasePath', () => {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      expect(getBasePath()).toBe('');

      process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo/';
      expect(getBasePath()).toBe('/wedding_website/demo');
    });
  });

  describe('withBasePath', () => {
    it('leaves root-relative paths unchanged when base path is empty or "/"', () => {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      expect(withBasePath('/api/schedule')).toBe('/api/schedule');
      expect(withBasePath('/images/placeholder.png', '')).toBe('/images/placeholder.png');
      expect(withBasePath('/images/placeholder.png', '/')).toBe('/images/placeholder.png');
    });

    it('prepends normalized subpath when NEXT_PUBLIC_BASE_PATH is active', () => {
      process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo/';
      expect(withBasePath('/api/registry')).toBe('/wedding_website/demo/api/registry');
      expect(withBasePath('/assets/favicon.png')).toBe(
        '/wedding_website/demo/assets/favicon.png'
      );
      expect(withBasePath('/')).toBe('/wedding_website/demo/');
    });

    it('avoids double-prefixing pre-prefixed paths while still prefixing partial segment siblings', () => {
      process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
      expect(withBasePath('/wedding_website/demo')).toBe('/wedding_website/demo');
      expect(withBasePath('/wedding_website/demo/registry')).toBe(
        '/wedding_website/demo/registry'
      );
      expect(withBasePath('/wedding_website/demo?tab=1')).toBe(
        '/wedding_website/demo?tab=1'
      );
      expect(withBasePath('/wedding_website/demo#story')).toBe(
        '/wedding_website/demo#story'
      );
      expect(withBasePath('/wedding_website/demo-other')).toBe(
        '/wedding_website/demo/wedding_website/demo-other'
      );
    });

    it('never modifies external, data, blob, mailto, hash-anchor, protocol-relative, or backslash URLs', () => {
      process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
      expect(withBasePath('https://example.com/photo.jpg')).toBe(
        'https://example.com/photo.jpg'
      );
      expect(withBasePath('http://example.com/api')).toBe('http://example.com/api');
      expect(withBasePath('data:image/png;base64,abc')).toBe('data:image/png;base64,abc');
      expect(withBasePath('blob:https://example.com/123')).toBe(
        'blob:https://example.com/123'
      );
      expect(withBasePath('mailto:contact@example.com')).toBe(
        'mailto:contact@example.com'
      );
      expect(withBasePath('#story')).toBe('#story');
      expect(withBasePath('//evil.example.com/phish.png')).toBe(
        '//evil.example.com/phish.png'
      );
      expect(withBasePath('/\\evil.example.com/phish.png')).toBe(
        '/\\evil.example.com/phish.png'
      );
      expect(withBasePath('')).toBe('');
    });
  });

  describe('stripBasePath', () => {
    it('strips active subpath prefix back to canonical root-relative path', () => {
      process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
      expect(stripBasePath('/wedding_website/demo/images/placeholder.png')).toBe(
        '/images/placeholder.png'
      );
      expect(stripBasePath('/wedding_website/demo')).toBe('/');
      expect(stripBasePath('/wedding_website/demo/')).toBe('/');
      expect(stripBasePath('/images/placeholder.png')).toBe('/images/placeholder.png');
      expect(stripBasePath('/wedding_website/demo-other')).toBe(
        '/wedding_website/demo-other'
      );
      expect(stripBasePath('https://example.com/wedding_website/demo/a.png')).toBe(
        'https://example.com/wedding_website/demo/a.png'
      );
    });
  });

  describe('getPortalBaseUrl', () => {
    it('resolves parent VitePress portal root URL across subpath and root deployments', () => {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      expect(getPortalBaseUrl()).toBe('/');
      expect(getPortalBaseUrl('/demo')).toBe('/');
      expect(getPortalBaseUrl('/wedding_website/demo')).toBe('/wedding_website/');
      expect(getPortalBaseUrl('/wedding_website/demo/')).toBe('/wedding_website/');
      expect(getPortalBaseUrl('/custom-prefix')).toBe('/custom-prefix/');
    });
  });

  describe('getShowcasePortalBasePath & resolveShowcasePath', () => {
    it('resolves root-origin showcase URLs when NEXT_PUBLIC_BASE_PATH is unset, "/", or "/demo"', () => {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
      expect(getShowcasePortalBasePath()).toBe('');
      expect(resolveShowcasePath('/')).toBe('/');
      expect(resolveShowcasePath('/api/')).toBe('/api/');
      expect(resolveShowcasePath('/storybook/')).toBe('/storybook/');

      expect(getShowcasePortalBasePath('/')).toBe('');
      expect(getShowcasePortalBasePath('/demo')).toBe('');
      expect(getShowcasePortalBasePath('/demo/')).toBe('');
      expect(resolveShowcasePath('/', '/demo/')).toBe('/');
      expect(resolveShowcasePath('/api/', '/demo')).toBe('/api/');
      expect(resolveShowcasePath('/storybook/', '/demo')).toBe('/storybook/');
    });

    it('derives repository subpath sibling URLs when NEXT_PUBLIC_BASE_PATH ends with /demo', () => {
      process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo/';
      expect(getShowcasePortalBasePath()).toBe('/wedding_website');
      expect(resolveShowcasePath('/')).toBe('/wedding_website/');
      expect(resolveShowcasePath('/api/')).toBe('/wedding_website/api/');
      expect(resolveShowcasePath('/storybook/')).toBe('/wedding_website/storybook/');

      expect(resolveShowcasePath('/', '/org/preview-123/demo')).toBe('/org/preview-123/');
      expect(resolveShowcasePath('/api/', '/org/preview-123/demo')).toBe(
        '/org/preview-123/api/'
      );
      expect(resolveShowcasePath('/storybook/', '/org/preview-123/demo')).toBe(
        '/org/preview-123/storybook/'
      );
    });

    it('preserves non-demo custom base paths cleanly', () => {
      expect(getShowcasePortalBasePath('/wedding_website')).toBe('/wedding_website');
      expect(resolveShowcasePath('/storybook/', '/wedding_website')).toBe(
        '/wedding_website/storybook/'
      );
    });
  });
});

describe('Sample & Default Local Public Asset Integrity', () => {
  it('ensures every local path in APP_DEFAULTS, STATIC_MOCK_CONFIG, and ARCHETYPE_PRESETS exists in public/ with valid image headers', async () => {
    const referencedPaths = new Set<string>();

    const collectIfLocal = (value: unknown) => {
      if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('/api/')) {
        referencedPaths.add(value);
      }
    };

    for (const config of [APP_DEFAULTS, STATIC_MOCK_CONFIG]) {
      collectIfLocal(config.faviconUrl);
      collectIfLocal(config.ogImageUrl);
      collectIfLocal(config.brandLogoUrl);
      collectIfLocal(config.heroImageUrl);
      collectIfLocal(config.brandWatermarkUrl);
      collectIfLocal(config.badgeGraphicUrl);
    }

    for (const preset of Object.values(ARCHETYPE_PRESETS)) {
      for (const item of preset.registryItems) {
        collectIfLocal(item.imageUrl);
      }
      for (const member of preset.weddingParty) {
        collectIfLocal(member.imageUrl);
      }
      for (const photo of preset.photos) {
        collectIfLocal(photo.url);
      }
    }

    expect(referencedPaths.size).toBeGreaterThanOrEqual(15);

    const publicDir = path.resolve(process.cwd(), 'public');
    for (const assetUrl of referencedPaths) {
      const fullPath = path.join(publicDir, assetUrl.replace(/^\/+/, ''));
      expect(fs.existsSync(fullPath)).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.isFile()).toBe(true);
      expect(stat.size).toBeGreaterThan(0);

      const dimensions = await getLocalImageDimensions(assetUrl);
      expect(dimensions).not.toBeNull();
      expect(dimensions!.width).toBeGreaterThan(0);
      expect(dimensions!.height).toBeGreaterThan(0);
    }
  });
});
