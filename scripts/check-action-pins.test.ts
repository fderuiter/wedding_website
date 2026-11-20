/**
 * @jest-environment node
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkActionPins } from './check-action-pins';

const REPO_ROOT = process.cwd();
const LIVE_WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const CHECK_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'check-action-pins.ts');
const TSX_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe('check-action-pins', () => {
  let tempDir: string;
  let workflowsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-action-pins-test-'));
    workflowsDir = path.join(tempDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes with zero violations on all live repository workflows', () => {
    const { workflowFiles, violations } = checkActionPins(LIVE_WORKFLOWS_DIR);
    expect(workflowFiles.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('rejects an unquoted leading ! conditional as a YAML 1.2 tag warning', () => {
    fs.writeFileSync(
      path.join(workflowsDir, 'broken-tag.yml'),
      [
        'name: Broken Conditional',
        'on:',
        '  workflow_dispatch:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  deploy:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        '      - name: Verify Artifact Provenance Attestation',
        '        id: provenance',
        "        if: !(inputs.dry_run && inputs.image_digest == '' && inputs.image_tag == 'latest')",
        '        run: echo "verifying"',
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      filePath: '.github/workflows/broken-tag.yml',
      lineNumber: 13,
      actionRef: 'TAG_RESOLVE_FAILED',
    });
    expect(violations[0].reason).toContain('TAG_RESOLVE_FAILED');

    const cliResult = spawnSync(process.execPath, [TSX_CLI_PATH, CHECK_SCRIPT_PATH], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    expect(cliResult.status).toBe(1);
    expect(cliResult.stderr).toContain('TAG_RESOLVE_FAILED');
  });

  it('accepts quoted leading ! conditionals and rejects malformed YAML 1.2 or unpinned actions', () => {
    fs.writeFileSync(
      path.join(workflowsDir, 'valid.yml'),
      [
        'name: Valid Conditional',
        'on:',
        '  workflow_dispatch:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  deploy:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        '      - uses: ./.github/workflows/local.yml',
        '      - name: Verify Artifact Provenance Attestation',
        '        id: provenance',
        '        if: "!(inputs.dry_run && inputs.image_digest == \'\' && inputs.image_tag == \'latest\')"',
        '        run: echo "ok"',
        '',
      ].join('\n')
    );

    expect(checkActionPins(workflowsDir).violations).toEqual([]);

    fs.writeFileSync(
      path.join(workflowsDir, 'invalid.yml'),
      [
        'name: Invalid Workflow',
        'jobs:',
        '  test:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - name: Bad indent',
        '      bad_key: [unclosed',
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    expect(violations.some((v) => v.reason.includes('YAML 1.2 parse error'))).toBe(true);
    expect(violations.some((v) => v.reason.includes('is not a 40-character commit SHA'))).toBe(true);
  });
});
