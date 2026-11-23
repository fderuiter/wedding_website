import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { parseDocument } from 'yaml';

const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const DEPLOY_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy.yml');
const DEPLOY_PROVIDER_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy-provider.yml');
const DB_MIGRATE_YML_PATH = path.join(WORKFLOWS_DIR, 'db-migrate.yml');
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
  const deployProviderYml = fs.readFileSync(DEPLOY_PROVIDER_YML_PATH, 'utf8');
  const dbMigrateYml = fs.readFileSync(DB_MIGRATE_YML_PATH, 'utf8');

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
  if (args.includes('--format') && args.includes('json')) {
    if (process.env.MOCK_SLSA_V02 === 'true') {
      process.stdout.write(JSON.stringify([
        {
          verificationResult: {
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
    process.stdout.write(JSON.stringify([{ verificationResult: { statement: { predicate: { buildDefinition } } } }]));
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
        deploy?: {
          steps?: Array<{ id?: string; if?: string }>;
        };
      };
    };
    const provenanceStep = parsed.jobs?.deploy?.steps?.find((step) => step.id === 'provenance');
    expect(provenanceStep?.if).toBe(
      "!(inputs.dry_run && inputs.image_digest == '' && inputs.image_tag == 'latest')"
    );
  });

  it('keeps top-level permissions at contents: read and scopes attestations/packages/id-token to deployment jobs', () => {
    expect(deployYml).toMatch(/^permissions:\n  contents: read\n/m);
    expect(deployProviderYml).toMatch(/^permissions:\n  contents: read\n/m);
    expect(dbMigrateYml).toMatch(/^permissions:\n  contents: read\n/m);

    expect(deployProviderYml).toContain(
      '    permissions:\n      contents: read\n      packages: read\n      attestations: read\n      id-token: write'
    );
    expect(deployYml).toContain(
      '  staging-deploy-provider:\n    name: Staging Provider Deployment\n    permissions:\n      contents: read\n      packages: read\n      attestations: read\n      id-token: write'
    );
    expect(deployYml).toContain(
      '  production-deploy-provider:\n    name: Production Provider Deployment\n    permissions:\n      contents: read\n      packages: read\n      attestations: read\n      id-token: write'
    );
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
      'Resolve Artifact Image URI',
      'Verify Artifact Provenance Attestation',
      'Verify Selected Provider Credentials',
      'Capture Active Image Tag Before Rollout',
      'Deploy via Generic Webhook Adapter',
      'Dry-run Provider Adapter Validation',
      'Resolve Service URL Output',
      'Deployment Summary',
    ];

    for (const stepName of stepNames) {
      const script = extractStepRunScript(deployProviderYml, stepName);
      expect(script).not.toContain('${{');
    }
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
      REPO_OWNER: 'OwnerOrg',
      SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
    });
    expect(provRes.status).toBe(0);
    const outputsAfterProv = fs.readFileSync(outputFile, 'utf8');
    expect(outputsAfterProv).toContain(`source_revision=${VALID_REVISION}`);
    expect(outputsAfterProv).toContain('attestation_status=verified');

    const cliCalls = fs.readFileSync(callLogFile, 'utf8');
    expect(cliCalls).not.toContain('docker buildx imagetools inspect --format');
    expect(cliCalls).toContain(`docker buildx imagetools inspect --raw ${expectedUri}`);
    expect(cliCalls).toContain(
      `gh attestation verify oci://${expectedUri} --owner OwnerOrg --signer-workflow OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml --format json [token=present]`
    );

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
    expect(cloudRunDoc).toContain('vars.SERVICE_URL');
    expect(cloudRunDoc).toContain('secrets.SERVICE_URL');
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

  it('verifies deploy.yml health probes succeed under simulated runner secret output redaction with vars.SERVICE_URL or legacy secrets.SERVICE_URL and reject degraded or invalid payloads', async () => {
    const stagingProbeScript = extractStepRunScript(deployYml, 'Execute Staging Health Probe Verification');
    const prodProbeScript = extractStepRunScript(deployYml, 'Execute Production Health Probe Verification');

    let healthMode: 'wrapped-ok' | 'unwrapped-ok' | 'degraded' | 'success-false' | 'malformed' = 'wrapped-ok';

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

    const fastStagingFailScript = stagingProbeScript
      .replace('MAX_TIMEOUT=120', 'MAX_TIMEOUT=1')
      .replace('DELAY=2', 'DELAY=1');
    const fastProdFailScript = prodProbeScript
      .replace('MAX_TIMEOUT=120', 'MAX_TIMEOUT=1')
      .replace('DELAY=2', 'DELAY=1');

    try {
      // Simulated runner redaction (empty string and masked '***') with vars.SERVICE_URL set
      const stagingVarsRes = await runAsync(stagingProbeScript, {
        VAR_SERVICE_URL: `${liveUrl}/`,
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
      });
      expect(stagingVarsRes.status).toBe(0);
      expect(stagingVarsRes.outputs).toContain('health_status=healthy');
      expect(stagingVarsRes.summary).toContain(`- **Target Service URL:** \`${liveUrl}\``);

      // Simulated runner redaction (empty string and '***') with legacy secrets.SERVICE_URL set
      const stagingSecretRes = await runAsync(stagingProbeScript, {
        VAR_SERVICE_URL: '',
        SERVICE_URL: '',
        SECRET_SERVICE_URL: liveUrl,
        IS_DRY_RUN: 'false',
      });
      expect(stagingSecretRes.status).toBe(0);
      expect(stagingSecretRes.outputs).toContain('health_status=healthy');

      const prodSecretMaskedRes = await runAsync(prodProbeScript, {
        VAR_SERVICE_URL: '',
        SERVICE_URL: '***',
        SECRET_SERVICE_URL: liveUrl,
        IS_DRY_RUN: 'false',
      });
      expect(prodSecretMaskedRes.status).toBe(0);
      expect(prodSecretMaskedRes.outputs).toContain('health_status=healthy');

      // Unwrapped fallback succeeds when .success is absent
      healthMode = 'unwrapped-ok';
      const unwrappedRes = await runAsync(prodProbeScript, {
        VAR_SERVICE_URL: liveUrl,
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
      });
      expect(unwrappedRes.status).toBe(0);
      expect(unwrappedRes.outputs).toContain('health_status=healthy');

      // Degraded wrapped payload fails closed
      healthMode = 'degraded';
      for (const script of [fastStagingFailScript, fastProdFailScript]) {
        const degradedRes = await runAsync(script, {
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
      for (const script of [fastStagingFailScript, fastProdFailScript]) {
        const successFalseRes = await runAsync(script, {
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
      const malformedRes = await runAsync(fastStagingFailScript, {
        VAR_SERVICE_URL: liveUrl,
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
      });
      expect(malformedRes.status).toBe(1);
      expect(malformedRes.outputs).toContain('health_status=unhealthy');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 25000);

  it('fails fast in deploy.yml without polling 127.0.0.1:3000 when is_dry_run is false and SERVICE_URL is omitted, and passes dry-run when omitted', () => {
    const stagingProbeScript = extractStepRunScript(deployYml, 'Execute Staging Health Probe Verification');
    const prodProbeScript = extractStepRunScript(deployYml, 'Execute Production Health Probe Verification');

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

    for (const script of [stagingProbeScript, prodProbeScript]) {
      fs.writeFileSync(outputFile, '');
      fs.writeFileSync(summaryFile, '');
      const failRes = runBashStep(script, {
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
    for (const script of [stagingProbeScript, prodProbeScript]) {
      const fastDryScript = script.replace('DELAY=2', 'DELAY=1').replace('ELAPSED -ge 6', 'ELAPSED -ge 0');
      fs.writeFileSync(outputFile, '');
      const dryRes = runBashStep(fastDryScript, {
        VAR_SERVICE_URL: '',
        SERVICE_URL: '',
        SECRET_SERVICE_URL: '',
        IS_DRY_RUN: 'true',
      });
      expect(dryRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain('health_status=healthy');
    }

    // Unreachable endpoint in live mode (IS_DRY_RUN=false) fails closed after timeout
    for (const script of [stagingProbeScript, prodProbeScript]) {
      const fastLiveTimeoutScript = script.replace('MAX_TIMEOUT=120', 'MAX_TIMEOUT=0');
      fs.writeFileSync(outputFile, '');
      const unreachableRes = runBashStep(fastLiveTimeoutScript, {
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

    // 5. generic-webhook and docker-host fail closed when DEPLOY_WEBHOOK_URL or DEPLOY_WEBHOOK_SECRET is absent
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

      const validWebhookRes = runBashStep(verifyCredsScript, {
        PROVIDER: webhookProvider,
        TARGET_ENV: 'production',
        DEPLOY_WEBHOOK_URL: 'https://hooks.example.com/deploy',
        DEPLOY_WEBHOOK_SECRET: 'secret-token',
      });
      expect(validWebhookRes.status).toBe(0);
    }

    // 6. Verify YAML step conditions select OIDC primary auth and GCP_SA_KEY fallback mutually exclusively
    const deployProviderDoc = parseDocument(deployProviderYml, { version: '1.2', strict: true }).toJS() as {
      jobs?: {
        deploy?: {
          steps?: Array<{ id?: string; if?: string; with?: Record<string, string> }>;
        };
      };
    };
    const steps = deployProviderDoc.jobs?.deploy?.steps ?? [];
    const verifyStep = steps.find((s) => s.id === 'verify-credentials');
    const oidcStep = steps.find((s) => s.id === 'gcp-auth-oidc');
    const keyStep = steps.find((s) => s.id === 'gcp-auth-key');
    const dryRunStep = steps.find((s) => s.if === 'inputs.dry_run');

    expect(verifyStep?.if).toBe('!inputs.dry_run');
    expect(oidcStep?.if).toContain('vars.GCP_WORKLOAD_IDENTITY_PROVIDER !=');
    expect(oidcStep?.if).toContain('vars.GCP_SERVICE_ACCOUNT !=');
    expect(oidcStep?.with?.workload_identity_provider).toBe('${{ vars.GCP_WORKLOAD_IDENTITY_PROVIDER }}');
    expect(keyStep?.if).toContain("vars.GCP_WORKLOAD_IDENTITY_PROVIDER == '' || vars.GCP_SERVICE_ACCOUNT == ''");
    expect(keyStep?.if).toContain("secrets.GCP_SA_KEY != ''");
    expect(dryRunStep).toBeDefined();
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
      });
      expect(okRes.status).toBe(0);
    }
  });
});
