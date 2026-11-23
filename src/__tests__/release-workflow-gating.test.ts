/**
 * @jest-environment node
 */
import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';

const WORKFLOWS_DIR = path.join(process.cwd(), '.github', 'workflows');

function readWorkflow(fileName: string): string {
  return fs.readFileSync(path.join(WORKFLOWS_DIR, fileName), 'utf8');
}

function extractTopLevelSection(yaml: string, sectionKey: string): string {
  const lines = yaml.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line.startsWith(`${sectionKey}:`));
  if (startIndex === -1) {
    return '';
  }

  const sectionLines: string[] = [lines[startIndex]];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.startsWith(' ') || line.trim().startsWith('#')) {
      sectionLines.push(line);
    } else {
      break;
    }
  }
  return sectionLines.join('\n');
}

function extractRunBlocks(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const blocks: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const inlineMatch = line.match(/^(\s*)run:\s*(.*)$/);
    if (!inlineMatch) {
      continue;
    }

    const indent = inlineMatch[1].length;
    const rest = inlineMatch[2].trim();

    if (rest === '|' || rest === '>-' || rest === '>') {
      const blockLines: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (nextLine.trim() === '') {
          blockLines.push(nextLine);
          continue;
        }
        const nextIndent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
        if (nextIndent > indent) {
          blockLines.push(nextLine);
          i = j;
        } else {
          break;
        }
      }
      blocks.push(blockLines.join('\n'));
    } else {
      blocks.push(rest);
    }
  }

  return blocks;
}

describe('Release Workflow CI Gating & Artifact Deduplication', () => {
  const ciWorkflow = readWorkflow('ci.yml');
  const publishWorkflow = readWorkflow('publish-artifact.yml');
  const deployWorkflow = readWorkflow('deploy.yml');
  const deployProviderWorkflow = readWorkflow('deploy-provider.yml');
  const migrateWorkflow = readWorkflow('db-migrate.yml');

  it('triggers ci.yml on main pushes, v* tags, pull requests, and releases while keeping deploy-docs restricted to main pushes and releases', () => {
    expect(ciWorkflow).toContain('name: CI');
    const onSection = extractTopLevelSection(ciWorkflow, 'on');
    expect(onSection).toContain('push:');
    expect(onSection).toContain('branches: [ main ]');
    expect(onSection).toContain("tags: [ 'v*' ]");
    expect(onSection).toContain('pull_request:');

    for (const jobId of ['verify:', 'unit-test:', 'build:', 'e2e-test:', 'deploy-docs:']) {
      expect(ciWorkflow).toContain(`  ${jobId}`);
    }
    expect(ciWorkflow).toMatch(
      /deploy-docs:\n\s+needs:\s*verify\n\s+if:\s*\(github\.ref == 'refs\/heads\/main' && github\.event_name == 'push'\) \|\| github\.event_name == 'release'/
    );
    expect(ciWorkflow).not.toContain('secrets.');
  });

  it('removes standalone main branch push trigger from publish-artifact.yml while retaining v* tags, workflow_dispatch, and workflow_call', () => {
    const onSection = extractTopLevelSection(publishWorkflow, 'on');
    expect(onSection).not.toContain('branches:');
    expect(onSection).not.toMatch(/-\s*main\b/);
    expect(onSection).toContain('tags:');
    expect(onSection).toContain("- 'v*'");
    expect(onSection).toContain('workflow_dispatch:');
    expect(onSection).toContain('workflow_call:');
    expect(onSection).toContain('commit_sha:');
  });

  it('scopes top-level permissions to contents: read and restricts write/actions permissions to individual jobs', () => {
    for (const [name, content] of [
      ['publish-artifact.yml', publishWorkflow],
      ['deploy.yml', deployWorkflow],
      ['deploy-provider.yml', deployProviderWorkflow],
      ['db-migrate.yml', migrateWorkflow],
    ] as const) {
      const topPermissions = extractTopLevelSection(content, 'permissions');
      expect({ name, topPermissions }).toEqual({
        name,
        topPermissions: expect.stringMatching(/^permissions:\s*\n\s+contents:\s*read\s*$/),
      });
    }

    // In publish-artifact.yml, actions: read lives strictly inside ci-gate and write permissions stay in build/publish
    const publishActionsReadMatches = publishWorkflow.match(/actions:\s*read/g) ?? [];
    expect(publishActionsReadMatches).toHaveLength(1);
    expect(publishWorkflow).toMatch(/ci-gate:\n[\s\S]*?permissions:\n\s+actions: read\n\s+outputs:/);
    expect(publishWorkflow).toMatch(
      /publish:\n[\s\S]*?permissions:\n\s+contents: read\n\s+packages: write\n\s+security-events: write\n\s+id-token: write\n\s+attestations: write/
    );

    // In deploy.yml, among direct runner jobs only ci-gate holds actions: read (reusable callers delegate to child CI gates)
    expect(deployWorkflow).toMatch(/ci-gate:[\s\S]*?permissions:\n\s+actions: read/);
    for (const nonCiRunnerJob of [
      'schema-compatibility',
      'staging-verify-deployment',
      'production-verify-deployment',
    ]) {
      const jobChunk = deployWorkflow.split(`  ${nonCiRunnerJob}:\n`)[1]?.split(/\n  [a-z-]+:\n/)[0] ?? '';
      expect(jobChunk).not.toContain('actions: read');
    }
  });

  it('triggers deploy.yml via workflow_run on CI completion for main instead of push', () => {
    const onSection = extractTopLevelSection(deployWorkflow, 'on');
    expect(onSection).not.toContain('push:');
    expect(onSection).toContain('workflow_run:');
    expect(onSection).toContain('- CI');
    expect(onSection).toContain('- completed');
    expect(onSection).toContain('- main');
    expect(onSection).toContain('workflow_dispatch:');
    expect(onSection).toContain('workflow_call:');
  });

  it('gates workflow_run on conclusion == success, event == push, and head_repository.full_name == github.repository', () => {
    expect(deployWorkflow).not.toContain("github.event_name == 'push'");

    const requiredChecks = [
      "github.event_name == 'workflow_run'",
      "github.event.workflow_run.conclusion == 'success'",
      "github.event.workflow_run.event == 'push'",
      'github.event.workflow_run.head_repository.full_name == github.repository',
    ];

    for (const check of requiredChecks) {
      expect(deployWorkflow).toContain(check);
    }

    // Staging and production jobs recognize successful workflow_run events alongside manual inputs
    expect(deployWorkflow).toMatch(
      /staging-database-migration:[\s\S]*?github\.event\.workflow_run\.conclusion == 'success'[\s\S]*?inputs\.environment == 'staging'/
    );
    expect(deployWorkflow).toMatch(
      /production-database-migration:[\s\S]*?github\.event\.workflow_run\.conclusion == 'success'[\s\S]*?inputs\.environment == 'production'/
    );
  });

  it('verifies a completed successful CI run for target_sha on workflow_dispatch and workflow_call and propagates resolved target_sha', () => {
    // Preflight gate checks ci.yml runs for targetSha on manual/reusable invocations
    expect(deployWorkflow).toContain("workflow_id: 'ci.yml'");
    expect(deployWorkflow).toContain('WORKFLOW_RUN_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(deployWorkflow).toContain('CURRENT_SHA: ${{ github.sha }}');
    expect(deployWorkflow).toContain('INPUT_IMAGE_DIGEST: ${{ inputs.image_digest }}');

    // Resolved SHA aligned in schema-compatibility on workflow_run (after ancestry check) and on pinned image_digest dispatches, and passed to workflow calls
    expect(deployWorkflow).not.toContain('ref: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(deployWorkflow).toMatch(
      /schema-compatibility:[\s\S]*?fetch-depth:\s*0[\s\S]*?if:\s*github\.event_name == 'workflow_run' \|\| inputs\.image_digest != ''[\s\S]*?TARGET_SHA:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}[\s\S]*?git merge-base --is-ancestor "\$TARGET_SHA" HEAD[\s\S]*?git checkout --detach "\$TARGET_SHA"/
    );
    expect(deployWorkflow).toContain('commit_sha: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(deployWorkflow).toContain('tag_name: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(deployWorkflow).not.toContain('|| github.sha');

    expect(publishWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
    expect(publishWorkflow).toContain('fetch-depth: 0');
    expect(publishWorkflow).toContain('INPUT_COMMIT_SHA: ${{ inputs.commit_sha }}');
    expect(migrateWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
    expect(migrateWorkflow).toContain('INPUT_COMMIT_SHA: ${{ inputs.commit_sha }}');
  });

  it('polls active ci.yml runs in publish-artifact.yml and blocks builds and provenance signing when CI has not passed', async () => {
    expect(publishWorkflow).toMatch(/build:\n\s+name:[^\n]+\n\s+needs:\s*\[ci-gate\]/);
    const runBlocks = extractRunBlocks(publishWorkflow);
    const pollCiScript = runBlocks.find((block) =>
      block.includes('actions/workflows/ci.yml/runs?head_sha=')
    );
    expect(pollCiScript).toBeDefined();

    const targetSha = 'abcdef0123456789abcdef0123456789abcdef01';
    let runsResponse: Array<Record<string, unknown>> = [];
    let onRequest: (() => void) | null = null;

    const server = http.createServer((req, res) => {
      if (req.url?.startsWith('/repos/fderuiter/wedding_website/actions/workflows/ci.yml/runs')) {
        if (onRequest) {
          onRequest();
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ workflow_runs: runsResponse }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const apiBase = `http://127.0.0.1:${port}`;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-ci-gate-'));

    const execGate = (envOverrides: Record<string, string>) =>
      new Promise<{ status: number | null; stdout: string; stderr: string; summary: string }>(
        (resolve, reject) => {
          const summaryPath = path.join(tempDir, `summary-${Math.random().toString(36).slice(2)}.md`);
          fs.writeFileSync(summaryPath, '');
          const child = spawn('bash', ['-eo', 'pipefail', '-c', pollCiScript!], {
            cwd: tempDir,
            env: {
              ...process.env,
              GITHUB_API_URL: apiBase,
              GITHUB_REPOSITORY: 'fderuiter/wedding_website',
              GITHUB_STEP_SUMMARY: summaryPath,
              GH_TOKEN: 'ghs_test_token',
              RESOLVED_SHA: targetSha,
              EVENT_NAME: 'workflow_dispatch',
              CI_POLL_INTERVAL_SECONDS: '1',
              CI_POLL_TIMEOUT_SECONDS: '5',
              CI_INITIAL_GRACE_SECONDS: '0',
              ...envOverrides,
            },
          });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
          });
          child.on('error', reject);
          child.on('close', (code) => {
            resolve({
              status: code,
              stdout,
              stderr,
              summary: fs.readFileSync(summaryPath, 'utf8'),
            });
          });
        }
      );

    try {
      // 1. Fails closed immediately when no passing CI run exists
      runsResponse = [];
      const missingRes = await execGate({});
      expect(missingRes.status).not.toBe(0);
      expect(missingRes.stdout + missingRes.stderr).toContain('No completed successful ci.yml workflow run found');

      // 2. Fails closed when only fork or failed runs exist
      runsResponse = [
        {
          id: 101,
          head_sha: targetSha,
          status: 'completed',
          conclusion: 'success',
          head_repository: { full_name: 'attacker/wedding_website' },
        },
        {
          id: 102,
          head_sha: targetSha,
          status: 'completed',
          conclusion: 'failure',
          head_repository: { full_name: 'fderuiter/wedding_website' },
        },
      ];
      const failedRes = await execGate({});
      expect(failedRes.status).not.toBe(0);

      // 3. Polls active ci.yml run on tag push until completed with success
      let pollCalls = 0;
      onRequest = () => {
        pollCalls += 1;
        if (pollCalls === 1) {
          runsResponse = [
            {
              id: 205,
              head_sha: targetSha,
              status: 'in_progress',
              conclusion: null,
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
          ];
        } else {
          runsResponse = [
            {
              id: 205,
              head_sha: targetSha,
              status: 'completed',
              conclusion: 'success',
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
          ];
        }
      };
      const polledPassRes = await execGate({ EVENT_NAME: 'push' });
      expect(polledPassRes.status).toBe(0);
      expect(pollCalls).toBeGreaterThanOrEqual(2);
      expect(polledPassRes.summary).toContain('**Verified CI Run ID:** `205`');

      // 4. Polls active ci.yml run and blocks when active run finishes with failure even if an older run succeeded
      let activeFailPolls = 0;
      onRequest = () => {
        activeFailPolls += 1;
        if (activeFailPolls === 1) {
          runsResponse = [
            {
              id: 301,
              head_sha: targetSha,
              status: 'queued',
              conclusion: null,
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
            {
              id: 200,
              head_sha: targetSha,
              status: 'completed',
              conclusion: 'success',
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
          ];
        } else {
          runsResponse = [
            {
              id: 301,
              head_sha: targetSha,
              status: 'completed',
              conclusion: 'failure',
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
            {
              id: 200,
              head_sha: targetSha,
              status: 'completed',
              conclusion: 'success',
              head_repository: { full_name: 'fderuiter/wedding_website' },
            },
          ];
        }
      };
      const polledFailRes = await execGate({ EVENT_NAME: 'push' });
      expect(polledFailRes.status).not.toBe(0);
      expect(polledFailRes.stdout + polledFailRes.stderr).toContain('completed without success');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('passes event fields and inputs via env variables with zero direct ${{ ... }} interpolation in run scripts', () => {
    for (const [name, content] of [
      ['deploy.yml', deployWorkflow],
      ['publish-artifact.yml', publishWorkflow],
      ['db-migrate.yml', migrateWorkflow],
    ] as const) {
      const runBlocks = extractRunBlocks(content);
      expect(runBlocks.length).toBeGreaterThan(0);
      for (const block of runBlocks) {
        expect({ name, hasDirectInterpolation: /\$\{\{[\s\S]*?\}\}/.test(block) }).toEqual({
          name,
          hasDirectInterpolation: false,
        });
      }
    }
  });

  it('enforces SemVer :latest comparison across GHCR and Docker Hub while omitting :latest on manual dispatches, main builds, pre-releases, and N-1 tags', () => {
    const runBlocks = extractRunBlocks(publishWorkflow);
    const computeTagScripts = runBlocks.filter((block) => block.includes('primary_uri='));
    expect(computeTagScripts).toHaveLength(2);

    const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-tag-test-'));
    const repoDir = path.join(tempOutDir, 'repo');
    const outputFile = path.join(tempOutDir, 'github_output.txt');
    const sampleSha = '0123456789abcdef0123456789abcdef01234567';

    const runComputeMeta = (script: string, envOverrides: Record<string, string>) => {
      fs.writeFileSync(outputFile, '');
      const res = spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
        cwd: repoDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          REGISTRY: 'ghcr.io',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_SHA: sampleSha,
          EVENT_NAME: 'push',
          RAW_INPUT_TAG: '',
          INPUT_COMMIT_SHA: '',
          DOCKERHUB_USERNAME: 'fderuiter',
          DOCKERHUB_TOKEN: 'dckr_pat_test',
          ...envOverrides,
        },
      });
      expect(res.status).toBe(0);
      return fs.readFileSync(outputFile, 'utf8');
    };

    try {
      fs.mkdirSync(repoDir, { recursive: true });
      execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'init\n');
      execFileSync('git', ['add', 'README.md'], { cwd: repoDir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'initial'], { cwd: repoDir, stdio: 'ignore' });

      for (const computeTagScript of computeTagScripts) {
        // Clear any tags from previous loop iteration
        const existingTags = execFileSync('git', ['tag', '-l'], { cwd: repoDir, encoding: 'utf8' })
          .split(/\r?\n/)
          .filter(Boolean);
        for (const t of existingTags) {
          execFileSync('git', ['tag', '-d', t], { cwd: repoDir, stdio: 'ignore' });
        }

        // 1. First stable v0.1.0 tag push publishes version, SHA, and :latest across registries
        execFileSync('git', ['tag', 'v0.1.0'], { cwd: repoDir, stdio: 'ignore' });
        const initialOutputs = runComputeMeta(computeTagScript, {
          GITHUB_REPOSITORY: 'FdeRuiter/Wedding_Website',
          GITHUB_REF: 'refs/tags/v0.1.0',
          GITHUB_REF_NAME: 'v0.1.0',
        });
        expect(initialOutputs).toContain('tag_name=v0.1.0');
        expect(initialOutputs).toContain('primary_uri=ghcr.io/fderuiter/wedding_website:v0.1.0');
        expect(initialOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:v0.1.0,ghcr.io/fderuiter/wedding_website:${sampleSha},ghcr.io/fderuiter/wedding_website:latest,fderuiter/wedding-website:v0.1.0,fderuiter/wedding-website:${sampleSha},fderuiter/wedding-website:latest`
        );

        // 2. Pre-release v* tag publishes version + SHA without overwriting :latest on either registry
        execFileSync('git', ['tag', 'v0.2.0-rc.1'], { cwd: repoDir, stdio: 'ignore' });
        const preReleaseOutputs = runComputeMeta(computeTagScript, {
          GITHUB_REF: 'refs/tags/v0.2.0-rc.1',
          GITHUB_REF_NAME: 'v0.2.0-rc.1',
        });
        expect(preReleaseOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:v0.2.0-rc.1,ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:v0.2.0-rc.1,fderuiter/wedding-website:${sampleSha}`
        );
        expect(preReleaseOutputs).not.toContain(':latest');

        // 3. Maintenance N-1 patch tag v1.4.3 when v2.0.0 already exists omits :latest on GHCR and Docker Hub
        execFileSync('git', ['tag', 'v2.0.0'], { cwd: repoDir, stdio: 'ignore' });
        execFileSync('git', ['tag', 'v1.4.3'], { cwd: repoDir, stdio: 'ignore' });
        const maintenanceOutputs = runComputeMeta(computeTagScript, {
          GITHUB_REF: 'refs/tags/v1.4.3',
          GITHUB_REF_NAME: 'v1.4.3',
        });
        expect(maintenanceOutputs).toContain('tag_name=v1.4.3');
        expect(maintenanceOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:v1.4.3,ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:v1.4.3,fderuiter/wedding-website:${sampleSha}`
        );
        expect(maintenanceOutputs).not.toContain(':latest');

        // 4. Pushing v2.1.0 when v2.0.0 and pre-release v2.2.0-rc.1 exist updates :latest on GHCR and Docker Hub
        execFileSync('git', ['tag', 'v2.2.0-rc.1'], { cwd: repoDir, stdio: 'ignore' });
        execFileSync('git', ['tag', 'v2.1.0'], { cwd: repoDir, stdio: 'ignore' });
        const highestStableOutputs = runComputeMeta(computeTagScript, {
          GITHUB_REF: 'refs/tags/v2.1.0',
          GITHUB_REF_NAME: 'v2.1.0',
        });
        expect(highestStableOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:v2.1.0,ghcr.io/fderuiter/wedding_website:${sampleSha},ghcr.io/fderuiter/wedding_website:latest,fderuiter/wedding-website:v2.1.0,fderuiter/wedding-website:${sampleSha},fderuiter/wedding-website:latest`
        );

        // 5. Default-branch build without version tag and manual workflow_dispatch runs never publish :latest
        const mainUntaggedOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'push',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
        });
        expect(mainUntaggedOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
        );
        expect(mainUntaggedOutputs).not.toContain(':latest');

        const manualMainDispatchOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          INPUT_COMMIT_SHA: sampleSha,
        });
        expect(manualMainDispatchOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
        );
        expect(manualMainDispatchOutputs).not.toContain(':latest');

        const manualTagRefDispatchOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/tags/v2.1.0',
          GITHUB_REF_NAME: 'v2.1.0',
          INPUT_COMMIT_SHA: sampleSha,
        });
        expect(manualTagRefDispatchOutputs).not.toContain(':latest');

        // 6. Feature branch dispatch and workflow_call with explicit SHA never publish :latest
        const branchOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/feature/test-branch',
          GITHUB_REF_NAME: 'feature/test-branch',
        });
        expect(branchOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
        );
        expect(branchOutputs).not.toContain(':latest');

        const shaOutputs = runComputeMeta(computeTagScript, {
          EVENT_NAME: 'workflow_call',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          RAW_INPUT_TAG: sampleSha,
          INPUT_COMMIT_SHA: sampleSha,
        });
        expect(shaOutputs).toContain(`tag_name=${sampleSha}`);
        expect(shaOutputs).toContain(
          `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
        );
        expect(shaOutputs).not.toContain(':latest');
      }
    } finally {
      fs.rmSync(tempOutDir, { recursive: true, force: true });
    }
  });

  it('builds, Trivy-scans, and smoke-tests native amd64 and arm64 images without QEMU before pushing digests and merging provenance-attested OCI index', () => {
    expect(publishWorkflow).not.toContain('setup-qemu-action');
    expect(publishWorkflow).toContain('runner: ubuntu-latest');
    expect(publishWorkflow).toContain('runner: ubuntu-24.04-arm');
    expect(publishWorkflow).toContain('platform: linux/amd64');
    expect(publishWorkflow).toContain('platform: linux/arm64');
    expect(publishWorkflow).toContain('cache-from: type=gha,scope=app-${{ matrix.arch }}');
    expect(publishWorkflow).toContain('cache-to: type=gha,scope=app-${{ matrix.arch }},mode=max');
    expect(publishWorkflow).toContain('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9');
    expect(publishWorkflow).toContain('buildkit-deps-${{ matrix.arch }}-');
    expect(publishWorkflow).toContain('buildkit-next-${{ matrix.arch }}-');
    for (const mountTarget of ['/var/cache/apt', '/var/lib/apt', '/root/.npm', '/app/.next/cache']) {
      expect(publishWorkflow).toContain(`target=${mountTarget}`);
    }

    // Verify Trivy scan and native container smoke test execute before registry login and digest push in the build job
    const buildJobSection = publishWorkflow.split(/\n  publish:\n/)[0] ?? '';
    const trivyIdx = buildJobSection.indexOf('aquasecurity/trivy-action');
    const sarifIdx = buildJobSection.indexOf('github/codeql-action/upload-sarif');
    const smokeIdx = buildJobSection.indexOf('node scripts/test-container.mjs');
    const loginIdx = buildJobSection.indexOf('docker/login-action');
    const pushDigestIdx = buildJobSection.indexOf('push-by-digest=true');

    expect(trivyIdx).toBeGreaterThan(-1);
    expect(sarifIdx).toBeGreaterThan(trivyIdx);
    expect(smokeIdx).toBeGreaterThan(sarifIdx);
    expect(loginIdx).toBeGreaterThan(smokeIdx);
    expect(pushDigestIdx).toBeGreaterThan(loginIdx);

    expect(buildJobSection).toContain("severity: 'CRITICAL,HIGH'");
    expect(buildJobSection).toContain("exit-code: '1'");
    expect(buildJobSection).toContain("category: 'trivy-${{ matrix.arch }}'");

    // Verify publish job merges per-architecture digests, verifies linux/amd64 & linux/arm64 manifests, attests provenance, and preserves outputs
    const publishJobSection = publishWorkflow.split(/\n  publish:\n/)[1] ?? '';
    expect(publishJobSection).toContain('needs: [build]');
    expect(publishJobSection).toContain('docker buildx imagetools create');
    expect(publishJobSection).toContain('actions/attest-build-provenance');
    expect(publishJobSection).toContain('image_uri: ${{ steps.meta.outputs.primary_uri }}');
    expect(publishJobSection).toContain('image_tag: ${{ steps.meta.outputs.tag_name }}');
    expect(publishJobSection).toContain('image_digest: ${{ steps.merge.outputs.digest }}');
  });

  it('isolates GHA cache_from in docker-compose.ci.yml, persists BuildKit cache mounts, skips PR mode=max writes, deduplicates amd64 Next.js and Storybook builds, and smoke-tests arm64 in CI', () => {
    const composeContent = fs.readFileSync(path.join(process.cwd(), 'docker-compose.yml'), 'utf8');
    expect(composeContent).not.toContain('type=gha');
    expect(composeContent).not.toContain('GHA_CACHE_SCOPE');

    const ciComposeContent = fs.readFileSync(path.join(process.cwd(), 'docker-compose.ci.yml'), 'utf8');
    expect(ciComposeContent.match(/type=gha,scope=\$\{GHA_CACHE_SCOPE:-app-amd64\}/g)).toHaveLength(2);
    expect(ciComposeContent).not.toContain('cache_to');
    expect(ciComposeContent).not.toContain('mode=max');

    expect(ciWorkflow).toContain('crazy-max/ghaction-github-runtime@');
    expect(ciWorkflow).toContain('GHA_CACHE_SCOPE: app-amd64');
    expect(ciWorkflow).toContain('runs-on: ubuntu-24.04-arm');
    expect(ciWorkflow).toContain('GHA_CACHE_SCOPE: app-arm64');
    expect(ciWorkflow).toContain(
      "cache-to: ${{ github.event_name != 'pull_request' && 'type=gha,scope=app-amd64,mode=max' || '' }}"
    );
    expect(ciWorkflow).toContain(
      "cache-to: ${{ github.event_name != 'pull_request' && 'type=gha,scope=app-arm64,mode=max' || '' }}"
    );
    for (const mountTarget of ['/var/cache/apt', '/var/lib/apt', '/root/.npm', '/app/.next/cache']) {
      expect(ciWorkflow).toContain(`target=${mountTarget}`);
    }
    expect(ciWorkflow).not.toContain('run: npm run build\n');
    expect(ciWorkflow).toContain('docker create wedding-website:latest');
    expect(ciWorkflow).toContain('docker cp "$CID:/app/." .next/standalone/');
    expect(ciWorkflow).not.toContain('docker tag wedding-website:latest wedding-website:latest');
    expect(ciWorkflow).toContain('wedding-website-image.tar.zst');
    expect(ciWorkflow).toContain('zstd -dc');

    const storybookWorkflow = readWorkflow('storybook.yml');
    const storybookOnSection = extractTopLevelSection(storybookWorkflow, 'on');
    expect(storybookOnSection).toContain('workflow_dispatch:');
    expect(storybookOnSection).not.toContain('push:');
    expect(storybookOnSection).not.toMatch(/-\s*main\b/);
    expect(storybookWorkflow).toContain('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9');
    expect(storybookWorkflow).toContain('actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9');
    expect(storybookWorkflow).toContain('name: storybook-static');
    expect(storybookWorkflow).toContain('path: storybook-static/');

    const testContainerScript = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'test-container.mjs'),
      'utf8'
    );
    expect(testContainerScript).toContain("process.arch === 'arm64' ? 'app-arm64' : 'app-amd64'");
    expect(testContainerScript).toContain(
      "runCommand('docker', ['compose', ...COMPOSE_ARGS, 'run', '--rm', 'migration']"
    );
    expect(testContainerScript).not.toMatch(/['"]run['"][^\n]*['"]--no-build['"]/);
  });

  it('merges verified amd64 and arm64 digests into a multi-platform OCI index and fails closed if either architecture manifest is missing', () => {
    const runBlocks = extractRunBlocks(publishWorkflow);
    const mergeScript = runBlocks.find((block) => block.includes('docker buildx imagetools create'));
    expect(mergeScript).toBeDefined();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-merge-test-'));
    const binDir = path.join(tempDir, 'bin');
    const digestsDir = path.join('/tmp', 'digests');
    const outputFile = path.join(tempDir, 'github_output.txt');
    const callsFile = path.join(tempDir, 'docker_calls.log');

    const amd64Digest = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
    const arm64Digest = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
    const mergedDigest = 'sha256:3333333333333333333333333333333333333333333333333333333333333333';
    const resolvedSha = '0123456789abcdef0123456789abcdef01234567';

    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.mkdirSync(digestsDir, { recursive: true });
      fs.writeFileSync(path.join(digestsDir, 'amd64.digest'), `${amd64Digest}\n`);
      fs.writeFileSync(path.join(digestsDir, 'arm64.digest'), `${arm64Digest}\n`);
      fs.writeFileSync(outputFile, '');
      fs.writeFileSync(callsFile, '');

      const dockerShim = path.join(binDir, 'docker');
      fs.writeFileSync(
        dockerShim,
        `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, args.join(' ') + '\\n');
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'create') {
  process.exit(0);
}
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'inspect') {
  if (args.includes('--raw')) {
    const manifests = process.env.OMIT_ARM64 === 'true'
      ? [{ platform: { os: 'linux', architecture: 'amd64' } }]
      : [
          { platform: { os: 'linux', architecture: 'amd64' } },
          { platform: { os: 'linux', architecture: 'arm64' } },
        ];
    const annotations = process.env.OMIT_REVISION === 'true'
      ? {}
      : { 'org.opencontainers.image.revision': process.env.MOCK_INDEX_REVISION || '${resolvedSha}' };
    process.stdout.write(JSON.stringify({ manifests, annotations }));
    process.exit(0);
  }
  process.stdout.write('${mergedDigest}');
  process.exit(0);
}
process.exit(1);
`
      );
      fs.chmodSync(dockerShim, 0o755);

      const okRes = spawnSync('bash', ['-eo', 'pipefail', '-c', mergeScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
          PRIMARY_URI: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          TAGS: 'ghcr.io/fderuiter/wedding_website:v0.1.0,ghcr.io/fderuiter/wedding_website:latest,fderuiter/wedding-website:v0.1.0,fderuiter/wedding-website:latest',
          RESOLVED_SHA: resolvedSha,
        },
      });
      expect(okRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(`digest=${mergedDigest}`);

      const calls = fs.readFileSync(callsFile, 'utf8');
      expect(calls).toContain(
        `buildx imagetools create --annotation index:org.opencontainers.image.revision=${resolvedSha} --tag ghcr.io/fderuiter/wedding_website:v0.1.0 --tag ghcr.io/fderuiter/wedding_website:latest ghcr.io/fderuiter/wedding_website@${amd64Digest} ghcr.io/fderuiter/wedding_website@${arm64Digest}`
      );
      expect(calls).toContain(
        `buildx imagetools create --annotation index:org.opencontainers.image.revision=${resolvedSha} --tag fderuiter/wedding-website:v0.1.0 --tag fderuiter/wedding-website:latest fderuiter/wedding-website@${amd64Digest} fderuiter/wedding-website@${arm64Digest}`
      );

      // Verify missing linux/arm64 manifest in merged index fails closed
      const failRes = spawnSync('bash', ['-eo', 'pipefail', '-c', mergeScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: '',
          PRIMARY_URI: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          TAGS: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          RESOLVED_SHA: resolvedSha,
          OMIT_ARM64: 'true',
        },
      });
      expect(failRes.status).not.toBe(0);

      // Verify missing org.opencontainers.image.revision annotation in merged index fails closed before attestation
      const missingRevRes = spawnSync('bash', ['-eo', 'pipefail', '-c', mergeScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: '',
          PRIMARY_URI: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          TAGS: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          RESOLVED_SHA: resolvedSha,
          OMIT_REVISION: 'true',
        },
      });
      expect(missingRevRes.status).not.toBe(0);
    } finally {
      fs.rmSync(digestsDir, { recursive: true, force: true });
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
