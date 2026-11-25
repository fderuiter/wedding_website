/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hydrateWorktreeCaches, rewriteEslintCacheForWorktree } from './worktree-cache.mjs';

describe('scripts/quality/worktree-cache.mjs', () => {
  let tempRoot: string;
  let repoRoot: string;
  let worktreeDir: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-cache-test-'));
    repoRoot = path.join(tempRoot, 'repo');
    worktreeDir = path.join(tempRoot, 'worktree');
    fs.mkdirSync(repoRoot, { recursive: true });
    fs.mkdirSync(worktreeDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('rewrites flatted .eslintcache paths for symlinked roots, reconciles mtime for identical files, and invalidates dirty files', () => {
    const symlinkRepoAlias = path.join(tempRoot, 'repo-alias');
    fs.symlinkSync(repoRoot, symlinkRepoAlias, process.platform === 'win32' ? 'junction' : 'dir');

    const srcClean = path.join(repoRoot, 'src', 'clean.ts');
    const destClean = path.join(worktreeDir, 'src', 'clean.ts');
    const srcDirty = path.join(repoRoot, 'src', 'dirty.ts');
    const destDirty = path.join(worktreeDir, 'src', 'dirty.ts');

    fs.mkdirSync(path.dirname(srcClean), { recursive: true });
    fs.mkdirSync(path.dirname(destClean), { recursive: true });

    fs.writeFileSync(srcClean, 'export const a = 1;\n');
    fs.writeFileSync(destClean, 'export const a = 1;\n');
    // Set distinct mtime on worktree copy (simulating fresh git worktree checkout)
    const futureTime = new Date(Date.now() + 10_000);
    fs.utimesSync(destClean, futureTime, futureTime);

    // Same byte length on dirty.ts, different content (unstaged fix on disk vs broken commit in worktree)
    fs.writeFileSync(srcDirty, 'export const b = 1;\n');
    fs.writeFileSync(destDirty, 'export const b = 9;\n');

    const srcCleanStat = fs.statSync(srcClean);
    const destCleanStat = fs.statSync(destClean);
    const srcDirtyStat = fs.statSync(srcDirty);
    const realWorktreeDir = fs.realpathSync(worktreeDir);

    // Reference clean.ts via symlinkRepoAlias to test sourceRoots alias resolution
    const flattedCache = [
      ['1', '2'],
      { key: '3', value: '4' },
      { key: '5', value: '6' },
      path.join(symlinkRepoAlias, 'src', 'clean.ts'),
      {
        size: srcCleanStat.size,
        mtime: srcCleanStat.mtime.getTime(),
        hash: 'h1',
        data: '7',
      },
      path.join(symlinkRepoAlias, 'src', 'dirty.ts'),
      {
        size: srcDirtyStat.size,
        mtime: srcDirtyStat.mtime.getTime(),
        hash: 'h2',
        data: '8',
      },
      { filePath: '3', errorCount: 0 },
      { filePath: '5', errorCount: 0 },
    ];

    const srcCache = path.join(repoRoot, '.eslintcache');
    const destCache = path.join(worktreeDir, '.eslintcache');
    fs.writeFileSync(srcCache, JSON.stringify(flattedCache), 'utf8');

    rewriteEslintCacheForWorktree(srcCache, destCache, symlinkRepoAlias, worktreeDir);

    const rewritten = JSON.parse(fs.readFileSync(destCache, 'utf8')) as unknown[];
    expect(rewritten[3]).toBe(path.join(realWorktreeDir, 'src', 'clean.ts'));
    expect(rewritten[5]).toBe(path.join(realWorktreeDir, 'src', 'dirty.ts'));

    // Unchanged file adopts worktree mtime and keeps hash
    expect((rewritten[4] as { mtime: number; hash?: string }).mtime).toBe(
      destCleanStat.mtime.getTime()
    );
    expect((rewritten[4] as { hash?: string }).hash).toBe('h1');

    // Content-divergent file (even with identical byte size!) is invalidated
    expect((rewritten[6] as { mtime: number; hash?: string }).mtime).toBe(-1);
    expect((rewritten[6] as { hash?: string }).hash).toBeUndefined();
  });

  it('falls back gracefully to copying non-JSON or non-array .eslintcache files and hydrates Next.js types + tsbuildinfo', () => {
    fs.mkdirSync(path.join(repoRoot, 'node_modules', '.bin'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, '.next', 'types'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'next-env.d.ts'), '/// <reference types="next" />\n');
    fs.writeFileSync(path.join(repoRoot, '.next', 'types', 'routes.d.ts'), 'export {};\n');
    fs.writeFileSync(path.join(repoRoot, 'tsconfig.build.tsbuildinfo'), '{"version":"5.0"}');
    fs.writeFileSync(path.join(repoRoot, '.eslintcache'), 'non-json-legacy-marker');

    hydrateWorktreeCaches(repoRoot, worktreeDir);

    expect(fs.lstatSync(path.join(worktreeDir, 'node_modules')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(worktreeDir, 'next-env.d.ts'), 'utf8')).toContain('next');
    expect(fs.existsSync(path.join(worktreeDir, '.next', 'types', 'routes.d.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(worktreeDir, 'tsconfig.build.tsbuildinfo'), 'utf8')).toBe(
      '{"version":"5.0"}'
    );
    expect(fs.readFileSync(path.join(worktreeDir, '.eslintcache'), 'utf8')).toBe(
      'non-json-legacy-marker'
    );
  });
});
