/**
 * @jest-environment node
 */
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { http as mswHttp, HttpResponse } from 'msw';
import { parseDocument, isMap } from 'yaml';
import { server as mswServer } from '../../src/mocks/server';
import { checkActionPins, verifyUpstreamActionPins } from '../check-action-pins';
import {
  conditionExcludesTrigger,
  getUntrustedWorkflowTriggers,
  permissionsHaveWriteScope,
} from './condition-parser';

const REPO_ROOT = process.cwd();
const CHECK_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'check-action-pins.ts');
const TSX_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

describe('action-pins modular hardening', () => {
  let tempDir: string;
  let workflowsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-pins-hardening-test-'));
    workflowsDir = path.join(tempDir, '.github', 'workflows');
    fs.mkdirSync(workflowsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('condition-parser unit behavior', () => {
    it('extracts untrusted workflow triggers across scalar, sequence, and map forms', () => {
      const parseOn = (yamlSnippet: string): unknown => {
        const doc = parseDocument(yamlSnippet, { version: '1.2', strict: true });
        return isMap(doc.contents) ? doc.contents.get('on', true) : undefined;
      };

      expect(getUntrustedWorkflowTriggers(parseOn('on: pull_request_target\n'))).toEqual([
        'pull_request_target',
      ]);
      expect(
        getUntrustedWorkflowTriggers(
          parseOn('on: [push, pull_request, workflow_run, pull_request]\n')
        )
      ).toEqual(['pull_request', 'workflow_run']);
      expect(
        getUntrustedWorkflowTriggers(
          parseOn('on:\n  workflow_dispatch:\n  workflow_run:\n    workflows: [CI]\n')
        )
      ).toEqual(['workflow_run']);
      expect(getUntrustedWorkflowTriggers(parseOn('on: workflow_dispatch\n'))).toEqual([]);
    });

    it('evaluates compound boolean if expressions and rejects tautological or negated bypasses', () => {
      expect(
        conditionExcludesTrigger("github.event_name != 'pull_request'", 'pull_request')
      ).toBe(true);
      expect(
        conditionExcludesTrigger(
          "${{ always() && (github.event_name != 'pull_request_target') }}",
          'pull_request_target'
        )
      ).toBe(true);
      expect(
        conditionExcludesTrigger(
          "!(github.event_name == 'workflow_run') && !cancelled()",
          'workflow_run'
        )
      ).toBe(true);
      expect(
        conditionExcludesTrigger(
          "(github.event_name == 'push' || github.event_name == 'workflow_dispatch')",
          'pull_request'
        )
      ).toBe(true);
      expect(conditionExcludesTrigger('false', 'pull_request')).toBe(true);

      // Bypasses & malformed expressions must return false (fail-closed)
      expect(
        conditionExcludesTrigger(
          "github.event_name != 'pull_request' || always()",
          'pull_request'
        )
      ).toBe(false);
      expect(
        conditionExcludesTrigger(
          "!(github.event_name != 'pull_request')",
          'pull_request'
        )
      ).toBe(false);
      expect(
        conditionExcludesTrigger(
          "${{ github.event_name != 'pull_request' }} || ${{ true }}",
          'pull_request'
        )
      ).toBe(false);
      expect(conditionExcludesTrigger('true', 'pull_request')).toBe(false);
    });

    it('treats omitted or null permissions as write-capable while accepting read-all and empty maps', () => {
      const parsePerms = (yamlSnippet: string): unknown => {
        const doc = parseDocument(yamlSnippet, { version: '1.2', strict: true });
        return isMap(doc.contents) ? doc.contents.get('permissions', true) : undefined;
      };

      expect(permissionsHaveWriteScope(undefined)).toBe(true);
      expect(permissionsHaveWriteScope(null)).toBe(true);
      expect(permissionsHaveWriteScope(parsePerms('permissions:\n'))).toBe(true);
      expect(permissionsHaveWriteScope(parsePerms('permissions: write-all\n'))).toBe(true);
      expect(
        permissionsHaveWriteScope(
          parsePerms('permissions:\n  contents: read\n  pull-requests: write\n')
        )
      ).toBe(true);

      expect(permissionsHaveWriteScope(parsePerms('permissions: read-all\n'))).toBe(false);
      expect(permissionsHaveWriteScope(parsePerms('permissions: {}\n'))).toBe(false);
      expect(
        permissionsHaveWriteScope(
          parsePerms('permissions:\n  contents: read\n  actions: read\n')
        )
      ).toBe(false);
    });
  });

  it('parses multiline, folded, flow, empty, non-scalar, docker://, and reusable job uses directives via AST', () => {
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
        '    uses: >- # v1.4.0',
        `      octo-org/shared-workflows/.github/workflows/release.yml@${validSha}`,
        '  steps-multiline:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    steps:',
        '      - uses:',
        `          actions/checkout@${validSha} # v7.0.1`,
        '        with:',
        '          persist-credentials: false',
        '      - uses: >- # v7.1.0',
        '          actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1',
        '',
      ].join('\n')
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
        '    timeout-minutes: 10',
        '    steps:',
        '      - uses: >-',
        '          actions/setup-node@v4',
        '      - { "uses": "actions/cache@v4" }',
        '      - uses: "   "',
        '      - uses: [actions/upload-artifact@v4]',
        `      - uses: docker://alpine@${validSha} # v3.20.0`,
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
        expect.objectContaining({
          filePath: '.github/workflows/multiline-invalid.yml',
          actionRef: `docker://alpine@${validSha}`,
          reason: expect.stringContaining('must specify "<owner>/<repo>"'),
        }),
      ])
    );
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
        '    timeout-minutes: 10',
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
        '    timeout-minutes: 10',
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
          actionRef: 'jobs.unsafe.steps[2].run',
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
        '    timeout-minutes: 10',
        '    steps:',
        '      - run: npm ci',
        '      - env:',
        '          VERIFY_DOCS_OUTCOME: ${{ steps.prev.outcome }}',
        '        run: |',
        '          if [ "$VERIFY_DOCS_OUTCOME" = "failure" ]; then echo "safe"; fi',
        '  safe-privileged:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    permissions:',
        '      contents: write',
        "    if: github.event_name != 'pull_request_target'",
        '    steps:',
        "      - if: '(!cancelled()) && (github.event_name == ''push'')'",
        '        run: npm ci',
        "      - if: always() && github.event_name != 'workflow_run'",
        `        uses: crazy-max/ghaction-github-runtime@${runtimeSha} # v4.0.0`,
        '      - if: false',
        '        run: npm install',
        '',
      ].join('\n')
    );

    expect(checkActionPins(workflowsDir).violations).toEqual([]);
  });

  it('propagates workflow_run across local workflow_call chains and blocks secrets: inherit, unused workflow_call.secrets, and unscoped docker logins', () => {
    const validCheckoutSha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
    const validDockerLoginSha = '65827bcbf780a503db4802a746dd7ef81ee58d33';

    fs.writeFileSync(
      path.join(workflowsDir, 'deploy-caller.yml'),
      [
        'name: Untrusted Workflow Run Caller',
        'on:',
        '  workflow_run:',
        '    workflows: [CI]',
        '    types: [completed]',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  call-stage:',
        '    permissions:',
        '      contents: read',
        '      packages: write',
        '    uses: ./.github/workflows/stage-callee.yml',
        '    secrets: inherit',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'stage-callee.yml'),
      [
        'name: Intermediate Reusable Stage',
        'on:',
        '  workflow_call:',
        '    secrets:',
        '      USED_TOKEN:',
        '        required: false',
        '      UNUSED_DATABASE_URL:',
        '        required: false',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  call-leaf:',
        '    permissions:',
        '      contents: read',
        '      packages: write',
        '    uses: ./.github/workflows/leaf-callee.yml',
        '    secrets:',
        '      USED_TOKEN: ${{ secrets.USED_TOKEN }}',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'leaf-callee.yml'),
      [
        'name: Leaf Write Callee',
        'on:',
        '  workflow_call:',
        '    secrets:',
        '      USED_TOKEN:',
        '        required: false',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  unsafe-publish:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    permissions:',
        '      contents: read',
        '      packages: write',
        '    steps:',
        `      - uses: actions/checkout@${validCheckoutSha} # v7.0.1`,
        "        if: github.event_name == 'workflow_call'",
        '        with:',
        '          persist-credentials: false',
        '      - run: bash ./scripts/ghcr-release-promotion.sh extract-promoted-sboms',
        `      - uses: docker/login-action@${validDockerLoginSha} # v4.1.0`,
        '        with:',
        '          registry: ghcr.io',
        '          username: ${{ github.actor }}',
        '          password: ${{ secrets.USED_TOKEN }}',
        '      - env:',
        '          GH_TOKEN: ${{ github.token }}',
        '        run: echo "$GH_TOKEN" | docker login ghcr.io -u octocat --password-stdin',
        '',
      ].join('\n')
    );

    const { violations } = checkActionPins(workflowsDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: '.github/workflows/deploy-caller.yml',
          actionRef: 'jobs.call-stage.secrets',
          reason: expect.stringContaining('uses "secrets: inherit"'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/stage-callee.yml',
          actionRef: 'on.workflow_call.secrets.UNUSED_DATABASE_URL',
          reason: expect.stringContaining('UNUSED_DATABASE_URL'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/leaf-callee.yml',
          actionRef: 'jobs.unsafe-publish.permissions',
          reason: expect.stringContaining(
            'Job "unsafe-publish" executes actions/checkout on workflow_run (via workflow_call from deploy-caller.yml -> stage-callee.yml) while holding write permissions'
          ),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/leaf-callee.yml',
          actionRef: 'jobs.unsafe-publish.permissions',
          reason: expect.stringContaining(
            'Job "unsafe-publish" executes npm or repository scripts on workflow_run (via workflow_call from deploy-caller.yml -> stage-callee.yml) while holding write permissions'
          ),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/leaf-callee.yml',
          actionRef: `docker/login-action@${validDockerLoginSha}`,
          reason: expect.stringContaining('uses docker/login-action without binding a temporary "DOCKER_CONFIG"'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/leaf-callee.yml',
          actionRef: 'jobs.unsafe-publish.steps[3].docker-login',
          reason: expect.stringContaining('runs "docker login" without scoping credentials to a temporary "DOCKER_CONFIG"'),
        }),
      ])
    );

    // Replace with split read-only preflight + checkout-free write job, explicit secret maps, and temporary DOCKER_CONFIG cleanup
    fs.writeFileSync(
      path.join(workflowsDir, 'deploy-caller.yml'),
      [
        'name: Hardened Workflow Run Caller',
        'on:',
        '  workflow_run:',
        '    workflows: [CI]',
        '    types: [completed]',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  call-stage:',
        '    permissions:',
        '      contents: read',
        '      packages: write',
        '    uses: ./.github/workflows/stage-callee.yml',
        '    secrets:',
        '      USED_TOKEN: ${{ secrets.DOCKERHUB_TOKEN }}',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'stage-callee.yml'),
      [
        'name: Hardened Reusable Stage',
        'on:',
        '  workflow_call:',
        '    secrets:',
        '      USED_TOKEN:',
        '        required: false',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  call-leaf:',
        '    permissions:',
        '      contents: read',
        '      packages: write',
        '    uses: ./.github/workflows/leaf-callee.yml',
        '    secrets:',
        '      USED_TOKEN: ${{ secrets.USED_TOKEN }}',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(workflowsDir, 'leaf-callee.yml'),
      [
        'name: Hardened Split Leaf Callee',
        'on:',
        '  workflow_call:',
        '    secrets:',
        '      USED_TOKEN:',
        '        required: false',
        'permissions:',
        '  contents: read',
        'jobs:',
        '  preflight:',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    permissions:',
        '      contents: read',
        '    steps:',
        `      - uses: actions/checkout@${validCheckoutSha} # v7.0.1`,
        '        with:',
        '          persist-credentials: false',
        '      - env:',
        '          GH_TOKEN: ${{ github.token }}',
        '        run: |',
        '          SCOPED_DOCKER_CONFIG="$(mktemp -d)"',
        '          chmod 700 "$SCOPED_DOCKER_CONFIG"',
        '          export DOCKER_CONFIG="$SCOPED_DOCKER_CONFIG"',
        '          trap \'rm -rf "$SCOPED_DOCKER_CONFIG"\' EXIT',
        '          printf "%s\\n" "$GH_TOKEN" | docker login ghcr.io -u octocat --password-stdin',
        '          bash ./scripts/ghcr-release-promotion.sh extract-promoted-sboms',
        '  publish:',
        '    needs: [preflight]',
        '    runs-on: ubuntu-latest',
        '    timeout-minutes: 10',
        '    permissions:',
        '      contents: read',
        '      packages: write',
        '    steps:',
        '      - id: docker-config',
        '        run: |',
        '          SCOPED_DIR="$(mktemp -d)"',
        '          chmod 700 "$SCOPED_DIR"',
        '          echo "path=${SCOPED_DIR}" >> "$GITHUB_OUTPUT"',
        `      - uses: docker/login-action@${validDockerLoginSha} # v4.1.0`,
        '        env:',
        '          DOCKER_CONFIG: ${{ steps.docker-config.outputs.path }}',
        '        with:',
        '          registry: ghcr.io',
        '          username: ${{ github.actor }}',
        '          password: ${{ secrets.USED_TOKEN }}',
        '      - if: always()',
        '        env:',
        '          SCOPED_DOCKER_CONFIG: ${{ steps.docker-config.outputs.path }}',
        '        run: rm -rf "$SCOPED_DOCKER_CONFIG"',
        '',
      ].join('\n')
    );

    expect(checkActionPins(workflowsDir).violations).toEqual([]);
  });

  it('peels annotated tags, checks branch ancestry with per-repo memoization, and rejects unmerged fork SHAs via REST API', async () => {
    const validCheckoutSha = '3d3c42e5aac5ba805825da76410c181273ba90b1';
    const checkoutAnnotatedTagSha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const validCodeqlSha = '33d7b85da1a04171e211befe2c739303b9a4c066';
    const forkCommitSha = 'ffffffffffffffffffffffffffffffffffffffff';
    const mainHeadSha = '1111111111111111111111111111111111111111';

    const requestedPaths: string[] = [];
    const inProcessApiBase = 'https://mock-github-ancestry.local';

    const routeMockGitHubApi = (
      pathname: string,
      search: string
    ): { status: number; body: Record<string, unknown> | Array<Record<string, unknown>> } => {
      if (pathname === `/repos/actions/checkout/commits/${validCheckoutSha}`) {
        return { status: 200, body: { sha: validCheckoutSha } };
      }
      if (pathname === `/repos/actions/checkout/commits/${forkCommitSha}`) {
        // GitHub's shared fork object network returns HTTP 200 for unmerged fork commits
        return { status: 200, body: { sha: forkCommitSha } };
      }
      if (pathname === `/repos/github/codeql-action/commits/${validCodeqlSha}`) {
        return { status: 200, body: { sha: validCodeqlSha } };
      }

      // Annotated tag peeling for actions/checkout v7.0.1 -> tag object -> validCheckoutSha
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

      // Fork commit comparison against checkout tag & branches (ahead/diverged -> rejected)
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

      // Branch ancestry fallback for github/codeql-action (tag 404 -> default_branch main -> behind)
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
        path.join(workflowsDir, 'ancestry-check.yml'),
        [
          'name: Upstream Ancestry Verification',
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
          `      - uses: github/codeql-action/upload-sarif@${validCodeqlSha} # v4.39.3`,
          `      - uses: actions/checkout@${forkCommitSha} # v7.0.1`,
          '        with:',
          '          persist-credentials: false',
          '',
        ].join('\n')
      );

      const upstreamRes = await verifyUpstreamActionPins(workflowsDir, {
        apiBaseUrl: inProcessApiBase,
        token: 'ghs_mock_ci_token',
      });
      expect(upstreamRes.verifiedPins).toBe(3);
      // Tag peeling for actions/checkout#v7.0.1 is memoized and not re-fetched for forkCommitSha
      expect(requestedPaths).toEqual([
        `/repos/actions/checkout/commits/${validCheckoutSha}`,
        '/repos/actions/checkout/git/ref/tags/v7.0.1',
        `/repos/actions/checkout/git/tags/${checkoutAnnotatedTagSha}`,
        `/repos/github/codeql-action/commits/${validCodeqlSha}`,
        '/repos/github/codeql-action/git/ref/tags/v4.39.3',
        '/repos/github/codeql-action',
        `/repos/github/codeql-action/compare/main...${validCodeqlSha}`,
        `/repos/actions/checkout/commits/${forkCommitSha}`,
        `/repos/actions/checkout/compare/${validCheckoutSha}...${forkCommitSha}`,
        '/repos/actions/checkout',
        `/repos/actions/checkout/compare/main...${forkCommitSha}`,
        '/repos/actions/checkout/branches?per_page=100',
      ]);
      expect(upstreamRes.violations).toHaveLength(1);
      expect(upstreamRes.violations[0]).toMatchObject({
        filePath: '.github/workflows/ancestry-check.yml',
        lineNumber: 15,
        actionRef: `actions/checkout@${forkCommitSha}`,
      });
      expect(upstreamRes.violations[0].reason).toContain('unmerged fork commit');

      const cliFail = await new Promise<{ status: number | null; stderr: string }>(
        (resolve, reject) => {
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
        }
      );
      expect(cliFail.status).toBe(1);
      expect(cliFail.stderr).toContain('unmerged fork commit');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('verifies refs/heads/* and peeled refs/tags/* via Git Smart HTTP fallback and rejects fork PR or unpeeled tag SHAs', async () => {
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
        '    timeout-minutes: 10',
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
});
