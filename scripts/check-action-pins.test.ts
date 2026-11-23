/**
 * @jest-environment node
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { http as mswHttp, HttpResponse } from 'msw';
import { server as mswServer } from '../src/mocks/server';
import { checkActionPins, verifyUpstreamActionPins } from './check-action-pins';

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
        '        with:',
        '          persist-credentials: false',
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
      lineNumber: 15,
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
        '        with:',
        '          persist-credentials: false',
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

  it('rejects third-party action pins missing an inline # v... version comment locally', () => {
    fs.writeFileSync(
      path.join(workflowsDir, 'missing-version-comment.yml'),
      [
        'name: Missing Version Comment',
        'on:',
        '  push:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
        '        with:',
        '          persist-credentials: false',
        '      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # pinned without semver tag',
        '      - uses: github/codeql-action/upload-sarif@33d7b85da1a04171e211befe2c739303b9a4c066 # v4.39.3',
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toMatchObject({
      filePath: '.github/workflows/missing-version-comment.yml',
      lineNumber: 10,
      actionRef: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    });
    expect(violations[0].reason).toContain('Missing inline "# v..." version comment');
    expect(violations[1]).toMatchObject({
      filePath: '.github/workflows/missing-version-comment.yml',
      lineNumber: 13,
      actionRef: 'actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
    });
    expect(violations[1].reason).toContain('Missing inline "# v..." version comment');
  });

  it('verifies upstream commit SHAs with --verify-upstream and GITHUB_TOKEN and rejects nonexistent SHAs', async () => {
    const validCheckoutSha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
    const validCodeqlSha = '33d7b85da1a04171e211befe2c739303b9a4c066';
    const brokenAttestSha = 'c0744595e72338575084a4bf85ed76e1eb521ddf';

    const requestedPaths: string[] = [];
    const authHeaders: Array<string | null> = [];
    const inProcessApiBase = 'https://mock-github-api.local';

    mswServer.use(
      mswHttp.get(`${inProcessApiBase}/repos/:owner/:repo/commits/:sha`, ({ request, params }) => {
        const pathname = new URL(request.url).pathname;
        requestedPaths.push(pathname);
        authHeaders.push(request.headers.get('authorization'));

        if (params.owner === 'actions' && params.repo === 'checkout' && params.sha === validCheckoutSha) {
          return HttpResponse.json({ sha: validCheckoutSha }, { status: 200 });
        }
        if (params.owner === 'github' && params.repo === 'codeql-action' && params.sha === validCodeqlSha) {
          return HttpResponse.json({ sha: validCodeqlSha }, { status: 200 });
        }
        if (
          params.owner === 'actions' &&
          params.repo === 'attest-build-provenance' &&
          params.sha === brokenAttestSha
        ) {
          return HttpResponse.json(
            { message: `No commit found for SHA: ${brokenAttestSha}` },
            { status: 422 }
          );
        }
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
      })
    );

    const server = http.createServer((req, res) => {
      if (req.url === `/repos/actions/checkout/commits/${validCheckoutSha}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sha: validCheckoutSha }));
        return;
      }
      if (req.url === `/repos/github/codeql-action/commits/${validCodeqlSha}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ sha: validCodeqlSha }));
        return;
      }
      if (req.url === `/repos/actions/attest-build-provenance/commits/${brokenAttestSha}`) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `No commit found for SHA: ${brokenAttestSha}` }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Not Found' }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const cliApiBaseUrl = `http://127.0.0.1:${port}`;

    try {
      fs.writeFileSync(
        path.join(workflowsDir, 'upstream-check.yml'),
        [
          'name: Upstream Verification',
          'on:',
          '  push:',
          'permissions:',
          '  contents: read',
          'jobs:',
          '  publish:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          `      - uses: actions/checkout@${validCheckoutSha} # v7.0.1`,
          '        with:',
          '          persist-credentials: false',
          `      - uses: actions/checkout@${validCheckoutSha} # v7.0.1`,
          '        with:',
          '          persist-credentials: false',
          `      - uses: github/codeql-action/upload-sarif@${validCodeqlSha} # v4.39.3`,
          `      - uses: actions/attest-build-provenance@${brokenAttestSha} # v2.2.3`,
          '',
        ].join('\n')
      );

      // Default offline check passes syntactically valid 40-char SHA + # v... comment without HTTP calls
      expect(checkActionPins(workflowsDir).violations).toEqual([]);
      expect(requestedPaths).toEqual([]);

      // Programmatic --verify-upstream deduplicates pins, forwards Bearer token, and flags HTTP 422 SHA
      const upstreamRes = await verifyUpstreamActionPins(workflowsDir, {
        apiBaseUrl: inProcessApiBase,
        token: 'ghs_mock_ci_token',
      });
      expect(upstreamRes.verifiedPins).toBe(3);
      expect(requestedPaths).toEqual([
        `/repos/actions/checkout/commits/${validCheckoutSha}`,
        `/repos/github/codeql-action/commits/${validCodeqlSha}`,
        `/repos/actions/attest-build-provenance/commits/${brokenAttestSha}`,
      ]);
      expect(authHeaders.every((header) => header === 'Bearer ghs_mock_ci_token')).toBe(true);
      expect(upstreamRes.violations).toHaveLength(1);
      expect(upstreamRes.violations[0]).toMatchObject({
        filePath: '.github/workflows/upstream-check.yml',
        lineNumber: 17,
        actionRef: `actions/attest-build-provenance@${brokenAttestSha}`,
      });
      expect(upstreamRes.violations[0].reason).toContain(
        `Upstream commit "${brokenAttestSha}" does not exist in "actions/attest-build-provenance" (HTTP 422)`
      );

      // CLI --verify-upstream exits non-zero and prints remediation on nonexistent upstream SHA
      const cliFail = await new Promise<{ status: number | null; stderr: string }>((resolve, reject) => {
        let stderr = '';
        const child = spawn(
          process.execPath,
          [TSX_CLI_PATH, CHECK_SCRIPT_PATH, '--verify-upstream'],
          {
            cwd: tempDir,
            env: {
              ...process.env,
              GITHUB_API_URL: cliApiBaseUrl,
              GITHUB_TOKEN: 'ghs_mock_ci_token',
            },
          }
        );
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString('utf8');
        });
        child.on('error', reject);
        child.on('close', (code) => resolve({ status: code, stderr }));
      });
      expect(cliFail.status).toBe(1);
      expect(cliFail.stderr).toContain('does not exist in "actions/attest-build-provenance" (HTTP 422)');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('enforces AST policies for persist-credentials, PR runtime/write tokens, rollback_environment, and release caches', () => {
    fs.writeFileSync(
      path.join(workflowsDir, 'ci.yml'),
      [
        'name: Insecure CI',
        'on:',
        '  pull_request:',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    permissions:',
        '      contents: read',
        '      pull-requests: write',
        '    steps:',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        '      - run: npm ci',
        '      - uses: crazy-max/ghaction-github-runtime@04d248b84655b509d8c44dc1d6f990c879747487 # v4.0.0',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'deploy-provider.yml'),
      [
        'name: Insecure Deploy Provider',
        'on:',
        '  workflow_dispatch:',
        '    inputs:',
        '      rollback_environment:',
        '        type: string',
        'jobs:',
        '  deploy:',
        '    runs-on: ubuntu-latest',
        "    environment: ${{ inputs.rollback_environment || inputs.environment || 'production' }}",
        '    steps:',
        '      - run: echo "deploy"',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'publish-artifact.yml'),
      [
        'name: Insecure Publish Artifact',
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
        '        with:',
        '          path: /tmp/buildkit-mounts/deps',
        "          key: buildkit-deps-amd64-${{ hashFiles('package-lock.json') }}",
        '          restore-keys: |',
        '            buildkit-deps-amd64-',
        '      - run: tar -xf /ctx/deps.tar -C /',
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    const reasons = violations.map((v) => v.reason);
    expect(reasons.some((r) => r.includes('with.persist-credentials: false'))).toBe(true);
    expect(reasons.some((r) => r.includes('crazy-max/ghaction-github-runtime must be guarded'))).toBe(true);
    expect(reasons.some((r) => r.includes('executes npm install/ci on pull_request while holding write permissions'))).toBe(true);
    expect(reasons.some((r) => r.includes('"rollback_environment" must not be exposed on workflow_dispatch'))).toBe(true);
    expect(reasons.some((r) => r.includes('references rollback_environment without guarding on "github.event_name == \'workflow_call\'"'))).toBe(true);
    expect(reasons.some((r) => r.includes('"release-" namespaced cache key'))).toBe(true);
    expect(reasons.some((r) => r.includes('omit prefix "restore-keys"'))).toBe(true);
    expect(reasons.some((r) => r.includes('--no-same-owner --no-same-permissions'))).toBe(true);
  });
});
