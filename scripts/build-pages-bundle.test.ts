import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPagesBundle,
  normalizePagesBasePath,
  resolveDemoBasePath,
  resolvePagesBundleConfig,
} from './build-pages-bundle.mjs';

describe('build-pages-bundle', () => {
  it('normalizes PAGES_BASE_PATH and VITEPRESS_BASE values consistently', () => {
    expect(normalizePagesBasePath('')).toBe('/');
    expect(normalizePagesBasePath('/')).toBe('/');
    expect(normalizePagesBasePath('wedding_website')).toBe('/wedding_website/');
    expect(normalizePagesBasePath('/wedding_website')).toBe('/wedding_website/');
    expect(normalizePagesBasePath('/wedding_website///')).toBe('/wedding_website/');
  });

  it('resolves demo base path without trailing slash for Next.js basePath', () => {
    expect(resolveDemoBasePath('/')).toBe('/demo');
    expect(resolveDemoBasePath('/wedding_website/')).toBe('/wedding_website/demo');
    expect(resolveDemoBasePath('custom-preview')).toBe('/custom-preview/demo');
  });

  it('resolves bundle config from options', () => {
    const cfg = resolvePagesBundleConfig({
      pagesBasePath: '/wedding_website',
    });

    expect(cfg.portalBasePath).toBe('/wedding_website/');
    expect(cfg.demoBasePath).toBe('/wedding_website/demo');
    expect(cfg.storybookBasePath).toBe('/wedding_website/storybook/');
  });

  it('orchestrates VitePress, Next.js static export, and Storybook into docs-portal/.vitepress/dist', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-bundle-test-'));
    const recordedCalls: Array<{
      label: string;
      command: string;
      args: string[];
      env: Record<string, string | undefined>;
    }> = [];

    try {
      const mockRunner = (
        label: string,
        command: string,
        args: string[],
        _cwd: string,
        envOverrides: Record<string, string | undefined> = {}
      ) => {
        recordedCalls.push({
          label,
          command,
          args,
          env: envOverrides,
        });

        const joined = `${command} ${args.join(' ')}`;
        if (joined.includes('docs:build')) {
          const distDir = path.join(tmpRoot, 'docs-portal', '.vitepress', 'dist', 'api');
          fs.mkdirSync(distDir, { recursive: true });
          fs.writeFileSync(
            path.join(tmpRoot, 'docs-portal', '.vitepress', 'dist', 'index.html'),
            '<html><body>Portal</body></html>'
          );
          fs.writeFileSync(path.join(distDir, 'index.html'), '<html><body>OpenAPI</body></html>');
        } else if (joined.includes('build:export')) {
          const outDir = path.join(tmpRoot, 'out', 'registry');
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(tmpRoot, 'out', 'index.html'), '<html><body>Demo</body></html>');
          fs.writeFileSync(path.join(outDir, 'index.html'), '<html><body>Registry</body></html>');
        } else if (joined.includes('build-storybook')) {
          const sbDir = path.join(tmpRoot, 'storybook-static');
          fs.mkdirSync(sbDir, { recursive: true });
          fs.writeFileSync(path.join(sbDir, 'index.html'), '<html><body>Storybook</body></html>');
          fs.writeFileSync(path.join(sbDir, 'iframe.html'), '<html><body>Iframe</body></html>');
        }
      };

      const result = buildPagesBundle({
        rootDir: tmpRoot,
        env: { PAGES_BASE_PATH: '/wedding_website/' },
        runCommand: mockRunner,
      });

      expect(recordedCalls).toHaveLength(3);
      expect(recordedCalls[0].env.VITEPRESS_BASE).toBe('/wedding_website/');
      expect(recordedCalls[1].env.STATIC_EXPORT).toBe('true');
      expect(recordedCalls[1].env.NEXT_PUBLIC_BASE_PATH).toBe('/wedding_website/demo');

      expect(fs.existsSync(path.join(result.distDir, 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(result.distDir, 'api', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(result.distDir, 'demo', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(result.distDir, 'demo', 'registry', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(result.distDir, 'storybook', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(result.distDir, '.nojekyll'))).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('throws a clear error if a sub-build fails to emit index.html', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-bundle-missing-'));
    try {
      expect(() =>
        buildPagesBundle({
          rootDir: tmpRoot,
          env: { PAGES_BASE_PATH: '/' },
          runCommand: () => {
            // Intentionally emit nothing
          },
        })
      ).toThrow(/VitePress build did not produce index\.html/);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
