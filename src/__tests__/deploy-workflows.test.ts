import { execFileSync, execSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { parseDocument } from 'yaml';

const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const DEPLOY_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy.yml');
const DEPLOY_STAGE_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy-stage.yml');
const DEPLOY_PROVIDER_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy-provider.yml');
const DB_MIGRATE_YML_PATH = path.join(WORKFLOWS_DIR, 'db-migrate.yml');
const ROLLBACK_YML_PATH = path.join(WORKFLOWS_DIR, 'rollback.yml');
const CI_YML_PATH = path.join(WORKFLOWS_DIR, 'ci.yml');
const STORYBOOK_YML_PATH = path.join(WORKFLOWS_DIR, 'storybook.yml');
const DEPLOYMENT_DOC_PATH = path.join(REPO_ROOT, 'DEPLOYMENT.md');
const CLOUD_RUN_DOC_PATH = path.join(REPO_ROOT, 'docs', 'deployment', 'gcp-cloud-run.md');

function extractStepRunScript(workflowContent: string, stepName: string): string {
  const lines = workflowContent.split(/\r?\n/);
  const targetHeader = `- name: ${stepName}`;
  const headerIdx = lines.findIndex((l) => l.trim() === targetHeader);
  if (headerIdx === -1) {
    throw new Error(`Step "${stepName}" not found in workflow`);
  }

  let runIdx = -1;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('- name:') || trimmed.startsWith('- uses:')) {
      break;
    }
    if (trimmed === 'run: |') {
      runIdx = i;
      break;
    }
  }

  if (runIdx === -1) {
    throw new Error(`"run: |" block not found for step "${stepName}"`);
  }

  const runIndent = lines[runIdx].search(/\S/);
  const scriptLines: string[] = [];
  for (let i = runIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') {
      scriptLines.push('');
      continue;
    }
    const indent = line.search(/\S/);
    if (indent <= runIndent) {
      break;
    }
    scriptLines.push(line.slice(runIndent + 2));
  }

  return scriptLines.join('\n');
}

describe('Release & Provider Deployment Workflow Digest Pinning and Provenance Checks', () => {
  const deployYml = fs.readFileSync(DEPLOY_YML_PATH, 'utf8');
  const deployStageYml = fs.readFileSync(DEPLOY_STAGE_YML_PATH, 'utf8');
  const deployProviderYml = fs.readFileSync(DEPLOY_PROVIDER_YML_PATH, 'utf8');
  const dbMigrateYml = fs.readFileSync(DB_MIGRATE_YML_PATH, 'utf8');
  const rollbackYml = fs.readFileSync(ROLLBACK_YML_PATH, 'utf8');
  const ciYml = fs.readFileSync(CI_YML_PATH, 'utf8');
  const storybookYml = fs.readFileSync(STORYBOOK_YML_PATH, 'utf8');

  let tempDir: string;
  let binDir: string;
  let outputFile: string;
  let summaryFile: string;
  let callLogFile: string;
  let mockCiRunsFile: string;
  let apiServerProc: ReturnType<typeof spawn>;
  let apiBaseUrl: string;

  const VALID_DIGEST = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const VALID_REVISION = 'abcdef0123456789abcdef0123456789abcdef01';

  function setMockCiRuns(runs: Array<Record<string, unknown>>) {
    fs.writeFileSync(mockCiRunsFile, JSON.stringify({ workflow_runs: runs }));
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-provider-test-'));
    binDir = path.join(tempDir, 'bin');
    outputFile = path.join(tempDir, 'github_output.txt');
    summaryFile = path.join(tempDir, 'github_summary.md');
    callLogFile = path.join(tempDir, 'cli_calls.log');
    mockCiRunsFile = path.join(tempDir, 'mock_ci_runs.json');

    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(summaryFile, '');
    fs.writeFileSync(callLogFile, '');

    setMockCiRuns([
      {
        id: 7001,
        head_sha: VALID_REVISION,
        status: 'completed',
        conclusion: 'success',
        head_repository: { full_name: 'OwnerOrg/Wedding_Website' },
      },
    ]);

    apiServerProc = spawn(
      process.execPath,
      [
        '-e',
        `
const fs = require('fs');
const http = require('http');
const runsFile = process.argv[1];
const server = http.createServer((req, res) => {
  if (req.url && req.url.includes('/actions/workflows/ci.yml/runs')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(fs.readFileSync(runsFile, 'utf8'));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n');
});
`,
        mockCiRunsFile,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const port = await new Promise<string>((resolve, reject) => {
      let buf = '';
      apiServerProc.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const nl = buf.indexOf('\n');
        if (nl !== -1) {
          resolve(buf.slice(0, nl).trim());
        }
      });
      apiServerProc.on('error', reject);
    });
    apiBaseUrl = `http://127.0.0.1:${port}`;

    // Shim docker CLI for login + buildx imagetools inspect
    const dockerShim = path.join(binDir, 'docker');
    fs.writeFileSync(
      dockerShim,
      `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callLogFile)}, 'docker ' + args.join(' ') + '\\n');
if (args[0] === 'login') {
  process.exit(0);
}
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'inspect') {
  if (process.env.MOCK_DOCKER_FAIL === 'true') {
    console.error('manifest unknown');
    process.exit(1);
  }
  if (args.includes('--raw')) {
    const annotations = process.env.MOCK_OMIT_INDEX_REVISION === 'true'
      ? {}
      : { 'org.opencontainers.image.revision': process.env.MOCK_INDEX_REVISION || '${VALID_REVISION}' };
    process.stdout.write(JSON.stringify({ annotations, manifests: [] }));
    process.exit(0);
  }
  process.stdout.write(process.env.MOCK_RESOLVED_DIGEST || '${VALID_DIGEST}');
  process.exit(0);
}
process.exit(1);
`
    );
    fs.chmodSync(dockerShim, 0o755);

    // Shim gh CLI for gh attestation verify
    const ghShim = path.join(binDir, 'gh');
    fs.writeFileSync(
      ghShim,
      `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callLogFile)}, 'gh ' + args.join(' ') + ' [token=' + (process.env.GH_TOKEN ? 'present' : 'missing') + ']\\n');
if (args[0] === 'attestation' && args[1] === 'verify') {
  if (process.env.MOCK_ATTESTATION_FAIL === 'true') {
    console.error('Error: failed to verify attestation');
    process.exit(1);
  }
  const sourceRefIdx = args.indexOf('--source-ref');
  const requestedSourceRef = sourceRefIdx >= 0 ? args[sourceRefIdx + 1] : '';
  if (process.env.MOCK_MAIN_REF_FAIL === 'true' && requestedSourceRef === 'refs/heads/main') {
    console.error('Error: certificate sourceRepositoryRef mismatch for refs/heads/main');
    process.exit(1);
  }
  if (args.includes('--format') && args.includes('json')) {
    const certificate = {
      ...(process.env.MOCK_OMIT_SLSA_REVISION === 'true'
        ? {}
        : {
            sourceRepositoryDigest:
              process.env.MOCK_ATTESTATION_SHA ||
              process.env.MOCK_SLSA_REVISION ||
              '${VALID_REVISION}',
          }),
      sourceRepositoryRef: process.env.MOCK_ATTESTATION_SOURCE_REF || 'refs/heads/main',
    };
    if (process.env.MOCK_SLSA_V02 === 'true') {
      process.stdout.write(JSON.stringify([
        {
          verificationResult: {
            signature: { certificate },
            statement: {
              predicate: {
                invocation: {
                  configSource: {
                    digest: { sha1: process.env.MOCK_SLSA_REVISION || '${VALID_REVISION}' },
                  },
                },
              },
            },
          },
        },
      ]));
      process.exit(0);
    }
    const buildDefinition = {};
    if (process.env.MOCK_SLSA_INPUT_SHA) {
      buildDefinition.externalParameters = { inputs: { commit_sha: process.env.MOCK_SLSA_INPUT_SHA } };
    }
    if (process.env.MOCK_OMIT_SLSA_REVISION !== 'true') {
      buildDefinition.resolvedDependencies = [
        { digest: { gitCommit: process.env.MOCK_SLSA_REVISION || '${VALID_REVISION}' } },
      ];
    }
    process.stdout.write(
      JSON.stringify([
        {
          verificationResult: {
            signature: { certificate },
            statement: { predicate: { buildDefinition } },
          },
        },
      ])
    );
    process.exit(0);
  }
  process.stdout.write('Verification succeeded!\\n');
  process.exit(0);
}
process.exit(1);
`
    );
    fs.chmodSync(ghShim, 0o755);
  });

  afterEach(async () => {
    if (apiServerProc && apiServerProc.exitCode === null) {
      await new Promise<void>((resolve) => {
        apiServerProc.once('close', () => resolve());
        apiServerProc.kill();
      });
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runBashStep(script: string, envOverrides: Record<string, string>, cwdOverride?: string) {
    return spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
      cwd: cwdOverride ?? tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        GITHUB_API_URL: apiBaseUrl,
        GITHUB_REPOSITORY: 'OwnerOrg/Wedding_Website',
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: summaryFile,
        ...envOverrides,
      },
    });
  }

  it('parses every workflow in .github/workflows/ as strict YAML 1.2 with zero errors or warnings and preserves provenance.if', () => {
    const workflowFiles = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort();

    expect(workflowFiles.length).toBeGreaterThan(0);

    for (const file of workflowFiles) {
      const content = fs.readFileSync(path.join(WORKFLOWS_DIR, file), 'utf8');
      const doc = parseDocument(content, { version: '1.2', strict: true });
      expect({
        file,
        errors: doc.errors.map((e) => e.message),
        warnings: doc.warnings.map((w) => w.message),
      }).toEqual({
        file,
        errors: [],
        warnings: [],
      });
    }

    const deployProviderDoc = parseDocument(deployProviderYml, { version: '1.2', strict: true });
    const parsed = deployProviderDoc.toJS() as {
      jobs?: {
        preflight?: {
          steps?: Array<{ id?: string; if?: string }>;
        };
      };
    };
    const provenanceStep = parsed.jobs?.preflight?.steps?.find((step) => step.id === 'provenance');
    expect(provenanceStep?.if).toContain('always()');
    expect(provenanceStep?.if).toContain("steps.validate-sha.outputs.is_rollback_call == 'true'");
    expect(provenanceStep?.if).toContain("steps.resolve.outcome == 'success'");
    expect(provenanceStep?.if).toContain(
      "!(inputs.dry_run && inputs.image_digest == '' && inputs.image_tag == 'latest')"
    );
  });

  it('keeps top-level permissions at contents: read and scopes attestations/packages/id-token to deployment jobs', () => {
    expect(deployYml).toMatch(/^permissions:\n  contents: read\n/m);
    expect(deployStageYml).toMatch(/^permissions:\n  contents: read\n/m);
    expect(deployProviderYml).toMatch(/^permissions:\n  contents: read\n/m);
    expect(dbMigrateYml).toMatch(/^permissions:\n  contents: read\n/m);

    expect(deployProviderYml).toContain(
      '    permissions:\n      actions: read\n      contents: read\n      packages: read\n      attestations: read\n      deployments: write\n      id-token: write'
    );
    expect(deployYml).toContain(
      '  staging:\n    name: Staging Deployment Stage\n    permissions:\n      actions: read\n      contents: read\n      packages: read\n      attestations: read\n      deployments: write\n      id-token: write'
    );
    expect(deployYml).toContain(
      '  production:\n    name: Production Deployment Stage\n    permissions:\n      actions: read\n      contents: read\n      packages: read\n      attestations: read\n      deployments: write\n      id-token: write'
    );
    expect(deployStageYml).toContain(
      '  deploy-provider:\n    name: Provider Deployment (${{ inputs.environment }})\n    permissions:\n      actions: read\n      contents: read\n      packages: read\n      attestations: read\n      deployments: write\n      id-token: write'
    );
    expect(deployStageYml).toContain(
      '  rollback:\n    name: Automated Rollback (${{ inputs.environment }})\n    permissions:\n      actions: read\n      contents: read\n      packages: read\n      attestations: read\n      deployments: write\n      id-token: write'
    );
  });

  it('isolates per-environment concurrency locks in deploy-stage.yml with queue: max and avoids nested lock contention via caller_holds_lock', () => {
    type WorkflowShape = {
      concurrency?: { group?: string; 'cancel-in-progress'?: boolean; queue?: string };
      on?: {
        workflow_call?: {
          inputs?: Record<string, { type?: string; default?: unknown; required?: boolean }>;
          secrets?: Record<string, { required?: boolean }>;
        };
      };
      jobs?: Record<
        string,
        {
          uses?: string;
          secrets?: string | Record<string, string>;
          concurrency?: unknown;
          with?: Record<string, unknown>;
        }
      >;
    };

    const deployDoc = parseDocument(deployYml, { version: '1.2', strict: true }).toJS() as WorkflowShape;
    const deployStageDoc = parseDocument(deployStageYml, { version: '1.2', strict: true }).toJS() as WorkflowShape;
    const dbMigrateDoc = parseDocument(dbMigrateYml, { version: '1.2', strict: true }).toJS() as WorkflowShape;
    const deployProviderDoc = parseDocument(deployProviderYml, { version: '1.2', strict: true }).toJS() as WorkflowShape;
    const rollbackDoc = parseDocument(rollbackYml, { version: '1.2', strict: true }).toJS() as WorkflowShape;

    // 1. deploy.yml removes root concurrency, bans secrets: inherit, and delegates staging/production to deploy-stage.yml
    expect(deployDoc.concurrency).toBeUndefined();
    for (const jobId of ['ci-gate', 'schema-compatibility', 'publish-artifact', 'staging', 'production']) {
      expect(deployDoc.jobs?.[jobId]?.concurrency).toBeUndefined();
      expect(deployDoc.jobs?.[jobId]?.secrets).not.toBe('inherit');
    }
    expect(deployDoc.jobs?.['publish-artifact']?.secrets).toEqual({
      DOCKERHUB_USERNAME: '${{ secrets.DOCKERHUB_USERNAME }}',
      DOCKERHUB_TOKEN: '${{ secrets.DOCKERHUB_TOKEN }}',
    });
    const expectedStageSecrets = {
      DATABASE_URL: '${{ secrets.DATABASE_URL }}',
      POSTGRES_URL_NON_POOLING: '${{ secrets.POSTGRES_URL_NON_POOLING }}',
      GCP_SA_KEY: '${{ secrets.GCP_SA_KEY }}',
      GCP_PROJECT_ID: '${{ secrets.GCP_PROJECT_ID }}',
      DEPLOY_WEBHOOK_URL: '${{ secrets.DEPLOY_WEBHOOK_URL }}',
      DEPLOY_WEBHOOK_SECRET: '${{ secrets.DEPLOY_WEBHOOK_SECRET }}',
      SERVICE_URL: '${{ secrets.SERVICE_URL }}',
    };
    expect(deployDoc.jobs?.staging?.uses).toBe('./.github/workflows/deploy-stage.yml');
    expect(deployDoc.jobs?.staging?.secrets).toEqual(expectedStageSecrets);
    expect(deployDoc.jobs?.staging?.with).toMatchObject({
      environment: 'staging',
      commit_sha: '${{ needs.ci-gate.outputs.target_sha }}',
    });
    expect(deployDoc.jobs?.production?.uses).toBe('./.github/workflows/deploy-stage.yml');
    expect(deployDoc.jobs?.production?.secrets).toEqual(expectedStageSecrets);
    expect(deployDoc.jobs?.production?.with).toMatchObject({
      environment: 'production',
      commit_sha: '${{ needs.ci-gate.outputs.target_sha }}',
    });

    // 2. deploy-stage.yml holds deploy-env-<environment> with queue: max, passes caller_holds_lock: true, and isolates DATABASE_URL strictly to db-migrate.yml
    expect(deployStageDoc.concurrency).toEqual({
      group: 'deploy-env-${{ inputs.environment }}',
      'cancel-in-progress': false,
      queue: 'max',
    });
    for (const stageChildJob of ['database-migration', 'deploy-provider', 'rollback']) {
      expect(deployStageDoc.jobs?.[stageChildJob]?.secrets).not.toBe('inherit');
      expect(deployStageDoc.jobs?.[stageChildJob]?.with?.caller_holds_lock).toBe(true);
    }
    expect(deployStageDoc.jobs?.['database-migration']?.secrets).toEqual({
      DATABASE_URL: '${{ secrets.DATABASE_URL }}',
      POSTGRES_URL_NON_POOLING: '${{ secrets.POSTGRES_URL_NON_POOLING }}',
    });
    const expectedProviderSecrets = {
      GCP_SA_KEY: '${{ secrets.GCP_SA_KEY }}',
      GCP_PROJECT_ID: '${{ secrets.GCP_PROJECT_ID }}',
      DEPLOY_WEBHOOK_URL: '${{ secrets.DEPLOY_WEBHOOK_URL }}',
      DEPLOY_WEBHOOK_SECRET: '${{ secrets.DEPLOY_WEBHOOK_SECRET }}',
      SERVICE_URL: '${{ secrets.SERVICE_URL }}',
    };
    expect(deployStageDoc.jobs?.['deploy-provider']?.secrets).toEqual(expectedProviderSecrets);
    expect(deployStageDoc.jobs?.rollback?.secrets).toEqual(expectedProviderSecrets);
    expect(rollbackDoc.jobs?.redeploy?.secrets).toEqual(expectedProviderSecrets);
    expect(deployProviderDoc.on?.workflow_call?.secrets).not.toHaveProperty('DATABASE_URL');
    expect(deployProviderDoc.on?.workflow_call?.secrets).not.toHaveProperty('POSTGRES_URL_NON_POOLING');

    // 3. db-migrate.yml and deploy-provider.yml expose caller_holds_lock and queue: max without forbidden contexts
    for (const [label, doc, callerPrefix] of [
      ['db-migrate.yml', dbMigrateDoc, 'caller-db-migrate-'],
      ['deploy-provider.yml', deployProviderDoc, 'caller-deploy-provider-'],
    ] as const) {
      expect({
        label,
        input: doc.on?.workflow_call?.inputs?.caller_holds_lock,
      }).toEqual({
        label,
        input: expect.objectContaining({ type: 'boolean', default: false }),
      });
      expect(doc.concurrency?.['cancel-in-progress']).toBe(false);
      expect(doc.concurrency?.queue).toBe('max');
      const groupExpr = doc.concurrency?.group ?? '';
      expect(groupExpr).toContain("format('deploy-env-{0}', inputs.environment || 'production')");
      expect(groupExpr).toContain(callerPrefix);
      expect(groupExpr).not.toContain('rollback_environment');
      for (const forbiddenCtx of ['needs.', 'steps.', 'secrets.', 'strategy.', 'matrix.']) {
        expect(groupExpr).not.toContain(forbiddenCtx);
      }
    }

    // 4. ci.yml and storybook.yml enforce queue: max FIFO concurrency and deploy-docs locks github-pages
    const ciDoc = parseDocument(ciYml, { version: '1.2', strict: true }).toJS() as {
      concurrency?: { group?: string; 'cancel-in-progress'?: boolean | string; queue?: string };
      jobs?: Record<
        string,
        {
          if?: string;
          concurrency?: { group?: string; 'cancel-in-progress'?: boolean | string; queue?: string };
        }
      >;
    };
    const storybookDoc = parseDocument(storybookYml, { version: '1.2', strict: true }).toJS() as WorkflowShape;

    expect(ciDoc.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress':
        "${{ github.event_name == 'pull_request' || github.event_name == 'merge_group' }}",
      queue: 'max',
    });
    expect(storybookDoc.concurrency).toEqual({
      group: 'storybook-${{ github.ref }}',
      'cancel-in-progress':
        "${{ github.event_name == 'pull_request' || github.event_name == 'merge_group' }}",
      queue: 'max',
    });
    expect(ciDoc.jobs?.['prepare-docs']?.if).toBe(
      "github.ref == 'refs/heads/main' && github.event_name == 'push'"
    );
    expect(ciDoc.jobs?.['deploy-docs']?.if).toBe(
      "github.ref == 'refs/heads/main' && github.event_name == 'push' && needs.prepare-docs.outputs.is_latest == 'true'"
    );
    expect(ciDoc.jobs?.['deploy-docs']?.concurrency).toEqual({
      group: 'github-pages',
      'cancel-in-progress': false,
      queue: 'max',
    });
  });

  it('verifies origin/main HEAD freshness in ci.yml deploy-docs and skips stale commits cleanly', () => {
    const freshnessScript = extractStepRunScript(ciYml, 'Verify Main Branch Tip Freshness');
    expect(freshnessScript).not.toContain('${{');

    const bareOriginDir = path.join(tempDir, 'origin.git');
    const workRepoDir = path.join(tempDir, 'work');
    fs.mkdirSync(bareOriginDir, { recursive: true });
    execFileSync('git', ['init', '--bare', '--initial-branch=main'], { cwd: bareOriginDir });
    execFileSync('git', ['clone', bareOriginDir, workRepoDir]);
    execFileSync('git', ['config', 'user.email', 'ci@example.com'], { cwd: workRepoDir });
    execFileSync('git', ['config', 'user.name', 'CI Bot'], { cwd: workRepoDir });

    fs.writeFileSync(path.join(workRepoDir, 'doc.txt'), 'v1\n');
    execFileSync('git', ['add', 'doc.txt'], { cwd: workRepoDir });
    execFileSync('git', ['commit', '-m', 'first commit'], { cwd: workRepoDir });
    const firstSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workRepoDir,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: workRepoDir });

    // 1. Tip commit matches origin/main HEAD -> is_latest=true
    fs.writeFileSync(outputFile, '');
    const latestRes = runBashStep(
      freshnessScript,
      {
        GITHUB_TOKEN: '',
        CURRENT_SHA: firstSha,
      },
      workRepoDir
    );
    expect(latestRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`main_head_sha=${firstSha}`);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('is_latest=true');

    // 2. Newer commit pushed to origin/main -> stale commit skips Pages with exit 0 and is_latest=false
    fs.writeFileSync(path.join(workRepoDir, 'doc.txt'), 'v2\n');
    execFileSync('git', ['add', 'doc.txt'], { cwd: workRepoDir });
    execFileSync('git', ['commit', '-m', 'second commit'], { cwd: workRepoDir });
    const secondSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: workRepoDir,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/main'], { cwd: workRepoDir });
    execFileSync('git', ['checkout', '--detach', firstSha], { cwd: workRepoDir, stdio: 'ignore' });

    fs.writeFileSync(outputFile, '');
    const staleRes = runBashStep(
      freshnessScript,
      {
        GITHUB_TOKEN: '',
        CURRENT_SHA: firstSha,
      },
      workRepoDir
    );
    expect(staleRes.status).toBe(0);
    expect(staleRes.stdout + staleRes.stderr).toContain('Skipping GitHub Pages deployment for stale commit');
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`main_head_sha=${secondSha}`);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('is_latest=false');

    // 3. Missing origin remote fails closed with exit 1
    execFileSync('git', ['remote', 'remove', 'origin'], { cwd: workRepoDir });
    fs.writeFileSync(outputFile, '');
    const missingOriginRes = runBashStep(
      freshnessScript,
      {
        GITHUB_TOKEN: '',
        CURRENT_SHA: secondSha,
      },
      workRepoDir
    );
    expect(missingOriginRes.status).toBe(1);
    expect(missingOriginRes.stdout + missingOriginRes.stderr).toContain("Missing git remote 'origin'");
  });

  it('propagates image_digest in deploy.yml and removes latest defaults in deploy-provider.yml', () => {
    expect(deployProviderYml).not.toContain("default: 'latest'");
    expect(deployProviderYml).toContain('image_digest:');

    expect(deployYml).toContain('image_digest:');
    const digestPassMatches = deployYml.match(
      /image_digest: \$\{\{ inputs\.image_digest \|\| needs\.publish-artifact\.outputs\.image_digest \}\}/g
    );
    expect(digestPassMatches).toHaveLength(2);
  });

  it('passes workflow inputs and GH_TOKEN strictly via env blocks without ${{ ... }} inside deploy-provider.yml run scripts', () => {
    const stepNames = [
      'Validate Commit SHA Input',
      'Resolve Artifact Image URI',
      'Verify Artifact Provenance Attestation',
      'Resolve Standalone Promotion Commit & Main Ancestry',
      'Verify Selected Provider Credentials',
      'Capture Active Image Tag Before Rollout',
      'Deploy via Generic Webhook Adapter',
      'Record Environment Deployment State',
      'Dry-run Provider Adapter Validation',
      'Resolve Service URL Output',
      'Deployment Summary',
    ];

    for (const stepName of stepNames) {
      const script = extractStepRunScript(deployProviderYml, stepName);
      expect(script).not.toContain('${{');
    }

    const stageHealthScript = extractStepRunScript(
      deployStageYml,
      'Execute Post-Deployment Health Probe Verification'
    );
    expect(stageHealthScript).not.toContain('${{');
  });

  it('validates an explicit sha256 digest, verifies OIDC provenance, and writes pinned @sha256 URI to outputs and summary', () => {
    const resolveScript = extractStepRunScript(deployProviderYml, 'Resolve Artifact Image URI');
    const provenanceScript = extractStepRunScript(deployProviderYml, 'Verify Artifact Provenance Attestation');
    const dryRunScript = extractStepRunScript(deployProviderYml, 'Dry-run Provider Adapter Validation');
    const summaryScript = extractStepRunScript(deployProviderYml, 'Deployment Summary');

    const resolveRes = runBashStep(resolveScript, {
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      RAW_DIGEST: VALID_DIGEST,
      RAW_TAG: 'a1b2c3d4',
      TARGET_ENV: 'staging',
    });
    expect(resolveRes.status).toBe(0);

    const expectedUri = `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`;
    const outputsAfterResolve = fs.readFileSync(outputFile, 'utf8');
    expect(outputsAfterResolve).toContain(`image_digest=${VALID_DIGEST}`);
    expect(outputsAfterResolve).toContain(`image_uri=${expectedUri}`);

    const provRes = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: expectedUri,
      IMAGE_DIGEST: VALID_DIGEST,
      RAW_TAG: 'a1b2c3d4',
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
    });
    expect(provRes.status).toBe(0);
    const outputsAfterProv = fs.readFileSync(outputFile, 'utf8');
    expect(outputsAfterProv).toContain('source_ref=refs/heads/main');
    expect(outputsAfterProv).toContain(`source_revision=${VALID_REVISION}`);
    expect(outputsAfterProv).toContain('attestation_status=verified');

    const cliCalls = fs.readFileSync(callLogFile, 'utf8');
    expect(cliCalls).not.toContain('docker buildx imagetools inspect --format');
    expect(cliCalls).toContain(`docker buildx imagetools inspect --raw ${expectedUri}`);
    expect(cliCalls).toContain(
      `gh attestation verify oci://${expectedUri} --owner OwnerOrg --signer-workflow OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml --source-ref refs/heads/main [token=present]`
    );
    expect(cliCalls).toContain(
      `gh attestation verify oci://${expectedUri} --owner OwnerOrg --signer-workflow OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml --source-ref refs/heads/main --format json [token=present]`
    );

    // v* release tag enforces --source-ref refs/tags/<tag>
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(callLogFile, '');
    const tagProvRes = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: expectedUri,
      IMAGE_DIGEST: VALID_DIGEST,
      RAW_TAG: 'v1.4.2',
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
    });
    expect(tagProvRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('source_ref=refs/tags/v1.4.2');
    expect(fs.readFileSync(callLogFile, 'utf8')).toContain(
      `gh attestation verify oci://${expectedUri} --owner OwnerOrg --signer-workflow OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml --source-ref refs/tags/v1.4.2 [token=present]`
    );

    // Unauthorized feature-branch source_ref fails closed before invoking gh attestation verify
    fs.writeFileSync(callLogFile, '');
    const badRefRes = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: expectedUri,
      IMAGE_DIGEST: VALID_DIGEST,
      INPUT_SOURCE_REF: 'refs/heads/feature-bypass',
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
    });
    expect(badRefRes.status).not.toBe(0);
    expect(badRefRes.stdout + badRefRes.stderr).toContain('Unauthorized provenance source_ref');
    expect(fs.readFileSync(callLogFile, 'utf8')).toBe('');

    const dryRunRes = runBashStep(dryRunScript, {
      IMAGE_URI: expectedUri,
      IMAGE_DIGEST: VALID_DIGEST,
    });
    expect(dryRunRes.status).toBe(0);
    expect(dryRunRes.stdout).toContain(expectedUri);

    const summaryRes = runBashStep(summaryScript, {
      TARGET_ENV: 'staging',
      PROVIDER: 'google-cloud-run',
      IMAGE_DIGEST: VALID_DIGEST,
      IMAGE_URI: expectedUri,
      ATTESTATION_STATUS: 'verified',
      SERVICE_URL: 'https://staging.example.com',
    });
    expect(summaryRes.status).toBe(0);

    const summary = fs.readFileSync(summaryFile, 'utf8');
    expect(summary).toContain(`**Verified Digest:** \`${VALID_DIGEST}\``);
    expect(summary).toContain(`**Pinned Artifact URI:** \`${expectedUri}\``);
    expect(summary).toContain('**Provenance Attestation:** `verified`');
  });

  it('resolves tag-only manual dispatch to an immutable sha256 digest via docker buildx imagetools inspect', () => {
    const resolveScript = extractStepRunScript(deployProviderYml, 'Resolve Artifact Image URI');
    const resolvedFromTag = 'sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    const res = runBashStep(resolveScript, {
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      RAW_DIGEST: '',
      RAW_TAG: 'v1.4.2',
      TARGET_ENV: 'production',
      MOCK_RESOLVED_DIGEST: resolvedFromTag,
    });

    expect(res.status).toBe(0);
    const cliCalls = fs.readFileSync(callLogFile, 'utf8');
    expect(cliCalls).toContain(
      'docker buildx imagetools inspect --format {{.Manifest.Digest}} ghcr.io/ownerorg/wedding_website:v1.4.2'
    );

    const outputs = fs.readFileSync(outputFile, 'utf8');
    expect(outputs).toContain(`image_digest=${resolvedFromTag}`);
    expect(outputs).toContain(`image_uri=ghcr.io/ownerorg/wedding_website@${resolvedFromTag}`);
  });

  it('blocks unpinned latest tags, missing identifiers, and malformed digests before registry or provenance calls', () => {
    const resolveScript = extractStepRunScript(deployProviderYml, 'Resolve Artifact Image URI');

    const latestRes = runBashStep(resolveScript, {
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      RAW_DIGEST: '',
      RAW_TAG: 'latest',
      TARGET_ENV: 'production',
    });
    expect(latestRes.status).not.toBe(0);
    expect(latestRes.stdout + latestRes.stderr).toContain("Unpinned 'latest' image tag is forbidden");

    const emptyRes = runBashStep(resolveScript, {
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      RAW_DIGEST: '',
      RAW_TAG: '',
      TARGET_ENV: 'production',
    });
    expect(emptyRes.status).not.toBe(0);
    expect(emptyRes.stdout + emptyRes.stderr).toContain('Missing artifact identifier');

    const badDigestRes = runBashStep(resolveScript, {
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      RAW_DIGEST: 'sha256:not-a-valid-64-char-hex',
      RAW_TAG: '',
      TARGET_ENV: 'production',
    });
    expect(badDigestRes.status).not.toBe(0);
    expect(badDigestRes.stdout + badDigestRes.stderr).toContain('Invalid image digest');

    expect(fs.readFileSync(callLogFile, 'utf8')).toBe('');
  });

  it('blocks deployment when gh attestation verify fails on an unattested or tampered image', () => {
    const provenanceScript = extractStepRunScript(deployProviderYml, 'Verify Artifact Provenance Attestation');

    const res = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`,
      IMAGE_DIGEST: VALID_DIGEST,
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_ATTESTATION_FAIL: 'true',
    });

    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toContain('OIDC build provenance verification failed');
    expect(fs.readFileSync(outputFile, 'utf8')).not.toContain('attestation_status=verified');
  });

  it('falls back to SLSA provenance revision and blocks deploy-provider.yml rollout when ci.yml has not passed for the signed revision', () => {
    const provenanceScript = extractStepRunScript(deployProviderYml, 'Verify Artifact Provenance Attestation');
    const slsaFallbackSha = '11223344556677889900aabbccddeeff00112233';
    const expectedUri = `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`;

    // 1. OCI index revision missing -> falls back to SLSA v1.0 resolvedDependencies gitCommit and verifies CI
    setMockCiRuns([
      {
        id: 8101,
        head_sha: slsaFallbackSha,
        status: 'completed',
        conclusion: 'success',
        head_repository: { full_name: 'OwnerOrg/Wedding_Website' },
      },
    ]);
    fs.writeFileSync(outputFile, '');
    const slsaOkRes = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: expectedUri,
      IMAGE_DIGEST: VALID_DIGEST,
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_OMIT_INDEX_REVISION: 'true',
      MOCK_SLSA_REVISION: slsaFallbackSha,
    });
    expect(slsaOkRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`source_revision=${slsaFallbackSha}`);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('attestation_status=verified');

    // 2. SLSA v0.2 invocation.configSource.digest.sha1 fallback also works
    fs.writeFileSync(outputFile, '');
    const slsaV02Res = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: expectedUri,
      IMAGE_DIGEST: VALID_DIGEST,
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_OMIT_INDEX_REVISION: 'true',
      MOCK_SLSA_V02: 'true',
      MOCK_SLSA_REVISION: slsaFallbackSha,
    });
    expect(slsaV02Res.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`source_revision=${slsaFallbackSha}`);

    // 3. Blocks rollout when ci.yml run for the signed revision failed or is absent
    setMockCiRuns([
      {
        id: 8102,
        head_sha: VALID_REVISION,
        status: 'completed',
        conclusion: 'failure',
        head_repository: { full_name: 'OwnerOrg/Wedding_Website' },
      },
    ]);
    fs.writeFileSync(outputFile, '');
    const failedCiRes = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: expectedUri,
      IMAGE_DIGEST: VALID_DIGEST,
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
    });
    expect(failedCiRes.status).not.toBe(0);
    expect(failedCiRes.stdout + failedCiRes.stderr).toContain(
      'No completed successful ci.yml workflow run found for signed source revision'
    );
    expect(fs.readFileSync(outputFile, 'utf8')).not.toContain('attestation_status=verified');

    // 4. Blocks rollout when neither OCI index metadata nor SLSA provenance contains a 40-char revision
    fs.writeFileSync(outputFile, '');
    const missingRevRes = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: expectedUri,
      IMAGE_DIGEST: VALID_DIGEST,
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_OMIT_INDEX_REVISION: 'true',
      MOCK_OMIT_SLSA_REVISION: 'true',
    });
    expect(missingRevRes.status).not.toBe(0);
    expect(missingRevRes.stdout + missingRevRes.stderr).toContain(
      'Unable to resolve a signed 40-character source revision'
    );

    // 5. Blocks rollout when OCI index revision conflicts with SLSA externalParameters.inputs.commit_sha
    fs.writeFileSync(outputFile, '');
    const conflictRes = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: expectedUri,
      IMAGE_DIGEST: VALID_DIGEST,
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_INDEX_REVISION: VALID_REVISION,
      MOCK_SLSA_INPUT_SHA: slsaFallbackSha,
    });
    expect(conflictRes.status).not.toBe(0);
    expect(conflictRes.stdout + conflictRes.stderr).toContain('conflicts with SLSA input commit_sha');
  });

  it('resolves target_sha from inputs.image_digest in deploy.yml ci-gate and aligns schema-compatibility and db-migrate.yml to that revision', () => {
    const resolveTargetShaScript = extractStepRunScript(deployYml, 'Resolve Target Commit SHA');
    const alignWorkspaceScript = extractStepRunScript(deployYml, 'Align Workspace to Verified Commit SHA');
    const confirmMigrationScript = extractStepRunScript(dbMigrateYml, 'Verify Manual Migration Confirmation');

    const headMainSha = '9999999999999999999999999999999999999999';
    const pinnedDigestSha = '4455667788990011223344556677889900112233';

    // 1. Orchestrated digest dispatch resolves target_sha from pinned digest's OCI revision instead of github.sha
    fs.writeFileSync(outputFile, '');
    const digestRes = runBashStep(resolveTargetShaScript, {
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      EVENT_NAME: 'workflow_dispatch',
      WORKFLOW_RUN_HEAD_SHA: '',
      CURRENT_SHA: headMainSha,
      INPUT_IMAGE_DIGEST: VALID_DIGEST,
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_INDEX_REVISION: pinnedDigestSha,
    });
    expect(digestRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${pinnedDigestSha}`);
    expect(fs.readFileSync(outputFile, 'utf8')).not.toContain(headMainSha);

    // 2. Falls back to SLSA provenance revision when OCI index revision annotation is absent
    fs.writeFileSync(outputFile, '');
    const slsaDigestRes = runBashStep(resolveTargetShaScript, {
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      EVENT_NAME: 'workflow_dispatch',
      WORKFLOW_RUN_HEAD_SHA: '',
      CURRENT_SHA: headMainSha,
      INPUT_IMAGE_DIGEST: VALID_DIGEST,
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_OMIT_INDEX_REVISION: 'true',
      MOCK_SLSA_REVISION: pinnedDigestSha,
    });
    expect(slsaDigestRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${pinnedDigestSha}`);

    // 3. Rejects malformed or unattested digests in Resolve Target Commit SHA
    const badDigestRes = runBashStep(resolveTargetShaScript, {
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      EVENT_NAME: 'workflow_dispatch',
      CURRENT_SHA: headMainSha,
      INPUT_IMAGE_DIGEST: 'sha256:bad',
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
    });
    expect(badDigestRes.status).not.toBe(0);

    const unattestedRes = runBashStep(resolveTargetShaScript, {
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      EVENT_NAME: 'workflow_dispatch',
      CURRENT_SHA: headMainSha,
      INPUT_IMAGE_DIGEST: VALID_DIGEST,
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_ATTESTATION_FAIL: 'true',
    });
    expect(unattestedRes.status).not.toBe(0);

    // 4. Align Workspace to Verified Commit SHA checks out maintenance-branch or older digest SHA on workflow_dispatch
    const repoDir = path.join(tempDir, 'align-repo');
    fs.mkdirSync(repoDir, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, 'schema.txt'), 'v1\n');
    execFileSync('git', ['add', 'schema.txt'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'v1 base'], { cwd: repoDir, stdio: 'ignore' });

    execFileSync('git', ['checkout', '-b', 'release/v1.4'], { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, 'schema.txt'), 'v1.4.3\n');
    execFileSync('git', ['add', 'schema.txt'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'v1.4.3 patch'], { cwd: repoDir, stdio: 'ignore' });
    const maintenanceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).trim();

    execFileSync('git', ['checkout', 'main'], { cwd: repoDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(repoDir, 'schema.txt'), 'v2.0.0\n');
    execFileSync('git', ['add', 'schema.txt'], { cwd: repoDir, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'v2.0.0 main'], { cwd: repoDir, stdio: 'ignore' });

    // On workflow_run (main push), non-ancestor commit is rejected
    const wfRunNonAncestor = runBashStep(
      alignWorkspaceScript,
      {
        EVENT_NAME: 'workflow_run',
        TARGET_SHA: maintenanceSha,
        GITHUB_REF: 'refs/heads/main',
      },
      repoDir
    );
    expect(wfRunNonAncestor.status).not.toBe(0);

    // On workflow_dispatch with pinned image_digest, maintenance branch revision aligns cleanly
    const dispatchAlignRes = runBashStep(
      alignWorkspaceScript,
      {
        EVENT_NAME: 'workflow_dispatch',
        TARGET_SHA: maintenanceSha,
      },
      repoDir
    );
    expect(dispatchAlignRes.status).toBe(0);
    expect(fs.readFileSync(path.join(repoDir, 'schema.txt'), 'utf8')).toBe('v1.4.3\n');

    // 5. db-migrate.yml rejects non-40-char commit_sha values while accepting aligned 40-char target_sha
    const badMigrateShaRes = runBashStep(confirmMigrationScript, {
      CONFIRM: 'true',
      TARGET_ENV: 'staging',
      INPUT_COMMIT_SHA: 'refs/heads/main',
    });
    expect(badMigrateShaRes.status).not.toBe(0);
    expect(badMigrateShaRes.stdout + badMigrateShaRes.stderr).toContain('Invalid commit_sha');

    const validMigrateShaRes = runBashStep(confirmMigrationScript, {
      CONFIRM: 'true',
      TARGET_ENV: 'staging',
      INPUT_COMMIT_SHA: maintenanceSha,
    });
    expect(validMigrateShaRes.status).toBe(0);
  });

  it('documents digest propagation and provenance verification in DEPLOYMENT.md and gcp-cloud-run.md', () => {
    const deploymentDoc = fs.readFileSync(DEPLOYMENT_DOC_PATH, 'utf8');
    const cloudRunDoc = fs.readFileSync(CLOUD_RUN_DOC_PATH, 'utf8');

    expect(deploymentDoc).toContain('gh attestation verify');
    expect(deploymentDoc).toContain('docker buildx imagetools inspect');
    expect(deploymentDoc).toContain('attestation_status');

    expect(cloudRunDoc).toContain(
      'image_digest: ${{ inputs.image_digest || needs.publish-artifact.outputs.image_digest }}'
    );
    expect(cloudRunDoc).toContain('attestations: read');
    expect(cloudRunDoc).toContain('gh attestation verify');
    expect(deploymentDoc).toContain('vars.SERVICE_URL');
    expect(deploymentDoc).toContain('secrets.SERVICE_URL');
    expect(deploymentDoc).toContain('commit_sha');
    expect(deploymentDoc).toContain('deployments: write');
    expect(cloudRunDoc).toContain('vars.SERVICE_URL');
    expect(cloudRunDoc).toContain('secrets.SERVICE_URL');
    expect(cloudRunDoc).toContain('commit_sha: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(cloudRunDoc).toContain('deployments: write');
    for (const doc of [deploymentDoc, cloudRunDoc]) {
      expect(doc).toContain('deploy-stage.yml');
      expect(doc).toContain('queue: max');
      expect(doc).toContain('caller_holds_lock');
      expect(doc).toContain('deploy-env-staging');
      expect(doc).toContain('deploy-env-production');
    }
  });

  it('resolves vars.SERVICE_URL, cloudrun url, and secrets.SERVICE_URL in order without exporting secret-only fallback to $GITHUB_OUTPUT', () => {
    const resolveUrlScript = extractStepRunScript(deployProviderYml, 'Resolve Service URL Output');
    const summaryScript = extractStepRunScript(deployProviderYml, 'Deployment Summary');

    const parseOutputs = () => {
      const map: Record<string, string> = {};
      for (const line of fs.readFileSync(outputFile, 'utf8').split(/\r?\n/)) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          map[line.slice(0, idx)] = line.slice(idx + 1);
        }
      }
      return map;
    };

    // 1. vars.SERVICE_URL set without secrets.SERVICE_URL -> unmasked output and summary
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(summaryFile, '');
    const varsRes = runBashStep(resolveUrlScript, {
      VAR_SERVICE_URL: 'https://staging.wedding.example.com',
      CLOUDRUN_URL: 'https://wedding-website-xyz.a.run.app',
      SECRET_SERVICE_URL: '',
      GCP_SA_KEY: '{"project_id":"demo"}',
      DEPLOY_WEBHOOK_URL: '',
      INPUT_DRY_RUN: 'false',
    });
    expect(varsRes.status).toBe(0);
    expect(parseOutputs()).toEqual({
      is_dry_run: 'false',
      service_url: 'https://staging.wedding.example.com',
    });

    const summaryRes = runBashStep(summaryScript, {
      TARGET_ENV: 'staging',
      PROVIDER: 'google-cloud-run',
      IMAGE_DIGEST: VALID_DIGEST,
      IMAGE_URI: `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`,
      ATTESTATION_STATUS: 'verified',
      SERVICE_URL: parseOutputs().service_url,
    });
    expect(summaryRes.status).toBe(0);
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain(
      '- **Service URL:** `https://staging.wedding.example.com`'
    );

    // 2. Cloud Run URL used when vars.SERVICE_URL is empty
    fs.writeFileSync(outputFile, '');
    const cloudRunRes = runBashStep(resolveUrlScript, {
      VAR_SERVICE_URL: '',
      CLOUDRUN_URL: 'https://wedding-website-xyz.a.run.app',
      SECRET_SERVICE_URL: 'https://legacy-secret.example.com',
      GCP_SA_KEY: '{"project_id":"demo"}',
      DEPLOY_WEBHOOK_URL: '',
      INPUT_DRY_RUN: 'false',
    });
    expect(cloudRunRes.status).toBe(0);
    expect(parseOutputs()).toEqual({
      is_dry_run: 'false',
      service_url: 'https://wedding-website-xyz.a.run.app',
    });

    // 3. Secret-only fallback omitted from $GITHUB_OUTPUT (both live and dry-run)
    fs.writeFileSync(outputFile, '');
    const secretLiveRes = runBashStep(resolveUrlScript, {
      VAR_SERVICE_URL: '',
      CLOUDRUN_URL: '',
      SECRET_SERVICE_URL: 'https://legacy-secret.example.com',
      GCP_SA_KEY: '',
      DEPLOY_WEBHOOK_URL: 'https://webhook.example.com/deploy',
      INPUT_DRY_RUN: 'false',
    });
    expect(secretLiveRes.status).toBe(0);
    expect(parseOutputs()).toEqual({
      is_dry_run: 'false',
      service_url: '',
    });
    expect(fs.readFileSync(outputFile, 'utf8')).not.toContain('legacy-secret.example.com');

    fs.writeFileSync(outputFile, '');
    const secretDryRes = runBashStep(resolveUrlScript, {
      VAR_SERVICE_URL: '',
      CLOUDRUN_URL: '',
      SECRET_SERVICE_URL: 'https://legacy-secret.example.com',
      GCP_SA_KEY: '',
      DEPLOY_WEBHOOK_URL: '',
      INPUT_DRY_RUN: 'true',
    });
    expect(secretDryRes.status).toBe(0);
    expect(parseOutputs()).toEqual({
      is_dry_run: 'true',
      service_url: '',
    });

    // 4. Missing URL in live mode outputs empty string (not 127.0.0.1:3000), while dry-run outputs 127.0.0.1:3000
    fs.writeFileSync(outputFile, '');
    const emptyLiveRes = runBashStep(resolveUrlScript, {
      VAR_SERVICE_URL: '',
      CLOUDRUN_URL: '',
      SECRET_SERVICE_URL: '',
      GCP_SA_KEY: '',
      DEPLOY_WEBHOOK_URL: 'https://webhook.example.com/deploy',
      INPUT_DRY_RUN: 'false',
    });
    expect(emptyLiveRes.status).toBe(0);
    expect(parseOutputs()).toEqual({
      is_dry_run: 'false',
      service_url: '',
    });

    fs.writeFileSync(outputFile, '');
    const emptyDryRes = runBashStep(resolveUrlScript, {
      VAR_SERVICE_URL: '',
      CLOUDRUN_URL: '',
      SECRET_SERVICE_URL: '',
      GCP_SA_KEY: '',
      DEPLOY_WEBHOOK_URL: '',
      INPUT_DRY_RUN: 'true',
    });
    expect(emptyDryRes.status).toBe(0);
    expect(parseOutputs()).toEqual({
      is_dry_run: 'true',
      service_url: 'http://127.0.0.1:3000',
    });
  });

  it('verifies deploy-stage.yml health probes succeed under simulated runner secret output redaction with vars.SERVICE_URL or legacy secrets.SERVICE_URL and reject degraded or invalid payloads', async () => {
    const stageProbeScript = extractStepRunScript(
      deployStageYml,
      'Execute Post-Deployment Health Probe Verification'
    );

    let healthMode: 'wrapped-ok' | 'unwrapped-ok' | 'degraded' | 'success-false' | 'malformed' = 'wrapped-ok';
    let readyMode: 'ready' | 'unhealthy-503' | 'unhealthy-200' | 'malformed' = 'ready';

    const server = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        if (healthMode === 'wrapped-ok') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: { status: 'ok', timestamp: '2026-11-20T00:00:00.000Z', database: 'connected' },
            })
          );
          return;
        }
        if (healthMode === 'unwrapped-ok') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', database: 'connected' }));
          return;
        }
        if (healthMode === 'degraded') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: { status: 'degraded', database: 'disconnected' },
            })
          );
          return;
        }
        if (healthMode === 'success-false') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              status: 'ok',
              database: 'connected',
              data: { status: 'ok', database: 'connected' },
            })
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('{"success":true,"data":{"status":"ok"');
        return;
      }
      if (req.url === '/api/ready') {
        if (readyMode === 'ready') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'ready',
              database: 'connected',
              timestamp: '2026-11-20T00:00:00.000Z',
            })
          );
          return;
        }
        if (readyMode === 'unhealthy-503') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'unhealthy',
              database: 'connected',
              error: 'Database schema is not ready',
              timestamp: '2026-11-20T00:00:00.000Z',
            })
          );
          return;
        }
        if (readyMode === 'unhealthy-200') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'unhealthy',
              database: 'connected',
            })
          );
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('{"status":"ready"');
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const liveUrl = `http://127.0.0.1:${port}`;

    const runAsync = (script: string, envOverrides: Record<string, string>) =>
      new Promise<{ status: number | null; outputs: string; summary: string }>((resolve, reject) => {
        const stepOut = path.join(tempDir, `out-${Math.random().toString(36).slice(2)}.txt`);
        const stepSum = path.join(tempDir, `sum-${Math.random().toString(36).slice(2)}.md`);
        fs.writeFileSync(stepOut, '');
        fs.writeFileSync(stepSum, '');
        const child = spawn('bash', ['-eo', 'pipefail', '-c', script], {
          cwd: tempDir,
          env: {
            ...process.env,
            GITHUB_OUTPUT: stepOut,
            GITHUB_STEP_SUMMARY: stepSum,
            ...envOverrides,
          },
        });
        child.on('error', reject);
        child.on('close', (code) => {
          resolve({
            status: code,
            outputs: fs.readFileSync(stepOut, 'utf8'),
            summary: fs.readFileSync(stepSum, 'utf8'),
          });
        });
      });

    const fastFailScript = stageProbeScript
      .replace('MAX_TIMEOUT=120', 'MAX_TIMEOUT=1')
      .replace('DELAY=2', 'DELAY=1');

    try {
      // Simulated runner redaction (empty string and masked '***') with vars.SERVICE_URL set
      const stagingVarsRes = await runAsync(stageProbeScript, {
        TARGET_ENV: 'staging',
        VAR_SERVICE_URL: `${liveUrl}/`,
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
      });
      expect(stagingVarsRes.status).toBe(0);
      expect(stagingVarsRes.outputs).toContain('health_status=healthy');
      expect(stagingVarsRes.summary).toContain(`- **Target Service URL:** \`${liveUrl}\``);

      // Simulated runner redaction (empty string and '***') with legacy secrets.SERVICE_URL set
      const stagingSecretRes = await runAsync(stageProbeScript, {
        TARGET_ENV: 'staging',
        VAR_SERVICE_URL: '',
        SERVICE_URL: '',
        SECRET_SERVICE_URL: liveUrl,
        IS_DRY_RUN: 'false',
      });
      expect(stagingSecretRes.status).toBe(0);
      expect(stagingSecretRes.outputs).toContain('health_status=healthy');

      const prodSecretMaskedRes = await runAsync(stageProbeScript, {
        TARGET_ENV: 'production',
        VAR_SERVICE_URL: '',
        SERVICE_URL: '***',
        SECRET_SERVICE_URL: liveUrl,
        IS_DRY_RUN: 'false',
      });
      expect(prodSecretMaskedRes.status).toBe(0);
      expect(prodSecretMaskedRes.outputs).toContain('health_status=healthy');

      // Unwrapped fallback succeeds when .success is absent
      healthMode = 'unwrapped-ok';
      const unwrappedRes = await runAsync(stageProbeScript, {
        TARGET_ENV: 'production',
        VAR_SERVICE_URL: liveUrl,
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
      });
      expect(unwrappedRes.status).toBe(0);
      expect(unwrappedRes.outputs).toContain('health_status=healthy');

      // Degraded wrapped payload fails closed
      healthMode = 'degraded';
      for (const targetEnv of ['staging', 'production'] as const) {
        const degradedRes = await runAsync(fastFailScript, {
          TARGET_ENV: targetEnv,
          VAR_SERVICE_URL: liveUrl,
          SERVICE_URL: '',
          SECRET_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
        });
        expect(degradedRes.status).toBe(1);
        expect(degradedRes.outputs).toContain('health_status=unhealthy');
      }

      // HTTP 200 with .success == false fails closed even if status/database look healthy
      healthMode = 'success-false';
      for (const targetEnv of ['staging', 'production'] as const) {
        const successFalseRes = await runAsync(fastFailScript, {
          TARGET_ENV: targetEnv,
          VAR_SERVICE_URL: liveUrl,
          SERVICE_URL: '',
          SECRET_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
        });
        expect(successFalseRes.status).toBe(1);
        expect(successFalseRes.outputs).toContain('health_status=unhealthy');
      }

      // Malformed JSON fails closed
      healthMode = 'malformed';
      const malformedRes = await runAsync(fastFailScript, {
        TARGET_ENV: 'staging',
        VAR_SERVICE_URL: liveUrl,
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
      });
      expect(malformedRes.status).toBe(1);
      expect(malformedRes.outputs).toContain('health_status=unhealthy');

      // Healthy /api/health with failing /api/ready (HTTP 503, status != ready, or malformed JSON) fails closed
      healthMode = 'wrapped-ok';
      for (const failingReadyMode of ['unhealthy-503', 'unhealthy-200', 'malformed'] as const) {
        readyMode = failingReadyMode;
        const readyFailRes = await runAsync(fastFailScript, {
          TARGET_ENV: 'production',
          VAR_SERVICE_URL: liveUrl,
          SERVICE_URL: '',
          SECRET_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
        });
        expect(readyFailRes.status).toBe(1);
        expect(readyFailRes.outputs).toContain('health_status=unhealthy');
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Hung /api/health socket (accepts connection & headers but never finishes response) stops within 10s via curl --connect-timeout 5 --max-time 10
    expect(stageProbeScript).toContain('--connect-timeout 5 --max-time 10');

    const deployStageDoc = parseDocument(deployStageYml, { version: '1.2', strict: true }).toJS() as {
      jobs?: Record<string, { 'timeout-minutes'?: number; if?: string }>;
    };
    expect(deployStageDoc.jobs?.['verify-deployment']?.['timeout-minutes']).toBe(5);
    const rollbackCond = deployStageDoc.jobs?.rollback?.if ?? '';
    expect(rollbackCond).toContain('(failure() || cancelled())');
    expect(rollbackCond).toContain(".result == 'failure'");
    expect(rollbackCond).toContain(".result == 'cancelled'");

    const openSockets = new Set<import('net').Socket>();
    const hungServer = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        // Intentionally leave socket open without ending response to simulate hung DB/health endpoint
      }
    });
    hungServer.on('connection', (sock) => {
      openSockets.add(sock);
      sock.on('close', () => openSockets.delete(sock));
    });

    await new Promise<void>((resolve) => hungServer.listen(0, '127.0.0.1', () => resolve()));
    const hungAddr = hungServer.address();
    const hungPort = typeof hungAddr === 'object' && hungAddr ? hungAddr.port : 0;
    const hungUrl = `http://127.0.0.1:${hungPort}`;

    // Keep curl's real --max-time 10 intact and set loop MAX_TIMEOUT=8 + DELAY=0 so a single hung probe stops at <=10s and exits immediately
    const hungBoundScript = stageProbeScript
      .replace('MAX_TIMEOUT=120', 'MAX_TIMEOUT=8')
      .replace('sleep $DELAY', 'sleep 0');

    try {
      const startMs = Date.now();
      const hungRes = await runAsync(hungBoundScript, {
        TARGET_ENV: 'production',
        VAR_SERVICE_URL: hungUrl,
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
      });
      const elapsedMs = Date.now() - startMs;
      expect(hungRes.status).toBe(1);
      expect(hungRes.outputs).toContain('health_status=unhealthy');
      // Curl --max-time 10 must abort the hung socket at ~10s (well below an unbounded hang)
      expect(elapsedMs).toBeGreaterThanOrEqual(9000);
      expect(elapsedMs).toBeLessThan(12500);
    } finally {
      for (const sock of openSockets) {
        sock.destroy();
      }
      await new Promise<void>((resolve) => hungServer.close(() => resolve()));
    }
  }, 35000);

  it('resolves attested commit SHA for manual deploy.yml image_digest runs and skips newer HEAD migrations', () => {
    const resolveTargetShaScript = extractStepRunScript(deployYml, 'Resolve Target Commit SHA');
    const alignSchemaScript = extractStepRunScript(deployYml, 'Align Workspace to Verified Commit SHA');
    const alignMigrateScript = extractStepRunScript(dbMigrateYml, 'Align Migration Workspace to Target Commit SHA');

    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-digest-repo-'));
    try {
      execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });

      const mig1Dir = path.join(repoDir, 'prisma', 'migrations', '20260101000000_base');
      fs.mkdirSync(mig1Dir, { recursive: true });
      fs.writeFileSync(path.join(mig1Dir, 'migration.sql'), 'CREATE TABLE "Guest" ("id" TEXT PRIMARY KEY);\n');
      execSync('git add . && git commit -m "release v1"', { cwd: repoDir, stdio: 'ignore' });
      const attestedSha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

      const mig2Dir = path.join(repoDir, 'prisma', 'migrations', '20260201000000_head_unreleased');
      fs.mkdirSync(mig2Dir, { recursive: true });
      fs.writeFileSync(path.join(mig2Dir, 'migration.sql'), 'ALTER TABLE "Guest" ADD COLUMN "future_col" TEXT;\n');
      execSync('git add . && git commit -m "unreleased HEAD migration"', { cwd: repoDir, stdio: 'ignore' });
      const headSha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

      // Shim gh attestation verify --format json to return SLSA provenance with attestedSha
      const ghAttestShim = path.join(binDir, 'gh');
      fs.writeFileSync(
        ghAttestShim,
        `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'attestation' && args[1] === 'verify' && args.includes('--format') && args.includes('json')) {
  process.stdout.write(JSON.stringify([{
    verificationResult: {
      statement: {
        predicate: {
          buildDefinition: {
            resolvedDependencies: [{ digest: { gitCommit: '${attestedSha}' } }]
          }
        }
      }
    }
  }]));
  process.exit(0);
}
process.exit(1);
`,
        { mode: 0o755 }
      );

      fs.writeFileSync(outputFile, '');
      const resolveRes = runBashStep(resolveTargetShaScript, {
        GH_TOKEN: 'ghs_test_token',
        GITHUB_ACTOR_LOGIN: 'octocat',
        EVENT_NAME: 'workflow_dispatch',
        WORKFLOW_RUN_HEAD_SHA: '',
        INPUT_COMMIT_SHA: '',
        INPUT_IMAGE_DIGEST: VALID_DIGEST,
        CURRENT_SHA: headSha,
        REPO_OWNER: 'OwnerOrg',
        SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
        MOCK_OMIT_INDEX_REVISION: 'true',
      });
      expect(resolveRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${attestedSha}`);

      // Rejects mismatched explicit commit_sha when image_digest provenance attests a different commit
      const mismatchRes = runBashStep(resolveTargetShaScript, {
        GH_TOKEN: 'ghs_test_token',
        GITHUB_ACTOR_LOGIN: 'octocat',
        EVENT_NAME: 'workflow_dispatch',
        WORKFLOW_RUN_HEAD_SHA: '',
        INPUT_COMMIT_SHA: headSha,
        INPUT_IMAGE_DIGEST: VALID_DIGEST,
        CURRENT_SHA: headSha,
        REPO_OWNER: 'OwnerOrg',
        SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
        MOCK_OMIT_INDEX_REVISION: 'true',
      });
      expect(mismatchRes.status).toBe(1);
      expect(mismatchRes.stdout + mismatchRes.stderr).toContain('does not match attested provenance commit SHA');

      // Aligning schema-compatibility and db-migrate workspaces to target_sha detaches at attestedSha and omits newer HEAD migrations
      const alignSchemaRes = spawnSync('bash', ['-eo', 'pipefail', '-c', alignSchemaScript], {
        cwd: repoDir,
        encoding: 'utf8',
        env: { ...process.env, TARGET_SHA: attestedSha, GITHUB_REF: 'refs/heads/main' },
      });
      expect(alignSchemaRes.status).toBe(0);
      expect(fs.existsSync(path.join(repoDir, 'prisma', 'migrations', '20260101000000_base'))).toBe(true);
      expect(fs.existsSync(path.join(repoDir, 'prisma', 'migrations', '20260201000000_head_unreleased'))).toBe(false);

      // Reset to main HEAD and verify db-migrate.yml workspace alignment step also detaches to attestedSha
      execSync('git checkout main', { cwd: repoDir, stdio: 'ignore' });
      expect(fs.existsSync(path.join(repoDir, 'prisma', 'migrations', '20260201000000_head_unreleased'))).toBe(true);

      const alignMigrateRes = spawnSync('bash', ['-eo', 'pipefail', '-c', alignMigrateScript], {
        cwd: repoDir,
        encoding: 'utf8',
        env: { ...process.env, TARGET_SHA: attestedSha },
      });
      expect(alignMigrateRes.status).toBe(0);
      expect(fs.existsSync(path.join(repoDir, 'prisma', 'migrations', '20260201000000_head_unreleased'))).toBe(false);
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('fails fast in deploy-stage.yml without polling 127.0.0.1:3000 when is_dry_run is false and SERVICE_URL is omitted, and passes dry-run when omitted', () => {
    const stageProbeScript = extractStepRunScript(
      deployStageYml,
      'Execute Post-Deployment Health Probe Verification'
    );

    // Shim curl to fail test if invoked during fail-fast checks
    const curlShim = path.join(binDir, 'curl');
    fs.writeFileSync(
      curlShim,
      `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(callLogFile)}, 'curl ' + process.argv.slice(2).join(' ') + '\\n');
process.stdout.write('\\nHTTP_STATUS_CODE:000');
process.exit(0);
`
    );
    fs.chmodSync(curlShim, 0o755);

    for (const targetEnv of ['staging', 'production'] as const) {
      fs.writeFileSync(outputFile, '');
      fs.writeFileSync(summaryFile, '');
      const failRes = runBashStep(stageProbeScript, {
        TARGET_ENV: targetEnv,
        VAR_SERVICE_URL: '',
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
      });
      expect(failRes.status).toBe(1);
      expect(failRes.stdout + failRes.stderr).toContain('Missing or invalid SERVICE_URL');
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('health_status=unhealthy');
    }

    // Zero polling calls to curl / 127.0.0.1:3000 when is_dry_run is false
    expect(fs.readFileSync(callLogFile, 'utf8')).toBe('');

    // Dry-run mode with omitted SERVICE_URL still passes
    const fastDryScript = stageProbeScript.replace('DELAY=2', 'DELAY=1').replace('ELAPSED -ge 6', 'ELAPSED -ge 0');
    for (const targetEnv of ['staging', 'production'] as const) {
      fs.writeFileSync(outputFile, '');
      const dryRes = runBashStep(fastDryScript, {
        TARGET_ENV: targetEnv,
        VAR_SERVICE_URL: '',
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'true',
      });
      expect(dryRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('health_status=healthy');
    }

    // Unreachable endpoint in live mode (IS_DRY_RUN=false) fails closed after timeout
    const fastLiveTimeoutScript = stageProbeScript.replace('MAX_TIMEOUT=120', 'MAX_TIMEOUT=0');
    for (const targetEnv of ['staging', 'production'] as const) {
      fs.writeFileSync(outputFile, '');
      const unreachableRes = runBashStep(fastLiveTimeoutScript, {
        TARGET_ENV: targetEnv,
        VAR_SERVICE_URL: 'http://127.0.0.1:9',
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
      });
      expect(unreachableRes.status).toBe(1);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('health_status=unhealthy');
    }
  });

  it('fails closed on missing provider credentials in live runs, resolves Cloud Run targets per environment, and selects OIDC ahead of GCP_SA_KEY', () => {
    const verifyCredsScript = extractStepRunScript(deployProviderYml, 'Verify Selected Provider Credentials');

    const parseOutputs = () => {
      const map: Record<string, string> = {};
      for (const line of fs.readFileSync(outputFile, 'utf8').split(/\r?\n/)) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          map[line.slice(0, idx)] = line.slice(idx + 1);
        }
      }
      return map;
    };

    // 1. google-cloud-run with neither OIDC nor GCP_SA_KEY fails closed
    fs.writeFileSync(outputFile, '');
    const missingGcpRes = runBashStep(verifyCredsScript, {
      PROVIDER: 'google-cloud-run',
      TARGET_ENV: 'staging',
      GCP_WORKLOAD_IDENTITY_PROVIDER: '',
      GCP_SERVICE_ACCOUNT: '',
      GCP_SA_KEY: '',
    });
    expect(missingGcpRes.status).not.toBe(0);
    expect(missingGcpRes.stdout + missingGcpRes.stderr).toContain('Missing Google Cloud credentials');

    // 2. Partial WIF without GCP_SA_KEY fallback fails closed
    const partialWifRes = runBashStep(verifyCredsScript, {
      PROVIDER: 'google-cloud-run',
      TARGET_ENV: 'staging',
      GCP_WORKLOAD_IDENTITY_PROVIDER:
        'projects/123456789/locations/global/workloadIdentityPools/github/providers/oidc',
      GCP_SERVICE_ACCOUNT: '',
      GCP_SA_KEY: '',
    });
    expect(partialWifRes.status).not.toBe(0);
    expect(partialWifRes.stdout + partialWifRes.stderr).toContain(
      'Incomplete Google Cloud Workload Identity Federation configuration'
    );

    // 3. OIDC Workload Identity on staging resolves wedding-website-staging default service & project ID from SA email
    fs.writeFileSync(outputFile, '');
    const oidcStagingRes = runBashStep(verifyCredsScript, {
      PROVIDER: 'google-cloud-run',
      TARGET_ENV: 'staging',
      INPUT_CLOUD_RUN_SERVICE: '',
      CLOUD_RUN_SERVICE: '',
      INPUT_CLOUD_RUN_REGION: '',
      CLOUD_RUN_REGION: '',
      GCP_WORKLOAD_IDENTITY_PROVIDER:
        'projects/123456789/locations/global/workloadIdentityPools/github/providers/oidc',
      GCP_SERVICE_ACCOUNT: 'runner@wedding-staging-proj.iam.gserviceaccount.com',
      GCP_SA_KEY: '',
      GCP_PROJECT_ID: '',
    });
    expect(oidcStagingRes.status).toBe(0);
    expect(parseOutputs()).toEqual({
      cloud_run_service: 'wedding-website-staging',
      cloud_run_region: 'us-central1',
      gcp_project_id: 'wedding-staging-proj',
    });

    // 4. GCP_SA_KEY fallback on production resolves wedding-website default and honors vars/inputs overrides
    fs.writeFileSync(outputFile, '');
    const keyProdRes = runBashStep(verifyCredsScript, {
      PROVIDER: 'google-cloud-run',
      TARGET_ENV: 'production',
      INPUT_CLOUD_RUN_SERVICE: '',
      CLOUD_RUN_SERVICE: '',
      INPUT_CLOUD_RUN_REGION: '',
      CLOUD_RUN_REGION: 'us-east1',
      GCP_WORKLOAD_IDENTITY_PROVIDER: '',
      GCP_SERVICE_ACCOUNT: '',
      GCP_SA_KEY: '{"project_id":"legacy-prod-proj"}',
      GCP_PROJECT_ID: '',
    });
    expect(keyProdRes.status).toBe(0);
    expect(parseOutputs()).toEqual({
      cloud_run_service: 'wedding-website',
      cloud_run_region: 'us-east1',
      gcp_project_id: 'legacy-prod-proj',
    });

    fs.writeFileSync(outputFile, '');
    const inputOverrideRes = runBashStep(verifyCredsScript, {
      PROVIDER: 'google-cloud-run',
      TARGET_ENV: 'staging',
      INPUT_CLOUD_RUN_SERVICE: 'custom-input-svc',
      CLOUD_RUN_SERVICE: 'custom-var-svc',
      INPUT_CLOUD_RUN_REGION: 'europe-west4',
      CLOUD_RUN_REGION: 'us-west1',
      GCP_WORKLOAD_IDENTITY_PROVIDER: '',
      GCP_SERVICE_ACCOUNT: '',
      GCP_SA_KEY: '{"project_id":"override-proj"}',
      GCP_PROJECT_ID: 'explicit-proj',
    });
    expect(inputOverrideRes.status).toBe(0);
    expect(parseOutputs()).toEqual({
      cloud_run_service: 'custom-input-svc',
      cloud_run_region: 'europe-west4',
      gcp_project_id: 'explicit-proj',
    });

    // 5. generic-webhook and docker-host fail closed when DEPLOY_WEBHOOK_URL or DEPLOY_WEBHOOK_SECRET is absent, non-HTTPS, or private/internal
    const dnsMockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-webhook-dns-'));
    const dnsMockScript = path.join(dnsMockDir, 'dns-mock.cjs');
    fs.writeFileSync(
      dnsMockScript,
      `const dns = require('dns');
const origLookup = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = async (hostname, options) => {
  if (hostname === 'hooks.example.com') {
    return [{ address: '93.184.216.34', family: 4 }];
  }
  if (hostname === 'private-hook.example.com') {
    return [{ address: '10.0.0.42', family: 4 }];
  }
  return origLookup(hostname, options);
};
`
    );
    const nodeOptionsWithDnsMock = `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--require ${dnsMockScript}`;

    try {
      for (const webhookProvider of ['generic-webhook', 'docker-host']) {
        const noUrlRes = runBashStep(verifyCredsScript, {
          PROVIDER: webhookProvider,
          TARGET_ENV: 'production',
          DEPLOY_WEBHOOK_URL: '',
          DEPLOY_WEBHOOK_SECRET: 'secret-token',
        });
        expect(noUrlRes.status).not.toBe(0);
        expect(noUrlRes.stdout + noUrlRes.stderr).toContain('Missing DEPLOY_WEBHOOK_URL');

        const noSecretRes = runBashStep(verifyCredsScript, {
          PROVIDER: webhookProvider,
          TARGET_ENV: 'production',
          DEPLOY_WEBHOOK_URL: 'https://hooks.example.com/deploy',
          DEPLOY_WEBHOOK_SECRET: '',
        });
        expect(noSecretRes.status).not.toBe(0);
        expect(noSecretRes.stdout + noSecretRes.stderr).toContain('Missing DEPLOY_WEBHOOK_SECRET');

        const httpRes = runBashStep(verifyCredsScript, {
          PROVIDER: webhookProvider,
          TARGET_ENV: 'production',
          DEPLOY_WEBHOOK_URL: 'http://hooks.example.com/deploy',
          DEPLOY_WEBHOOK_SECRET: 'secret-token',
          NODE_OPTIONS: nodeOptionsWithDnsMock,
        });
        expect(httpRes.status).not.toBe(0);
        expect(httpRes.stdout + httpRes.stderr).toContain('must use https:// scheme');

        for (const blockedUrl of [
          'https://127.0.0.1:8443/deploy',
          'https://169.254.169.254/latest/meta-data',
          'https://100.64.0.1/deploy',
          'https://[::1]/deploy',
          'https://[::ffff:127.0.0.1]/deploy',
          'https://localhost/deploy',
          'https://private-hook.example.com/deploy',
        ]) {
          const blockedRes = runBashStep(verifyCredsScript, {
            PROVIDER: webhookProvider,
            TARGET_ENV: 'production',
            DEPLOY_WEBHOOK_URL: blockedUrl,
            DEPLOY_WEBHOOK_SECRET: 'secret-token',
            NODE_OPTIONS: nodeOptionsWithDnsMock,
          });
          expect(blockedRes.status).not.toBe(0);
          expect(blockedRes.stdout + blockedRes.stderr).toContain('Blocked DEPLOY_WEBHOOK_URL');
        }

        const validWebhookRes = runBashStep(verifyCredsScript, {
          PROVIDER: webhookProvider,
          TARGET_ENV: 'production',
          DEPLOY_WEBHOOK_URL: 'https://hooks.example.com/deploy',
          DEPLOY_WEBHOOK_SECRET: 'secret-token',
          NODE_OPTIONS: nodeOptionsWithDnsMock,
        });
        expect(validWebhookRes.status).toBe(0);
      }
    } finally {
      fs.rmSync(dnsMockDir, { recursive: true, force: true });
    }

    // 6. Verify YAML step conditions select OIDC primary auth and GCP_SA_KEY fallback mutually exclusively
    const deployProviderDoc = parseDocument(deployProviderYml, { version: '1.2', strict: true }).toJS() as {
      jobs?: {
        deploy?: {
          steps?: Array<{ id?: string; name?: string; if?: string; with?: Record<string, string> }>;
        };
      };
    };
    const steps = deployProviderDoc.jobs?.deploy?.steps ?? [];
    const verifyStep = steps.find((s) => s.id === 'verify-credentials');
    const oidcStep = steps.find((s) => s.id === 'gcp-auth-oidc');
    const keyStep = steps.find((s) => s.id === 'gcp-auth-key');
    const dryRunStep = steps.find((s) => s.id === 'dry-run-adapter');

    expect(verifyStep?.if).toContain('always()');
    expect(verifyStep?.if).toContain("needs.preflight.outputs.is_rollback_call == 'true'");
    expect(verifyStep?.if).toContain('!inputs.dry_run');
    expect(oidcStep?.if).toContain('vars.GCP_WORKLOAD_IDENTITY_PROVIDER !=');
    expect(oidcStep?.if).toContain('vars.GCP_SERVICE_ACCOUNT !=');
    expect(oidcStep?.with?.workload_identity_provider).toBe('${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}');
    expect(keyStep?.if).toContain("vars.GCP_WORKLOAD_IDENTITY_PROVIDER == '' || vars.GCP_SERVICE_ACCOUNT == ''");
    expect(keyStep?.if).toContain("secrets.GCP_SA_KEY != ''");
    expect(dryRunStep).toBeDefined();
    expect(dryRunStep?.if).toContain('always()');
    expect(dryRunStep?.if).toContain("steps.capture-previous.outcome == 'success'");
    expect(dryRunStep?.if).toContain('inputs.dry_run');
  });

  it('defaults manual db-migrate.yml workflow_dispatch confirm to false and aborts before npx prisma migrate deploy when unconfirmed', () => {
    const dbMigrateDoc = parseDocument(dbMigrateYml, { version: '1.2', strict: true }).toJS() as {
      on?: {
        workflow_dispatch?: { inputs?: { confirm?: { default?: boolean; required?: boolean; type?: string } } };
        workflow_call?: { inputs?: { confirm?: { default?: boolean; type?: string } } };
      };
    };

    expect(dbMigrateDoc.on?.workflow_dispatch?.inputs?.confirm?.default).toBe(false);
    expect(dbMigrateDoc.on?.workflow_dispatch?.inputs?.confirm?.type).toBe('boolean');
    expect(dbMigrateDoc.on?.workflow_call?.inputs?.confirm?.default).toBe(true);

    const confirmGateScript = extractStepRunScript(dbMigrateYml, 'Verify Manual Migration Confirmation');
    const runMigrateScript = extractStepRunScript(dbMigrateYml, 'Run Prisma Migrate Deploy');
    expect(confirmGateScript).not.toContain('${{');
    expect(runMigrateScript).not.toContain('${{');

    // Shim npx so any accidental prisma invocation logs and fails
    const npxShim = path.join(binDir, 'npx');
    fs.writeFileSync(
      npxShim,
      `#!/usr/bin/env node
const fs = require('fs');
fs.appendFileSync(${JSON.stringify(callLogFile)}, 'npx ' + process.argv.slice(2).join(' ') + '\\n');
process.exit(0);
`,
      { mode: 0o755 }
    );

    fs.writeFileSync(summaryFile, '');
    const unconfirmedGateRes = runBashStep(confirmGateScript, {
      CONFIRM: 'false',
      TARGET_ENV: 'production',
    });
    expect(unconfirmedGateRes.status).toBe(1);
    expect(unconfirmedGateRes.stdout + unconfirmedGateRes.stderr).toContain("'confirm' input must be set to true");
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('Database Migration Aborted (Unconfirmed)');

    const unconfirmedMigrateRes = runBashStep(runMigrateScript, {
      CONFIRM: 'false',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });
    expect(unconfirmedMigrateRes.status).toBe(1);
    expect(fs.readFileSync(callLogFile, 'utf8')).toBe('');

    const confirmedGateRes = runBashStep(confirmGateScript, {
      CONFIRM: 'true',
      TARGET_ENV: 'staging',
    });
    expect(confirmedGateRes.status).toBe(0);

    const confirmedMigrateRes = runBashStep(runMigrateScript, {
      CONFIRM: 'true',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    });
    expect(confirmedMigrateRes.status).toBe(0);
    expect(fs.readFileSync(callLogFile, 'utf8')).toContain('npx prisma migrate deploy');
  });

  it('rejects empty-host TCP URIs without ?host=/... and accepts Cloud SQL socket URIs in db-migrate.yml Verify DATABASE_URL secret', () => {
    const verifySecretScript = extractStepRunScript(dbMigrateYml, 'Verify DATABASE_URL secret');
    expect(verifySecretScript).not.toContain('${{');

    const secretToken = 'CI_SUPER_SECRET_DB_TOKEN_88';
    const invalidUrls = [
      'postgres://',
      `postgresql://wedding:${secretToken}@/wedding_db`,
      `postgresql://wedding:${secretToken}@:5432/wedding_db`,
      `postgresql://wedding:${secretToken}@/wedding_db?host=/`,
      `postgresql://wedding:${secretToken}@/wedding_db?host=relative`,
    ];

    for (const badUrl of invalidUrls) {
      const res = runBashStep(verifySecretScript, {
        TARGET_ENV: 'production',
        DATABASE_URL: badUrl,
      });
      expect(res.status).toBe(1);
      const combined = res.stdout + res.stderr;
      expect(combined).toContain('Invalid format for DATABASE_URL');
      expect(combined).not.toContain(secretToken);
    }

    for (const validSocketUrl of [
      'postgresql://wedding_user:STRONG_PASSWORD@localhost/wedding_db?host=/cloudsql/proj:us-central1:wedding-db',
      'postgresql://wedding_user:STRONG_PASSWORD@/wedding_db?host=/cloudsql/proj:us-central1:wedding-db',
    ]) {
      const okRes = runBashStep(verifySecretScript, {
        TARGET_ENV: 'production',
        DATABASE_URL: validSocketUrl,
        POSTGRES_URL_NON_POOLING: validSocketUrl,
      });
      expect(okRes.status).toBe(0);
    }

    const badNonPoolingRes = runBashStep(verifySecretScript, {
      TARGET_ENV: 'production',
      DATABASE_URL: 'postgresql://wedding_user:STRONG_PASSWORD@localhost:5432/wedding_db',
      POSTGRES_URL_NON_POOLING: `postgresql://wedding:${secretToken}@/wedding_db`,
    });
    expect(badNonPoolingRes.status).toBe(1);
    const badNonPoolingOut = badNonPoolingRes.stdout + badNonPoolingRes.stderr;
    expect(badNonPoolingOut).toContain('Invalid format for POSTGRES_URL_NON_POOLING');
    expect(badNonPoolingOut).not.toContain(secretToken);
  });

  it('accepts image_tag in deploy.yml for tagged rollouts, resolves v* tag to origin/main commit SHA, skips rebuild, and runs db-migrate.yml before deploy-provider.yml', () => {
    const deployDoc = parseDocument(deployYml, { version: '1.2', strict: true }).toJS() as {
      on?: {
        workflow_dispatch?: { inputs?: Record<string, unknown> };
        workflow_call?: { inputs?: Record<string, unknown> };
      };
    };
    expect(deployDoc.on?.workflow_dispatch?.inputs).toHaveProperty('image_tag');
    expect(deployDoc.on?.workflow_call?.inputs).toHaveProperty('image_tag');

    expect(deployYml).toContain("inputs.image_digest == '' &&\n        inputs.image_tag == ''");
    const tagPassMatches = deployYml.match(
      /image_tag: \$\{\{ inputs\.image_tag \|\| needs\.publish-artifact\.outputs\.image_tag \|\| needs\.ci-gate\.outputs\.target_sha \}\}/g
    );
    expect(tagPassMatches).toHaveLength(2);

    const resolveTargetScript = extractStepRunScript(deployYml, 'Resolve Target Commit SHA');
    expect(resolveTargetScript).not.toContain('${{');

    const bareOrigin = path.join(tempDir, 'origin.git');
    const workRepo = path.join(tempDir, 'work');
    spawnSync('git', ['init', '--bare', bareOrigin], { stdio: 'pipe' });
    spawnSync('git', ['init', '-b', 'main', workRepo], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'config', 'user.email', 'ci@example.com'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'config', 'user.name', 'CI Bot'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'remote', 'add', 'origin', bareOrigin], { stdio: 'pipe' });

    fs.writeFileSync(path.join(workRepo, 'app.txt'), 'release-1\n');
    spawnSync('git', ['-C', workRepo, 'add', 'app.txt'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'commit', '-m', 'v0.1.0 commit'], { stdio: 'pipe' });
    const taggedSha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    spawnSync('git', ['-C', workRepo, 'tag', 'v0.1.0', taggedSha], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'push', 'origin', 'main', '--tags'], { stdio: 'pipe' });

    spawnSync('git', ['-C', workRepo, 'checkout', '-b', 'feature/unmerged'], { stdio: 'pipe' });
    fs.writeFileSync(path.join(workRepo, 'app.txt'), 'unmerged\n');
    spawnSync('git', ['-C', workRepo, 'add', 'app.txt'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'commit', '-m', 'unmerged'], { stdio: 'pipe' });
    const unmergedSha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    spawnSync('git', ['-C', workRepo, 'tag', 'v0.2.0-unmerged', unmergedSha], { stdio: 'pipe' });

    // Valid v* tag on origin/main resolves to its 40-char commit SHA
    fs.writeFileSync(outputFile, '');
    const okTagRes = spawnSync('bash', ['-eo', 'pipefail', '-c', resolveTargetScript], {
      cwd: workRepo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputFile,
        EVENT_NAME: 'workflow_dispatch',
        WORKFLOW_RUN_HEAD_SHA: '',
        CURRENT_SHA: taggedSha,
        INPUT_IMAGE_TAG: 'v0.1.0',
      },
    });
    expect(okTagRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${taggedSha}`);

    // Unpinned latest tag rejected
    const latestTagRes = spawnSync('bash', ['-eo', 'pipefail', '-c', resolveTargetScript], {
      cwd: workRepo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputFile,
        EVENT_NAME: 'workflow_dispatch',
        CURRENT_SHA: taggedSha,
        INPUT_IMAGE_TAG: 'latest',
      },
    });
    expect(latestTagRes.status).not.toBe(0);

    // Unmerged tag rejected
    const unmergedTagRes = spawnSync('bash', ['-eo', 'pipefail', '-c', resolveTargetScript], {
      cwd: workRepo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputFile,
        EVENT_NAME: 'workflow_dispatch',
        CURRENT_SHA: taggedSha,
        INPUT_IMAGE_TAG: 'v0.2.0-unmerged',
      },
    });
    expect(unmergedTagRes.status).not.toBe(0);
    expect(unmergedTagRes.stdout + unmergedTagRes.stderr).toContain('is not an ancestor of origin/main');
  });

  it('blocks standalone live promotions in deploy-provider.yml that lack origin/main ancestry or bypass ci.yml or db-migrate.yml', async () => {
    const standaloneTargetScript = extractStepRunScript(
      deployProviderYml,
      'Resolve Standalone Promotion Commit & Main Ancestry'
    );

    const deployProviderDoc = parseDocument(deployProviderYml, { version: '1.2', strict: true }).toJS() as {
      on?: {
        workflow_dispatch?: { inputs?: Record<string, unknown> };
        workflow_call?: { inputs?: Record<string, unknown> };
      };
      jobs?: {
        preflight?: {
          steps?: Array<{ id?: string; name?: string; if?: string; env?: Record<string, string>; with?: { script?: string } }>;
        };
      };
    };
    expect(deployProviderDoc.on?.workflow_dispatch?.inputs).toHaveProperty('source_ref');
    expect(deployProviderDoc.on?.workflow_call?.inputs).toHaveProperty('source_ref');

    const steps = deployProviderDoc.jobs?.preflight?.steps ?? [];
    const provenanceMeta = steps.find((s) => s.id === 'provenance');
    expect(provenanceMeta?.env?.INPUT_SOURCE_REF).toBe('${{ inputs.source_ref }}');

    const provenanceScript = extractStepRunScript(deployProviderYml, 'Verify Artifact Provenance Attestation');
    fs.writeFileSync(outputFile, '');
    const taggedDigestRes = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`,
      IMAGE_DIGEST: VALID_DIGEST,
      RAW_TAG: '',
      INPUT_SOURCE_REF: '',
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_MAIN_REF_FAIL: 'true',
      MOCK_ATTESTATION_SOURCE_REF: 'refs/tags/v1.4.2',
    });
    expect(taggedDigestRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('source_ref=refs/tags/v1.4.2');

    // Unauthorized feature-branch sourceRepositoryRef in certificate is rejected fail-closed
    fs.writeFileSync(outputFile, '');
    const branchDigestRes = runBashStep(provenanceScript, {
      GH_TOKEN: 'ghs_test_token',
      IMAGE_URI: `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`,
      IMAGE_DIGEST: VALID_DIGEST,
      RAW_TAG: '',
      INPUT_SOURCE_REF: '',
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_MAIN_REF_FAIL: 'true',
      MOCK_ATTESTATION_SOURCE_REF: 'refs/heads/feature-bypass',
    });
    expect(branchDigestRes.status).not.toBe(0);

    const gateStep = steps.find((s) => s.name === 'Verify Standalone CI & Database Migration Status');
    expect(gateStep?.if).toBe("github.event_name == 'workflow_dispatch' && !inputs.dry_run");
    expect(gateStep?.with?.script).toBeDefined();

    const bareOrigin = path.join(tempDir, 'origin-provider.git');
    const workRepo = path.join(tempDir, 'work-provider');
    spawnSync('git', ['init', '--bare', bareOrigin], { stdio: 'pipe' });
    spawnSync('git', ['init', '-b', 'main', workRepo], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'config', 'user.email', 'ci@example.com'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'config', 'user.name', 'CI Bot'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'remote', 'add', 'origin', bareOrigin], { stdio: 'pipe' });

    fs.writeFileSync(path.join(workRepo, 'app.txt'), 'main-commit\n');
    spawnSync('git', ['-C', workRepo, 'add', 'app.txt'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'commit', '-m', 'main release'], { stdio: 'pipe' });
    const mainSha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    spawnSync('git', ['-C', workRepo, 'tag', 'v1.0.0', mainSha], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'push', 'origin', 'main', '--tags'], { stdio: 'pipe' });

    // Digest-only standalone dispatch extracts sourceRepositoryDigest via gh attestation verify --format json and validates ancestry
    fs.writeFileSync(outputFile, '');
    const digestOnlyRes = spawnSync('bash', ['-eo', 'pipefail', '-c', standaloneTargetScript], {
      cwd: workRepo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        GITHUB_OUTPUT: outputFile,
        GH_TOKEN: 'ghs_test_token',
        IMAGE_URI: `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`,
        RAW_TAG: '',
        EXPECTED_SOURCE_REF: 'refs/heads/main',
        REPO_OWNER: 'OwnerOrg',
        SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
        MOCK_ATTESTATION_SHA: mainSha,
      },
    });
    expect(digestOnlyRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${mainSha}`);

    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (github: unknown, context: unknown, core: unknown) => Promise<void>;
    const runStandaloneGate = new AsyncFunction('github', 'context', 'core', gateStep!.with!.script!);

    const prevSha = process.env.TARGET_SHA;
    const prevEnv = process.env.TARGET_ENV;
    process.env.TARGET_SHA = mainSha;
    process.env.TARGET_ENV = 'production';
    try {
      // 1. Fails closed when ci.yml was bypassed
      const ciFailures: string[] = [];
      await runStandaloneGate(
        {
          rest: { actions: { listWorkflowRuns: 'listWorkflowRuns' } },
          paginate: async (_fn: unknown, opts: { workflow_id: string }) =>
            opts.workflow_id === 'ci.yml'
              ? []
              : [{ id: 2, run_number: 8, conclusion: 'success', head_sha: mainSha }],
        },
        { repo: { owner: 'OwnerOrg', repo: 'Wedding_Website' } },
        { setFailed: (msg: string) => ciFailures.push(msg), info: () => undefined }
      );
      expect(ciFailures).toHaveLength(1);
      expect(ciFailures[0]).toContain('no completed successful ci.yml workflow run found');

      // 2. Fails closed when ci.yml passed but db-migrate.yml was bypassed
      const migrateFailures: string[] = [];
      await runStandaloneGate(
        {
          rest: {
            actions: {
              listWorkflowRuns: 'listWorkflowRuns',
              listJobsForWorkflowRun: 'listJobsForWorkflowRun',
            },
          },
          paginate: async (_fn: unknown, opts: { workflow_id?: string }) =>
            opts.workflow_id === 'ci.yml'
              ? [{ id: 1, run_number: 7, conclusion: 'success', head_sha: mainSha }]
              : [],
        },
        { repo: { owner: 'OwnerOrg', repo: 'Wedding_Website' } },
        { setFailed: (msg: string) => migrateFailures.push(msg), info: () => undefined }
      );
      expect(migrateFailures).toHaveLength(1);
      expect(migrateFailures[0]).toContain('no completed successful db-migrate.yml workflow run found');

      // 2b. Fails closed when db-migrate.yml only succeeded for staging while TARGET_ENV is production
      const wrongEnvFailures: string[] = [];
      await runStandaloneGate(
        {
          rest: {
            actions: {
              listWorkflowRuns: 'listWorkflowRuns',
              listJobsForWorkflowRun: 'listJobsForWorkflowRun',
            },
          },
          paginate: async (fn: unknown) =>
            fn === 'listJobsForWorkflowRun'
              ? [
                {
                  id: 19,
                  name: 'Execute Database Migrations',
                  conclusion: 'success',
                  steps: [
                    { name: 'Verify Manual Migration Confirmation', conclusion: 'success' },
                    { name: 'Record Target Environment (staging)', conclusion: 'success' },
                  ],
                },
              ]
              : [{ id: 10, run_number: 14, conclusion: 'success', head_sha: mainSha }],
        },
        { repo: { owner: 'OwnerOrg', repo: 'Wedding_Website' } },
        { setFailed: (msg: string) => wrongEnvFailures.push(msg), info: () => undefined }
      );
      expect(wrongEnvFailures).toHaveLength(1);
      expect(wrongEnvFailures[0]).toContain(
        `no completed successful db-migrate.yml workflow run found for commit ${mainSha} (production)`
      );

      // 3. Succeeds when both ci.yml and db-migrate.yml succeeded for targetSha and TARGET_ENV
      const bothFailures: string[] = [];
      const bothInfos: string[] = [];
      await runStandaloneGate(
        {
          rest: {
            actions: {
              listWorkflowRuns: 'listWorkflowRuns',
              listJobsForWorkflowRun: 'listJobsForWorkflowRun',
            },
          },
          paginate: async (fn: unknown) =>
            fn === 'listJobsForWorkflowRun'
              ? [
                {
                  id: 20,
                  name: 'Execute Database Migrations',
                  conclusion: 'success',
                  steps: [
                    { name: 'Verify Manual Migration Confirmation', conclusion: 'success' },
                    { name: 'Record Target Environment (production)', conclusion: 'success' },
                  ],
                },
              ]
              : [{ id: 10, run_number: 15, conclusion: 'success', head_sha: mainSha }],
        },
        { repo: { owner: 'OwnerOrg', repo: 'Wedding_Website' } },
        { setFailed: (msg: string) => bothFailures.push(msg), info: (msg: string) => bothInfos.push(msg) }
      );
      expect(bothFailures).toHaveLength(0);
      expect(bothInfos[0]).toContain('Verified CI run #15 and database migration run #15 (production)');
    } finally {
      if (prevSha === undefined) delete process.env.TARGET_SHA;
      else process.env.TARGET_SHA = prevSha;
      if (prevEnv === undefined) delete process.env.TARGET_ENV;
      else process.env.TARGET_ENV = prevEnv;
    }
  });

  it('enforces --require-db exit codes in db-migrate.yml status_check and --offline git diff in deploy.yml schema-compatibility', () => {
    const dbMigrateDoc = parseDocument(dbMigrateYml, { version: '1.2', strict: true }).toJS() as {
      jobs?: {
        migrate?: {
          steps?: Array<{ id?: string; if?: string }>;
        };
      };
    };
    const migrateSteps = dbMigrateDoc.jobs?.migrate?.steps ?? [];
    const statusCheckStep = migrateSteps.find((s) => s.id === 'status_check');
    expect(statusCheckStep?.if).toBe("steps.confirm_gate.outcome == 'success'");

    const statusCheckScript = extractStepRunScript(
      dbMigrateYml,
      'Pre-flight schema migration check and summary'
    );
    const offlineSummaryScript = extractStepRunScript(
      deployYml,
      'Generate Pre-Flight Schema Migration & SQL DDL Summary'
    );
    const schemaCompatSection =
      (deployYml.split(/\n  schema-compatibility:\n/)[1] ?? '').split(/\n  publish-artifact:\n/)[0] ?? '';
    expect(schemaCompatSection).not.toContain('npm ci');
    expect(schemaCompatSection).not.toContain("cache: 'npm'");
    expect(statusCheckScript).not.toContain('${{');
    expect(statusCheckScript).toContain('--require-db');
    expect(offlineSummaryScript).not.toContain('${{');
    expect(offlineSummaryScript).toContain('node --experimental-strip-types scripts/preflight-migration-summary.ts');
    expect(offlineSummaryScript).toContain('--offline');

    const realTsxBin = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
    const realPreflightScript = path.join(REPO_ROOT, 'scripts', 'preflight-migration-summary.ts');
    const npxShim = path.join(binDir, 'npx');
    fs.writeFileSync(
      npxShim,
      `#!/usr/bin/env node
const { spawnSync } = require('child_process');
const args = process.argv.slice(2);
if (args[0] === 'tsx') {
  const scriptArg = args[1] === 'scripts/preflight-migration-summary.ts'
    ? ${JSON.stringify(realPreflightScript)}
    : args[1];
  const res = spawnSync(${JSON.stringify(realTsxBin)}, [scriptArg, ...args.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(res.status ?? 1);
}
if (args[0] === 'prisma' && args[1] === 'migrate' && args[2] === 'status') {
  if (process.env.MOCK_PRISMA_STDOUT) process.stdout.write(process.env.MOCK_PRISMA_STDOUT);
  if (process.env.MOCK_PRISMA_STDERR) process.stderr.write(process.env.MOCK_PRISMA_STDERR);
  process.exit(Number(process.env.MOCK_PRISMA_EXIT ?? '0'));
}
process.exit(1);
`,
      { mode: 0o755 }
    );

    const runWorkflowScriptInCwd = (cwd: string, script: string, envOverrides: Record<string, string>) =>
      spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
        cwd,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          GITHUB_STEP_SUMMARY: summaryFile,
          ...envOverrides,
        },
      });

    // 0. Remote URL without sslmode defaults to verify-full and runs pre-flight TLS handshake before Prisma CLI
    fs.writeFileSync(summaryFile, '');
    const leakedSecret = 'PROD_DB_SECRET_98765';
    const remoteDefaultTlsRes = runWorkflowScriptInCwd(REPO_ROOT, statusCheckScript, {
      DATABASE_URL: `postgresql://wedding:${leakedSecret}@db.prod.internal:5432/wedding`,
      TARGET_ENVIRONMENT: 'production',
      MOCK_PRISMA_EXIT: '0',
    });
    expect(remoteDefaultTlsRes.status).toBe(1);
    const remoteDefaultSummary = fs.readFileSync(summaryFile, 'utf8');
    expect(remoteDefaultSummary).toContain('**Pre-Flight Gate:** `FAILED` ❌');
    expect(remoteDefaultSummary).toContain('Pre-flight PostgreSQL TLS handshake check failed');
    expect(remoteDefaultSummary).not.toContain(leakedSecret);
    expect(remoteDefaultSummary).not.toContain('postgresql://');

    // 1. Fails closed with redacted URL when prisma migrate status hits P1001
    fs.writeFileSync(summaryFile, '');
    const p1001Res = runWorkflowScriptInCwd(REPO_ROOT, statusCheckScript, {
      DATABASE_URL: `postgresql://wedding:${leakedSecret}@db.prod.internal:5432/wedding?sslmode=disable`,
      TARGET_ENVIRONMENT: 'production',
      MOCK_PRISMA_EXIT: '1',
      MOCK_PRISMA_STDERR: `Error: P1001: Can't reach database server at postgresql://wedding:${leakedSecret}@db.prod.internal:5432/wedding\n`,
    });
    expect(p1001Res.status).toBe(1);
    const p1001Summary = fs.readFileSync(summaryFile, 'utf8');
    expect(p1001Summary).toContain('**Pre-Flight Gate:** `FAILED` ❌');
    expect(p1001Summary).toContain('P1001');
    expect(p1001Summary).not.toContain(leakedSecret);
    expect(p1001Summary).not.toContain('postgresql://');

    // 2. Fails closed on schema drift / diverged migration history
    fs.writeFileSync(summaryFile, '');
    const driftRes = runWorkflowScriptInCwd(REPO_ROOT, statusCheckScript, {
      DATABASE_URL: 'postgresql://wedding:pw@db.prod.internal:5432/wedding?sslmode=disable',
      TARGET_ENVIRONMENT: 'production',
      MOCK_PRISMA_EXIT: '1',
      MOCK_PRISMA_STDERR:
        'Your local migration history and the migrations table from your database are different:\nThe last common migration is: 20261120010000_add_appconfig_modules\n',
    });
    expect(driftRes.status).toBe(1);
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('SCHEMA DRIFT / DIVERGED HISTORY');

    // 3. Succeeds when Prisma 7 exits 1 with clean singular pending migration
    fs.writeFileSync(summaryFile, '');
    const singlePendingRes = runWorkflowScriptInCwd(REPO_ROOT, statusCheckScript, {
      DATABASE_URL: 'postgresql://wedding:pw@db.prod.internal:5432/wedding?sslmode=disable',
      TARGET_ENVIRONMENT: 'production',
      MOCK_PRISMA_EXIT: '1',
      MOCK_PRISMA_STDOUT:
        'Following migration have not yet been applied:\n20261121000000_add_registry_shipping_and_order_tracking\n\nTo apply migrations in production run prisma migrate deploy.\n',
    });
    expect(singlePendingRes.status).toBe(0);
    expect(fs.readFileSync(summaryFile, 'utf8')).toContain('**Pre-Flight Gate:** `READY TO APPLY` 🟡');

    // 4. deploy.yml schema-compatibility --offline emits NOT QUERIED git diff without fabricating slice(-3)
    const offlineRepo = path.join(tempDir, 'offline-repo');
    const offlineMigrations = path.join(offlineRepo, 'prisma', 'migrations');
    const offlineScriptsDir = path.join(offlineRepo, 'scripts');
    const offlineSrcLibDir = path.join(offlineRepo, 'src', 'lib');
    fs.mkdirSync(offlineMigrations, { recursive: true });
    fs.mkdirSync(offlineScriptsDir, { recursive: true });
    fs.mkdirSync(offlineSrcLibDir, { recursive: true });
    fs.copyFileSync(realPreflightScript, path.join(offlineScriptsDir, 'preflight-migration-summary.ts'));
    fs.copyFileSync(
      path.join(REPO_ROOT, 'src', 'lib', 'postgres-url.js'),
      path.join(offlineSrcLibDir, 'postgres-url.js')
    );
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'CI Bot',
      GIT_AUTHOR_EMAIL: 'ci@example.com',
      GIT_COMMITTER_NAME: 'CI Bot',
      GIT_COMMITTER_EMAIL: 'ci@example.com',
    };
    spawnSync('git', ['init'], { cwd: offlineRepo, env: gitEnv });
    for (const oldMig of [
      '20261118000000_old_one',
      '20261119000000_old_two',
      '20261120010000_old_three',
      '20261120020000_old_four',
    ]) {
      const d = path.join(offlineMigrations, oldMig);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'migration.sql'), `CREATE TABLE "${oldMig}" ("id" TEXT PRIMARY KEY);`);
    }
    spawnSync('git', ['add', '.'], { cwd: offlineRepo, env: gitEnv });
    spawnSync('git', ['commit', '-m', 'Baseline'], { cwd: offlineRepo, env: gitEnv });

    const newMig = '20261121000000_new_release_ddl';
    const newDir = path.join(offlineMigrations, newMig);
    fs.mkdirSync(newDir, { recursive: true });
    fs.writeFileSync(path.join(newDir, 'migration.sql'), 'ALTER TABLE "Rsvp" ADD COLUMN "notes" TEXT;');
    spawnSync('git', ['add', '.'], { cwd: offlineRepo, env: gitEnv });
    spawnSync('git', ['commit', '-m', 'Add new release migration'], { cwd: offlineRepo, env: gitEnv });

    fs.writeFileSync(summaryFile, '');
    const offlineRes = runWorkflowScriptInCwd(offlineRepo, offlineSummaryScript, {
      DATABASE_URL: '',
    });
    expect(offlineRes.status).toBe(0);
    const offlineSummary = fs.readFileSync(summaryFile, 'utf8');
    expect(offlineSummary).toContain('**Database Status:** `NOT QUERIED`');
    expect(offlineSummary).toContain(`\`${newMig}\``);
    expect(offlineSummary).toContain('ALTER TABLE "Rsvp" ADD COLUMN "notes" TEXT');
    expect(offlineSummary).not.toContain('PENDING MIGRATIONS DETECTED');
    expect(offlineSummary).not.toContain('20261120020000_old_four');
  });

  it('removes rollback_environment from workflow_dispatch in deploy.yml and deploy-provider.yml, binds deploy environment only on workflow_call, and preserves explicit GH_TOKEN auth on git fetch with persist-credentials: false', () => {
    const deployDoc = parseDocument(deployYml, { version: '1.2', strict: true }).toJS() as {
      on?: {
        workflow_dispatch?: { inputs?: Record<string, unknown> };
        workflow_call?: { inputs?: Record<string, unknown> };
      };
      jobs?: {
        staging?: { with?: Record<string, string> };
        production?: { with?: Record<string, string> };
      };
    };
    const providerDoc = parseDocument(deployProviderYml, { version: '1.2', strict: true }).toJS() as {
      on?: {
        workflow_dispatch?: { inputs?: Record<string, unknown> };
        workflow_call?: { inputs?: Record<string, unknown> };
      };
      jobs?: {
        preflight?: {
          permissions?: Record<string, string>;
          steps?: Array<{ uses?: string; with?: Record<string, unknown> }>;
        };
        deploy?: {
          environment?: string;
          steps?: Array<{ uses?: string; run?: string; with?: Record<string, unknown> }>;
        };
      };
    };

    expect(deployDoc.on?.workflow_dispatch?.inputs).not.toHaveProperty('rollback_environment');
    expect(deployDoc.on?.workflow_call?.inputs).toHaveProperty('rollback_environment');
    expect(providerDoc.on?.workflow_dispatch?.inputs).not.toHaveProperty('rollback_environment');
    expect(providerDoc.on?.workflow_call?.inputs).toHaveProperty('rollback_environment');

    expect(providerDoc.jobs?.deploy?.environment).toBe(
      "${{ (github.event_name == 'workflow_call' && inputs.rollback_environment) || inputs.environment || 'production' }}"
    );
    expect(deployDoc.jobs?.staging?.with?.rollback_environment).toBe(
      "${{ (github.event_name == 'workflow_call' && inputs.rollback_environment) || vars.STAGING_ROLLBACK_ENVIRONMENT || '' }}"
    );
    expect(deployDoc.jobs?.production?.with?.rollback_environment).toBe(
      "${{ (github.event_name == 'workflow_call' && inputs.rollback_environment) || vars.PRODUCTION_ROLLBACK_ENVIRONMENT || '' }}"
    );

    const preflightCheckoutSteps = (providerDoc.jobs?.preflight?.steps ?? []).filter((s) =>
      s.uses?.startsWith('actions/checkout@')
    );
    expect(preflightCheckoutSteps.length).toBeGreaterThan(0);
    for (const step of preflightCheckoutSteps) {
      expect(step.with?.['persist-credentials']).toBe(false);
    }
    const deployCheckoutSteps = (providerDoc.jobs?.deploy?.steps ?? []).filter((s) =>
      s.uses?.startsWith('actions/checkout@')
    );
    expect(deployCheckoutSteps).toHaveLength(0);
    for (const step of providerDoc.jobs?.deploy?.steps ?? []) {
      expect(step.uses ?? '').not.toContain('actions/setup-node');
      expect(step.run ?? '').not.toMatch(/\bnpm\b/);
      expect(step.run ?? '').not.toContain('scripts/');
    }

    for (const script of [
      extractStepRunScript(deployYml, 'Resolve Target Commit SHA'),
      extractStepRunScript(deployYml, 'Align Workspace to Verified Commit SHA'),
      extractStepRunScript(deployProviderYml, 'Resolve Standalone Promotion Commit & Main Ancestry'),
    ]) {
      expect(script).toContain('http.${ORIGIN_SERVER}/.extraheader=AUTHORIZATION: basic');
      expect(script).toContain('git "${GIT_AUTH_ARGS[@]}" fetch');
    }
  });

  it('verifies scripts/rollout-vps.sh polls /api/live, /api/health, and /api/ready and rejects targets that fail /api/ready or /api/health', async () => {
    const rolloutScriptPath = path.join(process.cwd(), 'scripts', 'rollout-vps.sh');
    const rolloutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollout-vps-probe-'));
    const mockBinDir = path.join(rolloutDir, 'bin');
    fs.mkdirSync(mockBinDir, { recursive: true });

    fs.writeFileSync(
      path.join(mockBinDir, 'docker'),
      `#!/usr/bin/env bash
if [[ "$*" == *"image inspect"* ]]; then
  exit 1
fi
if [[ "$*" == *"ps -q"* ]]; then
  echo "mock-cid-123"
  exit 0
fi
if [[ "$*" == *"inspect -f"* ]]; then
  echo "healthy"
  exit 0
fi
exit 0
`,
      { mode: 0o755 }
    );

    let healthOk = true;
    let readyOk = true;

    const createProbeHandler = () => (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (req.url === '/api/live') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'alive' }));
        return;
      }
      if (req.url === '/api/health') {
        if (healthOk) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: { status: 'ok', database: 'connected', timestamp: '2026-11-20T00:00:00.000Z' },
            })
          );
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              error: 'Database connection failed',
            })
          );
        }
        return;
      }
      if (req.url === '/api/ready') {
        if (readyOk) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'ready',
              database: 'connected',
              timestamp: '2026-11-20T00:00:00.000Z',
            })
          );
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              status: 'unhealthy',
              database: 'connected',
              error: 'Database schema is not ready',
            })
          );
        }
        return;
      }
      res.writeHead(404);
      res.end();
    };

    const primaryServer = http.createServer(createProbeHandler());
    const standbyServer = http.createServer(createProbeHandler());

    await Promise.all([
      new Promise<void>((resolve) => primaryServer.listen(0, '127.0.0.1', () => resolve())),
      new Promise<void>((resolve) => standbyServer.listen(0, '127.0.0.1', () => resolve())),
    ]);

    const primaryAddr = primaryServer.address();
    const standbyAddr = standbyServer.address();
    const primaryPort = typeof primaryAddr === 'object' && primaryAddr ? primaryAddr.port : 0;
    const standbyPort = typeof standbyAddr === 'object' && standbyAddr ? standbyAddr.port : 0;

    const runRollout = () =>
      new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn('bash', [rolloutScriptPath], {
          env: {
            ...process.env,
            PATH: `${mockBinDir}:${process.env.PATH || ''}`,
            PORT: String(primaryPort),
            STANDBY_PORT: String(standbyPort),
            SKIP_IMAGE_BUILD: 'true',
            ROLLOUT_WAIT_SECONDS: '1',
            ROLLOUT_POLL_INTERVAL: '0.1',
            DB_WAIT_SECONDS: '2',
            STANDBY_DRAIN_SECONDS: '0',
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
        child.on('close', (code) => resolve({ status: code, stdout, stderr }));
      });

    try {
      const okRollout = await runRollout();
      expect(okRollout.status).toBe(0);
      expect(okRollout.stdout).toContain('passed /api/live, /api/health, and /api/ready probes');

      readyOk = false;
      const readyFailRollout = await runRollout();
      expect(readyFailRollout.status).toBe(1);
      expect(readyFailRollout.stderr).toContain('/api/ready');

      readyOk = true;
      healthOk = false;
      const healthFailRollout = await runRollout();
      expect(healthFailRollout.status).toBe(1);
      expect(healthFailRollout.stderr).toContain('/api/health');
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => primaryServer.close(() => resolve())),
        new Promise<void>((resolve) => standbyServer.close(() => resolve())),
      ]);
      fs.rmSync(rolloutDir, { recursive: true, force: true });
    }
  });

  it('probes /api/health and /api/ready in deploy-provider.yml with bounded timeouts, redacts secrets.SERVICE_URL, stamps resolved tag/provenance SHAs, transitions GitHub Deployments two-phase, and gates rollback.yml in deploy-stage.yml', async () => {
    const providerDoc = parseDocument(deployProviderYml, { version: '1.2', strict: true }).toJS() as {
      on?: {
        workflow_dispatch?: { inputs?: Record<string, unknown> };
        workflow_call?: { inputs?: Record<string, unknown>; outputs?: Record<string, unknown> };
      };
      jobs?: {
        preflight?: {
          if?: string;
          'timeout-minutes'?: number;
          outputs?: Record<string, string>;
          steps?: Array<{
            id?: string;
            name?: string;
            if?: string;
            'timeout-minutes'?: number;
            uses?: string;
            with?: Record<string, unknown>;
          }>;
        };
        deploy?: {
          if?: string;
          'timeout-minutes'?: number;
          outputs?: Record<string, string>;
          steps?: Array<{
            id?: string;
            name?: string;
            if?: string;
            'timeout-minutes'?: number;
            uses?: string;
            with?: Record<string, unknown>;
          }>;
        };
      };
    };
    const stageDoc = parseDocument(deployStageYml, { version: '1.2', strict: true }).toJS() as {
      jobs?: {
        'deploy-provider'?: { with?: Record<string, unknown> };
        'verify-deployment'?: { environment?: unknown; outputs?: Record<string, string> };
        rollback?: { if?: string };
      };
    };

    expect(providerDoc.jobs?.preflight?.if).toBe('always()');
    expect(providerDoc.jobs?.preflight?.outputs?.cloud_run_labels).toBe(
      '${{ steps.provenance.outputs.cloud_run_labels || steps.standalone-target.outputs.cloud_run_labels || steps.resolve.outputs.cloud_run_labels }}'
    );
    expect(providerDoc.jobs?.deploy?.if).toBe(
      "always() && (!cancelled() || needs.preflight.outputs.is_rollback_call == 'true') && needs.preflight.result == 'success'"
    );
    expect(providerDoc.jobs?.deploy?.['timeout-minutes']).toBe(20);
    expect(providerDoc.on?.workflow_dispatch?.inputs).not.toHaveProperty('auto_rollback_on_failure');
    expect(providerDoc.on?.workflow_dispatch?.inputs).not.toHaveProperty('is_rollback');
    expect(providerDoc.on?.workflow_call?.inputs).toHaveProperty('auto_rollback_on_failure');
    expect(providerDoc.on?.workflow_call?.inputs).toHaveProperty('is_rollback');
    expect(providerDoc.on?.workflow_call?.outputs).toHaveProperty('health_status');
    expect(providerDoc.on?.workflow_call?.outputs).toHaveProperty('http_status');
    expect(providerDoc.on?.workflow_call?.outputs).toHaveProperty('inline_rollback_completed');

    const preflightSteps = providerDoc.jobs?.preflight?.steps ?? [];
    const deploySteps = providerDoc.jobs?.deploy?.steps ?? [];
    const cloudrunStep = deploySteps.find((s) => s.id === 'cloudrun');
    expect(cloudrunStep?.['timeout-minutes']).toBe(5);
    expect(cloudrunStep?.with?.labels).toBe('${{ needs.preflight.outputs.cloud_run_labels }}');

    const webhookStep = deploySteps.find((s) => s.id === 'webhook');
    expect(webhookStep?.['timeout-minutes']).toBe(2);

    const healthProbeStep = deploySteps.find((s) => s.id === 'health-probe');
    expect(healthProbeStep?.['timeout-minutes']).toBe(4);

    const finalizeStep = deploySteps.find((s) => s.id === 'finalize-deployment');
    expect(finalizeStep?.if).toContain('always()');

    const setupNodeStep = preflightSteps.find((s) => s.name === 'Setup Node.js for Migration Linter');
    expect(setupNodeStep?.uses).toContain('actions/setup-node@');
    expect(setupNodeStep?.with?.['node-version-file']).toBe('.nvmrc');

    expect(stageDoc.jobs?.['deploy-provider']?.with?.auto_rollback_on_failure).toBe(
      "${{ inputs.rollback_environment == '' }}"
    );
    expect(stageDoc.jobs?.['verify-deployment']?.environment).toBeUndefined();
    expect(stageDoc.jobs?.rollback?.if).toContain(
      "needs.deploy-provider.outputs.inline_rollback_completed != 'true'"
    );

    const providerProbeScript = extractStepRunScript(deployProviderYml, 'Verify Provider Service Health');
    const recordDeployScript = extractStepRunScript(deployProviderYml, 'Record Environment Deployment State');
    const finalizeDeployScript = extractStepRunScript(deployProviderYml, 'Finalize Environment Deployment Status');
    const stageProbeScript = extractStepRunScript(
      deployStageYml,
      'Execute Post-Deployment Health Probe Verification'
    );
    expect(providerProbeScript).toContain('--connect-timeout 5 --max-time 10');
    expect(providerProbeScript).toContain('READY_ENDPOINT="${TARGET_URL}/api/ready"');

    let probeState: 'ok' | 'degraded' = 'ok';
    let readyState: 'ready' | 'unhealthy' = 'ready';
    const createdDeployments: Array<{
      id: number;
      ref: string;
      payload: Record<string, unknown>;
      statuses: Array<{ state: string; auto_inactive?: boolean }>;
    }> = [];

    const mockServer = http.createServer((req, res) => {
      const reqUrl = req.url ?? '/';
      if (reqUrl === '/api/health') {
        if (probeState === 'ok') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: { status: 'ok', database: 'connected' } }));
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, status: 'degraded', database: 'disconnected' }));
        }
        return;
      }
      if (reqUrl === '/api/ready') {
        if (readyState === 'ready') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ready', database: 'connected' }));
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'unhealthy', database: 'connected', error: 'Database schema is not ready' }));
        }
        return;
      }
      let body = '';
      req.on('data', (c) => {
        body += c.toString();
      });
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'POST' && reqUrl === '/repos/OwnerOrg/Wedding_Website/deployments') {
          const parsed = JSON.parse(body) as { ref: string; payload: Record<string, unknown> };
          const id = 800 + createdDeployments.length + 1;
          createdDeployments.push({ id, ref: parsed.ref, payload: parsed.payload, statuses: [] });
          res.writeHead(201);
          res.end(JSON.stringify({ id }));
          return;
        }
        const statusMatch = reqUrl.match(/^\/repos\/OwnerOrg\/Wedding_Website\/deployments\/(\d+)\/statuses$/);
        if (req.method === 'POST' && statusMatch) {
          const id = Number(statusMatch[1]);
          const parsed = JSON.parse(body) as { state: string; auto_inactive?: boolean };
          const dep = createdDeployments.find((d) => d.id === id);
          dep?.statuses.push(parsed);
          res.writeHead(201);
          res.end(JSON.stringify(parsed));
          return;
        }
        res.writeHead(404);
        res.end('{}');
      });
    });

    await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = mockServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const secretBaseUrl = `http://127.0.0.1:${port}`;

    function runBashStepAsync(script: string, envOverrides: Record<string, string>) {
      return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn('bash', ['-eo', 'pipefail', '-c', script], {
          cwd: tempDir,
          env: {
            ...process.env,
            PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
            GITHUB_API_URL: apiBaseUrl,
            GITHUB_REPOSITORY: 'OwnerOrg/Wedding_Website',
            GITHUB_OUTPUT: outputFile,
            GITHUB_STEP_SUMMARY: summaryFile,
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
        child.on('close', (status) => resolve({ status, stdout, stderr }));
      });
    }

    try {
      // 1. Standalone workflow_dispatch with image_tag: v1.0.0 and empty commit_sha records resolved tag SHA instead of github.sha
      const resolvedTagSha = '1234567890abcdef1234567890abcdef12345678';
      const driftedGithubSha = 'fedcba0987654321fedcba0987654321fedcba09';

      fs.writeFileSync(outputFile, '');
      const recordRes = await runBashStepAsync(recordDeployScript, {
        GITHUB_TOKEN: 'ghs_test_token',
        GITHUB_REPOSITORY: 'OwnerOrg/Wedding_Website',
        GITHUB_API_URL: secretBaseUrl,
        TARGET_ENV: 'production',
        PROVIDER: 'docker-host',
        IMAGE_URI: `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`,
        IMAGE_DIGEST: VALID_DIGEST,
        IMAGE_TAG: 'v1.0.0',
        SOURCE_REVISION: resolvedTagSha,
        STANDALONE_TARGET_SHA: resolvedTagSha,
        INPUT_COMMIT_SHA: '',
        CURRENT_SHA: driftedGithubSha,
        VAR_SERVICE_URL: '',
        CLOUDRUN_URL: '',
      });
      expect(recordRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('deployment_id=801');
      expect(createdDeployments[0]?.ref).toBe(resolvedTagSha);
      expect(createdDeployments[0]?.payload.commit_sha).toBe(resolvedTagSha);
      expect(createdDeployments[0]?.statuses).toEqual([
        { state: 'in_progress', auto_inactive: false, environment: 'production' },
      ]);

      // 2. Verify Provider Service Health resolves secrets.SERVICE_URL in-memory without leaking it
      fs.writeFileSync(outputFile, '');
      fs.writeFileSync(summaryFile, '');
      const healthyProbeRes = await runBashStepAsync(providerProbeScript, {
        TARGET_ENV: 'production',
        VAR_SERVICE_URL: '',
        CLOUDRUN_URL: '',
        SECRET_SERVICE_URL: `${secretBaseUrl}/`,
        IS_DRY_RUN: 'false',
      });
      expect(healthyProbeRes.status).toBe(0);
      const healthyOutputs = fs.readFileSync(outputFile, 'utf8');
      expect(healthyOutputs).toContain('health_status=healthy');
      expect(healthyOutputs).toContain('http_status=200');
      expect(healthyOutputs).not.toContain(secretBaseUrl);
      expect(healthyProbeRes.stdout + healthyProbeRes.stderr).not.toContain(secretBaseUrl);
      expect(fs.readFileSync(summaryFile, 'utf8')).not.toContain(secretBaseUrl);

      // 3. Finalize Environment Deployment Status transitions 801 -> success (auto_inactive: true)
      fs.writeFileSync(outputFile, '');
      const finalizeOkRes = await runBashStepAsync(finalizeDeployScript, {
        GITHUB_TOKEN: 'ghs_test_token',
        GITHUB_REPOSITORY: 'OwnerOrg/Wedding_Website',
        GITHUB_API_URL: secretBaseUrl,
        TARGET_ENV: 'production',
        DEPLOYMENT_ID: '801',
        HEALTH_OUTCOME: 'success',
        HEALTH_STATUS: 'healthy',
        VAR_SERVICE_URL: '',
        CLOUDRUN_URL: '',
      });
      expect(finalizeOkRes.status).toBe(0);
      expect(createdDeployments[0]?.statuses[1]).toEqual({
        state: 'success',
        auto_inactive: true,
        environment: 'production',
      });

      // 4. deploy-stage.yml consumes health_status & http_status directly from deploy-provider.yml without polling
      fs.writeFileSync(outputFile, '');
      fs.writeFileSync(summaryFile, '');
      const consumedStageRes = await runBashStepAsync(stageProbeScript, {
        TARGET_ENV: 'production',
        VAR_SERVICE_URL: '',
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        PROVIDER_HEALTH_STATUS: 'healthy',
        PROVIDER_HTTP_STATUS: '200',
        IS_DRY_RUN: 'false',
      });
      expect(consumedStageRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('health_status=healthy');
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('http_status=200');

      // 5. Fails closed when /api/health returns 200 ok/connected but /api/ready returns 503 unhealthy
      readyState = 'unhealthy';
      const fastOneIterationProbe = providerProbeScript
        .replace('MAX_TIMEOUT=120', 'MAX_TIMEOUT=1')
        .replace('sleep $DELAY', 'sleep 1');
      fs.writeFileSync(outputFile, '');
      fs.writeFileSync(summaryFile, '');
      const unreadyProbeRes = await runBashStepAsync(fastOneIterationProbe, {
        TARGET_ENV: 'production',
        VAR_SERVICE_URL: '',
        CLOUDRUN_URL: '',
        SECRET_SERVICE_URL: secretBaseUrl,
        IS_DRY_RUN: 'false',
      });
      expect(unreadyProbeRes.status).toBe(1);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('health_status=unhealthy');
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('http_status=503');
      expect(unreadyProbeRes.stdout + unreadyProbeRes.stderr).not.toContain(secretBaseUrl);
      expect(fs.readFileSync(summaryFile, 'utf8')).not.toContain(secretBaseUrl);
      readyState = 'ready';

      // 6. Failed /api/health probe marks active GitHub Deployment failure (never success)
      probeState = 'degraded';
      const brokenSha = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
      fs.writeFileSync(outputFile, '');
      await runBashStepAsync(recordDeployScript, {
        GITHUB_TOKEN: 'ghs_test_token',
        GITHUB_REPOSITORY: 'OwnerOrg/Wedding_Website',
        GITHUB_API_URL: secretBaseUrl,
        TARGET_ENV: 'production',
        PROVIDER: 'google-cloud-run',
        IMAGE_URI: `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`,
        IMAGE_DIGEST: VALID_DIGEST,
        IMAGE_TAG: brokenSha,
        SOURCE_REVISION: brokenSha,
        STANDALONE_TARGET_SHA: '',
        INPUT_COMMIT_SHA: brokenSha,
        CURRENT_SHA: brokenSha,
        VAR_SERVICE_URL: '',
        CLOUDRUN_URL: '',
      });
      expect(createdDeployments[1]?.statuses).toEqual([
        { state: 'in_progress', auto_inactive: false, environment: 'production' },
      ]);

      const fastFailProbe = providerProbeScript.replace('MAX_TIMEOUT=120', 'MAX_TIMEOUT=0');
      fs.writeFileSync(outputFile, '');
      fs.writeFileSync(summaryFile, '');
      const failedProbeRes = await runBashStepAsync(fastFailProbe, {
        TARGET_ENV: 'production',
        VAR_SERVICE_URL: '',
        CLOUDRUN_URL: '',
        SECRET_SERVICE_URL: secretBaseUrl,
        IS_DRY_RUN: 'false',
      });
      expect(failedProbeRes.status).toBe(1);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('health_status=unhealthy');
      expect(fs.readFileSync(summaryFile, 'utf8')).toContain('[configured via secrets.SERVICE_URL]');
      expect(fs.readFileSync(summaryFile, 'utf8')).not.toContain(secretBaseUrl);

      await runBashStepAsync(finalizeDeployScript, {
        GITHUB_TOKEN: 'ghs_test_token',
        GITHUB_REPOSITORY: 'OwnerOrg/Wedding_Website',
        GITHUB_API_URL: secretBaseUrl,
        TARGET_ENV: 'production',
        DEPLOYMENT_ID: '802',
        HEALTH_OUTCOME: 'failure',
        HEALTH_STATUS: 'unhealthy',
        VAR_SERVICE_URL: '',
        CLOUDRUN_URL: '',
      });
      expect(createdDeployments[1]?.statuses[1]).toEqual({
        state: 'failure',
        auto_inactive: false,
        environment: 'production',
      });
    } finally {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    }
  });

  it('reads attested OCI org.opencontainers.image.revision before sourceRepositoryDigest in standalone-target and capture-previous, fails closed on OCI/SLSA conflict, and guards rollback paths against cancellation', () => {
    const validateShaScript = extractStepRunScript(deployProviderYml, 'Validate Commit SHA Input');
    const standaloneTargetScript = extractStepRunScript(
      deployProviderYml,
      'Resolve Standalone Promotion Commit & Main Ancestry'
    );
    const capturePreviousScript = extractStepRunScript(
      deployProviderYml,
      'Capture Active Image Tag Before Rollout'
    );

    const bareOrigin = path.join(tempDir, 'origin-oci-rev.git');
    const workRepo = path.join(tempDir, 'work-oci-rev');
    spawnSync('git', ['init', '--bare', bareOrigin], { stdio: 'pipe' });
    spawnSync('git', ['init', '-b', 'main', workRepo], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'config', 'user.email', 'ci@example.com'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'config', 'user.name', 'CI Bot'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'remote', 'add', 'origin', bareOrigin], { stdio: 'pipe' });

    fs.writeFileSync(path.join(workRepo, 'app.txt'), 'c1\n');
    spawnSync('git', ['-C', workRepo, 'add', 'app.txt'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'commit', '-m', 'c1 built release'], { stdio: 'pipe' });
    const c1Sha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

    fs.writeFileSync(path.join(workRepo, 'app.txt'), 'c2\n');
    spawnSync('git', ['-C', workRepo, 'add', 'app.txt'], { stdio: 'pipe' });
    spawnSync('git', ['-C', workRepo, 'commit', '-m', 'c2 drifted head'], { stdio: 'pipe' });
    const c2Sha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    spawnSync('git', ['-C', workRepo, 'push', 'origin', 'main'], { stdio: 'pipe' });

    // 0. validate-sha emits single-source is_rollback_call output consumed by downstream steps
    fs.writeFileSync(outputFile, '');
    const validateRollbackRes = runBashStep(validateShaScript, {
      INPUT_COMMIT_SHA: '',
      IS_ROLLBACK_CALL: 'true',
    });
    expect(validateRollbackRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('is_rollback_call=true');

    // 1. Standalone digest promotion resolves C1 from OCI index org.opencontainers.image.revision ahead of certificate.sourceRepositoryDigest (C2)
    fs.writeFileSync(outputFile, '');
    const driftStandaloneRes = spawnSync('bash', ['-eo', 'pipefail', '-c', standaloneTargetScript], {
      cwd: workRepo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        GITHUB_OUTPUT: outputFile,
        GH_TOKEN: 'ghs_test_token',
        GITHUB_ACTOR_LOGIN: 'octocat',
        IMAGE_URI: `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`,
        RAW_TAG: '',
        EXPECTED_SOURCE_REF: 'refs/heads/main',
        REPO_OWNER: 'OwnerOrg',
        SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
        MOCK_INDEX_REVISION: c1Sha,
        MOCK_ATTESTATION_SHA: c2Sha,
        MOCK_SLSA_REVISION: c2Sha,
      },
    });
    expect(driftStandaloneRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${c1Sha}`);

    // 2. Standalone digest promotion fails closed when OCI index revision conflicts with SLSA inputs.commit_sha
    const conflictStandaloneRes = spawnSync('bash', ['-eo', 'pipefail', '-c', standaloneTargetScript], {
      cwd: workRepo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        GITHUB_OUTPUT: outputFile,
        GH_TOKEN: 'ghs_test_token',
        GITHUB_ACTOR_LOGIN: 'octocat',
        IMAGE_URI: `ghcr.io/ownerorg/wedding_website@${VALID_DIGEST}`,
        RAW_TAG: '',
        EXPECTED_SOURCE_REF: 'refs/heads/main',
        REPO_OWNER: 'OwnerOrg',
        SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
        MOCK_INDEX_REVISION: c1Sha,
        MOCK_SLSA_INPUT_SHA: c2Sha,
        MOCK_ATTESTATION_SHA: c2Sha,
      },
    });
    expect(conflictStandaloneRes.status).not.toBe(0);
    expect(conflictStandaloneRes.stdout + conflictStandaloneRes.stderr).toContain('conflicts with SLSA input commit_sha');

    // 3. Capture Active Image Tag Before Rollout reads OCI revision ahead of OIDC GITHUB_SHA only AFTER gh attestation verify succeeds
    const servingDigest = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';
    const gcloudShim = path.join(binDir, 'gcloud');
    fs.writeFileSync(
      gcloudShim,
      `#!/usr/bin/env bash
if [[ "$*" == *"services describe"* ]]; then
  printf '{"status":{"traffic":[{"revisionName":"wedding-website-00021","percent":100}]}}'
  exit 0
fi
if [[ "$*" == *"revisions describe"* ]]; then
  printf 'ghcr.io/ownerorg/wedding_website@${servingDigest}\\n'
  exit 0
fi
exit 0
`,
      { mode: 0o755 }
    );

    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(callLogFile, '');
    const captureAttestedRes = runBashStep(capturePreviousScript, {
      PROVIDER: 'google-cloud-run',
      TARGET_ENV: 'production',
      INCOMING_TAG: c2Sha,
      INCOMING_DIGEST: VALID_DIGEST,
      INPUT_COMMIT_SHA: c2Sha,
      CURRENT_SHA: c2Sha,
      DRY_RUN: 'false',
      GCP_WORKLOAD_IDENTITY_PROVIDER: 'projects/1/locations/global/workloadIdentityPools/p/providers/o',
      GCP_SERVICE_ACCOUNT: 'deployer@demo-proj.iam.gserviceaccount.com',
      GITHUB_TOKEN: 'ghs_test_token',
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_INDEX_REVISION: c1Sha,
      MOCK_ATTESTATION_SHA: c2Sha,
      MOCK_SLSA_REVISION: c2Sha,
    });
    expect(captureAttestedRes.status).toBe(0);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`previous_image_tag=${c1Sha}`);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain(`previous_image_digest=${servingDigest}`);
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('previous_tag_source=oci-revision-label');

    // When gh attestation verify fails on serving digest, docker buildx imagetools inspect --raw is never called on the unattested digest
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(callLogFile, '');
    const captureUnattestedRes = runBashStep(capturePreviousScript, {
      PROVIDER: 'google-cloud-run',
      TARGET_ENV: 'production',
      INCOMING_TAG: c2Sha,
      INCOMING_DIGEST: VALID_DIGEST,
      INPUT_COMMIT_SHA: c2Sha,
      CURRENT_SHA: c2Sha,
      DRY_RUN: 'false',
      GCP_WORKLOAD_IDENTITY_PROVIDER: 'projects/1/locations/global/workloadIdentityPools/p/providers/o',
      GCP_SERVICE_ACCOUNT: 'deployer@demo-proj.iam.gserviceaccount.com',
      GITHUB_TOKEN: '',
      GH_TOKEN: 'ghs_test_token',
      GITHUB_ACTOR_LOGIN: 'octocat',
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
      MOCK_ATTESTATION_FAIL: 'true',
      MOCK_INDEX_REVISION: c1Sha,
    });
    expect(captureUnattestedRes.status).toBe(0);
    expect(fs.readFileSync(callLogFile, 'utf8')).not.toContain(
      `docker buildx imagetools inspect --raw ghcr.io/ownerorg/wedding_website@${servingDigest}`
    );

    // 4. Every rollback-path step across preflight and deploy in deploy-provider.yml evaluates always() and prior step outcomes
    const parsedProvider = parseDocument(deployProviderYml, { version: '1.2', strict: true }).toJS() as {
      jobs?: {
        preflight?: {
          steps?: Array<{ id?: string; name?: string; if?: string }>;
        };
        deploy?: {
          steps?: Array<{ id?: string; name?: string; if?: string }>;
        };
      };
    };
    const preflightSteps = parsedProvider.jobs?.preflight?.steps ?? [];
    const steps = parsedProvider.jobs?.deploy?.steps ?? [];
    for (const stepId of ['validate-sha', 'checkout', 'resolve', 'provenance']) {
      const step = preflightSteps.find((s) => s.id === stepId);
      expect(step?.if).toContain('always()');
    }
    for (const stepId of ['checkout', 'resolve', 'provenance']) {
      const step = preflightSteps.find((s) => s.id === stepId);
      expect(step?.if).toContain("steps.validate-sha.outputs.is_rollback_call == 'true'");
    }
    for (const stepId of [
      'verify-credentials',
      'gcp-auth-oidc',
      'gcp-auth-key',
      'capture-previous',
      'cloudrun',
      'webhook',
      'rollout-marker',
      'record-deployment',
      'dry-run-adapter',
      'health-probe',
      'finalize-deployment',
      'inline-rollback',
    ]) {
      const step = steps.find((s) => s.id === stepId);
      expect(step?.if).toContain('always()');
    }
    for (const stepId of [
      'verify-credentials',
      'gcp-auth-oidc',
      'gcp-auth-key',
      'capture-previous',
      'cloudrun',
      'webhook',
      'rollout-marker',
      'record-deployment',
      'dry-run-adapter',
      'health-probe',
    ]) {
      const step = steps.find((s) => s.id === stepId);
      expect(step?.if).toContain("needs.preflight.outputs.is_rollback_call == 'true'");
    }
    const inlineStep = steps.find((s) => s.id === 'inline-rollback');
    expect(inlineStep?.if).toContain("steps.health-probe.outcome != 'success'");
    expect(inlineStep?.if).toContain('!inputs.is_rollback');
  });
});
