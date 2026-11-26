import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeFileSha256,
  computeRouteTypesDigest,
  hasNextRouteInputs,
  isRouteTypesCacheValid,
} from './run-typecheck.mjs';

const PLACEHOLDER_PRIMARY_URL =
  'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder?sslmode=disable';

function symlinkEntry(srcPath, destPath, isDir) {
  fs.symlinkSync(
    srcPath,
    destPath,
    process.platform === 'win32' ? (isDir ? 'junction' : 'file') : isDir ? 'dir' : 'file'
  );
}

function readPretestState(rootDir) {
  const statePath = path.join(rootDir, 'node_modules', '.cache', 'pretest-state.json');
  try {
    if (!fs.existsSync(statePath) || !fs.statSync(statePath).isFile()) {
      return {};
    }
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePretestState(rootDir, state) {
  const statePath = path.join(rootDir, 'node_modules', '.cache', 'pretest-state.json');
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {
    // Ignore non-fatal cache state write errors
  }
}

/**
 * Determines whether `worktreeDir` must isolate `node_modules/.prisma` from `repoRoot/node_modules`
 * so `prisma generate` inside the worktree never overwrites `repoRoot/node_modules/.prisma/client`.
 *
 * @param {string} repoRoot
 * @param {string} worktreeDir
 * @returns {boolean}
 */
export function shouldIsolateWorktreePrisma(repoRoot, worktreeDir) {
  const repoSchemaPath = path.join(repoRoot, 'prisma', 'schema.prisma');
  const worktreeSchemaPath = path.join(worktreeDir, 'prisma', 'schema.prisma');
  const hasRepoSchema = fs.existsSync(repoSchemaPath);
  const hasWorktreeSchema = fs.existsSync(worktreeSchemaPath);

  if (!hasRepoSchema && !hasWorktreeSchema) {
    return false;
  }
  if (!hasRepoSchema || !hasWorktreeSchema) {
    return true;
  }

  const repoSchemaHash = computeFileSha256(repoSchemaPath);
  const worktreeSchemaHash = computeFileSha256(worktreeSchemaPath);
  if (!repoSchemaHash || !worktreeSchemaHash || repoSchemaHash !== worktreeSchemaHash) {
    return true;
  }

  const repoClientIndex = path.join(repoRoot, 'node_modules', '.prisma', 'client', 'index.js');
  if (!fs.existsSync(repoClientIndex)) {
    return true;
  }

  const state = readPretestState(repoRoot);
  if (
    typeof state.prismaClientSchemaHash !== 'string' ||
    state.prismaClientSchemaHash !== worktreeSchemaHash
  ) {
    return true;
  }

  return false;
}

/**
 * Creates an isolated `node_modules` tree in `worktreeDir` that symlinks shared dependencies from
 * `repoRoot/node_modules` while keeping `node_modules/.prisma`, `node_modules/@prisma/client`
 * entrypoints, and `node_modules/.cache/pretest-state.json` private to `worktreeDir`.
 *
 * @param {string} repoRoot
 * @param {string} worktreeDir
 */
export function isolateWorktreeNodeModules(repoRoot, worktreeDir) {
  const srcNodeModules = path.join(repoRoot, 'node_modules');
  const destNodeModules = path.join(worktreeDir, 'node_modules');
  if (!fs.existsSync(srcNodeModules)) {
    return;
  }

  if (fs.existsSync(destNodeModules)) {
    const stat = fs.lstatSync(destNodeModules);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(destNodeModules);
    } else {
      return;
    }
  }

  fs.mkdirSync(destNodeModules, { recursive: true });
  fs.mkdirSync(path.join(destNodeModules, '.prisma'), { recursive: true });

  const destCacheDir = path.join(destNodeModules, '.cache');
  fs.mkdirSync(destCacheDir, { recursive: true });
  const srcCacheDir = path.join(srcNodeModules, '.cache');
  if (fs.existsSync(srcCacheDir) && fs.statSync(srcCacheDir).isDirectory()) {
    for (const cacheEntry of fs.readdirSync(srcCacheDir, { withFileTypes: true })) {
      if (cacheEntry.name === 'pretest-state.json') {
        continue;
      }
      const srcCacheChild = path.join(srcCacheDir, cacheEntry.name);
      const destCacheChild = path.join(destCacheDir, cacheEntry.name);
      if (!fs.existsSync(destCacheChild)) {
        symlinkEntry(srcCacheChild, destCacheChild, cacheEntry.isDirectory());
      }
    }
  }

  for (const entry of fs.readdirSync(srcNodeModules, { withFileTypes: true })) {
    if (entry.name === '.prisma' || entry.name === '.cache') {
      continue;
    }

    const srcEntryPath = path.join(srcNodeModules, entry.name);
    const destEntryPath = path.join(destNodeModules, entry.name);

    if (entry.name === '@prisma' && entry.isDirectory()) {
      fs.mkdirSync(destEntryPath, { recursive: true });
      for (const scopedEntry of fs.readdirSync(srcEntryPath, { withFileTypes: true })) {
        const srcScopedPath = path.join(srcEntryPath, scopedEntry.name);
        const destScopedPath = path.join(destEntryPath, scopedEntry.name);
        if (scopedEntry.name === 'client' && scopedEntry.isDirectory()) {
          fs.mkdirSync(destScopedPath, { recursive: true });
          for (const clientItem of fs.readdirSync(srcScopedPath, { withFileTypes: true })) {
            const srcClientItem = path.join(srcScopedPath, clientItem.name);
            const destClientItem = path.join(destScopedPath, clientItem.name);
            if (clientItem.isDirectory()) {
              symlinkEntry(srcClientItem, destClientItem, true);
            } else if (clientItem.isFile()) {
              fs.copyFileSync(srcClientItem, destClientItem);
            } else if (clientItem.isSymbolicLink()) {
              const resolvedTarget = fs.realpathSync(srcClientItem);
              symlinkEntry(
                resolvedTarget,
                destClientItem,
                fs.statSync(resolvedTarget).isDirectory()
              );
            }
          }
        } else {
          const isDir = scopedEntry.isDirectory() ||
            (scopedEntry.isSymbolicLink() && fs.statSync(srcScopedPath).isDirectory());
          symlinkEntry(srcScopedPath, destScopedPath, isDir);
        }
      }
      continue;
    }

    const isDir = entry.isDirectory() ||
      (entry.isSymbolicLink() && fs.statSync(srcEntryPath).isDirectory());
    symlinkEntry(srcEntryPath, destEntryPath, isDir);
  }
}

function canHydrateWorktreeNextTypes(repoRoot, worktreeDir) {
  const repoDigest = computeRouteTypesDigest(repoRoot);
  const worktreeDigest = computeRouteTypesDigest(worktreeDir);
  if (repoDigest !== worktreeDigest) {
    return false;
  }

  const manifestPath = path.join(repoRoot, '.next', 'types', '.route-manifest.json');
  if (
    fs.existsSync(manifestPath) ||
    hasNextRouteInputs(repoRoot) ||
    hasNextRouteInputs(worktreeDir)
  ) {
    return isRouteTypesCacheValid(repoRoot, worktreeDigest);
  }

  return true;
}

function resolvePrismaBin(cwd) {
  const binName = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  const localBin = path.join(cwd, 'node_modules', '.bin', binName);
  if (fs.existsSync(localBin)) {
    return { command: localBin, prefixArgs: [] };
  }
  return { command: 'npx', prefixArgs: ['prisma'] };
}

/**
 * Ensures Prisma Client in `targetDir/node_modules/.prisma/client` matches `targetDir/prisma/schema.prisma`
 * before parallel quality workers start, isolating `node_modules` first when running inside an
 * ephemeral worktree so `repoRoot/node_modules/.prisma/client` is never overwritten.
 *
 * @param {string} targetDir
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.repoRoot]
 * @param {boolean} [options.isIsolatedWorktree]
 * @returns {Promise<{ ok: boolean, generated: boolean, status: number, stdout: string, stderr: string }>}
 */
export async function ensurePrismaClientReady(targetDir, options = {}) {
  const schemaPath = path.join(targetDir, 'prisma', 'schema.prisma');
  if (!fs.existsSync(schemaPath) || !fs.statSync(schemaPath).isFile()) {
    return { ok: true, generated: false, status: 0, stdout: '', stderr: '' };
  }

  const currentSchemaHash = computeFileSha256(schemaPath);
  const clientIndexPath = path.join(targetDir, 'node_modules', '.prisma', 'client', 'index.js');
  const state = readPretestState(targetDir);

  if (
    currentSchemaHash &&
    fs.existsSync(clientIndexPath) &&
    state.prismaClientSchemaHash === currentSchemaHash
  ) {
    return { ok: true, generated: false, status: 0, stdout: '', stderr: '' };
  }

  const targetNodeModules = path.join(targetDir, 'node_modules');
  const isWorktree = Boolean(
    options.isIsolatedWorktree ||
      (options.repoRoot && path.resolve(options.repoRoot) !== path.resolve(targetDir))
  );
  if (
    isWorktree &&
    fs.existsSync(targetNodeModules) &&
    fs.lstatSync(targetNodeModules).isSymbolicLink()
  ) {
    const inferredRepoRoot =
      options.repoRoot ?? path.dirname(fs.realpathSync(targetNodeModules));
    isolateWorktreeNodeModules(inferredRepoRoot, targetDir);
  }

  const { command, prefixArgs } = resolvePrismaBin(targetDir);
  const childEnv = {
    ...(options.env ?? process.env),
    DATABASE_URL: PLACEHOLDER_PRIMARY_URL,
  };
  delete childEnv.POSTGRES_URL_NON_POOLING;

  const spawnRes = await new Promise((resolve, reject) => {
    const child = spawn(command, [...prefixArgs, 'generate'], {
      cwd: targetDir,
      env: childEnv,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        status: code ?? 1,
        stdout,
        stderr,
      });
    });
  });

  if (spawnRes.status !== 0) {
    return {
      ok: false,
      generated: false,
      status: spawnRes.status,
      stdout: spawnRes.stdout,
      stderr: spawnRes.stderr,
    };
  }

  if (currentSchemaHash && fs.existsSync(clientIndexPath)) {
    const nextState = readPretestState(targetDir);
    nextState.prismaClientSchemaHash = currentSchemaHash;
    writePretestState(targetDir, nextState);
  }

  return {
    ok: true,
    generated: true,
    status: 0,
    stdout: spawnRes.stdout,
    stderr: spawnRes.stderr,
  };
}

/**
 * Rewrites a flatted ESLint file-entry-cache from `repoRoot` paths to `worktreeDir` paths,
 * reconciling `mtime` strictly for byte-identical unchanged files and invalidating entries
 * whose working-tree file diverges from the checked-out worktree revision.
 *
 * @param {string} srcCache
 * @param {string} destCache
 * @param {string} repoRoot
 * @param {string} worktreeDir
 */
export function rewriteEslintCacheForWorktree(srcCache, destCache, repoRoot, worktreeDir) {
  const raw = fs.readFileSync(srcCache, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fs.copyFileSync(srcCache, destCache);
    return;
  }

  if (!Array.isArray(parsed)) {
    fs.copyFileSync(srcCache, destCache);
    return;
  }

  const realRepoRoot = fs.realpathSync(repoRoot);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const realWorktreeDir = fs.realpathSync(worktreeDir);
  const sourceRoots = Array.from(new Set([realRepoRoot, resolvedRepoRoot]));
  const rewrittenByIndex = new Map();

  for (let i = 0; i < parsed.length; i++) {
    const value = parsed[i];
    if (typeof value !== 'string') {
      continue;
    }

    for (const rootCandidate of sourceRoots) {
      const prefix = `${rootCandidate}${path.sep}`;
      if (value.startsWith(prefix)) {
        const relPath = value.slice(prefix.length);
        const srcFile = path.join(realRepoRoot, relPath);
        const destFile = path.join(realWorktreeDir, relPath);
        parsed[i] = destFile;
        rewrittenByIndex.set(i, { srcFile, destFile });
        break;
      }
    }
  }

  for (const entry of parsed) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      typeof entry.key !== 'string' ||
      typeof entry.value !== 'string'
    ) {
      continue;
    }

    const keyIndex = Number.parseInt(entry.key, 10);
    const valueIndex = Number.parseInt(entry.value, 10);
    const fileMapping = rewrittenByIndex.get(keyIndex);
    const meta = parsed[valueIndex];
    if (
      !fileMapping ||
      !meta ||
      typeof meta !== 'object' ||
      Array.isArray(meta) ||
      typeof meta.size !== 'number' ||
      typeof meta.mtime !== 'number'
    ) {
      continue;
    }

    let cacheReusable = false;
    try {
      const srcStat = fs.statSync(fileMapping.srcFile);
      const destStat = fs.statSync(fileMapping.destFile);
      if (
        srcStat.isFile() &&
        destStat.isFile() &&
        srcStat.size === meta.size &&
        destStat.size === meta.size &&
        srcStat.mtime.getTime() === meta.mtime &&
        fs.readFileSync(fileMapping.srcFile).equals(fs.readFileSync(fileMapping.destFile))
      ) {
        meta.mtime = destStat.mtime.getTime();
        cacheReusable = true;
      }
    } catch {
      cacheReusable = false;
    }

    if (!cacheReusable) {
      meta.mtime = -1;
      delete meta.hash;
    }
  }

  fs.writeFileSync(destCache, JSON.stringify(parsed), 'utf8');
}

/**
 * Hydrates an ephemeral git worktree with `node_modules` (isolating `node_modules/.prisma` when
 * `prisma/schema.prisma` diverges from `repoRoot`'s generated client), route-digest-matched Next.js
 * route types (`next-env.d.ts` and `.next/types`), TypeScript `.tsbuildinfo` caches, and a
 * path-rewritten `.eslintcache`.
 *
 * @param {string} repoRoot
 * @param {string} worktreeDir
 */
export function hydrateWorktreeCaches(repoRoot, worktreeDir) {
  const srcNodeModules = path.join(repoRoot, 'node_modules');
  const destNodeModules = path.join(worktreeDir, 'node_modules');
  if (fs.existsSync(srcNodeModules) && !fs.existsSync(destNodeModules)) {
    if (shouldIsolateWorktreePrisma(repoRoot, worktreeDir)) {
      isolateWorktreeNodeModules(repoRoot, worktreeDir);
    } else {
      symlinkEntry(srcNodeModules, destNodeModules, true);
    }
  }

  let shouldCopyNextTypes = false;
  try {
    shouldCopyNextTypes = canHydrateWorktreeNextTypes(repoRoot, worktreeDir);
  } catch {
    shouldCopyNextTypes = false;
  }

  if (shouldCopyNextTypes) {
    const srcNextEnv = path.join(repoRoot, 'next-env.d.ts');
    const destNextEnv = path.join(worktreeDir, 'next-env.d.ts');
    try {
      if (
        fs.existsSync(srcNextEnv) &&
        !fs.existsSync(destNextEnv) &&
        fs.statSync(srcNextEnv).isFile()
      ) {
        fs.copyFileSync(srcNextEnv, destNextEnv);
      }
    } catch {
      // Ignore concurrent next-env.d.ts updates during copy
    }

    const srcNextTypes = path.join(repoRoot, '.next', 'types');
    const destNextTypes = path.join(worktreeDir, '.next', 'types');
    try {
      if (
        fs.existsSync(srcNextTypes) &&
        !fs.existsSync(destNextTypes) &&
        fs.statSync(srcNextTypes).isDirectory()
      ) {
        fs.mkdirSync(path.dirname(destNextTypes), { recursive: true });
        fs.cpSync(srcNextTypes, destNextTypes, { recursive: true });
      }
    } catch {
      // Ignore concurrent .next/types updates during copy
    }
  }

  for (const entry of fs.readdirSync(repoRoot)) {
    if (entry !== '.eslintcache' && !entry.endsWith('.tsbuildinfo')) {
      continue;
    }
    const srcCache = path.join(repoRoot, entry);
    const destCache = path.join(worktreeDir, entry);
    try {
      if (!fs.statSync(srcCache).isFile()) {
        continue;
      }
      if (entry === '.eslintcache') {
        rewriteEslintCacheForWorktree(srcCache, destCache, repoRoot, worktreeDir);
      } else {
        fs.copyFileSync(srcCache, destCache);
      }
    } catch {
      // Ignore concurrent cache rotation during copy
    }
  }
}
