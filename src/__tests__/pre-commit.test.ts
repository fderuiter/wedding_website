import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const PRE_COMMIT_PATH = path.join(REPO_ROOT, '.githooks', 'pre-commit');
const VERIFY_DOC_SYNC_PATH = path.join(REPO_ROOT, 'scripts', 'verify-doc-sync.ts');
const TSX_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

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
`
    );

    // Shim npx so lint-staged succeeds quickly while npx tsx runs real tsx
    const npxShim = path.join(binDir, 'npx');
    fs.writeFileSync(
      npxShim,
      `#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'lint-staged') {
  fs.appendFileSync(${JSON.stringify(logFile)}, 'npx:lint-staged\\n');
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
const args = process.argv.slice(2);
if (args[0] === 'run' && args[1]) {
  const scriptName = args[1];
  fs.appendFileSync(${JSON.stringify(logFile)}, 'npm:' + scriptName + '\\n');
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

  function runPreCommit() {
    return spawnSync(process.execPath, [PRE_COMMIT_PATH], {
      cwd: tempDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      },
    });
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

  it('rejects commit on schema documentation drift and cleanly restores stashed unstaged files', () => {
    // Stage a schema change without regenerating/staging docs
    fs.writeFileSync(path.join(tempDir, 'schema.json'), JSON.stringify({ version: '2.0.0' }) + '\n');
    execSync('git add schema.json', { cwd: tempDir, stdio: 'ignore' });

    // Create unstaged changes in both an unrelated file and ARCHITECTURE.md itself
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged work in progress\n');
    fs.writeFileSync(path.join(tempDir, 'ARCHITECTURE.md'), '# Architecture\n\nUnstaged draft edit\n');

    const result = runPreCommit();
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(combinedOutput).toContain('Documentation Drift Detected!');
    expect(combinedOutput).toContain('ACTIONABLE REMEDIATION:');
    expect(combinedOutput).toContain('Pre-commit check failed: Documentation synchronization check failed.');
    expect(combinedOutput).not.toContain('Failed to restore unstaged changes from stash');

    // Verify unstaged edits were cleanly restored without leaving stash entries behind
    expect(fs.readFileSync(path.join(tempDir, 'notes.txt'), 'utf-8')).toBe('unstaged work in progress\n');
    expect(fs.readFileSync(path.join(tempDir, 'ARCHITECTURE.md'), 'utf-8')).toBe(
      '# Architecture\n\nUnstaged draft edit\n'
    );

    const stashList = execSync('git stash list', { cwd: tempDir, encoding: 'utf-8' }).trim();
    expect(stashList).toBe('');

    const status = execSync('git status --porcelain', { cwd: tempDir, encoding: 'utf-8' });
    expect(status).toContain('M  schema.json');
    expect(status).toContain(' M notes.txt');
    expect(status).toContain(' M ARCHITECTURE.md');
  });

  it('accepts staged synchronized documentation updates and cleanly restores stashed unstaged edits', () => {
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

    // Leave unstaged work-in-progress changes that should be stashed and restored
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged work during doc sync commit\n');

    const result = runPreCommit();
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Stashing unstaged changes...');
    expect(result.stdout).toContain('Running Documentation synchronization check...');
    expect(result.stdout).toContain('Restoring unstaged changes...');
    expect(result.stdout).toContain('All pre-commit checks passed.');
    expect(combinedOutput).not.toContain('Failed to restore unstaged changes from stash');

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

    // Also include an unstaged edit to ensure stash restoration remains clean
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'unstaged edit with stale staged docs\n');

    const result = runPreCommit();
    const combinedOutput = `${result.stdout}\n${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(combinedOutput).toContain('Documentation Drift Detected!');
    expect(combinedOutput).toContain('public/openapi.json');
    expect(combinedOutput).toContain('ARCHITECTURE.md');
    expect(combinedOutput).toContain('Pre-commit check failed: Documentation synchronization check failed.');
    expect(combinedOutput).not.toContain('Failed to restore unstaged changes from stash');

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
});
