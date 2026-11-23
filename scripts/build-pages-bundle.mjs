import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentScriptFile = fileURLToPath(import.meta.url);
const currentScriptDir = path.dirname(currentScriptFile);
const defaultRootDir = path.resolve(currentScriptDir, '..');

/**
 * Normalizes a GitHub Pages or VitePress base path so it always starts and ends with `/`.
 * Examples:
 * - undefined / '' / '/' -> '/'
 * - 'wedding_website' / '/wedding_website' / '/wedding_website/' -> '/wedding_website/'
 */
export function normalizePagesBasePath(rawBase) {
  const cleaned = String(rawBase ?? '')
    .trim()
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  return cleaned ? `/${cleaned}/` : '/';
}

/**
 * Resolves the Next.js `NEXT_PUBLIC_BASE_PATH` (must start with `/` and have NO trailing slash)
 * for mounting the interactive Next.js static export under `<portalBase>demo`.
 * Examples:
 * - '/' -> '/demo'
 * - '/wedding_website/' -> '/wedding_website/demo'
 */
export function resolveDemoBasePath(rawBase) {
  const portalBase = normalizePagesBasePath(rawBase);
  return portalBase === '/' ? '/demo' : `${portalBase.slice(0, -1)}/demo`;
}

/**
 * Resolves all filesystem directories and normalized URL prefixes for the unified Pages bundle.
 */
export function resolvePagesBundleConfig(options = {}) {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : defaultRootDir;
  const rawBase = options.pagesBasePath ?? options.vitepressBase ?? '/';
  const portalBasePath = normalizePagesBasePath(rawBase);
  const demoBasePath = resolveDemoBasePath(portalBasePath);
  const storybookBasePath = portalBasePath === '/' ? '/storybook/' : `${portalBasePath}storybook/`;

  const distDir = path.join(rootDir, 'docs-portal', '.vitepress', 'dist');
  const nextOutDir = path.join(rootDir, 'out');
  const storybookOutDir = path.join(rootDir, 'storybook-static');
  const demoDestDir = path.join(distDir, 'demo');
  const storybookDestDir = path.join(distDir, 'storybook');
  const noJekyllFile = path.join(distDir, '.nojekyll');

  return {
    rootDir,
    portalBasePath,
    demoBasePath,
    storybookBasePath,
    distDir,
    nextOutDir,
    storybookOutDir,
    demoDestDir,
    storybookDestDir,
    noJekyllFile,
  };
}

function runStep(label, command, args, cwd, envOverrides = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...envOverrides,
    },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
  }
}

export function buildPagesBundle(options = {}) {
  const env = options.env ?? process.env;
  const config = resolvePagesBundleConfig({
    rootDir: options.rootDir,
    pagesBasePath: options.pagesBasePath ?? env.PAGES_BASE_PATH,
    vitepressBase: options.vitepressBase ?? env.VITEPRESS_BASE,
  });

  const keepStageDirs = options.keepStageDirs ?? env.KEEP_STAGE_DIRS === 'true';
  const runner = options.runCommand ?? runStep;

  console.log(
    'Building unified GitHub Pages showcase:\n' +
      `  Portal base:    ${config.portalBasePath}\n` +
      `  Demo base:      ${config.demoBasePath}\n` +
      `  Storybook base: ${config.storybookBasePath}\n` +
      `  Output bundle:  ${config.distDir}`
  );

  // Clean stale staging and dev type artifacts before building
  const nextDevDir = path.join(config.rootDir, '.next', 'dev');
  for (const target of [config.distDir, config.nextOutDir, config.storybookOutDir, nextDevDir]) {
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }

  try {
    // 1. Build VitePress Documentation & OpenAPI Portal -> docs-portal/.vitepress/dist
    runner('Building VitePress documentation portal', 'npm', ['run', 'docs:build'], config.rootDir, {
      VITEPRESS_BASE: config.portalBasePath,
    });

    if (!fs.existsSync(path.join(config.distDir, 'index.html'))) {
      throw new Error(`VitePress build did not produce index.html at ${config.distDir}`);
    }

    // 2. Build Next.js Static Export -> out/, then copy into docs-portal/.vitepress/dist/demo
    runner(
      'Building Next.js static export demo',
      'npm',
      ['run', 'build:export'],
      config.rootDir,
      {
        STATIC_EXPORT: 'true',
        NEXT_PUBLIC_BASE_PATH: config.demoBasePath,
      }
    );

    if (!fs.existsSync(path.join(config.nextOutDir, 'index.html'))) {
      throw new Error(`Next.js static export did not produce index.html at ${config.nextOutDir}`);
    }
    fs.rmSync(config.demoDestDir, { recursive: true, force: true });
    fs.cpSync(config.nextOutDir, config.demoDestDir, { recursive: true });

    // 3. Build Storybook Component Showcase -> storybook-static/, then copy into dist/storybook
    runner(
      'Building Storybook component showcase',
      'npm',
      ['run', 'build-storybook'],
      config.rootDir,
      {}
    );

    if (!fs.existsSync(path.join(config.storybookOutDir, 'index.html'))) {
      throw new Error(`Storybook build did not produce index.html at ${config.storybookOutDir}`);
    }
    fs.rmSync(config.storybookDestDir, { recursive: true, force: true });
    fs.cpSync(config.storybookOutDir, config.storybookDestDir, { recursive: true });

    // 4. Write .nojekyll so GitHub Pages serves _next/ and underscored assets directly
    fs.writeFileSync(config.noJekyllFile, '', 'utf8');

    console.log(`\nUnified GitHub Pages bundle ready at ${config.distDir}`);
    return config;
  } finally {
    if (!keepStageDirs) {
      for (const tempDir of [config.nextOutDir, config.storybookOutDir]) {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      }
    }
  }
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(currentScriptFile);

if (isMain) {
  try {
    buildPagesBundle();
  } catch (error) {
    console.error('Unified GitHub Pages bundle build failed:', error);
    process.exit(1);
  }
}
