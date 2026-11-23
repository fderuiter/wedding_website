import { execSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const PRE_COMMIT_PATH = path.join(REPO_ROOT, '.githooks', 'pre-commit');
const VERIFY_DOC_SYNC_PATH = path.join(REPO_ROOT, 'scripts', 'verify-doc-sync.ts');
const TSX_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const LINT_STAGED_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'lint-staged', 'bin', 'lint-staged.js');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

describe('.githooks/pre-commit documentation synchronization check', () => {
  let tempDir: string;
  let binDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-commit-doc-sync-'));
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
if (process.env.CREATE_UNTRACKED_DOC === '1') {
  fs.writeFileSync(path.join(process.cwd(), 'FEATURE_MODULES.md'), '# Generated Feature Modules\\n');
}
`
    );

    // Shim npx so lint-staged succeeds quickly by default (or runs real lint-staged when requested)
    const npxShim = path.join(binDir, 'npx');
    fs.writeFileSync(
      npxShim,
      `#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'lint-staged') {
  fs.appendFileSync(${JSON.stringify(logFile)}, 'npx:lint-staged\\n');
  if (process.env.RUN_REAL_LINT_STAGED === '1') {
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

    // Shim npm so check:doc-sync runs the real verify-doc-sync.ts and earlier checks record execution
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
  fs.appendFileSync(${JSON.stringify(logFile)}, 'npm:' + scriptName + '\\n');
  if (process.env.CORRUPT_BACKUP_ON_CHECK === scriptName) {
    const gitDir = path.join(process.cwd(), '.git');
    for (const entry of fs.readdirSync(gitDir)) {
      if (entry.startsWith('pre-commit-backup-')) {
        fs.writeFileSync(path.join(gitDir, entry, 'unstaged.patch'), 'corrupted invalid patch\\n');
      }
    }
  }
  if (process.env.SLEEP_ON_CHECK === scriptName) {
    setTimeout(() => process.exit(0), 5000);
    return;
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

    fs.writeFileSync(path.join(tempDir, '.gitignore'), '.test-bin/\n.executed-checks.log\n');
    fs.writeFileSync(path.join(tempDir, 'schema.json'), JSON.stringify({ version: '1.0.0' }) + '\n');
    fs.writeFileSync(
      path.join(tempDir, 'public', 'openapi.json'),
      JSON.stringify({ openapi: '3.0.3', version: '1.0.0' }, null, 2) + '\n'
    );
    fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Architecture\n\nSchema version: 1.0.0\n');
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'initial notes\n');

    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Initial synchronized commit"', { cwd: tempDir, stdio: 'ignore' });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runPreCommit(extraEnv: Record<string, string> = {}) {
    return spawnSync(process.execPath, [PRE_COMMIT_PATH], {
      cwd: tempDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        ...extraEnv,
      },
    });
  }

  function findBackupDirs(): string[] {
    const gitDir = path.join(tempDir, '.git');
    return fs.readdirSync(gitDir).filter((entry) => entry.startsWith('pre-commit-backup-'));
  }

  it('registers Documentation synchronization check (check:doc-sync) in .githooks/pre-commit', () => {
    const hookContent = fs.readFileSync(PRE_COMMIT_PATH, 'utf-8');
    expect(hookContent).toContain("{ name: 'Documentation synchronization check', script: 'check:doc-sync' }");
  });

  it('passes when documentation is synchronized and executes all twelve static checks in order', () => {
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'staged change\n');
    execSync('git add notes.txt', { cwd: tempDir, stdio: 'ignore' });

    const result = runPreCommit();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Running Documentation synchronization check...');
    expect(result.stdout).toContain('All pre-commit checks passed.');
    expect(findBackupDirs()).toEqual([]);

    const executed = fs.readFileSync(logFile, 'utf-8').trim().split('\n');
    expect(executed).toEqual([
      'npx:lint-staged',
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

  it('rejects commit on schema documentation drift and cleanly restores backed-up unstaged files', () => {
    // Stage a schema change without regenerating/staging docs
    fs.writeFileSync(path.join(tempDir, 'schema.json'), JSON.stringify({ version: '2.0.0' }) + '\n');
    execSync('git add schema.json', { cwd: tempDir, stdio: 'ignore' });

    // Create unstaged changes in both an unrelated file and ARCHITECTURE.md itself
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged work in progress\n');
    fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Architecture\n\nUnstaged draft edit\n');

    const result = runPreCommit({ CREATE_UNTRACKED_DOC: '1' });
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(combinedOutput).toContain('Documentation Drift Detected!');
    expect(combinedOutput).toContain('ACTIONABLE REMEDIATION:');
    expect(combinedOutput).toContain('Pre-commit check failed: Documentation synchronization check failed.');
    expect(combinedOutput).not.toContain('Failed to restore unstaged changes');

    // Verify unstaged edits were cleanly restored and check-created untracked docs were removed
    expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe('unstaged work in progress\n');
    expect(fs.readFileSync(path.join(tempDir, 'ARCHITECTURE.md'), 'utf-8')).toBe(
      '# Architecture\n\nUnstaged draft edit\n'
    );
    expect(fs.existsSync(path.join(tempDir, 'FEATURE_MODULES.md'))).toBe(false);
    expect(findBackupDirs()).toEqual([]);

    const stashList = execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim();
    expect(stashList).toBe('');

    const status = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
    expect(status).toContain('M  schema.json');
    expect(status).toContain(' M notes.txt');
    expect(status).toContain(' M ARCHITECTURE.md');
  });

  it('accepts staged synchronized documentation updates and cleanly restores backed-up unstaged edits', () => {
    // Update schema and stage synchronized regenerated documentation files
    fs.writeFileSync(path.join(tempDir, 'schema.json'), JSON.stringify({ version: '2.0.0' }) + '\n');
    fs.writeFileSync(
      path.join(tempDir, 'public', 'openapi.json'),
      JSON.stringify({ openapi: '3.0.3', version: '2.0.0' }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(tempDir, 'ARCHITECTURE.md'),
      '# Architecture\n\nSchema version: 2.0.0\n'
    );
    execSync('git add schema.json public/openapi.json ARCHITECTURE.md', {
      cwd: tempDir,
      stdio: 'ignore',
    });

    // Leave unstaged work-in-progress changes that should be backed up and restored
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged work during doc sync commit\n');

    const result = runPreCommit();
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Backing up unstaged changes...');
    expect(result.stdout).toContain('Running Documentation synchronization check...');
    expect(result.stdout).toContain('Restoring unstaged changes...');
    expect(result.stdout).toContain('All pre-commit checks passed.');
    expect(combinedOutput).not.toContain('Failed to restore unstaged changes');
    expect(findBackupDirs()).toEqual([]);

    expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe(
      'unstaged work during doc sync commit\n'
    );

    const stashList = execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim();
    expect(stashList).toBe('');

    const status = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
    expect(status).toContain('M  schema.json');
    expect(status).toContain('M  public/openapi.json');
    expect(status).toContain('M  ARCHITECTURE.md');
    expect(status).toContain(' M notes.txt');
  });

  it('rejects commit when staged documentation files contain stale content', () => {
    // Stage schema update to 2.0.0 alongside stale 1.5.0 documentation files
    fs.writeFileSync(path.join(tempDir, 'schema.json'), JSON.stringify({ version: '2.0.0' }) + '\n');
    fs.writeFileSync(
      path.join(tempDir, 'public', 'openapi.json'),
      JSON.stringify({ openapi: '3.0.3', version: '1.5.0' }, null, 2) + '\n'
    );
    fs.writeFileSync(
      path.join(tempDir, 'ARCHITECTURE.md'),
      '# Architecture\n\nSchema version: 1.5.0\n'
    );
    execSync('git add schema.json public/openapi.json ARCHITECTURE.md', {
      cwd: tempDir,
      stdio: 'ignore',
    });

    // Also include an unstaged edit to ensure patch restoration remains clean
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged edit with stale staged docs\n');

    const result = runPreCommit();
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(combinedOutput).toContain('Documentation Drift Detected!');
    expect(combinedOutput).toContain('public/openapi.json');
    expect(combinedOutput).toContain('ARCHITECTURE.md');
    expect(combinedOutput).toContain('Pre-commit check failed: Documentation synchronization check failed.');
    expect(combinedOutput).not.toContain('Failed to restore unstaged changes');
    expect(findBackupDirs()).toEqual([]);

    expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe(
      'unstaged edit with stale staged docs\n'
    );

    const stashList = execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim();
    expect(stashList).toBe('');

    const status = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
    expect(status).toContain('M  schema.json');
    expect(status).toContain('M  public/openapi.json');
    expect(status).toContain('M  ARCHITECTURE.md');
    expect(status).toContain(' M notes.txt');
  });

  it('isolates and restores partially staged MM, AM, MD, RM, binary, and untracked files without merge conflicts or touching git stash / MERGE_HEAD', () => {
    fs.writeFileSync(path.join(tempDir, 'delete-later.txt'), 'original content\n');
    fs.writeFileSync(path.join(tempDir, 'rename-old.txt'), 'before rename\n');
    fs.writeFileSync(path.join(tempDir, 'binary.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]));
    execSync('git add .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git commit -m "Add baseline edge-case fixtures"', { cwd: tempDir, stdio: 'ignore' });

    // Create a pre-existing user stash entry and MERGE_HEAD that must remain untouched
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'user stashed wip\n');
    execSync('git stash push -m "existing-user-stash"', { cwd: tempDir, stdio: 'ignore' });
    const headSha = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.join(tempDir, '.git', 'MERGE_HEAD'), `${headSha}\n`);

    // 1. MM file where staged and unstaged edits modify the exact same line (causes conflict under git stash pop)
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'line 1 staged version\n');
    execSync('git add notes.txt', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'line 1 unstaged override\nsecond unstaged line\n');

    // 2. AM file (staged addition with unstaged edits)
    fs.writeFileSync(path.join(tempDir, 'added.txt'), 'added staged\n');
    execSync('git add added.txt', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'added.txt'), 'added unstaged\n');

    // 3. MD file (staged modification with unstaged deletion)
    fs.writeFileSync(path.join(tempDir, 'delete-later.txt'), 'staged modification before unlink\n');
    execSync('git add delete-later.txt', { cwd: tempDir, stdio: 'ignore' });
    fs.unlinkSync(path.join(tempDir, 'delete-later.txt'));

    // 4. RM file (staged rename with unstaged modification)
    execSync('git mv rename-old.txt rename-new.txt', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'rename-new.txt'), 'after rename unstaged\n');

    // 5. Binary unstaged edit + nested untracked file
    const unstagedBinary = Buffer.from([0x00, 0xff, 0x10, 0x20, 0x30]);
    fs.writeFileSync(path.join(tempDir, 'binary.dat'), unstagedBinary);
    fs.mkdirSync(path.join(tempDir, 'drafts', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'drafts', 'nested', 'wip.txt'), 'untracked draft\n');

    const statusBefore = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });

    const result = runPreCommit({ CREATE_UNTRACKED_DOC: '1' });
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    // CREATE_UNTRACKED_DOC creates untracked FEATURE_MODULES.md (not in DEFAULT_DOC_FILES unless drifted),
    // wait: verify-doc-sync checks DEFAULT_DOC_FILES which includes FEATURE_MODULES.md, so creating FEATURE_MODULES.md
    // causes doc drift failure AND verifies untracked doc cleanup before user file restoration!
    expect(result.status).not.toBe(0);
    expect(combinedOutput).toContain('Backing up unstaged changes...');
    expect(combinedOutput).toContain('Restoring unstaged changes...');
    expect(combinedOutput).not.toContain('Failed to restore unstaged changes');

    const statusAfter = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
    expect(statusAfter).toBe(statusBefore);
    expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe(
      'line 1 unstaged override\nsecond unstaged line\n'
    );
    expect(fs.readFileSync(path.join(tempDir, 'added.txt'), 'utf-8')).toBe('added unstaged\n');
    expect(fs.existsSync(path.join(tempDir, 'delete-later.txt'))).toBe(false);
    expect(fs.readFileSync(path.join(tempDir, 'rename-new.txt'), 'utf-8')).toBe('after rename unstaged\n');
    expect(Buffer.compare(fs.readFileSync(path.join(tempDir, 'binary.dat')), unstagedBinary)).toBe(0);
    expect(fs.readFileSync(path.join(tempDir, 'drafts', 'nested', 'wip.txt'), 'utf-8')).toBe(
      'untracked draft\n'
    );
    expect(fs.existsSync(path.join(tempDir, 'FEATURE_MODULES.md'))).toBe(false);
    expect(findBackupDirs()).toEqual([]);

    const stashList = execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim();
    expect(stashList).toContain('existing-user-stash');
    expect(fs.readFileSync(path.join(tempDir, '.git', 'MERGE_HEAD'), 'utf-8')).toBe(`${headSha}\n`);
  });

  it('passes cleanly on partially staged MM files when all checks succeed', () => {
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'staged line 1\n');
    execSync('git add notes.txt', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged conflicting line 1\n');

    const result = runPreCommit();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Backing up unstaged changes...');
    expect(result.stdout).toContain('Restoring unstaged changes...');
    expect(result.stdout).toContain('All pre-commit checks passed.');
    expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe(
      'unstaged conflicting line 1\n'
    );

    const status = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
    expect(status).toContain('MM notes.txt');
    expect(findBackupDirs()).toEqual([]);
  });

  it('exits non-zero and preserves the .git/ backup folder when backup isolation fails', () => {
    // Create an unmerged index conflict alongside an unstaged diff so `git restore --worktree -- .` fails during backup
    execSync('git checkout -b conflict-branch', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'branch side\n');
    execSync('git commit -am "Branch edit"', { cwd: tempDir, stdio: 'ignore' });

    execSync('git checkout main', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'main side\n');
    execSync('git commit -am "Main edit"', { cwd: tempDir, stdio: 'ignore' });

    spawnSync('git', ['merge', 'conflict-branch'], { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'untracked-during-backup-fail.txt'), 'keep me safe\n');

    const result = runPreCommit();
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(combinedOutput).toContain('Backup preserved in');
    expect(combinedOutput).not.toContain('All pre-commit checks passed.');

    const backupDirs = findBackupDirs();
    expect(backupDirs).toHaveLength(1);
    const backupDirPath = path.join(tempDir, '.git', backupDirs[0]);
    expect(fs.existsSync(path.join(backupDirPath, 'unstaged.patch'))).toBe(true);
    expect(
      fs.readFileSync(
        path.join(backupDirPath, 'untracked', 'untracked-during-backup-fail.txt'),
        'utf-8'
      )
    ).toBe('keep me safe\n');
  });

  it('exits non-zero and preserves the .git/ backup folder when patch restoration fails', () => {
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'staged clean version\n');
    execSync('git add notes.txt', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged version needing recovery\n');
    fs.writeFileSync(path.join(tempDir, 'untracked-keep.txt'), 'untracked content\n');

    const result = runPreCommit({ CORRUPT_BACKUP_ON_CHECK: 'type-check' });
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(combinedOutput).toContain('Failed to restore unstaged changes. Backup preserved in');
    expect(combinedOutput).not.toContain('All pre-commit checks passed.');

    const backupDirs = findBackupDirs();
    expect(backupDirs).toHaveLength(1);
    const backupDirPath = path.join(tempDir, '.git', backupDirs[0]);
    expect(fs.existsSync(path.join(backupDirPath, 'unstaged.patch'))).toBe(true);
    expect(fs.existsSync(path.join(backupDirPath, 'untracked', 'untracked-keep.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(tempDir, 'untracked-keep.txt'), 'utf-8')).toBe(
      'untracked content\n'
    );
  });

  it('restores unstaged patches and untracked files cleanly on SIGTERM interruption', async () => {
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'staged before sigterm\n');
    execSync('git add notes.txt', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged before sigterm\n');
    fs.writeFileSync(path.join(tempDir, 'draft-sigterm.txt'), 'untracked sigterm\n');

    const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
      (resolve) => {
        const child = spawn(process.execPath, [PRE_COMMIT_PATH], {
          cwd: tempDir,
          env: {
            ...process.env,
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
            SLEEP_ON_CHECK: 'lint:unused',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let sentSigterm = false;

        child.stdout.on('data', (chunk: Buffer) => {
          stdout += chunk.toString();
          if (!sentSigterm && stdout.includes('Running Knip dead-code analysis...')) {
            sentSigterm = true;
            child.kill('SIGTERM');
          }
        });
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on('close', (status) => {
          resolve({ status, stdout, stderr });
        });
      }
    );

    expect(result.status).toBe(143);
    expect(result.stdout).toContain('Process interrupted by SIGTERM. Cleaning up...');
    expect(result.stdout).toContain('Restoring unstaged changes...');
    expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe('unstaged before sigterm\n');
    expect(fs.readFileSync(path.join(tempDir, 'draft-sigterm.txt'), 'utf-8')).toBe('untracked sigterm\n');
    expect(findBackupDirs()).toEqual([]);
  });

  it('configures lint-staged to check staged .mjs and .cjs files and enforces ESLint rules on them', () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
      'lint-staged'?: Record<string, string>;
    };
    expect(pkg['lint-staged']).toEqual({
      '*.{js,jsx,ts,tsx,mjs,cjs}': 'eslint --fix',
    });

    // Wire real ESLint flat config and node_modules into tempDir to verify end-to-end lint-staged behavior
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'temp-lint-test', private: true, 'lint-staged': pkg['lint-staged'] }, null, 2) + '\n'
    );
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tempDir, 'node_modules'));
    fs.symlinkSync(path.join(REPO_ROOT, 'eslint.config.mjs'), path.join(tempDir, 'eslint.config.mjs'));
    fs.symlinkSync(path.join(REPO_ROOT, 'eslint-rules'), path.join(tempDir, 'eslint-rules'));
    fs.writeFileSync(
      path.join(tempDir, '.gitignore'),
      '.test-bin/\n.executed-checks.log\nnode_modules\neslint.config.mjs\neslint-rules\npackage.json\n'
    );

    // 1. Staged .mjs with disallowed require() must fail lint-staged
    fs.writeFileSync(path.join(tempDir, 'bad-script.mjs'), "const fs = require('fs');\nexport default fs;\n");
    execSync('git add -f bad-script.mjs', { cwd: tempDir, stdio: 'ignore' });

    const failResult = runPreCommit({ RUN_REAL_LINT_STAGED: '1' });
    const failOutput = `${failResult.stdout}\n${failResult.stderr}`;
    expect(failResult.status).not.toBe(0);
    expect(failOutput).toContain('Pre-commit check failed: ESLint / lint-staged validation failed.');
    execSync('git rm -f bad-script.mjs', { cwd: tempDir, stdio: 'ignore' });

    // 2. Staged .mjs and .cjs with auto-fixable stylistic quotes/semicolons (and valid require() in .cjs) must auto-fix and pass
    fs.writeFileSync(path.join(tempDir, 'helper.mjs'), 'export const greeting = "hello"\n');
    fs.writeFileSync(
      path.join(tempDir, 'env-shim.cjs'),
      'const path = require("path")\nmodule.exports = path\n'
    );
    execSync('git add -f helper.mjs env-shim.cjs', { cwd: tempDir, stdio: 'ignore' });

    const passResult = runPreCommit({ RUN_REAL_LINT_STAGED: '1' });
    expect(passResult.status).toBe(0);
    expect(passResult.stdout).toContain('All pre-commit checks passed.');
    expect(fs.readFileSync(path.join(tempDir, 'helper.mjs'), 'utf-8')).toBe(
      "export const greeting = 'hello';\n"
    );
    expect(fs.readFileSync(path.join(tempDir, 'env-shim.cjs'), 'utf-8')).toBe(
      "const path = require('path');\nmodule.exports = path;\n"
    );
  });
});
