import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildPagesBundle,
  formatPagesBasePathsOutput,
  normalizePagesBasePath,
  parseCliArgs,
  resolveDemoBasePath,
  resolvePagesBundleConfig,
  resolvePagesPrefixes,
  resolveRepositoryPagesBasePath,
  resolveStorybookBasePath,
  runPagesCli,
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

  it('resolves Storybook base path without trailing slash for NEXT_PUBLIC_BASE_PATH', () => {
    expect(resolveStorybookBasePath('/')).toBe('/storybook');
    expect(resolveStorybookBasePath('/wedding_website/')).toBe('/wedding_website/storybook');
    expect(resolveStorybookBasePath('smith-wedding')).toBe('/smith-wedding/storybook');
  });

  it('resolves aligned portal, demo, and Storybook prefixes across topologies', () => {
    expect(resolvePagesPrefixes('/')).toEqual({
      portalBasePath: '/',
      demoBasePath: '/demo',
      storybookBasePath: '/storybook',
    });
    expect(resolvePagesPrefixes('/wedding_website/')).toEqual({
      portalBasePath: '/wedding_website/',
      demoBasePath: '/wedding_website/demo',
      storybookBasePath: '/wedding_website/storybook',
    });
    expect(resolvePagesPrefixes('smith-wedding')).toEqual({
      portalBasePath: '/smith-wedding/',
      demoBasePath: '/smith-wedding/demo',
      storybookBasePath: '/smith-wedding/storybook',
    });
  });

  it('resolves repository Pages base paths across default repo, forks, user sites, CNAME files, and Pages API metadata', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-repo-resolve-'));
    try {
      // 1. Default template repository
      expect(
        resolveRepositoryPagesBasePath({
          rootDir: tmpRoot,
          repository: 'fderuiter/wedding_website',
          env: {},
        })
      ).toBe('/wedding_website/');

      // 2. Renamed fork without Pages enabled yet (404 / empty API JSON)
      expect(
        resolveRepositoryPagesBasePath({
          rootDir: tmpRoot,
          repository: 'smiths/smith-wedding',
          pagesApiJson: '',
          env: {},
        })
      ).toBe('/smith-wedding/');

      // 3. Renamed fork with Pages API html_url
      expect(
        resolveRepositoryPagesBasePath({
          rootDir: tmpRoot,
          repository: 'smiths/smith-wedding',
          pagesApiJson: JSON.stringify({
            cname: null,
            html_url: 'https://smiths.github.io/smith-wedding/',
          }),
          env: {},
        })
      ).toBe('/smith-wedding/');

      // 4. User/organization site (<owner>.github.io, case-insensitive)
      expect(
        resolveRepositoryPagesBasePath({
          rootDir: tmpRoot,
          repository: 'Smiths/smiths.github.io',
          env: {},
        })
      ).toBe('/');

      // 5. Pages API custom domain cname
      expect(
        resolveRepositoryPagesBasePath({
          rootDir: tmpRoot,
          repository: 'smiths/smith-wedding',
          pagesApiJson: JSON.stringify({
            cname: 'wedding.example.com',
            html_url: 'https://wedding.example.com/',
          }),
          env: {},
        })
      ).toBe('/');

      // 6. CNAME files (CNAME, public/CNAME, docs-portal/public/CNAME)
      for (const cnameRel of ['CNAME', 'public/CNAME', 'docs-portal/public/CNAME']) {
        const fullCname = path.join(tmpRoot, cnameRel);
        fs.mkdirSync(path.dirname(fullCname), { recursive: true });
        fs.writeFileSync(fullCname, 'wedding.example.com\n', 'utf8');
        expect(
          resolveRepositoryPagesBasePath({
            rootDir: tmpRoot,
            repository: 'smiths/smith-wedding',
            env: {},
          })
        ).toBe('/');
        fs.rmSync(fullCname, { force: true });
      }
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('runs CLI resolver mode for $GITHUB_OUTPUT and JSON without executing sub-builds', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-cli-test-'));
    try {
      let stdout = '';
      const prefixes = runPagesCli(
        ['--resolve-base-paths', '--repo', 'smiths/smith-wedding'],
        {
          rootDir: tmpRoot,
          env: {},
          writeStdout: (chunk: string) => {
            stdout += chunk;
          },
        }
      );

      expect(prefixes).toEqual({
        portalBasePath: '/smith-wedding/',
        demoBasePath: '/smith-wedding/demo',
        storybookBasePath: '/smith-wedding/storybook',
      });
      expect(stdout).toBe(
        [
          'portal_base_path=/smith-wedding/',
          'demo_base_path=/smith-wedding/demo',
          'storybook_base_path=/smith-wedding/storybook',
          '',
        ].join('\n')
      );

      // Explicit empty --base-path="" (as emitted by actions/configure-pages on custom domains)
      let rootOut = '';
      runPagesCli(['--print-base-paths', '--base-path', '', '--json'], {
        rootDir: tmpRoot,
        env: { GH_REPO: 'fderuiter/wedding_website' },
        writeStdout: (chunk: string) => {
          rootOut += chunk;
        },
      });
      expect(JSON.parse(rootOut)).toEqual({
        portal_base_path: '/',
        demo_base_path: '/demo',
        storybook_base_path: '/storybook',
      });

      expect(parseCliArgs(['--resolve-base-paths', '--base-path=/custom', '--format=json'])).toMatchObject({
        resolveOnly: true,
        pagesBasePath: '/custom',
        format: 'json',
      });
      expect(
        formatPagesBasePathsOutput({
          portalBasePath: '/',
          demoBasePath: '/demo',
          storybookBasePath: '/storybook',
        })
      ).toContain('portal_base_path=/\ndemo_base_path=/demo\nstorybook_base_path=/storybook\n');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
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
      expect(recordedCalls[2].env.NEXT_PUBLIC_BASE_PATH).toBe('/wedding_website/storybook');

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
