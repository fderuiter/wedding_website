#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const DEFAULT_TSCONFIG_PROJECTS = [
  'tsconfig.build.json',
  'tsconfig.scripts.json',
  'tsconfig.e2e.json',
  'tsconfig.test.json',
  'tsconfig.json',
];

export const ROUTE_MANIFEST_RELATIVE_PATH = path.join('.next', 'types', '.route-manifest.json');

const NEXT_CONFIG_CANDIDATES = [
  'next.config.ts',
  'next.config.mts',
  'next.config.mjs',
  'next.config.js',
  'next.config.cjs',
];

const MIDDLEWARE_CANDIDATES = [
  'src/middleware.ts',
  'src/middleware.tsx',
  'src/middleware.js',
  'src/middleware.jsx',
  'src/middleware.mjs',
  'src/middleware.cjs',
  'middleware.ts',
  'middleware.tsx',
  'middleware.js',
  'middleware.jsx',
  'middleware.mjs',
  'middleware.cjs',
  'src/proxy.ts',
  'src/proxy.js',
  'src/proxy.mjs',
  'proxy.ts',
  'proxy.js',
  'proxy.mjs',
];

const APP_ROUTER_DIRS = ['src/app', 'app'];

const APP_SPECIAL_FILE_REGEX =
  /^(?:page|layout|route|default|template|loading|error|not-found|global-error|forbidden|unauthorized)\.(?:tsx?|jsx?|mjs|cjs|mdx?)$/;

const APP_METADATA_FILE_REGEX =
  /^(?:favicon\.ico|(?:robots|manifest)\.(?:tsx?|jsx?|mjs|cjs|txt|json|webmanifest)|sitemap\.(?:tsx?|jsx?|mjs|cjs|xml)|(?:icon|apple-icon|opengraph-image|twitter-image)\d?\.(?:tsx?|jsx?|mjs|cjs|ico|jpg|jpeg|png|svg|gif))$/;

const IGNORED_APP_SEGMENT_DIRS = new Set([
  'node_modules',
  '__tests__',
  '__mocks__',
  '.git',
]);

const IGNORED_APP_FILE_REGEX = /\.(?:test|spec|stories)\.[^.]+$/;

/**
 * Computes the SHA-256 hex digest of a buffer or UTF-8 string.
 *
 * @param {Buffer | string} input
 * @returns {string}
 */
export function computeSha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Computes the SHA-256 hex digest of a file on disk, or empty string if unreadable.
 *
 * @param {string} filePath
 * @returns {string}
 */
export function computeFileSha256(filePath) {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return '';
    }
    return computeSha256(fs.readFileSync(filePath));
  } catch {
    return '';
  }
}

function toPosixPath(relPath) {
  return relPath.split(path.sep).join('/');
}

/**
 * Checks whether a workspace contains Next.js App Router, middleware, or Next config inputs.
 *
 * @param {string} cwd
 * @returns {boolean}
 */
export function hasNextRouteInputs(cwd) {
  for (const appDir of APP_ROUTER_DIRS) {
    const absDir = path.join(cwd, appDir);
    if (fs.existsSync(absDir) && fs.statSync(absDir).isDirectory()) {
      return true;
    }
  }
  for (const candidate of [...NEXT_CONFIG_CANDIDATES, ...MIDDLEWARE_CANDIDATES]) {
    const absFile = path.join(cwd, candidate);
    if (fs.existsSync(absFile) && fs.statSync(absFile).isFile()) {
      return true;
    }
  }
  return false;
}

/**
 * Collects sorted App Router entrypoint descriptors under `src/app` and `app`.
 *
 * @param {string} cwd
 * @returns {Array<{ relPath: string, metadataHash: string }>}
 */
function collectAppRouterEntrypoints(cwd) {
  /** @type {Array<{ relPath: string, metadataHash: string }>} */
  const entrypoints = [];

  /**
   * @param {string} currentAbsDir
   */
  function walk(currentAbsDir) {
    let entries;
    try {
      entries = fs.readdirSync(currentAbsDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_APP_SEGMENT_DIRS.has(entry.name)) {
          continue;
        }
        walk(path.join(currentAbsDir, entry.name));
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (IGNORED_APP_FILE_REGEX.test(entry.name)) {
        continue;
      }
      const isSpecial = APP_SPECIAL_FILE_REGEX.test(entry.name);
      const isMetadata = !isSpecial && APP_METADATA_FILE_REGEX.test(entry.name);
      if (!isSpecial && !isMetadata) {
        continue;
      }
      const absFile = path.join(currentAbsDir, entry.name);
      const relPath = toPosixPath(path.relative(cwd, absFile));
      const metadataHash = isMetadata ? computeFileSha256(absFile) : '';
      entrypoints.push({ relPath, metadataHash });
    }
  }

  for (const appRelDir of APP_ROUTER_DIRS) {
    const absAppDir = path.join(cwd, appRelDir);
    if (fs.existsSync(absAppDir)) {
      try {
        if (fs.statSync(absAppDir).isDirectory()) {
          walk(absAppDir);
        }
      } catch {
        // Ignore transient directory access races
      }
    }
  }

  entrypoints.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
  return entrypoints;
}

function readInstalledNextVersion(cwd) {
  const pkgPath = path.join(cwd, 'node_modules', 'next', 'package.json');
  try {
    if (!fs.existsSync(pkgPath)) {
      return '';
    }
    const parsed = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return typeof parsed?.version === 'string' ? parsed.version : '';
  } catch {
    return '';
  }
}

/**
 * Computes a deterministic SHA-256 digest of App Router entrypoints, `src/middleware.ts`,
 * `next.config.ts`, and the installed `next` version.
 *
 * @param {string} [cwd]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function computeRouteTypesDigest(cwd = process.cwd(), env = process.env) {
  const nextVersion = readInstalledNextVersion(cwd);
  const configHashes = [];
  for (const relConfig of NEXT_CONFIG_CANDIDATES) {
    const hash = computeFileSha256(path.join(cwd, relConfig));
    if (hash) {
      configHashes.push({ path: relConfig, sha256: hash });
    }
  }

  const middlewareHashes = [];
  for (const relMiddleware of MIDDLEWARE_CANDIDATES) {
    const hash = computeFileSha256(path.join(cwd, relMiddleware));
    if (hash) {
      middlewareHashes.push({ path: relMiddleware, sha256: hash });
    }
  }

  const entrypoints = collectAppRouterEntrypoints(cwd);
  const payload = {
    schemaVersion: 1,
    nextVersion,
    staticExport: String(env.STATIC_EXPORT ?? ''),
    basePath: String(env.NEXT_PUBLIC_BASE_PATH ?? ''),
    nextConfigs: configHashes,
    middlewares: middlewareHashes,
    appRouterEntrypoints: entrypoints,
  };

  return computeSha256(JSON.stringify(payload));
}

/**
 * Verifies that `next-env.d.ts`, `.next/types/validator.ts`, `.next/types/routes.d.ts`, and
 * `.next/types/.route-manifest.json` exist and match the expected SHA-256 route digest.
 *
 * @param {string} cwd
 * @param {string} [expectedDigest]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isRouteTypesCacheValid(
  cwd,
  expectedDigest = computeRouteTypesDigest(cwd),
  env = process.env
) {
  const resolvedDigest = expectedDigest || computeRouteTypesDigest(cwd, env);
  const nextEnvPath = path.join(cwd, 'next-env.d.ts');
  const validatorPath = path.join(cwd, '.next', 'types', 'validator.ts');
  const routesPath = path.join(cwd, '.next', 'types', 'routes.d.ts');
  const manifestPath = path.join(cwd, ROUTE_MANIFEST_RELATIVE_PATH);

  const nextEnvHash = computeFileSha256(nextEnvPath);
  const validatorHash = computeFileSha256(validatorPath);
  const routesHash = computeFileSha256(routesPath);
  if (!nextEnvHash || !validatorHash || !routesHash) {
    return false;
  }

  try {
    if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
      return false;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!manifest || typeof manifest !== 'object') {
      return false;
    }
    return (
      manifest.version === 1 &&
      manifest.digest === resolvedDigest &&
      manifest.nextEnvSha256 === nextEnvHash &&
      manifest.validatorSha256 === validatorHash &&
      manifest.routesSha256 === routesHash
    );
  } catch {
    return false;
  }
}

/**
 * Writes `.next/types/.route-manifest.json` for the current generated Next.js route types.
 *
 * @param {string} cwd
 * @param {string} digest
 * @returns {boolean}
 */
export function writeRouteTypesManifestFile(cwd, digest) {
  const nextEnvHash = computeFileSha256(path.join(cwd, 'next-env.d.ts'));
  const validatorHash = computeFileSha256(path.join(cwd, '.next', 'types', 'validator.ts'));
  const routesHash = computeFileSha256(path.join(cwd, '.next', 'types', 'routes.d.ts'));
  if (!nextEnvHash || !validatorHash || !routesHash) {
    return false;
  }

  const manifestPath = path.join(cwd, ROUTE_MANIFEST_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const manifest = {
    version: 1,
    digest,
    nextEnvSha256: nextEnvHash,
    validatorSha256: validatorHash,
    routesSha256: routesHash,
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return true;
}

function resolveNextBinary(cwd) {
  const binName = process.platform === 'win32' ? 'next.cmd' : 'next';
  const localBin = path.join(cwd, 'node_modules', '.bin', binName);
  if (fs.existsSync(localBin)) {
    return { command: localBin, args: ['typegen'], exists: true };
  }
  const distBin = path.join(cwd, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (fs.existsSync(distBin)) {
    return { command: process.execPath, args: [distBin, 'typegen'], exists: true };
  }
  return { command: 'npx', args: ['next', 'typegen'], exists: false };
}

/**
 * Ensures `next-env.d.ts` and `.next/types/*` match the workspace route digest, deleting stale
 * `.next/types` and running `next typegen` whenever artifacts diverge.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {{ ok: boolean, regenerated: boolean, skipped: boolean, digest: string, exitCode: number, stdout: string, stderr: string }}
 */
export function ensureNextRouteTypes(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;

  if (
    env.SKIP_NEXT_TYPEGEN === 'true' ||
    env.STATIC_EXPORT === 'true' ||
    env.STATIC_EXPORT === '1'
  ) {
    return {
      ok: true,
      regenerated: false,
      skipped: true,
      digest: '',
      exitCode: 0,
      stdout: '',
      stderr: '',
    };
  }

  const nextBin = resolveNextBinary(cwd);
  if (!hasNextRouteInputs(cwd) && !nextBin.exists) {
    return {
      ok: true,
      regenerated: false,
      skipped: true,
      digest: '',
      exitCode: 0,
      stdout: '',
      stderr: '',
    };
  }

  const digest = computeRouteTypesDigest(cwd, env);
  const devTypesDir = path.join(cwd, '.next', 'dev', 'types');
  const nestedDevTypesDir = path.join(cwd, '.next', 'dev', 'dev', 'types');
  const hasStaleDevTypes = fs.existsSync(devTypesDir) || fs.existsSync(nestedDevTypesDir);

  if (!hasStaleDevTypes && isRouteTypesCacheValid(cwd, digest, env)) {
    return {
      ok: true,
      regenerated: false,
      skipped: false,
      digest,
      exitCode: 0,
      stdout: '',
      stderr: '',
    };
  }

  for (const staleDir of [path.join(cwd, '.next', 'types'), devTypesDir, nestedDevTypesDir]) {
    fs.rmSync(staleDir, { recursive: true, force: true });
  }

  const res = spawnSync(nextBin.command, nextBin.args, {
    cwd,
    env,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = res.stdout ?? '';
  const stderr = res.stderr ?? '';
  if (res.status !== 0) {
    return {
      ok: false,
      regenerated: true,
      skipped: false,
      digest,
      exitCode: res.status ?? 1,
      stdout,
      stderr,
    };
  }

  writeRouteTypesManifestFile(cwd, digest);
  return {
    ok: true,
    regenerated: true,
    skipped: false,
    digest,
    exitCode: 0,
    stdout,
    stderr,
  };
}

function isDeclarationPath(fileName) {
  return (
    fileName.endsWith('.d.ts') ||
    fileName.endsWith('.d.mts') ||
    fileName.endsWith('.d.cts')
  );
}

function createSharedTsContext(cwd) {
  const realCwd = fs.existsSync(cwd) ? fs.realpathSync(cwd) : path.resolve(cwd);
  const getCanonicalFileName = ts.sys.useCaseSensitiveFileNames
    ? (fileName) => fileName
    : (fileName) => fileName.toLowerCase();
  const toCanonicalKey = (fileName) => getCanonicalFileName(path.resolve(realCwd, fileName));
  const localTsLibFile = path.join(realCwd, 'node_modules', 'typescript', 'lib', 'typescript.js');

  /** @type {Map<string, ts.SourceFile>} */
  const dtsSourceFileCache = new Map();
  const moduleResolutionCache = ts.createModuleResolutionCache(realCwd, getCanonicalFileName);

  /** @type {ts.System} */
  const sys = {
    ...ts.sys,
    getCurrentDirectory: () => realCwd,
    getExecutingFilePath: () =>
      fs.existsSync(localTsLibFile) ? localTsLibFile : ts.sys.getExecutingFilePath(),
    createHash: (data) => computeSha256(data),
    realpath(targetPath) {
      const resolved = path.resolve(realCwd, targetPath);
      const nodeModulesPrefix = `${realCwd}${path.sep}node_modules${path.sep}`;
      if (resolved.startsWith(nodeModulesPrefix)) {
        return resolved;
      }
      return ts.sys.realpath ? ts.sys.realpath(targetPath) : targetPath;
    },
  };

  /** @type {ts.FormatDiagnosticsHost} */
  const formatHost = {
    getCurrentDirectory: () => realCwd,
    getCanonicalFileName,
    getNewLine: () => sys.newLine,
  };

  return {
    realCwd,
    toCanonicalKey,
    dtsSourceFileCache,
    moduleResolutionCache,
    sys,
    formatHost,
  };
}

function checkSingleTsconfigProject(ctx, configRelOrAbsPath, pretty) {
  const configPath = path.resolve(ctx.realCwd, configRelOrAbsPath);
  const configRead = ts.readConfigFile(configPath, ctx.sys.readFile);
  if (configRead.error) {
    const formatted = pretty
      ? ts.formatDiagnosticsWithColorAndContext([configRead.error], ctx.formatHost)
      : ts.formatDiagnostics([configRead.error], ctx.formatHost);
    return {
      errorCount: 1,
      formattedDiagnostics: formatted,
    };
  }

  const parsed = ts.parseJsonConfigFileContent(
    configRead.config,
    ctx.sys,
    path.dirname(configPath),
    { noEmit: true },
    configPath
  );

  const host = ts.createIncrementalCompilerHost(parsed.options, ctx.sys);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    if (isDeclarationPath(fileName) && !shouldCreateNewSourceFile) {
      const impliedFormat =
        typeof languageVersionOrOptions === 'object'
          ? String(languageVersionOrOptions.impliedNodeFormat ?? '')
          : '';
      const cacheKey = `${impliedFormat}::${ctx.toCanonicalKey(fileName)}`;
      const cached = ctx.dtsSourceFileCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      const created = originalGetSourceFile(
        fileName,
        languageVersionOrOptions,
        onError,
        shouldCreateNewSourceFile
      );
      if (created) {
        ctx.dtsSourceFileCache.set(cacheKey, created);
      }
      return created;
    }
    return originalGetSourceFile(
      fileName,
      languageVersionOrOptions,
      onError,
      shouldCreateNewSourceFile
    );
  };
  host.getModuleResolutionCache = () => ctx.moduleResolutionCache;

  const builderProgram = ts.createIncrementalProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    configFileParsingDiagnostics: parsed.errors,
    projectReferences: parsed.projectReferences,
    host,
  });

  const rawDiagnostics = [...builderProgram.getConfigFileParsingDiagnostics()];
  const configErrorCount = rawDiagnostics.length;
  rawDiagnostics.push(...builderProgram.getSyntacticDiagnostics());
  if (rawDiagnostics.length === configErrorCount) {
    rawDiagnostics.push(...builderProgram.getOptionsDiagnostics());
    rawDiagnostics.push(...builderProgram.getGlobalDiagnostics());
    if (rawDiagnostics.length === configErrorCount) {
      rawDiagnostics.push(...builderProgram.getSemanticDiagnostics());
      if (
        (parsed.options.declaration || parsed.options.composite) &&
        rawDiagnostics.length === configErrorCount
      ) {
        rawDiagnostics.push(...builderProgram.getDeclarationDiagnostics());
      }
    }
  }

  const emitResult = builderProgram.emit();
  rawDiagnostics.push(...emitResult.diagnostics);

  const diagnostics = ts.sortAndDeduplicateDiagnostics(rawDiagnostics);
  const errorDiagnostics = diagnostics.filter(
    (diag) => diag.category === ts.DiagnosticCategory.Error
  );

  if (diagnostics.length === 0) {
    return {
      errorCount: 0,
      formattedDiagnostics: '',
    };
  }

  const formatted = pretty
    ? ts.formatDiagnosticsWithColorAndContext(diagnostics, ctx.formatHost)
    : ts.formatDiagnostics(diagnostics, ctx.formatHost);

  return {
    errorCount: errorDiagnostics.length,
    formattedDiagnostics: formatted,
  };
}

/**
 * Runs route-manifest verification (`next typegen` when needed) followed by content-hashed
 * `ts.createIncrementalProgram` typechecking across all configured `tsconfig*.json` projects.
 *
 * @param {object} [options]
 * @param {string} [options.cwd]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string[]} [options.projects]
 * @param {boolean} [options.pretty]
 * @param {(projectPath: string, index: number) => void | Promise<void>} [options.onAfterProjectCheck]
 * @returns {Promise<{ ok: boolean, exitCode: number, regeneratedRoutes: boolean, failedProject: string | null, output: string }>}
 */
export async function runTypecheck(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const projects = options.projects ?? DEFAULT_TSCONFIG_PROJECTS;
  const pretty = options.pretty ?? Boolean(process.stderr.isTTY);

  const routeResult = ensureNextRouteTypes({ cwd, env });
  let combinedOutput = '';
  if (routeResult.stdout) {
    combinedOutput += routeResult.stdout;
  }
  if (routeResult.stderr) {
    combinedOutput += routeResult.stderr;
  }
  if (!routeResult.ok) {
    return {
      ok: false,
      exitCode: routeResult.exitCode || 1,
      regeneratedRoutes: routeResult.regenerated,
      failedProject: 'next-typegen',
      output: combinedOutput,
    };
  }

  const ctx = createSharedTsContext(cwd);
  for (let i = 0; i < projects.length; i++) {
    const projectFile = projects[i];
    const result = checkSingleTsconfigProject(ctx, projectFile, pretty);
    if (options.onAfterProjectCheck) {
      await options.onAfterProjectCheck(projectFile, i);
    }
    if (result.formattedDiagnostics) {
      combinedOutput += result.formattedDiagnostics;
    }
    if (result.errorCount > 0) {
      return {
        ok: false,
        exitCode: 1,
        regeneratedRoutes: routeResult.regenerated,
        failedProject: projectFile,
        output: combinedOutput,
      };
    }
  }

  return {
    ok: true,
    exitCode: 0,
    regeneratedRoutes: routeResult.regenerated,
    failedProject: null,
    output: combinedOutput,
  };
}

function parseCliProjects(argv) {
  /** @type {string[]} */
  const explicitProjects = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === '-p' || arg === '--project') && argv[i + 1]) {
      explicitProjects.push(argv[++i]);
    } else if (!arg.startsWith('-')) {
      explicitProjects.push(arg);
    }
  }
  return explicitProjects.length > 0 ? explicitProjects : DEFAULT_TSCONFIG_PROJECTS;
}

const invokedScript = typeof process.argv[1] === 'string' ? path.basename(process.argv[1]) : '';
if (invokedScript === 'run-typecheck.mjs') {
  const cliProjects = parseCliProjects(process.argv.slice(2));
  void runTypecheck({ projects: cliProjects }).then((result) => {
    if (result.output) {
      if (result.ok) {
        process.stdout.write(result.output);
      } else {
        process.stderr.write(result.output);
      }
    }
    process.exit(result.exitCode);
  });
}
