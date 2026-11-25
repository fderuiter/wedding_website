import fs from 'node:fs';
import path from 'node:path';

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
 * Hydrates an ephemeral git worktree with `node_modules` symlink, Next.js route types
 * (`next-env.d.ts` and `.next/types`), TypeScript `.tsbuildinfo` caches, and a path-rewritten
 * `.eslintcache`.
 *
 * @param {string} repoRoot
 * @param {string} worktreeDir
 */
export function hydrateWorktreeCaches(repoRoot, worktreeDir) {
  const srcNodeModules = path.join(repoRoot, 'node_modules');
  const destNodeModules = path.join(worktreeDir, 'node_modules');
  if (fs.existsSync(srcNodeModules) && !fs.existsSync(destNodeModules)) {
    fs.symlinkSync(
      srcNodeModules,
      destNodeModules,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  }

  const srcNextEnv = path.join(repoRoot, 'next-env.d.ts');
  const destNextEnv = path.join(worktreeDir, 'next-env.d.ts');
  try {
    if (fs.existsSync(srcNextEnv) && !fs.existsSync(destNextEnv) && fs.statSync(srcNextEnv).isFile()) {
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
