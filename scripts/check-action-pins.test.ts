/**
 * @jest-environment node
 */
import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
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

  it('parses multiline, folded, flow, empty, non-scalar, and reusable job uses directives via AST', () => {
    const validSha = '3d3c42e5aac5ba805825da76410c181273ba90b1';

    fs.writeFileSync(
      path.join(workflowsDir, 'multiline-valid.yml'),
      [
        'name: Valid Multiline & Reusable Job Uses',
        'on:',
        '  workflow_dispatch:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  reusable-local:',
        '    uses: ./.github/workflows/local.yml',
        '  reusable-pinned:',
        '    uses: >-# v1.4.0',
        `      octo-org/shared-workflows/.github/workflows/release.yml@${validSha}`,
        '  steps-multiline:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses:',
        `          actions/checkout@${validSha} # v7.0.1`,
        '        with:',
        '          persist-credentials: false',
        '      - uses: >- # v7.1.0',
        '          actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
        '',
      ].join('\n').replace('>-# v1.4.0', '>- # v1.4.0')
    );

    expect(checkActionPins(workflowsDir).violations).toEqual([]);

    fs.writeFileSync(
      path.join(workflowsDir, 'multiline-invalid.yml'),
      [
        'name: Invalid AST Uses Forms',
        'on:',
        '  workflow_dispatch:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  unpinned-reusable:',
        '    uses: octo-org/shared-workflows/.github/workflows/release.yml@main',
        '  empty-job-uses:',
        '    uses:',
        '  step-forms:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: >-',
        '          actions/setup-node@v4',
        '      - { "uses": "actions/cache@v4" }',
        '      - uses: "   "',
        '      - uses: [actions/upload-artifact@v4]',
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: '.github/workflows/multiline-invalid.yml',
          actionRef: 'octo-org/shared-workflows/.github/workflows/release.yml@main',
          reason: expect.stringContaining('is not a 40-character commit SHA'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/multiline-invalid.yml',
          actionRef: 'jobs.empty-job-uses.uses',
          reason: expect.stringContaining('Empty "uses" directive'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/multiline-invalid.yml',
          actionRef: 'actions/setup-node@v4',
          reason: expect.stringContaining('is not a 40-character commit SHA'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/multiline-invalid.yml',
          actionRef: 'actions/cache@v4',
          reason: expect.stringContaining('is not a 40-character commit SHA'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/multiline-invalid.yml',
          actionRef: 'jobs.step-forms.steps[2].uses',
          reason: expect.stringContaining('Empty "uses" directive'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/multiline-invalid.yml',
          actionRef: 'jobs.step-forms.steps[3].uses',
          reason: expect.stringContaining('Non-scalar "uses" directive'),
        }),
      ])
    );
  });

  it('verifies upstream commit SHAs with --verify-upstream and GITHUB_TOKEN via tag peeling and branch ancestry and rejects nonexistent or fork SHAs', async () => {
    const validCheckoutSha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
    const checkoutAnnotatedTagSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const validCodeqlSha = '33d7b85da1a04171e211befe2c739303b9a4c066';
    const brokenAttestSha = 'c0744595e72338575084a4bf85ed76e1eb521ddf';
    const forkCommitSha = 'ffffffffffffffffffffffffffffffffffffffff';
    const mainHeadSha = '1111111111111111111111111111111111111111';

    const requestedPaths: string[] = [];
    const authHeaders: Array<string | null> = [];
    const inProcessApiBase = 'https://mock-github-api.local';

    const routeMockGitHubApi = (
      pathname: string,
      search: string
    ): { status: number; body: Record<string, unknown> | Array<Record<string, unknown>> } => {
      // 1. Commit existence checks
      if (pathname === `/repos/actions/checkout/commits/${validCheckoutSha}`) {
        return { status: 200, body: { sha: validCheckoutSha } };
      }
      if (pathname === `/repos/actions/checkout/commits/${forkCommitSha}`) {
        // Simulates GitHub shared fork network returning HTTP 200 for an unmerged fork commit
        return { status: 200, body: { sha: forkCommitSha } };
      }
      if (pathname === `/repos/github/codeql-action/commits/${validCodeqlSha}`) {
        return { status: 200, body: { sha: validCodeqlSha } };
      }
      if (pathname === `/repos/actions/attest-build-provenance/commits/${brokenAttestSha}`) {
        return { status: 422, body: { message: `No commit found for SHA: ${brokenAttestSha}` } };
      }

      // 2. Annotated tag peeling for actions/checkout v7.0.1 -> tag object -> validCheckoutSha
      if (pathname === '/repos/actions/checkout/git/ref/tags/v7.0.1') {
        return {
          status: 200,
          body: {
            ref: 'refs/tags/v7.0.1',
            object: { type: 'tag', sha: checkoutAnnotatedTagSha },
          },
        };
      }
      if (pathname === `/repos/actions/checkout/git/tags/${checkoutAnnotatedTagSha}`) {
        return {
          status: 200,
          body: {
            sha: checkoutAnnotatedTagSha,
            object: { type: 'commit', sha: validCheckoutSha },
          },
        };
      }

      // 3. Fork commit comparison against checkout tag & branches (diverged / ahead -> rejected)
      if (pathname === `/repos/actions/checkout/compare/${validCheckoutSha}...${forkCommitSha}`) {
        return { status: 200, body: { status: 'ahead', ahead_by: 1, behind_by: 0 } };
      }
      if (pathname === '/repos/actions/checkout') {
        return { status: 200, body: { default_branch: 'main' } };
      }
      if (pathname === `/repos/actions/checkout/compare/main...${forkCommitSha}`) {
        return { status: 200, body: { status: 'diverged', ahead_by: 1, behind_by: 2 } };
      }
      if (pathname === '/repos/actions/checkout/branches' && search === '?per_page=100') {
        return {
          status: 200,
          body: [{ name: 'main', commit: { sha: mainHeadSha } }],
        };
      }

      // 4. Branch ancestry for github/codeql-action (tag 404 -> default_branch main -> behind)
      if (pathname === '/repos/github/codeql-action/git/ref/tags/v4.39.3') {
        return { status: 404, body: { message: 'Not Found' } };
      }
      if (pathname === '/repos/github/codeql-action') {
        return { status: 200, body: { default_branch: 'main' } };
      }
      if (pathname === `/repos/github/codeql-action/compare/main...${validCodeqlSha}`) {
        return { status: 200, body: { status: 'behind', ahead_by: 0, behind_by: 4 } };
      }

      return { status: 404, body: { message: 'Not Found' } };
    };

    mswServer.use(
      mswHttp.get(`${inProcessApiBase}/*`, ({ request }) => {
        const parsed = new URL(request.url);
        requestedPaths.push(`${parsed.pathname}${parsed.search}`);
        authHeaders.push(request.headers.get('authorization'));
        const mocked = routeMockGitHubApi(parsed.pathname, parsed.search);
        return HttpResponse.json(mocked.body, { status: mocked.status });
      })
    );

    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
      const mocked = routeMockGitHubApi(parsed.pathname, parsed.search);
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
          '    steps:',
          `      - uses: actions/checkout@${validCheckoutSha} # v7.0.1`,
          '        with:',
          '          persist-credentials: false',
          `      - uses: actions/checkout@${validCheckoutSha} # v7.0.1`,
          '        with:',
          '          persist-credentials: false',
          `      - uses: github/codeql-action/upload-sarif@${validCodeqlSha} # v4.39.3`,
          `      - uses: actions/attest-build-provenance@${brokenAttestSha} # v2.2.3`,
          `      - uses: actions/checkout@${forkCommitSha} # v7.0.1`,
          '        with:',
          '          persist-credentials: false',
          '',
        ].join('\n')
      );

      // Default offline check passes syntactically valid 40-char SHA + # v... comment without HTTP calls
      expect(checkActionPins(workflowsDir).violations).toEqual([]);
      expect(requestedPaths).toEqual([]);

      // Programmatic --verify-upstream deduplicates pins, peels annotated tags, checks branch ancestry,
      // and rejects both HTTP 422 SHAs and unmerged fork SHAs
      const upstreamRes = await verifyUpstreamActionPins(workflowsDir, {
        apiBaseUrl: inProcessApiBase,
        token: 'ghs_mock_ci_token',
      });
      expect(upstreamRes.verifiedPins).toBe(4);
      expect(requestedPaths).toEqual([
        `/repos/actions/checkout/commits/${validCheckoutSha}`,
        '/repos/actions/checkout/git/ref/tags/v7.0.1',
        `/repos/actions/checkout/git/tags/${checkoutAnnotatedTagSha}`,
        `/repos/github/codeql-action/commits/${validCodeqlSha}`,
        '/repos/github/codeql-action/git/ref/tags/v4.39.3',
        '/repos/github/codeql-action',
        `/repos/github/codeql-action/compare/main...${validCodeqlSha}`,
        `/repos/actions/attest-build-provenance/commits/${brokenAttestSha}`,
        `/repos/actions/checkout/commits/${forkCommitSha}`,
        '/repos/actions/checkout/git/ref/tags/v7.0.1',
        `/repos/actions/checkout/git/tags/${checkoutAnnotatedTagSha}`,
        `/repos/actions/checkout/compare/${validCheckoutSha}...${forkCommitSha}`,
        '/repos/actions/checkout',
        `/repos/actions/checkout/compare/main...${forkCommitSha}`,
        '/repos/actions/checkout/branches?per_page=100',
      ]);
      expect(authHeaders.every((header) => header === 'Bearer ghs_mock_ci_token')).toBe(true);
      expect(upstreamRes.violations).toHaveLength(2);
      expect(upstreamRes.violations[0]).toMatchObject({
        filePath: '.github/workflows/upstream-check.yml',
        lineNumber: 17,
        actionRef: `actions/attest-build-provenance@${brokenAttestSha}`,
      });
      expect(upstreamRes.violations[0].reason).toContain(
        `Upstream commit "${brokenAttestSha}" does not exist in "actions/attest-build-provenance" (HTTP 422)`
      );
      expect(upstreamRes.violations[1]).toMatchObject({
        filePath: '.github/workflows/upstream-check.yml',
        lineNumber: 18,
        actionRef: `actions/checkout@${forkCommitSha}`,
      });
      expect(upstreamRes.violations[1].reason).toContain('unmerged fork commit');

      // CLI --verify-upstream exits non-zero and prints remediation on nonexistent or fork SHAs
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
      expect(cliFail.stderr).toContain('unmerged fork commit');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('verifies refs/heads/* and refs/tags/* via Git Smart HTTP fallback and rejects unmerged fork commits or unpeeled tag SHAs', async () => {
    const gitRoot = path.join(tempDir, 'git-remotes');
    const workTree = path.join(tempDir, 'git-work');
    const bareRepoPath = path.join(gitRoot, 'octo', 'custom-action.git');
    fs.mkdirSync(workTree, { recursive: true });
    fs.mkdirSync(path.dirname(bareRepoPath), { recursive: true });

    const runGit = (cwd: string, args: string[]): string =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test Author',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test Author',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        },
      }).trim();

    runGit(workTree, ['init', '-b', 'main']);
    fs.writeFileSync(path.join(workTree, 'action.yml'), 'name: v1\n');
    runGit(workTree, ['add', 'action.yml']);
    runGit(workTree, ['commit', '-m', 'Initial commit (branch ancestor)']);
    const ancestorSha = runGit(workTree, ['rev-parse', 'HEAD']);

    fs.writeFileSync(path.join(workTree, 'action.yml'), 'name: v2\n');
    runGit(workTree, ['add', 'action.yml']);
    runGit(workTree, ['commit', '-m', 'Release v2.0.0']);
    const annotatedTargetSha = runGit(workTree, ['rev-parse', 'HEAD']);
    runGit(workTree, ['tag', '-a', 'v2.0.0', '-m', 'Annotated v2.0.0']);
    const unpeeledTagObjectSha = runGit(workTree, ['rev-parse', 'v2.0.0']);

    fs.writeFileSync(path.join(workTree, 'action.yml'), 'name: main-tip\n');
    runGit(workTree, ['add', 'action.yml']);
    runGit(workTree, ['commit', '-m', 'Main branch tip']);

    // Create an unmerged fork commit reachable only via refs/pull/99/head
    runGit(workTree, ['checkout', '-b', 'fork-branch', annotatedTargetSha]);
    fs.writeFileSync(path.join(workTree, 'action.yml'), 'name: malicious-fork\n');
    runGit(workTree, ['add', 'action.yml']);
    runGit(workTree, ['commit', '-m', 'Unmerged fork PR commit']);
    const forkPrSha = runGit(workTree, ['rev-parse', 'HEAD']);
    runGit(workTree, ['checkout', 'main']);
    runGit(workTree, ['branch', '-D', 'fork-branch']);

    runGit(tempDir, ['clone', '--bare', '--quiet', workTree, bareRepoPath]);
    runGit(bareRepoPath, ['update-ref', 'refs/pull/99/head', forkPrSha]);

    const rateLimitedApiBase = 'https://rate-limited-github-api.local';
    mswServer.use(
      mswHttp.get(`${rateLimitedApiBase}/*`, () =>
        HttpResponse.json({ message: 'API rate limit exceeded' }, { status: 403 })
      )
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'git-fallback.yml'),
      [
        'name: Git Fallback Ancestry Check',
        'on:',
        '  push:',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        `      - uses: octo/custom-action@${annotatedTargetSha} # v2.0.0`,
        `      - uses: octo/custom-action@${ancestorSha} # v1.0.0`,
        `      - uses: octo/custom-action@${forkPrSha} # v2.0.0`,
        `      - uses: octo/custom-action@${unpeeledTagObjectSha} # v2.0.0`,
        '',
      ].join('\n')
    );

    const res = await verifyUpstreamActionPins(workflowsDir, {
      apiBaseUrl: rateLimitedApiBase,
      gitBaseUrl: pathToFileURL(gitRoot).href,
      token: '',
    });

    expect(res.violations).toHaveLength(2);
    expect(res.violations.map((v) => v.actionRef)).toEqual([
      `octo/custom-action@${forkPrSha}`,
      `octo/custom-action@${unpeeledTagObjectSha}`,
    ]);
    expect(res.violations.every((v) => v.reason.includes('not reachable'))).toBe(true);
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

  it('rejects pull_request_target/workflow_run hazards, || always() guard bypasses, omitted permissions, and run interpolations', () => {
    const runtimeSha = '04d248b84655b509d8c44dc1d6f990c879747487';

    fs.writeFileSync(
      path.join(workflowsDir, 'pr-target-omitted-perms.yml'),
      [
        'name: Omitted Permissions & OR Guard Bypass',
        'on:',
        '  push:',
        '  pull_request_target:',
        'jobs:',
        '  unsafe:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Install with default permissive token',
        '        run: npm ci',
        '      - name: Bypass guard with || always()',
        "        if: github.event_name != 'pull_request_target' || always()",
        `        uses: crazy-max/ghaction-github-runtime@${runtimeSha} # v4.0.0`,
        '      - name: Interpolate untrusted expression in run',
        '        run: |',
        '          if [ "${{ steps.prev.outcome }}" = "failure" ]; then echo "bad"; fi',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'workflow-run-partial-guard.yml'),
      [
        'name: Workflow Run & Partial Multi-Trigger Guard',
        'on: [push, pull_request, workflow_run]',
        'permissions:',
        '  contents: write',
        'jobs:',
        '  partial:',
        '    runs-on: ubuntu-latest',
        "    if: github.event_name != 'pull_request'",
        '    steps:',
        '      - run: npm install',
        `      - uses: crazy-max/ghaction-github-runtime@${runtimeSha} # v4.0.0`,
        "        if: github.event_name == 'push' || always()",
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: '.github/workflows/pr-target-omitted-perms.yml',
          actionRef: 'jobs.unsafe.permissions',
          reason: expect.stringContaining(
            'Job "unsafe" executes npm install/ci on pull_request_target while holding write permissions'
          ),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/pr-target-omitted-perms.yml',
          actionRef: `crazy-max/ghaction-github-runtime@${runtimeSha}`,
          reason: expect.stringContaining('crazy-max/ghaction-github-runtime must be guarded'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/pr-target-omitted-perms.yml',
          actionRef: 'jobs.unsafe.run',
          reason: expect.stringContaining('interpolates "${{ ... }}" directly inside a step "run" script'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/workflow-run-partial-guard.yml',
          actionRef: 'jobs.partial.permissions',
          reason: expect.stringContaining(
            'Job "partial" executes npm install/ci on pull_request/workflow_run while holding write permissions'
          ),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/workflow-run-partial-guard.yml',
          actionRef: `crazy-max/ghaction-github-runtime@${runtimeSha}`,
          reason: expect.stringContaining('crazy-max/ghaction-github-runtime must be guarded'),
        }),
      ])
    );

    // Verify compliant workflow with explicit read-only permissions, env binding, and complete boolean guards
    fs.rmSync(path.join(workflowsDir, 'pr-target-omitted-perms.yml'));
    fs.rmSync(path.join(workflowsDir, 'workflow-run-partial-guard.yml'));
    fs.writeFileSync(
      path.join(workflowsDir, 'hardened-guards.yml'),
      [
        'name: Hardened Guards & Env Binding',
        'on: [push, pull_request_target, workflow_run]',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  safe-install:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - run: npm ci',
        '      - env:',
        '          VERIFY_DOCS_OUTCOME: ${{ steps.prev.outcome }}',
        '        run: |',
        '          if [ "$VERIFY_DOCS_OUTCOME" = "failure" ]; then echo "safe"; fi',
        '  safe-privileged:',
        '    runs-on: ubuntu-latest',
        '    permissions:',
        '      contents: write',
        "    if: github.event_name != 'pull_request_target'",
        '    steps:',
        "      - if: (!cancelled()) && (github.event_name == 'push')",
        '        run: npm ci',
        "      - if: always() && github.event_name != 'workflow_run'",
        `        uses: crazy-max/ghaction-github-runtime@${runtimeSha} # v4.0.0`,
        '',
      ].join('\n')
    );

    expect(checkActionPins(workflowsDir).violations).toEqual([]);
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
        '    concurrency:',
        '      group: pr-lint-${{ github.ref }}',
        '      cancel-in-progress: true',
        '    steps:',
        '      - run: echo "ok"',
        '  deploy-docs:',
        "    if: github.ref == 'refs/heads/main' && github.event_name == 'push'",
        '    runs-on: ubuntu-latest',
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
  });
});
