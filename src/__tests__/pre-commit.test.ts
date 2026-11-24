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
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');
const ZERO_SHA = '0'.repeat(40);

describe('Split Git hooks (.githooks/pre-commit and .githooks/pre-push)', () => {
  let tempDir: string;
  let binDir: string;
  let logFile: string;
  let cwdLogFile: string;
  let worktreeProbeFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-hooks-split-'));
    binDir = path.join(tempDir, '.test-bin');
    logFile = path.join(tempDir, '.executed-checks.log');
    cwdLogFile = path.join(tempDir, '.executed-cwds.log');
    worktreeProbeFile = path.join(tempDir, '.worktree-probe.json');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'scripts'), { recursive: true });

    // Create stub generators used by verify-doc-sync in the isolated repo (supporting --check)
    fs.writeFileSync(
      path.join(tempDir, 'scripts', 'generate-openapi.ts'),
      `
import fs from 'fs';
import path from 'path';
const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'schema.json'), 'utf8'));
const outputPath = path.join(process.cwd(), 'public', 'openapi.json');
const expected = JSON.stringify({ openapi: '3.0.3', version: schema.version }, null, 2) + '\\n';
if (process.argv.includes('--check')) {
  const existing = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8') : null;
  if (existing !== expected) {
    console.error('Drift detected in public/openapi.json');
    process.exit(1);
  }
  process.exit(0);
}
fs.writeFileSync(outputPath, expected);
`
    );

    fs.writeFileSync(
      path.join(tempDir, 'scripts', 'generate-docs.ts'),
      `
import fs from 'fs';
import path from 'path';
const schema = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'schema.json'), 'utf8'));
const archPath = path.join(process.cwd(), 'ARCHITECTURE.md');
const featurePath = path.join(process.cwd(), 'FEATURE_MODULES.md');
const expectedArch = '# Architecture\\n\\nSchema version: ' + schema.version + '\\n';
const expectedFeatures = '# Feature Modules\\n\\nSchema version: ' + schema.version + '\\n';
if (process.argv.includes('--check')) {
  let drifted = false;
  const existingArch = fs.existsSync(archPath) ? fs.readFileSync(archPath, 'utf8') : null;
  if (existingArch !== expectedArch) {
    console.error('Drift detected in ARCHITECTURE.md');
    drifted = true;
  }
  const existingFeatures = fs.existsSync(featurePath) ? fs.readFileSync(featurePath, 'utf8') : null;
  if (existingFeatures !== expectedFeatures) {
    console.error('Drift detected in FEATURE_MODULES.md');
    drifted = true;
  }
  process.exit(drifted ? 1 : 0);
}
fs.writeFileSync(archPath, expectedArch);
fs.writeFileSync(featurePath, expectedFeatures);
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

    // Shim npm so check:doc-sync runs real verify-doc-sync.ts and checks record execution + worktree state
    const npmShim = path.join(binDir, 'npm');
    fs.writeFileSync(
      npmShim,
      `#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[0] === 'run' && args[1]) {
  const scriptName = args[1];
  const cwd = process.cwd();
  fs.appendFileSync(${JSON.stringify(logFile)}, 'npm:' + scriptName + '\\n');
  fs.appendFileSync(${JSON.stringify(cwdLogFile)}, scriptName + ':' + fs.realpathSync(cwd) + '\\n');

  if (!fs.existsSync(${JSON.stringify(worktreeProbeFile)})) {
    const nmPath = path.join(cwd, 'node_modules');
    fs.writeFileSync(
      ${JSON.stringify(worktreeProbeFile)},
      JSON.stringify({
        cwd: fs.realpathSync(cwd),
        hasNodeModulesSymlink: fs.existsSync(nmPath) && fs.lstatSync(nmPath).isSymbolicLink(),
        hasEslintCache: fs.existsSync(path.join(cwd, '.eslintcache')),
        hasBuildInfo: fs.existsSync(path.join(cwd, 'tsconfig.build.tsbuildinfo')),
        gitDirEnv: process.env.GIT_DIR ?? null,
      })
    );
  }

  if (process.env.FAIL_CHECK_SCRIPT === scriptName) {
    process.exit(1);
  }
  if (scriptName === 'type-check' && fs.existsSync(path.join(cwd, 'partial.ts'))) {
    const content = fs.readFileSync(path.join(cwd, 'partial.ts'), 'utf8');
    if (content.includes('TS_ERROR_TOKEN')) {
      console.error('TypeScript error in partial.ts');
      process.exit(1);
    }
  }
  if (scriptName === 'lint' && fs.existsSync(path.join(cwd, 'partial.ts'))) {
    const content = fs.readFileSync(path.join(cwd, 'partial.ts'), 'utf8');
    if (content.includes('ESLINT_ERROR_TOKEN')) {
      console.error('ESLint error in partial.ts');
      process.exit(1);
    }
  }
  if (scriptName === 'check:doc-sync') {
    const res = spawnSync(
      process.execPath,
      [${JSON.stringify(TSX_CLI_PATH)}, ${JSON.stringify(VERIFY_DOC_SYNC_PATH)}],
      { cwd, stdio: 'inherit', env: process.env }
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
      '.test-bin/\n.executed-checks.log\n.executed-cwds.log\n.worktree-probe.json\n.lint-task.cjs\nnode_modules\n*.tsbuildinfo\n.eslintcache\n'
    );
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify(
        {
          name: 'hook-test-fixture',
          private: true,
          'lint-staged': {
            '*.{js,jsx,ts,tsx,mjs,cjs}': `node ${path.join(tempDir, '.lint-task.cjs')}`,
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
  if (!fs.existsSync(file)) {
    continue;
  }
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
    fs.writeFileSync(path.join(tempDir, 'FEATURE_MODULES.md'), '# Feature Modules\n\nSchema version: 1.0.0\n');
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

  function runHook(
    hookPath: string,
    extraEnv: Record<string, string> = {},
    options: { stdin?: string; args?: string[] } = {}
  ) {
    let input = options.stdin;
    if (input === undefined && hookPath === PRE_PUSH_PATH) {
      const headSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
      input = `refs/heads/main ${headSha} refs/heads/main ${ZERO_SHA}\n`;
    }
    return spawnSync(process.execPath, [hookPath, ...(options.args ?? [])], {
      cwd: tempDir,
      encoding: 'utf-8',
      input,
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
      fs.writeFileSync(path.join(tempDir, 'scratch-untracked.ts'), 'export const scratch = true;\n');
      fs.writeFileSync(path.join(tempDir, 'unstaged.txt'), 'initial unstaged baseline\n');
      execSync('git add unstaged.txt && git commit -m "Add unstaged baseline"', {
        cwd: tempDir,
        stdio: 'ignore',
      });
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

    it('preserves AM, MD, RM, same-line MM, binary unstaged edits, nested untracked files, pre-existing git stash entries, and MERGE_HEAD', () => {
      fs.writeFileSync(path.join(tempDir, 'delete-later.mjs'), 'export const del = 1;\n');
      fs.writeFileSync(path.join(tempDir, 'rename-old.mjs'), 'export const renamed = 1;\n');
      fs.writeFileSync(path.join(tempDir, 'binary.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
      execSync('git add . && git commit -m "Add baseline edge-case fixtures"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'user stashed wip\n');
      execSync('git stash push -m "existing-user-stash"', { cwd: tempDir, stdio: 'ignore' });
      const headSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
      fs.writeFileSync(path.join(tempDir, '.git', 'MERGE_HEAD'), `${headSha}\n`);

      fs.writeFileSync(path.join(tempDir, 'partial.ts'), 'export const alpha = 100;\n');
      execSync('git add partial.ts', { cwd: tempDir, stdio: 'ignore' });
      fs.writeFileSync(
        path.join(tempDir, 'partial.ts'),
        'export const alpha = 200;\nexport const beta = 300;\n'
      );

      fs.writeFileSync(path.join(tempDir, 'added.cjs'), "const p = require('path');\nmodule.exports = p;\n");
      execSync('git add added.cjs', { cwd: tempDir, stdio: 'ignore' });
      fs.writeFileSync(
        path.join(tempDir, 'added.cjs'),
        "const p = require('path');\nmodule.exports = { p };\n"
      );

      fs.writeFileSync(path.join(tempDir, 'delete-later.mjs'), 'export const del = 2;\n');
      execSync('git add delete-later.mjs', { cwd: tempDir, stdio: 'ignore' });
      fs.unlinkSync(path.join(tempDir, 'delete-later.mjs'));

      execSync('git mv rename-old.mjs rename-new.mjs', { cwd: tempDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(tempDir, 'rename-new.mjs'), 'export const renamed = 3;\n');

      const unstagedBinary = Buffer.from([0x00, 0xff, 0x10, 0x20, 0x30]);
      fs.writeFileSync(path.join(tempDir, 'binary.dat'), unstagedBinary);
      fs.mkdirSync(path.join(tempDir, 'drafts', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'drafts', 'nested', 'wip.txt'), 'untracked draft\n');

      const statusBefore = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });

      const result = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(result.status).toBe(0);

      const statusAfter = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
      expect(statusAfter).not.toContain('UU');
      expect(statusAfter).toBe(statusBefore);
      expect(fs.readFileSync(path.join(tempDir, 'partial.ts'), 'utf-8')).toBe(
        'export const alpha = 200;\nexport const beta = 300;\n'
      );
      expect(fs.readFileSync(path.join(tempDir, 'added.cjs'), 'utf-8')).toBe(
        "const p = require('path');\nmodule.exports = { p };\n"
      );
      expect(fs.existsSync(path.join(tempDir, 'delete-later.mjs'))).toBe(false);
      expect(fs.readFileSync(path.join(tempDir, 'rename-new.mjs'), 'utf-8')).toBe(
        'export const renamed = 3;\n'
      );
      expect(Buffer.compare(fs.readFileSync(path.join(tempDir, 'binary.dat')), unstagedBinary)).toBe(0);
      expect(fs.readFileSync(path.join(tempDir, 'drafts', 'nested', 'wip.txt'), 'utf-8')).toBe(
        'untracked draft\n'
      );

      const stashList = execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim();
      expect(stashList).toContain('existing-user-stash');
      expect(fs.readFileSync(path.join(tempDir, '.git', 'MERGE_HEAD'), 'utf-8')).toBe(`${headSha}\n`);
    });

    it('configures lint-staged with --cache and --no-warn-ignored so ignored tracked files pass while staged lint errors fail', () => {
      const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
        'lint-staged'?: Record<string, string>;
      };
      expect(pkg['lint-staged']).toEqual({
        '*.{js,jsx,ts,tsx,mjs,cjs}':
          'eslint --cache --cache-location .eslintcache --no-warn-ignored --fix --max-warnings=0',
      });

      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(
          { name: 'temp-lint-test', private: true, 'lint-staged': pkg['lint-staged'] },
          null,
          2
        ) + '\n'
      );
      fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));
      fs.symlinkSync(path.join(REPO_ROOT, 'eslint.config.mjs'), path.join(tempDir, 'eslint.config.mjs'));
      fs.symlinkSync(path.join(REPO_ROOT, 'eslint-rules'), path.join(tempDir, 'eslint-rules'));
      fs.writeFileSync(
        path.join(tempDir, '.gitignore'),
        '.test-bin/\n.executed-checks.log\n.executed-cwds.log\n.worktree-probe.json\n.lint-task.cjs\nnode_modules\neslint.config.mjs\neslint-rules\n.eslintcache\n'
      );
      execSync('git add package.json .gitignore && git commit -m "Configure real ESLint lint-staged"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      // 1. Staged .mjs with disallowed require() must fail lint-staged
      fs.writeFileSync(path.join(tempDir, 'bad-script.mjs'), "const fs = require('fs');\nexport default fs;\n");
      execSync('git add bad-script.mjs', { cwd: tempDir, stdio: 'ignore' });

      const failResult = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      const failOutput = `${failResult.stdout}\n${failResult.stderr}`;
      expect(failResult.status).not.toBe(0);
      expect(failOutput).toContain('Pre-commit check failed: ESLint / lint-staged validation failed.');
      execSync('git rm -f bad-script.mjs', { cwd: tempDir, stdio: 'ignore' });

      // 2. Staging ESLint-ignored tracked files alongside auto-fixable files must pass with exit code 0 and populate .eslintcache
      fs.mkdirSync(path.join(tempDir, 'docs-portal', '.vitepress', 'theme'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'docker', 'prisma-cli', 'stubs', 'empty'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'public', 'mockServiceWorker.js'), '/* eslint-ignored msw */\nvar x = "ignored"\n');
      fs.writeFileSync(
        path.join(tempDir, 'docs-portal', '.vitepress', 'theme', 'index.ts'),
        'export const portalTheme: any = "ignored"\n'
      );
      fs.writeFileSync(
        path.join(tempDir, 'docker', 'prisma-cli', 'stubs', 'empty', 'index.cjs'),
        'module.exports = {}\n'
      );
      fs.writeFileSync(path.join(tempDir, 'helper.mjs'), 'export const greeting = "hello"\n');
      fs.writeFileSync(
        path.join(tempDir, 'env-shim.cjs'),
        'const path = require("path")\nmodule.exports = path\n'
      );
      execSync(
        'git add public/mockServiceWorker.js docs-portal/.vitepress/theme/index.ts docker/prisma-cli/stubs/empty/index.cjs helper.mjs env-shim.cjs',
        { cwd: tempDir, stdio: 'ignore' }
      );

      const passResult = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(passResult.status).toBe(0);
      expect(passResult.stdout).toContain('All pre-commit checks passed.');
      expect(fs.existsSync(path.join(tempDir, '.eslintcache'))).toBe(true);
      expect(fs.readFileSync(path.join(tempDir, 'helper.mjs'), 'utf-8')).toBe(
        "export const greeting = 'hello';\n"
      );
      expect(fs.readFileSync(path.join(tempDir, 'env-shim.cjs'), 'utf-8')).toBe(
        "const path = require('path');\nmodule.exports = path;\n"
      );
    });
  });

  describe('.githooks/pre-push', () => {
    it('registers type-check, lint, lint:unused, check:audit, and all 10 check:static scripts without destructive git commands', () => {
      const hookContent = fs.readFileSync(PRE_PUSH_PATH, 'utf-8');
      expect(hookContent).toContain("{ name: 'ESLint code linting', script: 'lint' }");
      expect(hookContent).toContain("{ name: 'Security dependency audit', script: 'check:audit' }");
      expect(hookContent).toContain("{ name: 'Documentation synchronization check', script: 'check:doc-sync' }");
      expect(hookContent).toContain('worktree');
      expect(hookContent).not.toMatch(/\bgit\s+stash\b|['"]stash['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+reset\b|['"]reset['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+checkout\b|['"]checkout['"]/);
    });

    it('passes in place when HEAD and tracked files match the pushed commit, executing all thirteen standard checks in order', () => {
      const result = runHook(PRE_PUSH_PATH);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Running Documentation synchronization check...');
      expect(result.stdout).toContain('All pre-push checks passed.');
      expect(result.stdout).not.toContain('ephemeral Git worktree');

      const executed = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      expect(executed).toEqual([
        'npm:type-check',
        'npm:lint',
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

      const probe = JSON.parse(fs.readFileSync(worktreeProbeFile, 'utf-8')) as { cwd: string };
      expect(probe.cwd).toBe(fs.realpathSync(tempDir));
    });

    it('exits 0 immediately on branch deletions, matching remote SHAs, or empty stdin even when unstaged errors exist', () => {
      const headSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
      fs.writeFileSync(path.join(tempDir, 'partial.ts'), 'export const broken = TS_ERROR_TOKEN;\n');

      const deleteResult = runHook(
        PRE_PUSH_PATH,
        {},
        { stdin: `(delete) ${ZERO_SHA} refs/heads/old-branch ${headSha}\n` }
      );
      expect(deleteResult.status).toBe(0);
      expect(fs.existsSync(logFile)).toBe(false);

      const sameShaResult = runHook(
        PRE_PUSH_PATH,
        {},
        { stdin: `refs/heads/main ${headSha} refs/heads/main ${headSha}\n` }
      );
      expect(sameShaResult.status).toBe(0);
      expect(fs.existsSync(logFile)).toBe(false);

      const emptyStdinResult = runHook(PRE_PUSH_PATH, {}, { stdin: '' });
      expect(emptyStdinResult.status).toBe(0);
      expect(fs.existsSync(logFile)).toBe(false);

      expect(fs.readFileSync(path.join(tempDir, 'partial.ts'), 'utf-8')).toBe(
        'export const broken = TS_ERROR_TOKEN;\n'
      );
    });

    it('verifies clean pushed commits in an ephemeral detached worktree when unstaged errors exist on disk, hydrating caches and cleaning up', () => {
      // Seed node_modules, .eslintcache, and tsconfig.build.tsbuildinfo in tempDir
      fs.mkdirSync(path.join(tempDir, 'node_modules', '.marker'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, '.eslintcache'), 'cached-eslint-state');
      fs.writeFileSync(path.join(tempDir, 'tsconfig.build.tsbuildinfo'), 'cached-tsbuildinfo-state');

      // Introduce unstaged TypeScript & ESLint errors in the working tree while HEAD remains clean
      const dirtyEdit = 'export const dirty = TS_ERROR_TOKEN + ESLINT_ERROR_TOKEN;\n';
      fs.writeFileSync(path.join(tempDir, 'partial.ts'), dirtyEdit);

      const result = runHook(PRE_PUSH_PATH, { GIT_DIR: path.join(tempDir, '.git') });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ephemeral Git worktree');
      expect(result.stdout).toContain('All pre-push checks passed.');

      const probe = JSON.parse(fs.readFileSync(worktreeProbeFile, 'utf-8')) as {
        cwd: string;
        hasNodeModulesSymlink: boolean;
        hasEslintCache: boolean;
        hasBuildInfo: boolean;
        gitDirEnv: string | null;
      };
      expect(probe.cwd).not.toBe(fs.realpathSync(tempDir));
      expect(probe.hasNodeModulesSymlink).toBe(true);
      expect(probe.hasEslintCache).toBe(true);
      expect(probe.hasBuildInfo).toBe(true);
      expect(probe.gitDirEnv).toBeNull();

      // Ephemeral worktree must be removed and pruned after completion
      expect(fs.existsSync(probe.cwd)).toBe(false);
      const worktreeList = execSync('git worktree list', { cwd: tempDir, encoding: 'utf-8' })
        .trim()
        .split(/\r?\n/);
      expect(worktreeList).toHaveLength(1);

      // Unstaged working tree edits remain untouched
      expect(fs.readFileSync(path.join(tempDir, 'partial.ts'), 'utf-8')).toBe(dirtyEdit);
    });

    it('rejects a broken pushed commit in an ephemeral worktree even when unstaged edits fix the error on disk', () => {
      // Commit a TypeScript/ESLint defect
      fs.writeFileSync(path.join(tempDir, 'partial.ts'), 'export const bad = ESLINT_ERROR_TOKEN;\n');
      execSync('git add partial.ts && git commit -m "Broken commit"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      // Fix the defect ONLY as an unstaged edit on disk
      const unstagedFix = 'export const fixed = 42;\n';
      fs.writeFileSync(path.join(tempDir, 'partial.ts'), unstagedFix);

      const result = runHook(PRE_PUSH_PATH);
      const combined = `${result.stdout}\n${result.stderr}`;
      expect(result.status).not.toBe(0);
      expect(combined).toContain('ephemeral Git worktree');
      expect(combined).toContain('Pre-push check failed: ESLint code linting failed.');

      const probe = JSON.parse(fs.readFileSync(worktreeProbeFile, 'utf-8')) as { cwd: string };
      expect(fs.existsSync(probe.cwd)).toBe(false);
      expect(fs.readFileSync(path.join(tempDir, 'partial.ts'), 'utf-8')).toBe(unstagedFix);
    });

    it('runs check:audit only when pushed commits modify package-lock.json or docker/prisma-cli/package-lock.json', () => {
      const baseSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();

      // 1. Commit touching root package-lock.json
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{"lockfileVersion": 3}\n');
      execSync('git add package-lock.json && git commit -m "Update root lockfile"', {
        cwd: tempDir,
        stdio: 'ignore',
      });
      const rootLockSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();

      const rootLockResult = runHook(
        PRE_PUSH_PATH,
        {},
        { stdin: `refs/heads/main ${rootLockSha} refs/heads/main ${baseSha}\n` }
      );
      expect(rootLockResult.status).toBe(0);
      expect(fs.readFileSync(logFile, 'utf-8').trim().split('\n')).toContain('npm:check:audit');

      // 2. Subsequent commit touching docker/prisma-cli/package-lock.json
      fs.unlinkSync(logFile);
      fs.mkdirSync(path.join(tempDir, 'docker', 'prisma-cli'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'docker', 'prisma-cli', 'package-lock.json'),
        '{"lockfileVersion": 3}\n'
      );
      execSync('git add docker/prisma-cli/package-lock.json && git commit -m "Update prisma-cli lockfile"', {
        cwd: tempDir,
        stdio: 'ignore',
      });
      const prismaLockSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();

      const prismaLockResult = runHook(
        PRE_PUSH_PATH,
        {},
        { stdin: `refs/heads/main ${prismaLockSha} refs/heads/main ${rootLockSha}\n` }
      );
      expect(prismaLockResult.status).toBe(0);
      expect(fs.readFileSync(logFile, 'utf-8').trim().split('\n')).toContain('npm:check:audit');

      // 3. Subsequent commit NOT touching lockfiles skips check:audit
      fs.unlinkSync(logFile);
      fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'no lockfile change\n');
      execSync('git add notes.txt && git commit -m "Docs note"', {
        cwd: tempDir,
        stdio: 'ignore',
      });
      const notesSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();

      const noLockResult = runHook(
        PRE_PUSH_PATH,
        {},
        { stdin: `refs/heads/main ${notesSha} refs/heads/main ${prismaLockSha}\n` }
      );
      expect(noLockResult.status).toBe(0);
      expect(fs.readFileSync(logFile, 'utf-8').trim().split('\n')).not.toContain('npm:check:audit');
    });

    it('rejects push on schema documentation drift without modifying tracked documentation files on disk', () => {
      const originalOpenApi = fs.readFileSync(path.join(tempDir, 'public', 'openapi.json'), 'utf-8');
      const originalArch = fs.readFileSync(path.join(tempDir, 'ARCHITECTURE.md'), 'utf-8');
      const originalFeatures = fs.readFileSync(path.join(tempDir, 'FEATURE_MODULES.md'), 'utf-8');

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

      // Read-only --check leaves committed documentation files completely untouched on disk
      expect(fs.readFileSync(path.join(tempDir, 'public', 'openapi.json'), 'utf-8')).toBe(
        originalOpenApi
      );
      expect(fs.readFileSync(path.join(tempDir, 'ARCHITECTURE.md'), 'utf-8')).toBe(originalArch);
      expect(fs.readFileSync(path.join(tempDir, 'FEATURE_MODULES.md'), 'utf-8')).toBe(
        originalFeatures
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
      expect(executed).toEqual(['npm:type-check', 'npm:lint', 'npm:lint:unused']);
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

    it('enables incremental caching with distinct tsBuildInfoFile paths across all 5 TypeScript suites', () => {
      const rootTsconfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.json'), 'utf-8'));
      const buildTsconfig = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.build.json'), 'utf-8')
      );
      const testTsconfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.test.json'), 'utf-8'));
      const e2eTsconfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.e2e.json'), 'utf-8'));
      const scriptsTsconfig = JSON.parse(
        fs.readFileSync(path.join(REPO_ROOT, 'tsconfig.scripts.json'), 'utf-8')
      );
      const gitignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf-8');

      expect(rootTsconfig.compilerOptions.incremental).toBe(true);
      expect(buildTsconfig.compilerOptions.incremental).toBe(true);
      expect(testTsconfig.compilerOptions.incremental).toBe(true);
      expect(e2eTsconfig.compilerOptions.incremental).toBe(true);
      expect(scriptsTsconfig.compilerOptions.incremental).toBe(true);

      const buildInfoFiles = [
        rootTsconfig.compilerOptions.tsBuildInfoFile ?? './tsconfig.tsbuildinfo',
        buildTsconfig.compilerOptions.tsBuildInfoFile,
        testTsconfig.compilerOptions.tsBuildInfoFile,
        e2eTsconfig.compilerOptions.tsBuildInfoFile,
        scriptsTsconfig.compilerOptions.tsBuildInfoFile,
      ];
      expect(buildInfoFiles.every((entry) => typeof entry === 'string' && entry.endsWith('.tsbuildinfo'))).toBe(
        true
      );
      expect(new Set(buildInfoFiles.map((entry) => path.normalize(entry))).size).toBe(5);
      expect(gitignore).toContain('*.tsbuildinfo');
    });
  });
});
