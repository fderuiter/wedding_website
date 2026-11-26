/**
 * @jest-environment node
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { http as mswHttp, HttpResponse } from 'msw';
import { parseDocument, isMap, isPair, isScalar, isSeq } from 'yaml';
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
        '    timeout-minutes: 10',
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
      lineNumber: 16,
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
        '    timeout-minutes: 10',
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
        '    timeout-minutes: 10',
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
      lineNumber: 11,
      actionRef: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    });
    expect(violations[0].reason).toContain('Missing inline "# v..." version comment');
    expect(violations[1]).toMatchObject({
      filePath: '.github/workflows/missing-version-comment.yml',
      lineNumber: 14,
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

    const routeBaselineUpstreamApi = (
      pathname: string
    ): { status: number; body: Record<string, unknown> } => {
      if (pathname === `/repos/actions/checkout/commits/${validCheckoutSha}`) {
        return { status: 200, body: { sha: validCheckoutSha } };
      }
      if (pathname === '/repos/actions/checkout/git/ref/tags/v7.0.1') {
        return {
          status: 200,
          body: {
            ref: 'refs/tags/v7.0.1',
            object: { type: 'commit', sha: validCheckoutSha },
          },
        };
      }
      if (pathname === `/repos/github/codeql-action/commits/${validCodeqlSha}`) {
        return { status: 200, body: { sha: validCodeqlSha } };
      }
      if (pathname === '/repos/github/codeql-action/git/ref/tags/v4.39.3') {
        return {
          status: 200,
          body: {
            ref: 'refs/tags/v4.39.3',
            object: { type: 'commit', sha: validCodeqlSha },
          },
        };
      }
      if (pathname === `/repos/actions/attest-build-provenance/commits/${brokenAttestSha}`) {
        return {
          status: 422,
          body: { message: `No commit found for SHA: ${brokenAttestSha}` },
        };
      }
      return { status: 404, body: { message: 'Not Found' } };
    };

    mswServer.use(
      mswHttp.get(`${inProcessApiBase}/*`, ({ request }) => {
        const pathname = new URL(request.url).pathname;
        requestedPaths.push(pathname);
        authHeaders.push(request.headers.get('authorization'));
        const mocked = routeBaselineUpstreamApi(pathname);
        return HttpResponse.json(mocked.body, { status: mocked.status });
      })
    );

    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      const mocked = routeBaselineUpstreamApi(pathname);
      res.writeHead(mocked.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mocked.body));
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
          '    timeout-minutes: 10',
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
        '/repos/actions/checkout/git/ref/tags/v7.0.1',
        `/repos/github/codeql-action/commits/${validCodeqlSha}`,
        '/repos/github/codeql-action/git/ref/tags/v4.39.3',
        `/repos/actions/attest-build-provenance/commits/${brokenAttestSha}`,
      ]);
      expect(authHeaders.every((header) => header === 'Bearer ghs_mock_ci_token')).toBe(true);
      expect(upstreamRes.violations).toHaveLength(1);
      expect(upstreamRes.violations[0]).toMatchObject({
        filePath: '.github/workflows/upstream-check.yml',
        lineNumber: 18,
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

  it('enforces AST policies for persist-credentials, PR runtime/write tokens, || bypasses, write-scoped PR checkouts, rollback_environment, shared release caches, and curl --location webhooks', () => {
    fs.writeFileSync(
      path.join(workflowsDir, 'ci.yml'),
      [
        'name: Insecure CI',
        'on:',
        '  pull_request:',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    permissions:',
        '      contents: read',
        '      pull-requests: write',
        '    steps:',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        '      - run: npm ci',
        '      - uses: crazy-max/ghaction-github-runtime@04d248b84655b509d8c44dc1d6f990c879747487 # v4.0.0',
        '  checkout-only-write:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        "    if: github.event_name != 'pull_request' || github.ref == 'refs/heads/main'",
        '    permissions:',
        '      contents: read',
        '      issues: write',
        '    steps:',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        '        with:',
        '          persist-credentials: false',
        '      - run: tar --no-same-owner --no-same-permissions -xf /ctx/deps.tar -C /',
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
        '    timeout-minutes: 10',
        "    environment: ${{ inputs.rollback_environment || inputs.environment || 'production' }}",
        '    steps:',
        '      - env:',
        '          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}',
        '        run: |',
        '          curl --silent --show-error --location --fail-with-body \\',
        '            -X POST "$DEPLOY_WEBHOOK_URL" -d "$PAYLOAD"',
        '      - env:',
        '          DEPLOY_WEBHOOK_URL: ${{ secrets.DEPLOY_WEBHOOK_URL }}',
        '        run: |',
        '          curl -fsSL -X POST "$DEPLOY_WEBHOOK_URL" -H "X-Deploy-Signature-256: sha256=abc"',
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
        '    timeout-minutes: 20',
        '    steps:',
        '      - uses: actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0',
        '        with:',
        '          path: /tmp/buildkit-mounts/deps',
        "          key: buildkit-deps-amd64-${{ hashFiles('package-lock.json') }}",
        '          restore-keys: |',
        '            buildkit-deps-amd64-',
        '      - uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0',
        '        with:',
        '          context: .',
        '          cache-from: type=gha,scope=app-amd64',
        '          cache-to: type=gha,scope=app-amd64,mode=max',
        '      - env:',
        '          GHA_CACHE_SCOPE: app-amd64',
        '        run: node scripts/test-container.mjs',
        '      - run: tar -xf /ctx/deps.tar -C /',
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    const reasons = violations.map((v) => v.reason);
    expect(reasons.some((r) => r.includes('with.persist-credentials: false'))).toBe(true);
    expect(reasons.some((r) => r.includes('crazy-max/ghaction-github-runtime must be guarded'))).toBe(true);
    expect(reasons.some((r) => r.includes('executes npm install/ci on pull_request while holding write permissions'))).toBe(true);
    expect(
      reasons.some((r) =>
        r.includes('Job "checkout-only-write" executes actions/checkout on pull_request while holding write permissions')
      )
    ).toBe(true);
    expect(
      reasons.some((r) =>
        r.includes('BuildKit cache archive extraction in ci.yml must run "validate_cache_archive"')
      )
    ).toBe(true);
    expect(reasons.some((r) => r.includes('"rollback_environment" must not be exposed on workflow_dispatch'))).toBe(true);
    expect(reasons.some((r) => r.includes('references rollback_environment without guarding on "github.event_name == \'workflow_call\'"'))).toBe(true);
    expect(
      reasons.filter((r) => r.includes('invokes curl with "--location" / "-L" redirect following')).length
    ).toBe(2);
    expect(reasons.some((r) => r.includes('"release-" namespaced cache key'))).toBe(true);
    expect(reasons.some((r) => r.includes('omit prefix "restore-keys"'))).toBe(true);
    expect(
      reasons.some((r) =>
        r.includes('docker/build-push-action "cache-from" in publish-artifact.yml must isolate BuildKit GitHub Actions caches under a "scope=release-..."')
      )
    ).toBe(true);
    expect(
      reasons.some((r) =>
        r.includes('docker/build-push-action "cache-to" in publish-artifact.yml must isolate BuildKit GitHub Actions caches under a "scope=release-..."')
      )
    ).toBe(true);
    expect(
      reasons.some((r) =>
        r.includes('GHA_CACHE_SCOPE in publish-artifact.yml must use a "release-" namespaced cache scope')
      )
    ).toBe(true);
    expect(reasons.some((r) => r.includes('--no-same-owner --no-same-permissions'))).toBe(true);
  });

  it('rejects non-cancelling concurrency blocks without queue: max and actions/deploy-pages jobs without github-pages FIFO concurrency', () => {
    const validCheckoutSha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
    const validDeployPagesSha = '368f82528645a54fb793d4d04e342629a3f51346';

    fs.writeFileSync(
      path.join(workflowsDir, 'missing-queues.yml'),
      [
        'name: Missing Queue Policies',
        'on:',
        '  push:',
        '    branches: [ main ]',
        'permissions:',
        '  contents: read',
        'concurrency:',
        '  group: ${{ github.workflow }}-${{ github.ref }}',
        "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        'jobs:',
        '  scalar-lock:',
        '    runs-on: ubuntu-latest',
        '    concurrency: custom-job-lock',
        '    steps:',
        '      - run: echo "scalar"',
        '  deploy-docs:',
        '    runs-on: ubuntu-latest',
        '    concurrency:',
        '      group: wrong-pages-group',
        '      cancel-in-progress: false',
        '    steps:',
        `      - uses: actions/checkout@${validCheckoutSha} # v7.0.1`,
        '        with:',
        '          persist-credentials: false',
        `      - uses: actions/deploy-pages@${validDeployPagesSha} # v5.0.1`,
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: '.github/workflows/missing-queues.yml',
          actionRef: 'concurrency',
          reason: expect.stringContaining('Non-cancelling concurrency block must set "queue: max"'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/missing-queues.yml',
          actionRef: 'jobs.scalar-lock.concurrency',
          reason: expect.stringContaining(
            'Non-cancelling jobs.scalar-lock.concurrency block must set "queue: max"'
          ),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/missing-queues.yml',
          actionRef: 'jobs.deploy-docs.concurrency',
          reason: expect.stringContaining(
            'Non-cancelling jobs.deploy-docs.concurrency block must set "queue: max"'
          ),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/missing-queues.yml',
          actionRef: `actions/deploy-pages@${validDeployPagesSha}`,
          reason: expect.stringContaining(
            'Job "deploy-docs" uses actions/deploy-pages without "github-pages" FIFO concurrency'
          ),
        }),
      ])
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'cancelling-pages.yml'),
      [
        'name: Cancelling Pages Job',
        'on:',
        '  pull_request:',
        'permissions:',
        '  contents: read',
        'concurrency:',
        '  group: pr-${{ github.ref }}',
        '  cancel-in-progress: true',
        'jobs:',
        '  deploy-docs:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    concurrency:',
        '      group: github-pages',
        '      cancel-in-progress: true',
        '    steps:',
        `      - uses: actions/deploy-pages@${validDeployPagesSha} # v5.0.1`,
        '',
      ].join('\n')
    );

    const cancellingRes = checkActionPins(workflowsDir);
    const cancellingFileViolations = cancellingRes.violations.filter(
      (v) => v.filePath === '.github/workflows/cancelling-pages.yml'
    );
    // Top-level cancel-in-progress: true does not require queue: max, while actions/deploy-pages still rejects cancel-in-progress: true
    expect(cancellingFileViolations).toHaveLength(1);
    expect(cancellingFileViolations[0]).toMatchObject({
      actionRef: `actions/deploy-pages@${validDeployPagesSha}`,
      reason: expect.stringContaining(
        'Job "deploy-docs" uses actions/deploy-pages without "github-pages" FIFO concurrency'
      ),
    });

    fs.rmSync(path.join(workflowsDir, 'missing-queues.yml'));
    fs.rmSync(path.join(workflowsDir, 'cancelling-pages.yml'));
    fs.writeFileSync(
      path.join(workflowsDir, 'compliant-queues.yml'),
      [
        'name: Compliant Queue & Pages Workflow',
        'on:',
        '  push:',
        '    branches: [ main ]',
        '  pull_request:',
        'permissions:',
        '  contents: read',
        'concurrency:',
        '  group: ${{ github.workflow }}-${{ github.ref }}',
        "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
        '  queue: max',
        'jobs:',
        '  pr-lint:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    concurrency:',
        '      group: pr-lint-${{ github.ref }}',
        '      cancel-in-progress: true',
        '    steps:',
        '      - run: echo "ok"',
        '  deploy-docs:',
        '    if: github.ref == \'refs/heads/main\' && github.event_name == \'push\'',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 15',
        '    concurrency:',
        '      group: github-pages',
        '      cancel-in-progress: false',
        '      queue: max',
        '    steps:',
        `      - uses: actions/checkout@${validCheckoutSha} # v7.0.1`,
        '        with:',
        '          persist-credentials: false',
        `      - uses: actions/deploy-pages@${validDeployPagesSha} # v5.0.1`,
        '',
      ].join('\n')
    );

    expect(checkActionPins(workflowsDir).violations).toEqual([]);

    const cliPositionalPass = spawnSync(
      process.execPath,
      [TSX_CLI_PATH, CHECK_SCRIPT_PATH, path.join(workflowsDir, 'compliant-queues.yml')],
      { cwd: tempDir, encoding: 'utf8' }
    );
    expect(cliPositionalPass.status).toBe(0);

    const cliUnknownFlag = spawnSync(
      process.execPath,
      [TSX_CLI_PATH, CHECK_SCRIPT_PATH, '--unknown-flag'],
      { cwd: tempDir, encoding: 'utf8' }
    );
    expect(cliUnknownFlag.status).toBe(1);
  });

  it('rejects runs-on jobs with missing, non-integer, zero, negative, or over-60 timeout-minutes and invalid step timeouts', () => {
    fs.writeFileSync(
      path.join(workflowsDir, 'invalid-timeouts.yml'),
      [
        'name: Invalid Timeouts',
        'on:',
        '  workflow_dispatch:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  missing-timeout:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: echo "missing"',
        '  float-timeout:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 12.5',
        '    steps:',
        '      - run: echo "float"',
        '  string-timeout:',
        '    runs-on: ubuntu-latest',
        "    timeout-minutes: '10'",
        '    steps:',
        '      - run: echo "string"',
        '  null-timeout:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes:',
        '    steps:',
        '      - run: echo "null"',
        '  zero-timeout:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 0',
        '    steps:',
        '      - run: echo "zero"',
        '  negative-timeout:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: -5',
        '    steps:',
        '      - run: echo "negative"',
        '  over-max-timeout:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 61',
        '    steps:',
        '      - run: echo "over-60"',
        '  step-budget-overflow:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    steps:',
        '      - name: Equal to job timeout',
        '        timeout-minutes: 10',
        '        run: echo "equal"',
        '      - name: Exceeds job timeout',
        '        timeout-minutes: 15',
        '        run: echo "exceeds"',
        '      - name: Zero step timeout',
        '        timeout-minutes: 0',
        '        run: echo "zero-step"',
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    expect(violations).toEqual([
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 7,
        actionRef: 'jobs.missing-timeout.timeout-minutes',
        reason: expect.stringContaining(
          'Job "missing-timeout" with runs-on must set an explicit integer "timeout-minutes" between 1 and 60'
        ),
      }),
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 13,
        actionRef: 'jobs.float-timeout.timeout-minutes',
        reason: expect.stringContaining('integer between 1 and 60 (got 12.5)'),
      }),
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 18,
        actionRef: 'jobs.string-timeout.timeout-minutes',
        reason: expect.stringContaining('integer between 1 and 60 (got "10")'),
      }),
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 23,
        actionRef: 'jobs.null-timeout.timeout-minutes',
        reason: expect.stringContaining('integer between 1 and 60 (got null)'),
      }),
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 28,
        actionRef: 'jobs.zero-timeout.timeout-minutes',
        reason: expect.stringContaining('integer between 1 and 60 (got 0)'),
      }),
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 33,
        actionRef: 'jobs.negative-timeout.timeout-minutes',
        reason: expect.stringContaining('integer between 1 and 60 (got -5)'),
      }),
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 38,
        actionRef: 'jobs.over-max-timeout.timeout-minutes',
        reason: expect.stringContaining('integer between 1 and 60 (got 61)'),
      }),
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 46,
        actionRef: 'jobs.step-budget-overflow.steps[0].timeout-minutes',
        reason: expect.stringContaining('strictly less than enclosing job "timeout-minutes: 10"'),
      }),
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 49,
        actionRef: 'jobs.step-budget-overflow.steps[1].timeout-minutes',
        reason: expect.stringContaining('strictly less than enclosing job "timeout-minutes: 10"'),
      }),
      expect.objectContaining({
        filePath: '.github/workflows/invalid-timeouts.yml',
        lineNumber: 52,
        actionRef: 'jobs.step-budget-overflow.steps[2].timeout-minutes',
        reason: expect.stringContaining('integer between 1 and 60 (got 0)'),
      }),
    ]);

    const cliResult = spawnSync(process.execPath, [TSX_CLI_PATH, CHECK_SCRIPT_PATH], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    expect(cliResult.status).toBe(1);
    expect(cliResult.stderr).toContain('.github/workflows/invalid-timeouts.yml:7');
    expect(cliResult.stderr).toContain(
      'Job "missing-timeout" with runs-on must set an explicit integer "timeout-minutes" between 1 and 60'
    );
    expect(cliResult.stderr).toContain(
      'Every runs-on job must declare an integer "timeout-minutes" between 1 and 60'
    );
  });

  it('accepts reusable workflow caller jobs without runs-on or timeout-minutes and verifies live workflow timeout budgets', () => {
    fs.writeFileSync(
      path.join(workflowsDir, 'reusable-caller.yml'),
      [
        'name: Reusable Caller Workflow',
        'on:',
        '  workflow_call:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  database-migration:',
        '    uses: ./.github/workflows/db-migrate.yml',
        '    with:',
        '      environment: staging',
        '    secrets: inherit',
        '  deploy-provider:',
        '    needs: [database-migration]',
        '    uses: ./.github/workflows/deploy-provider.yml',
        '    with:',
        '      environment: staging',
        '    secrets: inherit',
        '  min-bound:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 1',
        '    steps:',
        '      - run: echo "min"',
        '  max-bound:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 60',
        '    steps:',
        '      - name: Bounded step',
        '        timeout-minutes: 59',
        '        run: echo "max"',
        '',
      ].join('\n')
    );

    expect(checkActionPins(workflowsDir).violations).toEqual([]);

    // Verify all live runner jobs (including ci-complete), 5-minute rollback cap, and step < job timeout invariant
    const liveWorkflowNames = fs
      .readdirSync(LIVE_WORKFLOWS_DIR)
      .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
      .sort();

    let runnerJobCount = 0;
    let reusableCallerJobCount = 0;
    let configuredStepTimeoutCount = 0;

    for (const fileName of liveWorkflowNames) {
      const content = fs.readFileSync(path.join(LIVE_WORKFLOWS_DIR, fileName), 'utf8');
      const doc = parseDocument(content, { version: '1.2', strict: true });
      expect(doc.errors).toEqual([]);
      expect(isMap(doc.contents)).toBe(true);
      if (!isMap(doc.contents)) continue;

      const jobsNode: unknown = doc.contents.get('jobs', true);
      if (!isMap(jobsNode)) continue;

      for (const jobPair of jobsNode.items) {
        if (!isPair(jobPair) || !isScalar(jobPair.key) || !isMap(jobPair.value)) continue;
        const jobMap = jobPair.value;

        if (!jobMap.has('runs-on')) {
          expect(jobMap.has('uses')).toBe(true);
          reusableCallerJobCount += 1;
          continue;
        }

        runnerJobCount += 1;
        const jobTimeoutNode: unknown = jobMap.get('timeout-minutes', true);
        expect(isScalar(jobTimeoutNode)).toBe(true);
        if (!isScalar(jobTimeoutNode)) continue;

        const jobTimeout = jobTimeoutNode.value;
        expect(typeof jobTimeout).toBe('number');
        expect(Number.isInteger(jobTimeout)).toBe(true);
        expect(jobTimeout).toBeGreaterThanOrEqual(1);
        expect(jobTimeout).toBeLessThanOrEqual(60);

        if (fileName === 'rollback.yml') {
          expect(jobTimeout).toBeLessThanOrEqual(5);
        }

        const stepsNode: unknown = jobMap.get('steps', true);
        if (!isSeq(stepsNode)) continue;
        for (const stepNode of stepsNode.items) {
          if (!isMap(stepNode) || !stepNode.has('timeout-minutes')) continue;
          configuredStepTimeoutCount += 1;
          const stepTimeoutNode: unknown = stepNode.get('timeout-minutes', true);
          expect(isScalar(stepTimeoutNode)).toBe(true);
          if (!isScalar(stepTimeoutNode)) continue;
          expect(typeof stepTimeoutNode.value).toBe('number');
          expect(Number.isInteger(stepTimeoutNode.value)).toBe(true);
          expect(stepTimeoutNode.value).toBeGreaterThanOrEqual(1);
          expect(stepTimeoutNode.value).toBeLessThan(jobTimeout as number);
        }
      }
    }

    expect(runnerJobCount).toBeGreaterThanOrEqual(24);
    expect(reusableCallerJobCount).toBeGreaterThan(0);
    expect(configuredStepTimeoutCount).toBeGreaterThan(0);
  });

  it('scopes workflow scans to passed CLI .yml/.yaml paths while preserving full directory scanning with zero file arguments', () => {
    const cleanPath = path.join(workflowsDir, 'clean.yml');
    const brokenDraftPath = path.join(workflowsDir, 'broken-draft.yml');

    fs.writeFileSync(
      cleanPath,
      [
        'name: Clean Workflow',
        'on:',
        '  workflow_dispatch:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    steps:',
        '      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
        '        with:',
        '          persist-credentials: false',
        '',
      ].join('\n')
    );
    fs.writeFileSync(
      brokenDraftPath,
      [
        'name: Broken Draft Workflow',
        'on: [push]',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  bad:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '',
      ].join('\n')
    );

    // Scoped CLI call on clean.yml ignores broken-draft.yml
    const scopedPass = spawnSync(
      process.execPath,
      [TSX_CLI_PATH, CHECK_SCRIPT_PATH, '.github/workflows/clean.yml'],
      { cwd: tempDir, encoding: 'utf8' }
    );
    expect(scopedPass.status).toBe(0);
    expect(scopedPass.stdout).toContain('All 1 workflow file(s) parse cleanly');

    // Scoped CLI call on a deleted workflow path exits 0 cleanly
    const deletedPass = spawnSync(
      process.execPath,
      [TSX_CLI_PATH, CHECK_SCRIPT_PATH, '.github/workflows/deleted-workflow.yml'],
      { cwd: tempDir, encoding: 'utf8' }
    );
    expect(deletedPass.status).toBe(0);
    expect(deletedPass.stdout).toContain('All 0 workflow file(s) parse cleanly');

    // Scoped CLI call on broken-draft.yml fails
    const scopedFail = spawnSync(
      process.execPath,
      [TSX_CLI_PATH, CHECK_SCRIPT_PATH, brokenDraftPath],
      { cwd: tempDir, encoding: 'utf8' }
    );
    expect(scopedFail.status).toBe(1);
    expect(scopedFail.stderr).toContain('.github/workflows/broken-draft.yml');

    // Zero file arguments preserves full-repository workflow scan
    const fullScanFail = spawnSync(process.execPath, [TSX_CLI_PATH, CHECK_SCRIPT_PATH], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    expect(fullScanFail.status).toBe(1);
    expect(fullScanFail.stderr).toContain('.github/workflows/broken-draft.yml');
  });
});
