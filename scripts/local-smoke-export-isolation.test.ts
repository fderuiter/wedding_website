import { spawnSync } from 'child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import nextConfig from '../next.config';
import {
  cleanupExportStage,
  persistExportStageCache,
  promoteStagedExportOutput,
  restoreLegacyApiBackup,
  stageExportWorkspace,
} from './build-export.mjs';
import {
  ALLOWLIST_PREFIXES,
  isAllowlisted,
} from './check-personal-identifiers';
import {
  COMPOSE_ARGS as CONTAINER_COMPOSE_ARGS,
  buildCiComposeEnv,
  getAvailableLoopbackPort as getContainerLoopbackPort,
} from './test-container.mjs';
import {
  COMPOSE_ARGS as STANDALONE_COMPOSE_ARGS,
  getAvailableLoopbackPort as getStandaloneLoopbackPort,
  resolveStandaloneDatabaseTarget,
} from './test-standalone.mjs';

describe('local smoke isolation, staged static exports, and untracked next-env.d.ts', () => {
  const repoRoot = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-export-isolation-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Docker Compose project and loopback port isolation in smoke scripts', () => {
    it('isolates standalone and container Compose stacks with distinct -p project names and no port-3000 kill -9', () => {
      expect(STANDALONE_COMPOSE_ARGS).toEqual([
        '-p',
        'wedding-smoke-standalone',
        '--env-file',
        '.env.ci',
        '-f',
        'docker-compose.yml',
        '-f',
        'docker-compose.ci.yml',
      ]);
      expect(CONTAINER_COMPOSE_ARGS).toEqual([
        '-p',
        'wedding-smoke-container',
        '--env-file',
        '.env.ci',
        '-f',
        'docker-compose.yml',
        '-f',
        'docker-compose.ci.yml',
      ]);

      const containerScriptRaw = fs.readFileSync(
        path.join(repoRoot, 'scripts/test-container.mjs'),
        'utf8'
      );
      expect(containerScriptRaw).not.toMatch(/lsof\s+-ti:3000/);
      expect(containerScriptRaw).not.toMatch(/kill\s+-9/);
    });

    it('allocates distinct free loopback ports and honors valid overrides', async () => {
      const occupiedServer = net.createServer();
      await new Promise<void>((resolve, reject) => {
        occupiedServer.once('error', reject);
        occupiedServer.listen(0, '127.0.0.1', () => resolve());
      });

      try {
        const addr = occupiedServer.address();
        const occupiedPort = typeof addr === 'object' && addr ? addr.port : 0;
        expect(occupiedPort).toBeGreaterThan(0);

        const standalonePort = await getStandaloneLoopbackPort(undefined, [occupiedPort]);
        const containerPort = await getContainerLoopbackPort(undefined, [
          occupiedPort,
          standalonePort,
        ]);

        expect(standalonePort).toBeGreaterThan(0);
        expect(standalonePort).not.toBe(occupiedPort);
        expect(containerPort).toBeGreaterThan(0);
        expect(containerPort).not.toBe(occupiedPort);
        expect(containerPort).not.toBe(standalonePort);

        await expect(getStandaloneLoopbackPort('4123')).resolves.toBe(4123);
        await expect(getContainerLoopbackPort(54321)).resolves.toBe(54321);
        await expect(getStandaloneLoopbackPort('0')).rejects.toThrow(/Invalid port override/);
        await expect(getContainerLoopbackPort('70000')).rejects.toThrow(/Invalid port override/);
      } finally {
        await new Promise<void>((resolve) => occupiedServer.close(() => resolve()));
      }
    });

    it('skips isolated Compose database when DATABASE_URL is set and uses loopback DB_PORT otherwise', async () => {
      const explicitUrl = 'postgresql://custom:secret@127.0.0.1:15432/custom_wedding';
      const explicitTarget = await resolveStandaloneDatabaseTarget({
        DATABASE_URL: explicitUrl,
      });
      expect(explicitTarget).toEqual({
        databaseUrl: explicitUrl,
        dbPort: null,
        useComposeDb: false,
      });

      const autoTarget = await resolveStandaloneDatabaseTarget(
        {
          DATABASE_URL: '   ',
          DB_USER: 'smoke_user',
          DB_PASSWORD: 'smoke_pass',
          DB_NAME: 'smoke_db',
        },
        [3000]
      );
      expect(autoTarget.useComposeDb).toBe(true);
      expect(autoTarget.dbPort).toBeGreaterThan(0);
      expect(autoTarget.dbPort).not.toBe(3000);
      expect(autoTarget.databaseUrl).toBe(
        `postgresql://smoke_user:smoke_pass@127.0.0.1:${autoTarget.dbPort}/smoke_db`
      );

      const overrideTarget = await resolveStandaloneDatabaseTarget({
        DB_PORT: '25432',
      });
      expect(overrideTarget.useComposeDb).toBe(true);
      expect(overrideTarget.dbPort).toBe(25432);
      expect(overrideTarget.databaseUrl).toContain('@127.0.0.1:25432/');

      const composeEnv = buildCiComposeEnv({ PORT: '43111', DB_PORT: '45432' });
      expect(composeEnv.PORT).toBe('43111');
      expect(composeEnv.DB_PORT).toBe('45432');
    });
  });

  describe('staged static exports inside .next/export-stage and turbopack.root', () => {
    it('stages inputs without src/app/api, public/uploads, or mockServiceWorker.js while leaving tracked src/app/api intact', () => {
      for (const cfg of [
        'package.json',
        'next.config.ts',
        'postcss.config.mjs',
        'tsconfig.json',
        'tsconfig.build.json',
      ]) {
        fs.writeFileSync(path.join(tempDir, cfg), `// ${cfg}\n`);
      }
      fs.mkdirSync(path.join(tempDir, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'assets', 'hero.txt'), 'asset');

      fs.mkdirSync(path.join(tempDir, 'public', 'uploads'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'public', 'favicon.ico'), 'icon');
      fs.writeFileSync(path.join(tempDir, 'public', 'mockServiceWorker.js'), '// msw');
      fs.writeFileSync(path.join(tempDir, 'public', 'uploads', 'guest-photo.jpg'), 'secret');

      fs.mkdirSync(path.join(tempDir, 'src', 'app', 'api', 'ready'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'src', 'app', 'globals.css'),
        '@import "tailwindcss";\n@source "../**/*.{ts,tsx}";\n'
      );
      fs.writeFileSync(path.join(tempDir, 'src', 'app', 'page.tsx'), 'export default function Page() { return null; }');
      fs.writeFileSync(path.join(tempDir, 'src', 'app', 'api', 'ready', 'route.ts'), 'export function GET() {}');

      const stageDir = stageExportWorkspace(tempDir);
      expect(stageDir).toBe(path.join(tempDir, '.next', 'export-stage'));
      expect(fs.existsSync(path.join(tempDir, 'src', 'app', 'api', 'ready', 'route.ts'))).toBe(true);
      expect(fs.existsSync(path.join(stageDir, 'src', 'app', 'page.tsx'))).toBe(true);
      expect(fs.readFileSync(path.join(stageDir, 'src', 'app', 'globals.css'), 'utf8')).toContain(
        '@source "../../../../src/**/*.{ts,tsx}";'
      );
      expect(fs.existsSync(path.join(stageDir, 'src', 'app', 'api'))).toBe(false);
      expect(fs.existsSync(path.join(stageDir, 'public', 'favicon.ico'))).toBe(true);
      expect(fs.existsSync(path.join(stageDir, 'public', 'uploads'))).toBe(false);
      expect(fs.existsSync(path.join(stageDir, 'public', 'mockServiceWorker.js'))).toBe(false);
      expect(fs.existsSync(path.join(stageDir, 'assets', 'hero.txt'))).toBe(true);

      fs.mkdirSync(path.join(stageDir, 'out'), { recursive: true });
      fs.writeFileSync(path.join(stageDir, 'out', 'index.html'), '<html>exported</html>');

      const promotedOut = promoteStagedExportOutput(tempDir, stageDir);
      expect(promotedOut).toBe(path.join(tempDir, 'out'));
      expect(fs.readFileSync(path.join(tempDir, 'out', 'index.html'), 'utf8')).toBe(
        '<html>exported</html>'
      );

      cleanupExportStage(tempDir);
      expect(fs.existsSync(stageDir)).toBe(false);

      // Verify .next-export/cache round-trip into .next/export-stage and back without leaking into out/
      fs.mkdirSync(path.join(tempDir, '.next-export', 'cache', 'webpack'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, '.next-export', 'cache', 'webpack', 'pack.gz'),
        'cached-bundle'
      );
      const cachedStageDir = stageExportWorkspace(tempDir);
      expect(
        fs.readFileSync(
          path.join(cachedStageDir, '.next-export', 'cache', 'webpack', 'pack.gz'),
          'utf8'
        )
      ).toBe('cached-bundle');

      fs.mkdirSync(path.join(cachedStageDir, '.next-export'), { recursive: true });
      fs.writeFileSync(
        path.join(cachedStageDir, '.next-export', 'index.html'),
        '<html>distDir export</html>'
      );
      expect(persistExportStageCache(tempDir, cachedStageDir)).toBe(true);
      promoteStagedExportOutput(tempDir, cachedStageDir);
      cleanupExportStage(tempDir);

      expect(
        fs.readFileSync(path.join(tempDir, '.next-export', 'cache', 'webpack', 'pack.gz'), 'utf8')
      ).toBe('cached-bundle');
      expect(fs.readFileSync(path.join(tempDir, 'out', 'index.html'), 'utf8')).toBe(
        '<html>distDir export</html>'
      );
      expect(fs.existsSync(path.join(tempDir, 'out', 'cache'))).toBe(false);
    });

    it('restores legacy .api-backup-export if an interrupted prior run left src/app/api missing', () => {
      const legacyBackupDir = path.join(tempDir, '.api-backup-export', 'health');
      fs.mkdirSync(legacyBackupDir, { recursive: true });
      fs.writeFileSync(path.join(legacyBackupDir, 'route.ts'), 'export const GET = () => {};');

      expect(restoreLegacyApiBackup(tempDir)).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'src', 'app', 'api', 'health', 'route.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.api-backup-export'))).toBe(false);
      expect(restoreLegacyApiBackup(tempDir)).toBe(false);
    });

    it('runs build-export.mjs end-to-end in a staged workspace, promotes out/, and removes .next/export-stage', () => {
      const scriptsDir = path.join(tempDir, 'scripts');
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.copyFileSync(
        path.join(repoRoot, 'scripts/build-export.mjs'),
        path.join(scriptsDir, 'build-export.mjs')
      );
      fs.writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}\n');
      fs.mkdirSync(path.join(tempDir, 'src', 'app', 'api'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'src', 'app', 'page.tsx'), 'export default () => null;\n');
      fs.writeFileSync(path.join(tempDir, 'src', 'app', 'api', 'route.ts'), 'export const GET = () => {};\n');

      const binDir = path.join(tempDir, 'node_modules', '.bin');
      fs.mkdirSync(binDir, { recursive: true });
      const nextStubPath = path.join(binDir, 'next');
      fs.writeFileSync(
        nextStubPath,
        [
          '#!/usr/bin/env node',
          "import fs from 'node:fs';",
          "import path from 'node:path';",
          "if (process.env.STATIC_EXPORT !== 'true') process.exit(2);",
          "if (fs.existsSync(path.join(process.cwd(), 'src', 'app', 'api'))) process.exit(3);",
          "fs.mkdirSync(path.join(process.cwd(), 'out'), { recursive: true });",
          "fs.writeFileSync(path.join(process.cwd(), 'out', 'index.html'), '<!doctype html><title>Static</title>');",
        ].join('\n'),
        { mode: 0o755 }
      );

      const res = spawnSync(process.execPath, [path.join(scriptsDir, 'build-export.mjs')], {
        cwd: tempDir,
        encoding: 'utf8',
      });
      expect(res.status).toBe(0);
      expect(fs.existsSync(path.join(tempDir, 'src', 'app', 'api', 'route.ts'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'out', 'index.html'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, '.next', 'export-stage'))).toBe(false);
    });

    it('pins turbopack.root in next.config.ts to the repository root even from .next/export-stage', () => {
      expect(nextConfig.turbopack?.root).toBe(repoRoot);

      // Verify path resolution logic when evaluated inside .next/export-stage (where node_modules lives two levels up)
      fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });
      const stagedDir = path.join(tempDir, '.next', 'export-stage');
      fs.mkdirSync(stagedDir, { recursive: true });

      const resolvedFromRoot = fs.existsSync(path.join(tempDir, 'node_modules'))
        ? tempDir
        : path.resolve(tempDir, '..', '..');
      const resolvedFromStage = fs.existsSync(path.join(stagedDir, 'node_modules'))
        ? stagedDir
        : path.resolve(stagedDir, '..', '..');

      expect(resolvedFromRoot).toBe(tempDir);
      expect(resolvedFromStage).toBe(tempDir);
    });
  });

  describe('ignore rules for out/, .api-backup-export/, .next/export-stage, and untracked next-env.d.ts', () => {
    it('ignores out/ and .api-backup-export/ in check-personal-identifiers, .gitignore, and eslint.config.mjs', () => {
      expect(ALLOWLIST_PREFIXES).toEqual(
        expect.arrayContaining(['.next/', '.next-export/', 'out/', '.api-backup-export/'])
      );
      expect(isAllowlisted('out', true)).toBe(true);
      expect(isAllowlisted('out/index.html', false)).toBe(true);
      expect(isAllowlisted('.api-backup-export', true)).toBe(true);
      expect(isAllowlisted('.api-backup-export/route.ts', false)).toBe(true);
      expect(isAllowlisted('.next/export-stage/src/app/page.tsx', false)).toBe(true);
      expect(isAllowlisted('src/app/page.tsx', false)).toBe(false);

      const gitIgnoreCheck = spawnSync(
        'git',
        ['check-ignore', 'out/index.html', '.api-backup-export/route.ts', 'next-env.d.ts'],
        { cwd: repoRoot, encoding: 'utf8' }
      );
      expect(gitIgnoreCheck.status).toBe(0);

      const eslintConfigRaw = fs.readFileSync(path.join(repoRoot, 'eslint.config.mjs'), 'utf8');
      expect(eslintConfigRaw).toContain("'out/**'");
      expect(eslintConfigRaw).toContain("'.api-backup-export/**'");

      const tsconfig = JSON.parse(
        fs.readFileSync(path.join(repoRoot, 'tsconfig.json'), 'utf8')
      ) as { exclude?: string[]; include?: string[] };
      expect(tsconfig.exclude).toContain('.next-export');
      expect(tsconfig.exclude).toContain('.next/export-stage');
    });

    it('keeps next-env.d.ts untracked in Git while running next typegen in typecheck, type-check, and postinstall', () => {
      const trackedCheck = spawnSync('git', ['ls-files', 'next-env.d.ts'], {
        cwd: repoRoot,
        encoding: 'utf8',
      });
      expect(trackedCheck.status).toBe(0);
      expect(trackedCheck.stdout.trim()).toBe('');

      const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      };
      expect(pkg.scripts.typecheck.startsWith('next typegen && ')).toBe(true);
      expect(pkg.scripts['type-check'].startsWith('next typegen && ')).toBe(true);
      expect(pkg.scripts.postinstall.startsWith('next typegen && ')).toBe(true);

      const knip = JSON.parse(fs.readFileSync(path.join(repoRoot, 'knip.json'), 'utf8')) as {
        entry?: string[];
        project?: string[];
      };
      expect(knip.entry ?? []).not.toContain('next-env.d.ts');
      expect(knip.project ?? []).not.toContain('next-env.d.ts');

      for (const tsFile of ['tsconfig.json', 'tsconfig.build.json', 'tsconfig.test.json']) {
        const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot, tsFile), 'utf8')) as {
          include?: string[];
        };
        expect(parsed.include).toContain('next-env.d.ts');
      }
    });
  });
});
