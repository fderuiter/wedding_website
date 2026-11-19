import path from 'path';
import { decodeUrlPathSafely } from './validation';

export class PathContainmentError extends Error {
  readonly code = 'ERR_PATH_CONTAINMENT';

  constructor(message: string) {
    super(message);
    this.name = 'PathContainmentError';
  }
}

interface ContainmentOptions {
  /**
   * Directory against which the decoded relative path is resolved.
   */
  baseDir: string;
  /**
   * Root directory within which both lexical and canonical (realpath) paths must remain.
   * Defaults to `baseDir` when omitted.
   */
  containmentRoot?: string;
  /**
   * Require raw and decoded input paths to begin with a single leading `/`.
   */
  requireLeadingSlash?: boolean;
}

interface ContainedExistingFoundResult {
  exists: true;
  realPath: string;
  cleanKey: string;
}

interface ContainedExistingMissingResult {
  exists: false;
  resolvedPath: string;
  cleanKey: string;
}

type ContainedExistingPathResult =
  | ContainedExistingFoundResult
  | ContainedExistingMissingResult;

function isPathInsideRoot(rootPath: string, targetPath: string, allowEqual = false): boolean {
  const rel = path.relative(rootPath, targetPath);
  if (rel === '') {
    return allowEqual;
  }
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function getErrnoCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code?: string }).code;
  }
  return undefined;
}

function validateAndDecodeRelativeKey(
  rawInput: string,
  requireLeadingSlash = false
): string {
  if (typeof rawInput !== 'string' || rawInput.length === 0) {
    throw new PathContainmentError('Path cannot be empty');
  }

  const rawPath = rawInput.split('?')[0].split('#')[0];
  if (requireLeadingSlash && (!rawPath.startsWith('/') || rawPath.startsWith('//'))) {
    throw new PathContainmentError('Path must start with a single leading slash');
  }

  const decoded = decodeUrlPathSafely(rawInput);
  if (decoded === null) {
    throw new PathContainmentError('Path contains disallowed characters or encoding');
  }

  if (requireLeadingSlash && (!decoded.startsWith('/') || decoded.startsWith('//'))) {
    throw new PathContainmentError('Decoded path must start with a single leading slash');
  }

  const segments = decoded.split('/');
  if (segments.includes('..')) {
    throw new PathContainmentError('Parent directory traversal segments are not allowed');
  }

  const cleanKey = decoded.replace(/^\/+/, '');
  if (!cleanKey) {
    throw new PathContainmentError('Path resolves to root directory');
  }

  return cleanKey;
}

async function assertNotDanglingSymlink(
  fs: typeof import('fs/promises'),
  candidatePath: string
): Promise<void> {
  if (typeof fs.lstat !== 'function') {
    return;
  }
  try {
    const stat = await fs.lstat(candidatePath);
    if (stat.isSymbolicLink()) {
      throw new PathContainmentError('Symlink escape detected');
    }
  } catch (err: unknown) {
    if (err instanceof PathContainmentError) {
      throw err;
    }
    if (getErrnoCode(err) !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Resolves an existing path against `baseDir` and verifies both lexical (`path.relative`)
 * and canonical (`fs.promises.realpath`) containment within `containmentRoot`.
 * Throws `PathContainmentError` on traversal, null bytes, backslashes, or symlink escapes.
 */
export async function resolveContainedExistingPath(
  rawInput: string,
  options: ContainmentOptions
): Promise<ContainedExistingPathResult> {
  const cleanKey = validateAndDecodeRelativeKey(rawInput, options.requireLeadingSlash);

  const resolvedBase = path.resolve(options.baseDir);
  const resolvedRoot = path.resolve(options.containmentRoot ?? options.baseDir);
  const resolvedTarget = path.resolve(resolvedBase, cleanKey);

  if (!isPathInsideRoot(resolvedRoot, resolvedTarget, false)) {
    throw new PathContainmentError('Path escapes containment root');
  }

  const fs = await import('fs/promises');

  let canonicalBase = resolvedBase;
  if (typeof fs.realpath === 'function') {
    try {
      canonicalBase = await fs.realpath(resolvedBase);
    } catch (err: unknown) {
      if (getErrnoCode(err) === 'ENOENT') {
        await assertNotDanglingSymlink(fs, resolvedBase);
        return { exists: false, resolvedPath: resolvedTarget, cleanKey };
      }
      throw err;
    }
  }

  let canonicalRoot = resolvedRoot;
  if (resolvedRoot === resolvedBase) {
    canonicalRoot = canonicalBase;
  } else if (typeof fs.realpath === 'function') {
    try {
      canonicalRoot = await fs.realpath(resolvedRoot);
      if (!isPathInsideRoot(canonicalBase, canonicalRoot, false)) {
        throw new PathContainmentError('Containment root escapes base directory');
      }
    } catch (err: unknown) {
      if (err instanceof PathContainmentError) {
        throw err;
      }
      if (getErrnoCode(err) === 'ENOENT') {
        await assertNotDanglingSymlink(fs, resolvedRoot);
        return { exists: false, resolvedPath: resolvedTarget, cleanKey };
      }
      throw err;
    }
  }

  if (typeof fs.realpath !== 'function') {
    return { exists: true, realPath: resolvedTarget, cleanKey };
  }

  try {
    const realPath = await fs.realpath(resolvedTarget);
    if (!isPathInsideRoot(canonicalRoot, realPath, false)) {
      throw new PathContainmentError('Canonical path escapes containment root');
    }
    return { exists: true, realPath, cleanKey };
  } catch (err: unknown) {
    if (err instanceof PathContainmentError) {
      throw err;
    }
    if (getErrnoCode(err) === 'ENOENT') {
      await assertNotDanglingSymlink(fs, resolvedTarget);

      // Verify existing ancestor directories stay inside canonicalRoot
      let ancestor = path.dirname(resolvedTarget);
      while (isPathInsideRoot(resolvedRoot, ancestor, true)) {
        try {
          const realAncestor = await fs.realpath(ancestor);
          if (!isPathInsideRoot(canonicalRoot, realAncestor, true)) {
            throw new PathContainmentError('Ancestor directory escapes containment root');
          }
          break;
        } catch (ancErr: unknown) {
          if (ancErr instanceof PathContainmentError) {
            throw ancErr;
          }
          if (getErrnoCode(ancErr) === 'ENOENT') {
            await assertNotDanglingSymlink(fs, ancestor);
            const nextAncestor = path.dirname(ancestor);
            if (nextAncestor === ancestor) break;
            ancestor = nextAncestor;
            continue;
          }
          throw ancErr;
        }
      }

      return { exists: false, resolvedPath: resolvedTarget, cleanKey };
    }
    throw err;
  }
}

/**
 * Resolves a write destination path against `baseDir` and verifies both lexical (`path.relative`)
 * and parent canonical (`fs.promises.realpath`) containment within `containmentRoot` before writes.
 * Creates parent directories safely inside `containmentRoot` and rejects symlinked targets.
 */
export async function resolveContainedWritePath(
  rawInput: string,
  options: ContainmentOptions
): Promise<string> {
  const cleanKey = validateAndDecodeRelativeKey(rawInput, options.requireLeadingSlash);

  const resolvedBase = path.resolve(options.baseDir);
  const resolvedRoot = path.resolve(options.containmentRoot ?? options.baseDir);
  const resolvedTarget = path.resolve(resolvedBase, cleanKey);

  if (!isPathInsideRoot(resolvedRoot, resolvedTarget, false)) {
    throw new PathContainmentError('Write path escapes containment root');
  }

  const fs = await import('fs/promises');
  const parentDir = path.dirname(resolvedTarget);

  // Pre-mkdir check: inspect existing ancestors so mkdir never traverses an escaping symlink
  if (typeof fs.realpath === 'function') {
    let cur = parentDir;
    while (true) {
      try {
        const realCur = await fs.realpath(cur);
        if (isPathInsideRoot(resolvedRoot, cur, true)) {
          const canonicalBase = await fs.realpath(resolvedBase);
          const canonicalRoot =
            resolvedRoot === resolvedBase ? canonicalBase : await fs.realpath(resolvedRoot);
          if (resolvedRoot !== resolvedBase && !isPathInsideRoot(canonicalBase, canonicalRoot, false)) {
            throw new PathContainmentError('Containment root escapes base directory');
          }
          if (!isPathInsideRoot(canonicalRoot, realCur, true)) {
            throw new PathContainmentError('Parent directory escapes containment root');
          }
        }
        break;
      } catch (err: unknown) {
        if (err instanceof PathContainmentError) {
          throw err;
        }
        if (getErrnoCode(err) === 'ENOENT') {
          await assertNotDanglingSymlink(fs, cur);
          const next = path.dirname(cur);
          if (next === cur) {
            break;
          }
          cur = next;
          continue;
        }
        throw err;
      }
    }
  }

  await fs.mkdir(parentDir, { recursive: true });

  let canonicalParent = parentDir;
  if (typeof fs.realpath === 'function') {
    const canonicalBase = await fs.realpath(resolvedBase);
    const canonicalRoot =
      resolvedRoot === resolvedBase ? canonicalBase : await fs.realpath(resolvedRoot);
    if (resolvedRoot !== resolvedBase && !isPathInsideRoot(canonicalBase, canonicalRoot, false)) {
      throw new PathContainmentError('Containment root escapes base directory');
    }
    canonicalParent = await fs.realpath(parentDir);
    if (!isPathInsideRoot(canonicalRoot, canonicalParent, true)) {
      throw new PathContainmentError('Canonical parent directory escapes containment root');
    }
  }

  const finalFilePath = path.join(canonicalParent, path.basename(resolvedTarget));

  if (typeof fs.lstat === 'function') {
    try {
      const stat = await fs.lstat(finalFilePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new PathContainmentError('Target write path is a symlink or non-regular file');
      }
    } catch (err: unknown) {
      if (err instanceof PathContainmentError) {
        throw err;
      }
      if (getErrnoCode(err) !== 'ENOENT') {
        throw err;
      }
    }
  }

  return finalFilePath;
}
