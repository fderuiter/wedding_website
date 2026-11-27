/**
 * @jest-environment node
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeFileSha256,
  ensureNextRouteTypes,
  isRouteTypesCacheValid,
  runTypecheck,
} from './run-typecheck.mjs';
import {
  ensurePrismaClientReady,
  hydrateWorktreeCaches,
  isolateWorktreeNodeModules,
  rewriteEslintCacheForWorktree,
  shouldIsolateWorktreePrisma,
} from './worktree-cache.mjs';

const LIVE_REPO_ROOT = process.cwd();

function createMinimalTsAndNextWorkspace(targetDir: string, includeRealNodeModules = false): void {
  fs.mkdirSync(path.join(targetDir, 'src', 'app'), { recursive: true });
  if (includeRealNodeModules) {
    fs.symlinkSync(
      path.join(LIVE_REPO_ROOT, 'node_modules'),
      path.join(targetDir, 'node_modules'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
  }

  fs.writeFileSync(
    path.join(targetDir, 'next.config.ts'),
    'const nextConfig = {};\nexport default nextConfig;\n'
  );
  fs.writeFileSync(
    path.join(targetDir, 'src', 'middleware.ts'),
    'export function middleware(): undefined {\n  return undefined;\n}\n'
  );
  fs.writeFileSync(
    path.join(targetDir, 'src', 'app', 'layout.tsx'),
    "import type { ReactNode } from 'react';\nexport default function RootLayout({ children }: { children: ReactNode }): ReactNode {\n  return children;\n}\n"
  );
  fs.writeFileSync(
    path.join(targetDir, 'src', 'app', 'page.tsx'),
    'export default function HomePage(): null {\n  return null;\n}\n'
  );
  fs.writeFileSync(path.join(targetDir, 'src', 'value.ts'), 'export const value: number = 1;\n');

  const baseCompilerOptions = {
    target: 'ES2022',
    lib: ['dom', 'esnext'],
    allowJs: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: 'react-jsx',
    incremental: true,
    skipLibCheck: true,
    types: ['node'],
    plugins: [{ name: 'next' }],
  };

  fs.writeFileSync(
    path.join(targetDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: baseCompilerOptions,
        include: [
          'next-env.d.ts',
          'src/**/*.ts',
          'src/**/*.tsx',
          '.next/types/**/*.ts',
          '.next/dev/types/**/*.ts',
        ],
        exclude: ['node_modules'],
      },
      null,
      2
    ) + '\n'
  );
  fs.writeFileSync(
    path.join(targetDir, 'tsconfig.build.json'),
    JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: {
          incremental: true,
          tsBuildInfoFile: './tsconfig.build.tsbuildinfo',
        },
        include: ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      },
      null,
      2
    ) + '\n'
  );
}

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

  it(
    'copies .next/types only when .route-manifest.json matches the worktree route digest and regenerates via next typegen on divergence',
    async () => {
      createMinimalTsAndNextWorkspace(repoRoot, true);
      createMinimalTsAndNextWorkspace(worktreeDir, false);

      const initialTypegen = ensureNextRouteTypes({ cwd: repoRoot });
      expect(initialTypegen.ok).toBe(true);
      expect(initialTypegen.regenerated).toBe(true);
      expect(isRouteTypesCacheValid(repoRoot)).toBe(true);

      // Matching route digest: hydrateWorktreeCaches copies next-env.d.ts + .next/types and runTypecheck reuses them
      hydrateWorktreeCaches(repoRoot, worktreeDir);
      expect(fs.existsSync(path.join(worktreeDir, 'next-env.d.ts'))).toBe(true);
      expect(fs.existsSync(path.join(worktreeDir, '.next', 'types', 'validator.ts'))).toBe(true);
      expect(
        fs.existsSync(path.join(worktreeDir, '.next', 'types', '.route-manifest.json'))
      ).toBe(true);

      const warmWorktreeCheck = await runTypecheck({
        cwd: worktreeDir,
        projects: ['tsconfig.build.json', 'tsconfig.json'],
      });
      expect(warmWorktreeCheck.ok).toBe(true);
      expect(warmWorktreeCheck.regeneratedRoutes).toBe(false);

      // Divergent route in a second worktree: hydrateWorktreeCaches must NOT copy stale .next/types
      const divergentWorktree = path.join(tempRoot, 'worktree-divergent');
      createMinimalTsAndNextWorkspace(divergentWorktree, false);
      fs.mkdirSync(path.join(divergentWorktree, 'src', 'app', 'api', 'ping'), { recursive: true });
      fs.writeFileSync(
        path.join(divergentWorktree, 'src', 'app', 'api', 'ping', 'route.ts'),
        'export async function GET(): Promise<Response> {\n  return Response.json({ ok: true });\n}\n'
      );

      hydrateWorktreeCaches(repoRoot, divergentWorktree);
      expect(fs.existsSync(path.join(divergentWorktree, '.next', 'types'))).toBe(false);
      expect(fs.existsSync(path.join(divergentWorktree, 'next-env.d.ts'))).toBe(false);

      const regenCheck = await runTypecheck({
        cwd: divergentWorktree,
        projects: ['tsconfig.build.json', 'tsconfig.json'],
      });
      expect(regenCheck.ok).toBe(true);
      expect(regenCheck.regeneratedRoutes).toBe(true);
      expect(
        fs.readFileSync(path.join(divergentWorktree, '.next', 'types', 'validator.ts'), 'utf8')
      ).toContain('api/ping/route');

      // Middleware or next.config.ts edit also invalidates route-digest hydration
      const middlewareWorktree = path.join(tempRoot, 'worktree-middleware');
      createMinimalTsAndNextWorkspace(middlewareWorktree, false);
      fs.writeFileSync(
        path.join(middlewareWorktree, 'src', 'middleware.ts'),
        'export const config = { matcher: ["/guest/:path*"] };\nexport function middleware(): undefined {\n  return undefined;\n}\n'
      );
      hydrateWorktreeCaches(repoRoot, middlewareWorktree);
      expect(fs.existsSync(path.join(middlewareWorktree, '.next', 'types'))).toBe(false);
    },
    60_000
  );

  it(
    'catches committed TS2322 errors via SHA-256 content hashes in hydrated worktrees even when copied .tsbuildinfo has a newer mtime',
    async () => {
      createMinimalTsAndNextWorkspace(repoRoot, true);
      createMinimalTsAndNextWorkspace(worktreeDir, false);

      // repoRoot has clean unstaged file and warm .tsbuildinfo
      fs.writeFileSync(path.join(repoRoot, 'src', 'value.ts'), 'export const value: number = 42;\n');
      const warmRepo = await runTypecheck({
        cwd: repoRoot,
        projects: ['tsconfig.build.json', 'tsconfig.json'],
      });
      expect(warmRepo.ok).toBe(true);

      // Backdate worktree TS2322 file and push repoRoot .tsbuildinfo mtime into the future
      const worktreeValuePath = path.join(worktreeDir, 'src', 'value.ts');
      fs.writeFileSync(worktreeValuePath, "export const value: number = 'broken-ts2322';\n");
      const past = new Date(Date.now() - 30_000);
      const future = new Date(Date.now() + 60_000);
      fs.utimesSync(worktreeValuePath, past, past);
      for (const cacheName of ['tsconfig.build.tsbuildinfo', 'tsconfig.tsbuildinfo']) {
        fs.utimesSync(path.join(repoRoot, cacheName), future, future);
      }

      hydrateWorktreeCaches(repoRoot, worktreeDir);
      expect(fs.existsSync(path.join(worktreeDir, 'tsconfig.build.tsbuildinfo'))).toBe(true);

      const brokenWorktreeCheck = await runTypecheck({
        cwd: worktreeDir,
        projects: ['tsconfig.build.json', 'tsconfig.json'],
      });
      expect(brokenWorktreeCheck.ok).toBe(false);
      expect(brokenWorktreeCheck.exitCode).toBe(1);
      expect(brokenWorktreeCheck.output).toContain('TS2322');
    },
    60_000
  );

  it(
    'isolates worktree node_modules/.prisma on schema divergence and never overwrites repoRoot/node_modules/.prisma/client',
    async () => {
      // Build a repoRoot with its own node_modules wrapper sharing packages from LIVE_REPO_ROOT
      const repoNodeModules = path.join(repoRoot, 'node_modules');
      fs.mkdirSync(repoNodeModules, { recursive: true });
      const liveNodeModules = path.join(LIVE_REPO_ROOT, 'node_modules');
      for (const entry of fs.readdirSync(liveNodeModules, { withFileTypes: true })) {
        if (entry.name === '.prisma' || entry.name === '.cache' || entry.name === '@prisma') {
          continue;
        }
        const srcEntry = path.join(liveNodeModules, entry.name);
        const destEntry = path.join(repoNodeModules, entry.name);
        const isDir =
          entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(srcEntry).isDirectory());
        fs.symlinkSync(
          srcEntry,
          destEntry,
          process.platform === 'win32' ? (isDir ? 'junction' : 'file') : isDir ? 'dir' : 'file'
        );
      }

      // Copy @prisma/client wrapper files and symlink sibling @prisma packages
      const repoAtPrisma = path.join(repoNodeModules, '@prisma');
      fs.mkdirSync(repoAtPrisma, { recursive: true });
      for (const scoped of fs.readdirSync(path.join(liveNodeModules, '@prisma'), {
        withFileTypes: true,
      })) {
        const srcScoped = path.join(liveNodeModules, '@prisma', scoped.name);
        const destScoped = path.join(repoAtPrisma, scoped.name);
        if (scoped.name === 'client') {
          fs.cpSync(srcScoped, destScoped, { recursive: true });
        } else {
          fs.symlinkSync(
            srcScoped,
            destScoped,
            process.platform === 'win32' ? 'junction' : 'dir'
          );
        }
      }

      const baseSchema = [
        'datasource db {',
        '  provider = "postgresql"',
        '}',
        '',
        'generator client {',
        '  provider = "prisma-client-js"',
        '  output   = "../node_modules/.prisma/client"',
        '}',
        '',
        'model BaseItem {',
        '  id   String @id @default(cuid())',
        '  name String',
        '}',
        '',
      ].join('\n');

      const minimalPrismaConfig = [
        "import { defineConfig } from 'prisma/config';",
        'export default defineConfig({',
        "  schema: 'prisma/schema.prisma',",
        '  datasource: {',
        "    url: process.env.DATABASE_URL ?? 'postgresql://dummy:dummy@localhost:5432/dummy',",
        '  },',
        '});',
        '',
      ].join('\n');

      fs.mkdirSync(path.join(repoRoot, 'prisma'), { recursive: true });
      const repoSchemaPath = path.join(repoRoot, 'prisma', 'schema.prisma');
      fs.writeFileSync(repoSchemaPath, baseSchema);
      fs.writeFileSync(path.join(repoRoot, 'prisma.config.ts'), minimalPrismaConfig);

      const repoSentinelClientPath = path.join(
        repoNodeModules,
        '.prisma',
        'client',
        'index.js'
      );
      fs.mkdirSync(path.dirname(repoSentinelClientPath), { recursive: true });
      const sentinelContent = '// REPO_ROOT_PRISMA_CLIENT_SENTINEL\nmodule.exports = {};\n';
      fs.writeFileSync(repoSentinelClientPath, sentinelContent);

      const baseSchemaHash = computeFileSha256(repoSchemaPath);
      const repoPretestStatePath = path.join(repoNodeModules, '.cache', 'pretest-state.json');
      fs.mkdirSync(path.dirname(repoPretestStatePath), { recursive: true });
      const initialStateRaw = `${JSON.stringify({ prismaClientSchemaHash: baseSchemaHash }, null, 2)}\n`;
      fs.writeFileSync(repoPretestStatePath, initialStateRaw);

      // 1. Identical schema + matching pretest-state hash -> fast symlink, zero regeneration
      const matchingWorktree = path.join(tempRoot, 'worktree-matching');
      fs.mkdirSync(path.join(matchingWorktree, 'prisma'), { recursive: true });
      fs.writeFileSync(path.join(matchingWorktree, 'prisma', 'schema.prisma'), baseSchema);
      expect(shouldIsolateWorktreePrisma(repoRoot, matchingWorktree)).toBe(false);
      hydrateWorktreeCaches(repoRoot, matchingWorktree);
      expect(fs.lstatSync(path.join(matchingWorktree, 'node_modules')).isSymbolicLink()).toBe(true);

      const matchingPrep = await ensurePrismaClientReady(matchingWorktree, {
        repoRoot,
        isIsolatedWorktree: true,
      });
      expect(matchingPrep.ok).toBe(true);
      expect(matchingPrep.generated).toBe(false);

      // 2. Divergent worktree schema -> isolated node_modules/.prisma, generates only inside worktreeDir
      fs.mkdirSync(path.join(worktreeDir, 'prisma'), { recursive: true });
      fs.writeFileSync(path.join(worktreeDir, 'prisma.config.ts'), minimalPrismaConfig);
      const divergentSchema = `${baseSchema}\nmodel WorktreeOnlyAudit {\n  id        String @id @default(cuid())\n  createdAt DateTime @default(now())\n}\n`;
      fs.writeFileSync(path.join(worktreeDir, 'prisma', 'schema.prisma'), divergentSchema);

      expect(shouldIsolateWorktreePrisma(repoRoot, worktreeDir)).toBe(true);
      hydrateWorktreeCaches(repoRoot, worktreeDir);
      expect(fs.lstatSync(path.join(worktreeDir, 'node_modules')).isSymbolicLink()).toBe(false);

      const divergentPrep = await ensurePrismaClientReady(worktreeDir, {
        repoRoot,
        isIsolatedWorktree: true,
      });
      expect(divergentPrep.ok).toBe(true);
      expect(divergentPrep.generated).toBe(true);

      // Worktree generated its own client with WorktreeOnlyAudit while repoRoot sentinel & pretest-state are untouched!
      const worktreeClientDts = fs.readFileSync(
        path.join(worktreeDir, 'node_modules', '.prisma', 'client', 'index.d.ts'),
        'utf8'
      );
      expect(worktreeClientDts).toContain('WorktreeOnlyAudit');
      expect(fs.readFileSync(repoSentinelClientPath, 'utf8')).toBe(sentinelContent);
      expect(fs.readFileSync(repoPretestStatePath, 'utf8')).toBe(initialStateRaw);

      // Also verify direct isolateWorktreeNodeModules idempotency when dest node_modules is already a directory
      isolateWorktreeNodeModules(repoRoot, worktreeDir);
      expect(fs.existsSync(path.join(worktreeDir, 'node_modules', '.prisma', 'client', 'index.d.ts'))).toBe(true);
    },
    60_000
  );
});
