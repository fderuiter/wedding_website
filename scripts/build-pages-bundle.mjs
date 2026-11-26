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
 * Resolves the Storybook `NEXT_PUBLIC_BASE_PATH` (must start with `/` and have NO trailing slash)
 * for mounting the static Storybook showcase under `<portalBase>storybook`.
 * Examples:
 * - '/' -> '/storybook'
 * - '/wedding_website/' -> '/wedding_website/storybook'
 */
export function resolveStorybookBasePath(rawBase) {
  const portalBase = normalizePagesBasePath(rawBase);
  return portalBase === '/' ? '/storybook' : `${portalBase.slice(0, -1)}/storybook`;
}

/**
 * Computes aligned portal, demo, and Storybook base-path prefixes from a raw Pages base path.
 */
export function resolvePagesPrefixes(rawBase) {
  const portalBasePath = normalizePagesBasePath(rawBase);
  const demoBasePath = resolveDemoBasePath(portalBasePath);
  const storybookBasePath = resolveStorybookBasePath(portalBasePath);
  return {
    portalBasePath,
    demoBasePath,
    storybookBasePath,
  };
}

const CNAME_CANDIDATE_FILES = ['CNAME', 'public/CNAME', 'docs-portal/public/CNAME'];

/**
 * Resolves the normalized GitHub Pages portal base path (`'/'` or `'/<repo>/'`) from explicit
 * overrides, repository custom-domain `CNAME` files, `<owner>.github.io` naming, GitHub Pages API
 * metadata (`cname` / `html_url`), or the repository name fallback.
 */
export function resolveRepositoryPagesBasePath(options = {}) {
  const env = options.env ?? process.env;
  if (options.pagesBasePath !== undefined) {
    return normalizePagesBasePath(options.pagesBasePath);
  }
  if (options.vitepressBase !== undefined) {
    return normalizePagesBasePath(options.vitepressBase);
  }
  if (env.PAGES_BASE_PATH !== undefined) {
    return normalizePagesBasePath(env.PAGES_BASE_PATH);
  }
  if (env.VITEPRESS_BASE !== undefined) {
    return normalizePagesBasePath(env.VITEPRESS_BASE);
  }

  const rootDir = options.rootDir ? path.resolve(options.rootDir) : defaultRootDir;
  for (const relPath of CNAME_CANDIDATE_FILES) {
    const candidatePath = path.join(rootDir, relPath);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
      return '/';
    }
  }

  const rawRepo = String(options.repository ?? env.GH_REPO ?? env.GITHUB_REPOSITORY ?? '').trim();
  let owner = '';
  let repo = '';
  if (rawRepo.includes('/')) {
    const slashIdx = rawRepo.indexOf('/');
    owner = rawRepo.slice(0, slashIdx).trim();
    repo = rawRepo.slice(slashIdx + 1).trim();
  } else {
    repo = rawRepo;
  }

  if (owner && repo && repo.toLowerCase() === `${owner.toLowerCase()}.github.io`) {
    return '/';
  }

  let resolvedRawBase = repo ? `/${repo}` : '/';
  const pagesApiJson = String(options.pagesApiJson ?? env.PAGES_API_JSON ?? '').trim();
  if (pagesApiJson) {
    try {
      const parsed = JSON.parse(pagesApiJson);
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.cname === 'string' && parsed.cname.trim().length > 0) {
          return '/';
        }
        if (typeof parsed.html_url === 'string' && parsed.html_url.trim().length > 0) {
          resolvedRawBase = new URL(parsed.html_url).pathname;
        }
      }
    } catch {
      // Ignore malformed Pages API responses and preserve repository fallback
    }
  }

  return normalizePagesBasePath(resolvedRawBase);
}

/**
 * Formats resolved Pages base paths for `$GITHUB_OUTPUT` (`github`) or JSON (`json`).
 */
export function formatPagesBasePathsOutput(prefixes, format = 'github') {
  if (format === 'json') {
    return `${JSON.stringify(
      {
        portal_base_path: prefixes.portalBasePath,
        demo_base_path: prefixes.demoBasePath,
        storybook_base_path: prefixes.storybookBasePath,
      },
      null,
      2
    )}\n`;
  }
  return [
    `portal_base_path=${prefixes.portalBasePath}`,
    `demo_base_path=${prefixes.demoBasePath}`,
    `storybook_base_path=${prefixes.storybookBasePath}`,
    '',
  ].join('\n');
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
      {
        NEXT_PUBLIC_BASE_PATH: resolveStorybookBasePath(config.portalBasePath),
      }
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

export function parseCliArgs(argv = []) {
  const parsed = {
    resolveOnly: false,
    format: 'github',
    pagesBasePath: undefined,
    repository: undefined,
    pagesApiJson: undefined,
    rootDir: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--resolve-base-paths' || arg === '--print-base-paths') {
      parsed.resolveOnly = true;
    } else if (arg === '--json') {
      parsed.format = 'json';
    } else if (arg === '--format' && i + 1 < argv.length) {
      parsed.format = argv[++i];
    } else if (arg.startsWith('--format=')) {
      parsed.format = arg.slice('--format='.length);
    } else if (arg === '--base-path' && i + 1 < argv.length) {
      parsed.pagesBasePath = argv[++i];
    } else if (arg.startsWith('--base-path=')) {
      parsed.pagesBasePath = arg.slice('--base-path='.length);
    } else if (arg === '--repo' && i + 1 < argv.length) {
      parsed.repository = argv[++i];
    } else if (arg.startsWith('--repo=')) {
      parsed.repository = arg.slice('--repo='.length);
    } else if (arg === '--pages-json' && i + 1 < argv.length) {
      parsed.pagesApiJson = argv[++i];
    } else if (arg.startsWith('--pages-json=')) {
      parsed.pagesApiJson = arg.slice('--pages-json='.length);
    } else if (arg === '--root-dir' && i + 1 < argv.length) {
      parsed.rootDir = argv[++i];
    } else if (arg.startsWith('--root-dir=')) {
      parsed.rootDir = arg.slice('--root-dir='.length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (parsed.format !== 'github' && parsed.format !== 'json') {
    throw new Error(`Unsupported --format "${parsed.format}" (expected "github" or "json")`);
  }

  return parsed;
}

export function runPagesCli(argv = process.argv.slice(2), options = {}) {
  const cli = parseCliArgs(argv);
  const env = options.env ?? process.env;
  const writeStdout = options.writeStdout ?? ((chunk) => process.stdout.write(chunk));

  if (cli.resolveOnly) {
    const portalBase = resolveRepositoryPagesBasePath({
      rootDir: cli.rootDir ?? options.rootDir,
      pagesBasePath: cli.pagesBasePath,
      repository: cli.repository,
      pagesApiJson: cli.pagesApiJson,
      env,
    });
    const prefixes = resolvePagesPrefixes(portalBase);
    const output = formatPagesBasePathsOutput(prefixes, cli.format);
    writeStdout(output);
    return prefixes;
  }

  return buildPagesBundle({
    ...options,
    rootDir: cli.rootDir ?? options.rootDir,
    ...(cli.pagesBasePath !== undefined ? { pagesBasePath: cli.pagesBasePath } : {}),
    env,
  });
}

const isMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(currentScriptFile);

if (isMain) {
  try {
    runPagesCli();
  } catch (error) {
    console.error('Unified GitHub Pages bundle build failed:', error);
    process.exit(1);
  }
}
