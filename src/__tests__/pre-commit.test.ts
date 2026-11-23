import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const PRE_COMMIT_PATH = path.join(REPO_ROOT, '.githooks', 'pre-commit');
const PRE_PUSH_PATH = path.join(REPO_ROOT, '.githooks', 'pre-push');
const INSTALL_HOOKS_PATH = path.join(REPO_ROOT, 'scripts', 'install-git-hooks.js');
const VERIFY_DOC_SYNC_PATH = path.join(REPO_ROOT, 'scripts', 'verify-doc-sync.ts');
const TSX_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const LINT_STAGED_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'lint-staged', 'bin', 'lint-staged.js');

describe('Split Git hooks (.githooks/pre-commit and .githooks/pre-push)', () => {
  let tempDir: string;
  let binDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hooks-split-'));
    binDir = path.join(tempDir, '.test-bin');
    logFile = path.join(tempDir, '.executed-checks.log');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'scripts'), { recursive: true });

    // Create stub generators used by verify-doc-sync in the isolated repo
    fs.writeFileSync(
      path.join(tempDir, 'scripts', 'generate-openapi.ts'),
      `
import fs from 'fs';
import path from 'path';
const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'schema.json'), 'utf8'));
fs.writeFileSync(
  path.join(process.cwd(), 'public', 'openapi.json'),
  JSON.stringify({ openapi: '3.0.3', version: schema.version }, null, 2) + '\\n'
);
`
    );

    fs.writeFileSync(
      path.join(tempDir, 'scripts', 'generate-docs.ts'),
      `
import fs from 'fs';
import path from 'path';
const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'schema.json'), 'utf8'));
fs.writeFileSync(
  path.join(process.cwd(), 'ARCHITECTURE.md'),
  '# Architecture\\n\\nSchema version: ' + schema.version + '\\n'
);
`
    );

    // Shim npx so lint-staged delegates to real lint-staged (or fast failure override) and tsx runs real tsx
    const npxShim = path.join(binDir, 'npx');
    fs.writeFileSync(
      npxShim,
      `#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'lint-staged') {
  fs.appendFileSync(${JSON.stringify(logFile)}, 'npx:lint-staged\\n');
  if (process.env.MOCK_LINT_STAGED_FAIL === '1') {
    console.error('ESLint error in staged file');
    process.exit(1);
  }
  if (process.env.USE_REAL_LINT_STAGED === '1') {
    const res = spawnSync(process.execPath, [${JSON.stringify(LINT_STAGED_CLI_PATH)}, ...args.slice(1)], {
      stdio: 'inherit',
      env: process.env,
    });
    process.exit(res.status ?? 1);
  }
  process.exit(0);
}
if (args[0] === 'tsx') {
  const res = spawnSync(process.execPath, [${JSON.stringify(TSX_CLI_PATH)}, ...args.slice(1)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(res.status ?? 1);
}
process.exit(0);
`
    );
    fs.chmodSync(npxShim, 0o755);

    // Shim npm so check:doc-sync runs the real verify-doc-sync.ts and checks record execution
    const npmShim = path.join(binDir, 'npm');
    fs.writeFileSync(
      npmShim,
      `#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'run' && args[1]) {
  const scriptName = args[1];
  fs.appendFileSync(${JSON.stringify(logFile)}, 'npm:' + scriptName + '\\n');
  if (process.env.FAIL_CHECK_SCRIPT === scriptName) {
    process.exit(1);
  }
  if (scriptName === 'check:doc-sync') {
    const res = spawnSync(
      process.execPath,
      [${JSON.stringify(TSX_CLI_PATH)}, ${JSON.stringify(VERIFY_DOC_SYNC_PATH)}],
      { stdio: 'inherit', env: process.env }
    );
    process.exit(res.status ?? 1);
  }
  process.exit(0);
}
process.exit(0);
`
    );
    fs.chmodSync(npmShim, 0o755);

    // Initialize temporary git repository with synchronized baseline docs
    execSync('git init -b main', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name "Test Runner"', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'ignore' });

    fs.writeFileSync(
      path.join(tempDir, '.gitignore'),
      '.test-bin/\n.executed-checks.log\n.lint-task.cjs\n'
    );
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'hook-test-fixture',
          private: true,
          'lint-staged': {
            '*.ts': `node ${path.join(tempDir, '.lint-task.cjs')}`,
          },
        },
        null,
        2
      ) + '\n'
    );
    fs.writeFileSync(
      path.join(tempDir, '.lint-task.cjs'),
      `const fs = require('fs');
const path = require('path');
const concurrentPath = path.join(process.cwd(), 'notes.txt');
if (process.env.SIMULATE_CONCURRENT_SAVE === '1') {
  fs.writeFileSync(concurrentPath, 'concurrent editor save during commit\\n');
}
for (const file of process.argv.slice(2)) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('LINT_ERROR_TOKEN')) {
    console.error('Lint error in ' + file);
    process.exit(1);
  }
}
`
    );
    fs.writeFileSync(path.join(tempDir, 'schema.json'), JSON.stringify({ version: '1.0.0' }) + '\n');
    fs.writeFileSync(
      path.join(tempDir, 'public', 'openapi.json'),
      JSON.stringify({ openapi: '3.0.3', version: '1.0.0' }, null, 2) + '\n'
    );
    fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Architecture\n\nSchema version: 1.0.0\n');
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'initial notes\n');
    fs.writeFileSync(
      path.join(tempDir, 'partial.ts'),
      ['export const alpha = 1;', 'export const beta = 2;', ''].join('\n')
    );

    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Initial synchronized commit"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runHook(hookPath: string, extraEnv: Record<string, string> = {}) {
    return spawnSync(process.execPath, [hookPath], {
      cwd: tempDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        ...extraEnv,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });
  }

  describe('.githooks/pre-commit', () => {
    it('removes stash helpers and forbids git stash, git reset, and git checkout -- .', () => {
      const hookContent = fs.readFileSync(PRE_COMMIT_PATH, 'utf-8');
      expect(hookContent).toContain('lint-staged');
      expect(hookContent).not.toContain('hasUnstagedChanges');
      expect(hookContent).not.toContain('pushStash');
      expect(hookContent).not.toContain('popStash');
      expect(hookContent).not.toMatch(/\bgit\s+stash\b|['"]stash['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+reset\b|['"]reset['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+checkout\b|['"]checkout['"]/);
      expect(hookContent).not.toContain("'npm'");
    });

    it('runs only npx lint-staged and exits non-zero on ESLint errors', () => {
      fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'staged change\n');
      execSync('git add notes.txt', { cwd: tempDir, stdio: 'ignore' });

      const passResult = runHook(PRE_COMMIT_PATH);
      expect(passResult.status).toBe(0);
      expect(passResult.stdout).toContain('All pre-commit checks passed.');

      const executed = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      expect(executed).toEqual(['npx:lint-staged']);

      const failResult = runHook(PRE_COMMIT_PATH, { MOCK_LINT_STAGED_FAIL: '1' });
      expect(failResult.status).not.toBe(0);
      expect(`${failResult.stdout}\n${failResult.stderr}`).toContain(
        'Pre-commit check failed: ESLint / lint-staged validation failed.'
      );
    });

    it('preserves MM partial staging, ?? untracked files, and concurrent saves with zero UU conflicts', () => {
      // Add untracked scratch file -> '?? scratch-untracked.ts' and unstaged file -> ' M unstaged.txt'
      fs.writeFileSync(path.join(tempDir, 'scratch-untracked.ts'), 'export const scratch = true;\n');
      fs.writeFileSync(path.join(tempDir, 'unstaged.txt'), 'initial unstaged baseline\n');
      execSync('git add unstaged.txt && git commit -m "Add unstaged baseline"', {
        cwd: tempDir,
        stdio: 'ignore',
      });
      // Re-stage hunk 1 on partial.ts and add unstaged hunk 2 -> 'MM partial.ts'
      fs.writeFileSync(
        path.join(tempDir, 'partial.ts'),
        ['export const alpha = 10;', 'export const beta = 2;', ''].join('\n')
      );
      execSync('git add partial.ts', { cwd: tempDir, stdio: 'ignore' });
      fs.writeFileSync(
        path.join(tempDir, 'partial.ts'),
        ['export const alpha = 10;', 'export const beta = 20;', 'export const gamma = 30;', ''].join('\n')
      );
      fs.writeFileSync(path.join(tempDir, 'unstaged.txt'), 'unstaged local edit\n');

      const statusBefore = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
      expect(statusBefore).toContain('MM partial.ts');
      expect(statusBefore).toContain(' M unstaged.txt');
      expect(statusBefore).toContain('?? scratch-untracked.ts');

      const result = runHook(PRE_COMMIT_PATH, {
        USE_REAL_LINT_STAGED: '1',
        SIMULATE_CONCURRENT_SAVE: '1',
      });
      expect(result.status).toBe(0);

      const statusAfter = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
      expect(statusAfter).not.toContain('UU');
      expect(statusAfter).toContain('MM partial.ts');
      expect(statusAfter).toContain(' M unstaged.txt');
      expect(statusAfter).toContain('?? scratch-untracked.ts');

      expect(fs.readFileSync(path.join(tempDir, 'partial.ts'), 'utf-8')).toBe(
        ['export const alpha = 10;', 'export const beta = 20;', 'export const gamma = 30;', ''].join('\n')
      );
      expect(fs.readFileSync(path.join(tempDir, 'unstaged.txt'), 'utf-8')).toBe(
        'unstaged local edit\n'
      );
      expect(fs.readFileSync(path.join(tempDir, 'scratch-untracked.ts'), 'utf-8')).toBe(
        'export const scratch = true;\n'
      );
      expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe(
        'concurrent editor save during commit\n'
      );

      const stagedPartial = execSync('git show :partial.ts', { cwd: tempDir, encoding: 'utf-8' });
      expect(stagedPartial).toBe(['export const alpha = 10;', 'export const beta = 2;', ''].join('\n'));

      const stashList = execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim();
      expect(stashList).toBe('');
    });
  });

  describe('.githooks/pre-push', () => {
    it('registers type-check, lint:unused, and all 10 check:static scripts without destructive git commands', () => {
      const hookContent = fs.readFileSync(PRE_PUSH_PATH, 'utf-8');
      expect(hookContent).toContain("{ name: 'Documentation synchronization check', script: 'check:doc-sync' }");
      expect(hookContent).not.toMatch(/\bgit\s+stash\b|['"]stash['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+reset\b|['"]reset['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+checkout\b|['"]checkout['"]/);
    });

    it('passes when documentation is synchronized and executes all twelve workspace checks in order', () => {
      const result = runHook(PRE_PUSH_PATH);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Running Documentation synchronization check...');
      expect(result.stdout).toContain('All pre-push checks passed.');

      const executed = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      expect(executed).toEqual([
        'npm:type-check',
        'npm:lint:unused',
        'npm:check:env-docs',
        'npm:check:runbooks',
        'npm:check:setup-guides',
        'npm:check:identifiers',
        'npm:check:action-pins',
        'npm:check:links',
        'npm:check:spec-contracts',
        'npm:check:prisma',
        'npm:lint:migrations',
        'npm:check:doc-sync',
      ]);
    });

    it('rejects push on schema documentation drift while keeping regenerated docs intact on disk', () => {
      // Commit a schema change without regenerating docs
      fs.writeFileSync(path.join(tempDir, 'schema.json'), JSON.stringify({ version: '2.0.0' }) + '\n');
      execSync('git add schema.json', { cwd: tempDir, stdio: 'ignore' });
      execSync('git commit -m "Update schema without docs"', { cwd: tempDir, stdio: 'ignore' });

      // Keep an unrelated unstaged file and untracked file in workspace
      fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged work in progress\n');
      fs.writeFileSync(path.join(tempDir, 'scratch.txt'), 'untracked note\n');

      const result = runHook(PRE_PUSH_PATH);
      const combinedOutput = `${result.stdout}\n${result.stderr}`;

      expect(result.status).not.toBe(0);
      expect(combinedOutput).toContain('Documentation Drift Detected!');
      expect(combinedOutput).toContain('ACTIONABLE REMEDIATION:');
      expect(combinedOutput).toContain(
        'Pre-push check failed: Documentation synchronization check failed.'
      );

      // Regenerated documentation stays on disk ready to be staged and committed
      expect(fs.readFileSync(path.join(tempDir, 'public', 'openapi.json'), 'utf-8')).toBe(
        JSON.stringify({ openapi: '3.0.3', version: '2.0.0' }, null, 2) + '\n'
      );
      expect(fs.readFileSync(path.join(tempDir, 'ARCHITECTURE.md'), 'utf-8')).toBe(
        '# Architecture\n\nSchema version: 2.0.0\n'
      );

      // Unrelated edits and untracked files remain untouched with zero stash entries
      expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe(
        'unstaged work in progress\n'
      );
      expect(fs.readFileSync(path.join(tempDir, 'scratch.txt'), 'utf-8')).toBe('untracked note\n');
      expect(execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim()).toBe('');
    });

    it('stops immediately and exits non-zero when an earlier workspace check fails', () => {
      const result = runHook(PRE_PUSH_PATH, { FAIL_CHECK_SCRIPT: 'lint:unused' });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'Pre-push check failed: Knip dead-code analysis failed.'
      );

      const executed = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      expect(executed).toEqual(['npm:type-check', 'npm:lint:unused']);
    });
  });

  describe('Hook installer and incremental TypeScript configuration', () => {
    it('configures core.hooksPath and 0o755 executable permissions on both hooks outside CI', () => {
      const hookDir = path.join(tempDir, '.githooks');
      const scriptsDir = path.join(tempDir, 'scripts');
      fs.mkdirSync(hookDir, { recursive: true });
      fs.mkdirSync(scriptsDir, { recursive: true });
      fs.copyFileSync(PRE_COMMIT_PATH, path.join(hookDir, 'pre-commit'));
      fs.copyFileSync(PRE_PUSH_PATH, path.join(hookDir, 'pre-push'));
      fs.chmodSync(path.join(hookDir, 'pre-commit'), 0o644);
      fs.chmodSync(path.join(hookDir, 'pre-push'), 0o644);
      fs.copyFileSync(INSTALL_HOOKS_PATH, path.join(scriptsDir, 'install-git-hooks.mjs'));

      const envWithoutCi = { ...process.env };
      delete envWithoutCi.CI;
      delete envWithoutCi.CONTINUOUS_INTEGRATION;

      const res = spawnSync(process.execPath, [path.join(scriptsDir, 'install-git-hooks.mjs')], {
        cwd: tempDir,
        encoding: 'utf-8',
        env: envWithoutCi,
      });
      expect(res.status).toBe(0);

      const hooksPath = execSync('git config core.hooksPath', { cwd: tempDir, encoding: 'utf-8' }).trim();
      expect(hooksPath).toBe('.githooks');

      if (process.platform !== 'win32') {
        const preCommitMode = fs.statSync(path.join(hookDir, 'pre-commit')).mode & 0o777;
        const prePushMode = fs.statSync(path.join(hookDir, 'pre-push')).mode & 0o777;
        expect(preCommitMode).toBe(0o755);
        expect(prePushMode).toBe(0o755);
      }
    });

    it('enables incremental caching with distinct tsBuildInfoFile paths across TypeScript suites', () => {
      const rootTsconfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.json'), 'utf-8'));
      const testTsconfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.test.json'), 'utf-8'));
      const e2eTsconfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.e2e.json'), 'utf-8'));
      const scriptsTsconfig = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.scripts.json'), 'utf-8')
      );
      const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf-8');

      expect(rootTsconfig.compilerOptions.incremental).toBe(true);
      expect(testTsconfig.compilerOptions.incremental).toBe(true);
      expect(e2eTsconfig.compilerOptions.incremental).toBe(true);
      expect(scriptsTsconfig.compilerOptions.incremental).toBe(true);

      const buildInfoFiles = [
        rootTsconfig.compilerOptions.tsBuildInfoFile ?? './tsconfig.tsbuildinfo',
        testTsconfig.compilerOptions.tsBuildInfoFile,
        e2eTsconfig.compilerOptions.tsBuildInfoFile,
        scriptsTsconfig.compilerOptions.tsBuildInfoFile,
      ];
      expect(buildInfoFiles.every((entry) => typeof entry === 'string' && entry.endsWith('.tsbuildinfo'))).toBe(
        true
      );
      expect(new Set(buildInfoFiles.map((entry) => path.normalize(entry))).size).toBe(4);
      expect(gitignore).toContain('*.tsbuildinfo');
    });
  });
});
