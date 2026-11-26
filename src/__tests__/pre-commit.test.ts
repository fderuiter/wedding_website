import { execSync, spawn, spawnSync } from 'child_process';
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
    const eslintCachePath = path.join(cwd, '.eslintcache');
    try {
      fs.writeFileSync(
        ${JSON.stringify(worktreeProbeFile)},
        JSON.stringify({
          cwd: fs.realpathSync(cwd),
          hasNodeModulesSymlink: fs.existsSync(nmPath) && fs.lstatSync(nmPath).isSymbolicLink(),
          hasEslintCache: fs.existsSync(eslintCachePath),
          eslintCacheRaw: fs.existsSync(eslintCachePath) ? fs.readFileSync(eslintCachePath, 'utf8') : null,
          hasBuildInfo: fs.existsSync(path.join(cwd, 'tsconfig.build.tsbuildinfo')),
          hasNextEnv: fs.existsSync(path.join(cwd, 'next-env.d.ts')),
          hasNextTypes: fs.existsSync(path.join(cwd, '.next', 'types', 'routes.d.ts')),
          gitDirEnv: process.env.GIT_DIR ?? null,
        }),
        { flag: 'wx' }
      );
    } catch {
      // Another parallel worker wrote the probe first
    }
  }

  if (process.env.SLOW_CHECK_SCRIPT === scriptName) {
    const delayMs = Number(process.env.SLOW_CHECK_DELAY_MS || '4000');
    setTimeout(() => process.exit(0), delayMs);
    return;
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
      '.test-bin/\n.executed-checks.log\n.executed-cwds.log\n.worktree-probe.json\n.lint-task.cjs\nnode_modules\n*.tsbuildinfo\n.eslintcache\nnext-env.d.ts\n.next\n'
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
if (process.env.SNAPSHOT_MARKER_FILE) {
  fs.writeFileSync(process.env.SNAPSHOT_MARKER_FILE, fs.realpathSync(process.cwd()), 'utf8');
}
if (process.env.SIMULATE_CONCURRENT_SAVE === '1') {
  fs.writeFileSync(path.join(__dirname, 'notes.txt'), 'concurrent editor save during commit\\n');
  if (fs.existsSync(path.join(__dirname, 'unstaged.txt'))) {
    fs.writeFileSync(path.join(__dirname, 'unstaged.txt'), 'concurrent unstaged save during commit\\n');
  }
}
if (process.env.SLOW_LINT_TASK_MS) {
  setTimeout(() => process.exit(0), Number(process.env.SLOW_LINT_TASK_MS));
  return;
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
    it('removes stash helpers, enforces --no-stash/--no-revert snapshot flags, and forbids git stash, git reset, and git checkout -- .', () => {
      const hookContent = fs.readFileSync(PRE_COMMIT_PATH, 'utf-8');
      expect(hookContent).toContain('lint-staged');
      expect(hookContent).toContain('write-tree');
      expect(hookContent).toContain('hydrateWorktreeCaches');
      expect(hookContent).toContain('--no-stash');
      expect(hookContent).toContain('--no-revert');
      expect(hookContent).toContain('--no-hide-partially-staged');
      expect(hookContent).toContain('--diff=--staged');
      expect(hookContent).not.toContain('hasUnstagedChanges');
      expect(hookContent).not.toContain('pushStash');
      expect(hookContent).not.toContain('popStash');
      expect(hookContent).not.toMatch(/\bgit\s+stash\b|['"]stash['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+reset\b|['"]reset['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+checkout\b|['"]checkout['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+restore\b|['"]restore['"]/);
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

    it('preserves MM partial staging, ?? untracked files, and concurrent notes.txt + unstaged.txt saves across passing and failing runs without staging them', () => {
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

      const markerPath = path.join(tempDir, '.snapshot-cwd.txt');
      const passResult = runHook(PRE_COMMIT_PATH, {
        USE_REAL_LINT_STAGED: '1',
        SIMULATE_CONCURRENT_SAVE: '1',
        SNAPSHOT_MARKER_FILE: markerPath,
      });
      expect(passResult.status).toBe(0);

      const passSnapshotCwd = fs.readFileSync(markerPath, 'utf-8').trim();
      expect(passSnapshotCwd).not.toBe(fs.realpathSync(tempDir));
      expect(fs.existsSync(passSnapshotCwd)).toBe(false);
      fs.unlinkSync(markerPath);

      const statusAfterPass = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
      expect(statusAfterPass).not.toContain('UU');
      expect(statusAfterPass).toContain('MM partial.ts');
      expect(statusAfterPass).toContain(' M notes.txt');
      expect(statusAfterPass).toContain(' M unstaged.txt');
      expect(statusAfterPass).toContain('?? scratch-untracked.ts');

      expect(fs.readFileSync(path.join(tempDir, 'partial.ts'), 'utf-8')).toBe(
        ['export const alpha = 10;', 'export const beta = 20;', 'export const gamma = 30;', ''].join('\n')
      );
      expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe(
        'concurrent editor save during commit\n'
      );
      expect(fs.readFileSync(path.join(tempDir, 'unstaged.txt'), 'utf-8')).toBe(
        'concurrent unstaged save during commit\n'
      );
      expect(fs.readFileSync(path.join(tempDir, 'scratch-untracked.ts'), 'utf-8')).toBe(
        'export const scratch = true;\n'
      );

      expect(execSync('git show :partial.ts', { cwd: tempDir, encoding: 'utf-8' })).toBe(
        ['export const alpha = 10;', 'export const beta = 2;', ''].join('\n')
      );
      expect(execSync('git show :notes.txt', { cwd: tempDir, encoding: 'utf-8' })).toBe(
        'initial notes\n'
      );
      expect(execSync('git show :unstaged.txt', { cwd: tempDir, encoding: 'utf-8' })).toBe(
        'initial unstaged baseline\n'
      );
      expect(execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim()).toBe('');

      // Reset concurrent files to baseline before testing a FAILING pre-commit run with concurrent saves
      fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'initial notes\n');
      fs.writeFileSync(path.join(tempDir, 'unstaged.txt'), 'unstaged local edit\n');
      fs.writeFileSync(
        path.join(tempDir, 'partial.ts'),
        ['export const alpha = LINT_ERROR_TOKEN;', 'export const beta = 2;', ''].join('\n')
      );
      execSync('git add partial.ts', { cwd: tempDir, stdio: 'ignore' });
      fs.writeFileSync(
        path.join(tempDir, 'partial.ts'),
        ['export const alpha = LINT_ERROR_TOKEN;', 'export const beta = 20;', 'export const gamma = 30;', ''].join('\n')
      );

      const failResult = runHook(PRE_COMMIT_PATH, {
        USE_REAL_LINT_STAGED: '1',
        SIMULATE_CONCURRENT_SAVE: '1',
        SNAPSHOT_MARKER_FILE: markerPath,
      });
      expect(failResult.status).not.toBe(0);

      const failSnapshotCwd = fs.readFileSync(markerPath, 'utf-8').trim();
      expect(failSnapshotCwd).not.toBe(fs.realpathSync(tempDir));
      expect(fs.existsSync(failSnapshotCwd)).toBe(false);
      fs.unlinkSync(markerPath);

      const statusAfterFail = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
      expect(statusAfterFail).not.toContain('UU');
      expect(statusAfterFail).toContain('MM partial.ts');
      expect(statusAfterFail).toContain(' M notes.txt');
      expect(statusAfterFail).toContain(' M unstaged.txt');
      expect(statusAfterFail).toContain('?? scratch-untracked.ts');

      expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe(
        'concurrent editor save during commit\n'
      );
      expect(fs.readFileSync(path.join(tempDir, 'unstaged.txt'), 'utf-8')).toBe(
        'concurrent unstaged save during commit\n'
      );
      expect(execSync('git show :notes.txt', { cwd: tempDir, encoding: 'utf-8' })).toBe(
        'initial notes\n'
      );
      expect(execSync('git show :unstaged.txt', { cwd: tempDir, encoding: 'utf-8' })).toBe(
        'initial unstaged baseline\n'
      );
      expect(execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim()).toBe('');
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

    it('configures lint-staged with --cache, manifest routing, and snapshot isolation so unstaged/untracked drafts do not block clean commits while broken staged commits and MERGE_HEAD merges fail', () => {
      const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
        engines?: Record<string, string>;
        devEngines?: Record<string, unknown>;
        'lint-staged'?: Record<string, string>;
      };
      expect(pkg['lint-staged']).toEqual({
        '*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}':
          'eslint --cache --cache-location .eslintcache --no-warn-ignored --no-error-on-unmatched-pattern --fix --max-warnings=0',
        '.githooks/*':
          'eslint --cache --cache-location .eslintcache --no-warn-ignored --no-error-on-unmatched-pattern --fix --max-warnings=0',
        '.github/workflows/*.{yml,yaml}': 'npm run check:action-pins',
        'prisma/migrations/**/*.sql': 'npm run lint:migrations',
        '{Dockerfile,.dockerignore,docker-entrypoint.sh,docker-compose*.yml,docker/**,package.json,package-lock.json}':
          'npm run check:standalone -- --static-only',
        '*.md': 'npm run check:links',
      });

      const nodeDigest = 'sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee';
      const debianDigest = 'sha256:734a72b3d6142a71993b4bc580ca01d8ca687f77a2c422d96a961d3376b179bc';
      const postgresDigest = 'sha256:e18480a22d6e48f4d816a6696769b1ec09ac73a824c5649e49c7d8b684913f3d';
      const validSha512 = `sha512-${Buffer.alloc(64, 0x42).toString('base64')}`;

      const basePackageJson = {
        name: 'temp-lint-test',
        private: true,
        engines: pkg.engines,
        devEngines: pkg.devEngines,
        scripts: {
          'check:action-pins': `${process.execPath} ${TSX_CLI_PATH} ${path.join(REPO_ROOT, 'scripts', 'check-action-pins.ts')}`,
          'lint:migrations': `${process.execPath} --experimental-strip-types ${path.join(REPO_ROOT, 'scripts', 'verify-migration-compatibility.ts')}`,
          'check:standalone': `${process.execPath} ${TSX_CLI_PATH} ${path.join(REPO_ROOT, 'scripts', 'check-docker-build.ts')}`,
          'check:links': `${process.execPath} ${TSX_CLI_PATH} ${path.join(REPO_ROOT, 'scripts', 'check-doc-links.ts')}`,
        },
        'lint-staged': pkg['lint-staged'],
      };
      const basePackageLock = {
        name: 'temp-lint-test',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: 'temp-lint-test',
          },
        },
      };

      fs.writeFileSync(path.join(tempDir, '.nvmrc'), '22\n');
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify(basePackageJson, null, 2) + '\n'
      );
      fs.writeFileSync(
        path.join(tempDir, 'package-lock.json'),
        JSON.stringify(basePackageLock, null, 2) + '\n'
      );
      const fixtureEnginesCommit = 'd1b3f377ca835d73fd50954a5e22128b9ebdd6b8';
      const fixtureEnginesVersion = `8.1.0-1.${fixtureEnginesCommit}`;
      fs.writeFileSync(
        path.join(tempDir, 'Dockerfile'),
        [
          '# syntax=docker/dockerfile:1',
          `FROM node:22-bookworm-slim@${nodeDigest} AS base`,
          'WORKDIR /app',
          'RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\',
          '    --mount=type=cache,target=/var/lib/apt,sharing=locked \\',
          '    rm -f /etc/apt/apt.conf.d/docker-clean && \\',
          '    apt-get update && apt-get install -y --no-install-recommends \\',
          '    openssl \\',
          '    ca-certificates \\',
          '    binutils && \\',
          "    printf 'update-notifier=false\\n' > /usr/local/etc/npmrc",
          'FROM base AS prisma-cli',
          'WORKDIR /opt/prisma-cli',
          'COPY docker/prisma-cli/package.json docker/prisma-cli/package-lock.json docker/prisma-cli/engine-digests.json ./',
          'COPY docker/prisma-cli/stubs ./stubs',
          'RUN --mount=type=cache,target=/root/.npm,sharing=locked \\',
          '    npm ci --ignore-scripts --install-links --omit=dev --no-audit --no-fund && \\',
          '    printf \'%s  %s\\n\' "$EXPECTED_BIN_SHA256" "$ENGINE_BIN" | sha256sum -c - && \\',
          '    find /opt/prisma-cli/node_modules -type f -name "schema-engine-*" -exec strip --strip-unneeded {} +',
          'FROM base AS builder',
          'COPY package.json package-lock.json .npmrc ./',
          'RUN --mount=type=cache,target=/root/.npm,sharing=locked \\',
          '    npm ci --ignore-scripts',
          'COPY prisma ./prisma',
          'COPY prisma.config.ts next.config.ts postcss.config.mjs tsconfig.json tsconfig.build.json ./',
          'COPY assets ./assets',
          'COPY public ./public',
          'COPY src ./src',
          'COPY scripts/generate-password-hash.mjs ./scripts/generate-password-hash.mjs',
          'RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \\',
          '    npm run build:docker',
          `FROM debian:bookworm-slim@${debianDigest} AS runner`,
          'WORKDIR /app',
          'RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\',
          '    --mount=type=cache,target=/var/lib/apt,sharing=locked \\',
          '    rm -f /etc/apt/apt.conf.d/docker-clean && \\',
          '    apt-get update && apt-get install -y --no-install-recommends \\',
          '    openssl ca-certificates tini libstdc++6 && \\',
          '    addgroup --system --gid 1001 nodejs && \\',
          '    adduser --system --uid 1001 --ingroup nodejs nextjs',
          'COPY --from=base /usr/local/bin/node /usr/local/bin/node',
          'COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli',
          'COPY --from=builder /app/prisma.config.ts ./prisma.config.ts',
          'COPY --from=builder /app/scripts/generate-password-hash.mjs ./scripts/generate-password-hash.mjs',
          'RUN ln -sf /usr/local/bin/prisma /app/node_modules/.bin/prisma && \\',
          '    find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null || true',
          'HEALTHCHECK CMD node -e "fetch(\'http://127.0.0.1:3000/api/live\')"',
          'ENTRYPOINT ["/usr/bin/tini", "-s", "--", "docker-entrypoint.sh"]',
          'CMD ["node", "server.js"]',
          '',
        ].join('\n')
      );
      fs.mkdirSync(path.join(tempDir, 'docker', 'prisma-cli'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'docker', 'prisma-cli', 'engine-digests.json'),
        `${JSON.stringify(
          {
            enginesVersion: fixtureEnginesVersion,
            enginesCommit: fixtureEnginesCommit,
            platforms: {
              'linux/amd64': {
                binaryTarget: 'debian-openssl-3.0.x',
                binaryName: 'schema-engine-debian-openssl-3.0.x',
                url: `https://binaries.prisma.sh/all_commits/${fixtureEnginesCommit}/debian-openssl-3.0.x/schema-engine.gz`,
                gzipSha256: '5827f56149193f0249b2f4b8a64e60c300c3129ed6514bad0a11c340e1cffad6',
                sha256: '7116e00278a793ee13db6f0a732c1aaec10f795a37bc02e3a7df3b06b2f1311f',
              },
              'linux/arm64': {
                binaryTarget: 'linux-arm64-openssl-3.0.x',
                binaryName: 'schema-engine-linux-arm64-openssl-3.0.x',
                url: `https://binaries.prisma.sh/all_commits/${fixtureEnginesCommit}/linux-arm64-openssl-3.0.x/schema-engine.gz`,
                gzipSha256: 'aee61c23442accf150d3b253d3b829c15085ea810fd690c5f38944cd64f9cb0e',
                sha256: '81d8f205f0e6ed3240d0bebf2e45a85646dca2c8acb2679781832d5ace7876ce',
              },
            },
          },
          null,
          2
        )}\n`
      );
      fs.writeFileSync(
        path.join(tempDir, '.dockerignore'),
        ['node_modules', '.next', '.dockerignore', 'Dockerfile', 'docker-compose*.yml', ''].join('\n')
      );
      fs.writeFileSync(
        path.join(tempDir, 'docker-compose.yml'),
        [
          'services:',
          '  db:',
          `    image: postgres:15-alpine@${postgresDigest}`,
          '  migration:',
          '    image: wedding-website:latest',
          '    pull_policy: never',
          '  app:',
          '    image: wedding-website:latest',
          '    init: true',
          '    stop_grace_period: 15s',
          '    build:',
          '      context: .',
          '',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(tempDir, 'docker-entrypoint.sh'),
        [
          '#!/bin/sh',
          'export NPM_CONFIG_UPDATE_NOTIFIER=false',
          'if [ "$RUN_MIGRATIONS" = "true" ] || [ "$RUN_MIGRATIONS" = "1" ]; then',
          '  ./node_modules/.bin/prisma migrate deploy',
          'fi',
          'exec "$@"',
          '',
        ].join('\n')
      );
      fs.writeFileSync(
        path.join(tempDir, 'next.config.ts'),
        ["const nextConfig = { output: 'standalone' };", 'export default nextConfig;', ''].join('\n')
      );
      fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'docs', 'guide.md'), '# Guide\n\nBaseline docs.\n');
      fs.writeFileSync(path.join(tempDir, 'docs', 'orphan.md'), '# Orphan\n\nStandalone note.\n');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Project\n\nSee [Guide](docs/guide.md).\n');

      fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));
      fs.copyFileSync(path.join(REPO_ROOT, 'eslint.config.mjs'), path.join(tempDir, 'eslint.config.mjs'));
      fs.cpSync(path.join(REPO_ROOT, 'eslint-rules'), path.join(tempDir, 'eslint-rules'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tempDir, '.gitignore'),
        '.test-bin/\n.executed-checks.log\n.executed-cwds.log\n.worktree-probe.json\n.lint-task.cjs\nnode_modules\n.eslintcache\n'
      );
      execSync('git add . && git commit -m "Configure real validators and ESLint lint-staged"', {
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

      // 2. Staging ESLint-ignored build outputs alongside linted .githooks/*, .mts, auto-fixable files (including partial non-conflicting & conflicting working-tree files), AND unstaged/untracked drafts in Markdown, workflows, and Compose files must pass!
      fs.mkdirSync(path.join(tempDir, 'docs-portal', '.vitepress', 'dist'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.githooks'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, 'docker', 'prisma-cli', 'stubs', 'empty'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.github', 'workflows'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'public', 'mockServiceWorker.js'), '/* eslint-ignored msw */\nvar x = "ignored"\n');
      fs.writeFileSync(
        path.join(tempDir, 'docs-portal', '.vitepress', 'dist', 'app.js'),
        'var ignoredPortalBundle = "ignored"\n'
      );
      fs.writeFileSync(
        path.join(tempDir, 'docs-portal', '.vitepress', 'config.mts'),
        "export const portalTitle = 'Docs';\n"
      );
      fs.writeFileSync(
        path.join(tempDir, '.githooks', 'custom-hook'),
        "#!/usr/bin/env node\nconsole.log('hook ok');\n"
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
      fs.writeFileSync(
        path.join(tempDir, 'partial-fix.mjs'),
        ['export const fixedLine = "needs-quotes"', 'export const secondLine = 1;', ''].join('\n')
      );
      fs.writeFileSync(
        path.join(tempDir, 'conflict-fix.mjs'),
        'export const sameLine = "staged-double-quotes"\n'
      );
      execSync(
        'git add -f public/mockServiceWorker.js docs-portal/.vitepress/dist/app.js docs-portal/.vitepress/config.mts .githooks/custom-hook docker/prisma-cli/stubs/empty/index.cjs helper.mjs env-shim.cjs partial-fix.mjs conflict-fix.mjs',
        { cwd: tempDir, stdio: 'ignore' }
      );

      // Add non-conflicting unstaged edit on partial-fix.mjs and conflicting same-line edit on conflict-fix.mjs
      fs.writeFileSync(
        path.join(tempDir, 'partial-fix.mjs'),
        ['export const fixedLine = "needs-quotes"', 'export const secondLine = 99;', 'export const localDraft = true;', ''].join('\n')
      );
      fs.writeFileSync(
        path.join(tempDir, 'conflict-fix.mjs'),
        'export const sameLine = "conflicting-working-tree-draft"\n'
      );

      // Add broken UNSTAGED and UNTRACKED drafts across Markdown, workflows, and Compose files
      const originalCompose = fs.readFileSync(path.join(tempDir, 'docker-compose.yml'), 'utf-8');
      fs.writeFileSync(
        path.join(tempDir, 'README.md'),
        '# Project\n\nUnstaged broken draft link: [Missing](docs/does-not-exist.md)\n'
      );
      fs.writeFileSync(
        path.join(tempDir, 'docs', 'untracked-draft.md'),
        '# Draft\n\n[Broken Link](./nowhere.md)\n'
      );
      fs.writeFileSync(
        path.join(tempDir, '.github', 'workflows', 'untracked-draft.yml'),
        'name: Draft\non: [push]\njobs:\n  bad:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n'
      );
      fs.writeFileSync(
        path.join(tempDir, 'docker-compose.yml'),
        originalCompose.replace(`postgres:15-alpine@${postgresDigest}`, 'postgres:15-alpine')
      );

      const passResult = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(passResult.status).toBe(0);
      expect(passResult.stdout).toContain('All pre-commit checks passed.');
      expect(fs.existsSync(path.join(tempDir, '.eslintcache'))).toBe(true);

      // Fully staged scripts are updated both in the active Git index and on disk
      expect(fs.readFileSync(path.join(tempDir, 'helper.mjs'), 'utf-8')).toBe(
        "export const greeting = 'hello';\n"
      );
      expect(execSync('git show :helper.mjs', { cwd: tempDir, encoding: 'utf-8' })).toBe(
        "export const greeting = 'hello';\n"
      );
      expect(fs.readFileSync(path.join(tempDir, 'env-shim.cjs'), 'utf-8')).toBe(
        "const path = require('path');\nmodule.exports = path;\n"
      );

      // Partially staged non-conflicting file updates staged blob AND merges fix hunk into working tree
      expect(execSync('git show :partial-fix.mjs', { cwd: tempDir, encoding: 'utf-8' })).toBe(
        ["export const fixedLine = 'needs-quotes';", 'export const secondLine = 1;', ''].join('\n')
      );
      expect(fs.readFileSync(path.join(tempDir, 'partial-fix.mjs'), 'utf-8')).toBe(
        ["export const fixedLine = 'needs-quotes';", 'export const secondLine = 99;', 'export const localDraft = true;', ''].join('\n')
      );

      // Conflicting working-tree file updates staged blob in active Git index while leaving live file untouched
      expect(execSync('git show :conflict-fix.mjs', { cwd: tempDir, encoding: 'utf-8' })).toBe(
        "export const sameLine = 'staged-double-quotes';\n"
      );
      expect(fs.readFileSync(path.join(tempDir, 'conflict-fix.mjs'), 'utf-8')).toBe(
        'export const sameLine = "conflicting-working-tree-draft"\n'
      );

      // Unstaged and untracked drafts remain intact on disk
      expect(fs.readFileSync(path.join(tempDir, 'docs', 'untracked-draft.md'), 'utf-8')).toContain(
        './nowhere.md'
      );
      expect(
        fs.readFileSync(path.join(tempDir, '.github', 'workflows', 'untracked-draft.yml'), 'utf-8')
      ).toContain('actions/checkout@v4');

      // Clean up working-tree drafts and commit the clean staged files
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Project\n\nSee [Guide](docs/guide.md).\n');
      fs.writeFileSync(path.join(tempDir, 'docker-compose.yml'), originalCompose);
      fs.unlinkSync(path.join(tempDir, 'docs', 'untracked-draft.md'));
      fs.unlinkSync(path.join(tempDir, '.github', 'workflows', 'untracked-draft.yml'));
      fs.writeFileSync(
        path.join(tempDir, 'partial-fix.mjs'),
        ["export const fixedLine = 'needs-quotes';", 'export const secondLine = 1;', ''].join('\n')
      );
      fs.writeFileSync(
        path.join(tempDir, 'conflict-fix.mjs'),
        "export const sameLine = 'staged-double-quotes';\n"
      );
      execSync('git commit -m "Commit clean staged files"', { cwd: tempDir, stdio: 'ignore' });

      // 3. Staged workflow with unpinned action must fail even if another workflow exists cleanly
      fs.writeFileSync(
        path.join(tempDir, '.github', 'workflows', 'ci.yml'),
        [
          'name: CI',
          'on: [pull_request]',
          'permissions:',
          '  contents: read',
          'jobs:',
          '  lint:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - uses: actions/checkout@v4',
          '',
        ].join('\n')
      );
      execSync('git add .github/workflows/ci.yml', { cwd: tempDir, stdio: 'ignore' });

      const workflowFail = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(workflowFail.status).not.toBe(0);
      expect(`${workflowFail.stdout}\n${workflowFail.stderr}`).toContain(
        'Pre-commit check failed: ESLint / lint-staged validation failed.'
      );
      execSync('git rm -f .github/workflows/ci.yml', { cwd: tempDir, stdio: 'ignore' });

      // 4. Staged destructive SQL migration must fail
      const migrationDir = path.join(tempDir, 'prisma', 'migrations', '20261201000000_drop');
      fs.mkdirSync(migrationDir, { recursive: true });
      fs.writeFileSync(path.join(migrationDir, 'migration.sql'), 'DROP TABLE "Guest";\n');
      execSync('git add prisma/migrations/20261201000000_drop/migration.sql', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      const migrationFail = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(migrationFail.status).not.toBe(0);
      expect(`${migrationFail.stdout}\n${migrationFail.stderr}`).toContain(
        'Pre-commit check failed: ESLint / lint-staged validation failed.'
      );
      execSync('git rm -f prisma/migrations/20261201000000_drop/migration.sql', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      // 5. Untracked docs/ files and unstaged target headings must NEVER mask broken staged Markdown commits
      fs.writeFileSync(path.join(tempDir, 'docs', 'untracked-target.md'), '# Untracked Target\n');
      fs.writeFileSync(
        path.join(tempDir, 'docs', 'guide.md'),
        '# Guide\n\n## Unstaged Section\n'
      );
      fs.writeFileSync(
        path.join(tempDir, 'README.md'),
        '# Project\n\nSee [Untracked](docs/untracked-target.md) and [Section](docs/guide.md#unstaged-section).\n'
      );
      execSync('git add README.md', { cwd: tempDir, stdio: 'ignore' });

      const untrackedTargetFail = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(untrackedTargetFail.status).not.toBe(0);
      fs.unlinkSync(path.join(tempDir, 'docs', 'untracked-target.md'));
      fs.writeFileSync(path.join(tempDir, 'docs', 'guide.md'), '# Guide\n\nBaseline docs.\n');
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Project\n\nSee [Guide](docs/guide.md).\n');
      execSync('git add README.md', { cwd: tempDir, stdio: 'ignore' });

      // 6. Staged Markdown deletion triggers check:links (rejecting broken incoming links, allowing unreferenced deletions + script deletions)
      execSync('git rm docs/guide.md', { cwd: tempDir, stdio: 'ignore' });
      const deletedDocFail = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(deletedDocFail.status).not.toBe(0);
      fs.writeFileSync(path.join(tempDir, 'docs', 'guide.md'), '# Guide\n\nBaseline docs.\n');
      execSync('git add docs/guide.md', { cwd: tempDir, stdio: 'ignore' });

      execSync('git rm docs/orphan.md helper.mjs', { cwd: tempDir, stdio: 'ignore' });
      const deletedOrphanPass = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(deletedOrphanPass.status).toBe(0);
      execSync('git commit -m "Remove unreferenced orphan doc and helper"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      // 7. Staged package.json edit with UNSTAGED package-lock.json must fail until package-lock.json is also staged
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ ...basePackageJson, dependencies: { zod: '^4.6.7' } }, null, 2) + '\n'
      );
      fs.writeFileSync(
        path.join(tempDir, 'package-lock.json'),
        JSON.stringify(
          {
            ...basePackageLock,
            packages: {
              '': {
                name: 'temp-lint-test',
                dependencies: { zod: '^4.6.7' },
              },
              'node_modules/zod': {
                version: '4.6.7',
                resolved: 'https://registry.npmjs.org/zod/-/zod-4.6.7.tgz',
                integrity: validSha512,
              },
            },
          },
          null,
          2
        ) + '\n'
      );
      execSync('git add package.json', { cwd: tempDir, stdio: 'ignore' });

      const unstagedLockFail = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(unstagedLockFail.status).not.toBe(0);

      execSync('git add package-lock.json', { cwd: tempDir, stdio: 'ignore' });
      const stagedLockPass = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
      expect(stagedLockPass.status).toBe(0);
      execSync('git commit -m "Add synchronized zod dependency and lockfile"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      // 8. MERGE_HEAD merge commits reject unconflicted broken workflows, Dockerfiles, and Markdown links
      const baseBranch = 'main';
      for (const scenario of [
        {
          branch: 'merge-broken-workflow',
          setup: () => {
            fs.mkdirSync(path.join(tempDir, '.github', 'workflows'), { recursive: true });
            fs.writeFileSync(
              path.join(tempDir, '.github', 'workflows', 'merged.yml'),
              [
                'name: Merged Broken Workflow',
                'on: [push]',
                'permissions:',
                '  contents: read',
                'jobs:',
                '  verify:',
                '    runs-on: ubuntu-latest',
                '    timeout-minutes: 5',
                '    steps:',
                '      - uses: actions/checkout@v4',
                '',
              ].join('\n')
            );
          },
        },
        {
          branch: 'merge-broken-dockerfile',
          setup: () => {
            const df = fs.readFileSync(path.join(tempDir, 'Dockerfile'), 'utf-8');
            fs.writeFileSync(
              path.join(tempDir, 'Dockerfile'),
              df.replace(`node:22-bookworm-slim@${nodeDigest}`, 'node:22-bookworm-slim')
            );
          },
        },
        {
          branch: 'merge-broken-markdown',
          setup: () => {
            fs.writeFileSync(
              path.join(tempDir, 'docs', 'merge-broken.md'),
              '# Merge Doc\n\nBroken link: [Missing](./nonexistent-target.md)\n'
            );
          },
        },
      ]) {
        execSync(`git checkout -b ${scenario.branch}`, { cwd: tempDir, stdio: 'ignore' });
        scenario.setup();
        execSync('git add . && git commit -m "Introduce defect on side branch"', {
          cwd: tempDir,
          stdio: 'ignore',
        });

        execSync(`git checkout ${baseBranch}`, { cwd: tempDir, stdio: 'ignore' });
        fs.writeFileSync(path.join(tempDir, 'notes.txt'), `main divergence before ${scenario.branch}\n`);
        execSync('git add notes.txt && git commit -m "Advance main"', {
          cwd: tempDir,
          stdio: 'ignore',
        });

        execSync(`git merge --no-commit --no-ff ${scenario.branch}`, {
          cwd: tempDir,
          stdio: 'ignore',
        });
        expect(fs.existsSync(path.join(tempDir, '.git', 'MERGE_HEAD'))).toBe(true);

        const mergeHookRes = runHook(PRE_COMMIT_PATH, { USE_REAL_LINT_STAGED: '1' });
        expect(mergeHookRes.status).not.toBe(0);
        expect(fs.existsSync(path.join(tempDir, '.git', 'MERGE_HEAD'))).toBe(true);

        execSync('git merge --abort', { cwd: tempDir, stdio: 'ignore' });
      }
    });

    it('removes the temporary snapshot directory on SIGINT, SIGTERM, and SIGHUP', async () => {
      fs.writeFileSync(path.join(tempDir, 'partial.ts'), 'export const alpha = 77;\n');
      execSync('git add partial.ts', { cwd: tempDir, stdio: 'ignore' });

      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
        const markerPath = path.join(tempDir, `.snapshot-${sig}.txt`);
        const child = spawn(process.execPath, [PRE_COMMIT_PATH], {
          cwd: tempDir,
          env: {
            ...process.env,
            USE_REAL_LINT_STAGED: '1',
            SLOW_LINT_TASK_MS: '8000',
            SNAPSHOT_MARKER_FILE: markerPath,
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          },
          stdio: 'ignore',
        });

        const snapshotCwd = await new Promise<string>((resolve, reject) => {
          const deadline = Date.now() + 5000;
          const poll = () => {
            if (fs.existsSync(markerPath)) {
              const recorded = fs.readFileSync(markerPath, 'utf-8').trim();
              if (recorded) {
                resolve(recorded);
                return;
              }
            }
            if (Date.now() > deadline) {
              reject(new Error(`Timed out waiting for snapshot marker before ${sig}`));
              return;
            }
            setTimeout(poll, 25);
          };
          poll();
        });

        const tempBaseDir = path.dirname(snapshotCwd);
        expect(fs.existsSync(tempBaseDir)).toBe(true);

        child.kill(sig);
        const code = await new Promise<number | null>((resolve) => {
          child.on('close', (exitCode) => resolve(exitCode));
        });
        expect(code).not.toBe(0);
        expect(fs.existsSync(tempBaseDir)).toBe(false);
        fs.unlinkSync(markerPath);
      }
    });
  });

  describe('.githooks/pre-push', () => {
    it('registers type-check, lint, lint:unused, check:audit, and all 11 check:static scripts without destructive git commands', () => {
      const hookContent = fs.readFileSync(PRE_PUSH_PATH, 'utf-8');
      expect(hookContent).toContain("{ name: 'ESLint code linting', script: 'lint' }");
      expect(hookContent).toContain("{ name: 'Security dependency audit', script: 'check:audit' }");
      expect(hookContent).toContain("script: 'check:standalone'");
      expect(hookContent).toContain("'--static-only'");
      expect(hookContent).toContain("{ name: 'Documentation synchronization check', script: 'check:doc-sync' }");
      expect(hookContent).toContain('worktree');
      expect(hookContent).not.toMatch(/\bgit\s+stash\b|['"]stash['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+reset\b|['"]reset['"]/);
      expect(hookContent).not.toMatch(/\bgit\s+checkout\b|['"]checkout['"]/);
    });

    it('passes in place when HEAD and tracked files match the pushed commit, executing all fourteen standard checks in parallel', () => {
      fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'non-manifest commit\n');
      execSync('git add notes.txt && git commit -m "Update notes without touching manifests"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      const result = runHook(PRE_PUSH_PATH);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Running Documentation synchronization check...');
      expect(result.stdout).toContain('All pre-push checks passed.');
      expect(result.stdout).not.toContain('ephemeral Git worktree');

      const executed = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      const expectedChecks = [
        'npm:type-check',
        'npm:lint',
        'npm:lint:unused',
        'npm:check:env-docs',
        'npm:check:runbooks',
        'npm:check:setup-guides',
        'npm:check:identifiers',
        'npm:check:action-pins',
        'npm:check:standalone',
        'npm:check:links',
        'npm:check:spec-contracts',
        'npm:check:prisma',
        'npm:lint:migrations',
        'npm:check:doc-sync',
      ];
      expect(executed).toHaveLength(expectedChecks.length);
      expect(executed.slice().sort()).toEqual(expectedChecks.slice().sort());

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

    it('verifies clean pushed commits in an ephemeral detached worktree when unstaged errors exist on disk, hydrating rewritten .eslintcache and Next.js route types and cleaning up', () => {
      const cleanPath = path.join(tempDir, 'clean.ts');
      fs.writeFileSync(cleanPath, 'export const cleanValue = 1;\n');
      execSync('git add clean.ts && git commit -m "Add clean.ts"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      const realRepoDir = fs.realpathSync(tempDir);
      const realCleanPath = path.join(realRepoDir, 'clean.ts');
      const realPartialPath = path.join(realRepoDir, 'partial.ts');
      const cleanStat = fs.statSync(realCleanPath);

      // Seed node_modules, flatted .eslintcache, tsconfig.build.tsbuildinfo, next-env.d.ts, and .next/types
      fs.mkdirSync(path.join(tempDir, 'node_modules', '.marker'), { recursive: true });
      fs.mkdirSync(path.join(tempDir, '.next', 'types'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'next-env.d.ts'), '/// <reference types="next" />\n');
      fs.writeFileSync(path.join(tempDir, '.next', 'types', 'routes.d.ts'), 'export {};\n');
      fs.writeFileSync(path.join(tempDir, 'tsconfig.build.tsbuildinfo'), 'cached-tsbuildinfo-state');

      // Introduce unstaged TypeScript & ESLint errors in the working tree while HEAD remains clean
      const dirtyEdit = 'export const dirty = TS_ERROR_TOKEN + ESLINT_ERROR_TOKEN;\n';
      fs.writeFileSync(path.join(tempDir, 'partial.ts'), dirtyEdit);
      const dirtyStat = fs.statSync(realPartialPath);

      const flattedCache = [
        ['1', '2'],
        { key: '3', value: '4' },
        { key: '5', value: '6' },
        realCleanPath,
        { size: cleanStat.size, mtime: cleanStat.mtime.getTime(), data: { hashOfConfig: 'cfg1' } },
        realPartialPath,
        { size: dirtyStat.size, mtime: dirtyStat.mtime.getTime(), data: { hashOfConfig: 'cfg1' } },
      ];
      fs.writeFileSync(path.join(tempDir, '.eslintcache'), JSON.stringify(flattedCache));

      const result = runHook(PRE_PUSH_PATH, { GIT_DIR: path.join(tempDir, '.git') });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('ephemeral Git worktree');
      expect(result.stdout).toContain('All pre-push checks passed.');

      const probe = JSON.parse(fs.readFileSync(worktreeProbeFile, 'utf-8')) as {
        cwd: string;
        hasNodeModulesSymlink: boolean;
        hasEslintCache: boolean;
        eslintCacheRaw: string | null;
        hasBuildInfo: boolean;
        hasNextEnv: boolean;
        hasNextTypes: boolean;
        gitDirEnv: string | null;
      };
      expect(probe.cwd).not.toBe(realRepoDir);
      expect(probe.hasNodeModulesSymlink).toBe(true);
      expect(probe.hasEslintCache).toBe(true);
      expect(probe.hasBuildInfo).toBe(true);
      expect(probe.hasNextEnv).toBe(true);
      expect(probe.hasNextTypes).toBe(true);
      expect(probe.gitDirEnv).toBeNull();

      expect(probe.eslintCacheRaw).not.toBeNull();
      const hydratedCache = JSON.parse(probe.eslintCacheRaw ?? '[]') as unknown[];
      expect(hydratedCache[3]).toBe(path.join(probe.cwd, 'clean.ts'));
      expect(hydratedCache[5]).toBe(path.join(probe.cwd, 'partial.ts'));
      expect((hydratedCache[4] as { mtime: number }).mtime).toBeGreaterThan(0);
      expect((hydratedCache[6] as { mtime: number }).mtime).toBe(-1);

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

    it('runs check:audit when pushed commits modify package.json, package-lock.json, or docker/prisma-cli manifests/lockfiles', () => {
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

      // 2. Subsequent commit touching root package.json only
      fs.unlinkSync(logFile);
      fs.writeFileSync(
        path.join(tempDir, 'package.json'),
        JSON.stringify({ name: 'hook-test-fixture', version: '1.0.1', private: true }, null, 2) + '\n'
      );
      execSync('git add package.json && git commit -m "Update root manifest"', {
        cwd: tempDir,
        stdio: 'ignore',
      });
      const rootPkgSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();

      const rootPkgResult = runHook(
        PRE_PUSH_PATH,
        {},
        { stdin: `refs/heads/main ${rootPkgSha} refs/heads/main ${rootLockSha}\n` }
      );
      expect(rootPkgResult.status).toBe(0);
      expect(fs.readFileSync(logFile, 'utf-8').trim().split('\n')).toContain('npm:check:audit');

      // 3. Subsequent commit touching docker/prisma-cli/package.json
      fs.unlinkSync(logFile);
      fs.mkdirSync(path.join(tempDir, 'docker', 'prisma-cli'), { recursive: true });
      fs.writeFileSync(
        path.join(tempDir, 'docker', 'prisma-cli', 'package.json'),
        '{"name": "prisma-cli", "private": true}\n'
      );
      execSync('git add docker/prisma-cli/package.json && git commit -m "Update prisma-cli manifest"', {
        cwd: tempDir,
        stdio: 'ignore',
      });
      const prismaPkgSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();

      const prismaPkgResult = runHook(
        PRE_PUSH_PATH,
        {},
        { stdin: `refs/heads/main ${prismaPkgSha} refs/heads/main ${rootPkgSha}\n` }
      );
      expect(prismaPkgResult.status).toBe(0);
      expect(fs.readFileSync(logFile, 'utf-8').trim().split('\n')).toContain('npm:check:audit');

      // 4. Subsequent commit touching docker/prisma-cli/package-lock.json
      fs.unlinkSync(logFile);
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
        { stdin: `refs/heads/main ${prismaLockSha} refs/heads/main ${prismaPkgSha}\n` }
      );
      expect(prismaLockResult.status).toBe(0);
      expect(fs.readFileSync(logFile, 'utf-8').trim().split('\n')).toContain('npm:check:audit');

      // 5. Subsequent commit NOT touching manifests or lockfiles skips check:audit
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

    it('cancels in-flight checks, skips queued checks, and exits non-zero when a parallel workspace check fails', () => {
      fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'non-manifest fail-fast check\n');
      execSync('git add notes.txt && git commit -m "Update notes before fail-fast check"', {
        cwd: tempDir,
        stdio: 'ignore',
      });

      const startTime = Date.now();
      const result = runHook(PRE_PUSH_PATH, {
        PRE_PUSH_CONCURRENCY: '2',
        SLOW_CHECK_SCRIPT: 'type-check',
        SLOW_CHECK_DELAY_MS: '5000',
        FAIL_CHECK_SCRIPT: 'lint',
      });
      const elapsedMs = Date.now() - startTime;

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'Pre-push check failed: ESLint code linting failed.'
      );
      expect(elapsedMs).toBeLessThan(4000);

      const executed = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
      expect(executed).toContain('npm:lint');
      expect(executed).not.toContain('npm:check:doc-sync');
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
