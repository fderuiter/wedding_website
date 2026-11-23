/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import crypto from 'crypto';
import { execSync, spawn, spawnSync } from 'child_process';
import { parseDocument } from 'yaml';

const ROOT_DIR = process.cwd();
const WORKFLOWS_DIR = path.join(ROOT_DIR, '.github', 'workflows');
const DEPLOY_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy.yml');
const DEPLOY_STAGE_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy-stage.yml');
const DEPLOY_PROVIDER_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy-provider.yml');
const ROLLBACK_YML_PATH = path.join(WORKFLOWS_DIR, 'rollback.yml');

/**
 * Extracts the bash `run: |` script body for a named step in a GitHub Actions workflow YAML file.
 */
function extractStepRunScript(workflowContent: string, stepName: string): string {
  const lines = workflowContent.split(/\r?\n/);
  const namePattern = new RegExp(`^\\s*-\\s*name:\\s*['"]?${stepName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`);

  let stepStartIdx = -1;
  let stepIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    if (namePattern.test(lines[i])) {
      stepStartIdx = i;
      stepIndent = lines[i].search(/\S/);
      break;
    }
  }

  if (stepStartIdx === -1) {
    throw new Error(`Step "${stepName}" not found in workflow`);
  }

  let runLineIdx = -1;
  let runIndent = 0;
  for (let i = stepStartIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = lines[i].search(/\S/);
    if (indent <= stepIndent) break;
    if (/^run:\s*\|/.test(trimmed)) {
      runLineIdx = i;
      runIndent = indent;
      break;
    }
  }

  if (runLineIdx === -1) {
    throw new Error(`Multiline "run: |" block not found for step "${stepName}"`);
  }

  const scriptLines: string[] = [];
  let blockIndent: number | null = null;

  for (let i = runLineIdx + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    if (rawLine.trim() === '') {
      if (blockIndent !== null) scriptLines.push('');
      continue;
    }
    const indent = rawLine.search(/\S/);
    if (indent <= runIndent) break;
    if (blockIndent === null) {
      blockIndent = indent;
    }
    scriptLines.push(rawLine.slice(blockIndent));
  }

  return scriptLines.join('\n');
}

function runBashStep(
  script: string,
  envOverrides: Record<string, string>,
  cwd?: string
): { status: number | null; stdout: string; stderr: string; outputs: Record<string, string>; summary: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-step-'));
  const outputPath = path.join(tmpDir, 'github_output.txt');
  const summaryPath = path.join(tmpDir, 'github_summary.md');
  fs.writeFileSync(outputPath, '');
  fs.writeFileSync(summaryPath, '');

  try {
    const result = spawnSync('bash', ['-e', '-c', script], {
      cwd: cwd || tmpDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
        ...envOverrides,
      },
    });

    const rawOutputs = fs.readFileSync(outputPath, 'utf8');
    const outputs: Record<string, string> = {};
    for (const line of rawOutputs.split(/\r?\n/)) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        outputs[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
      }
    }

    const summary = fs.readFileSync(summaryPath, 'utf8');
    return {
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      outputs,
      summary,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function runBashStepAsync(
  script: string,
  envOverrides: Record<string, string>,
  cwd?: string
): Promise<{ status: number | null; stdout: string; stderr: string; outputs: Record<string, string>; summary: string }> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-step-async-'));
  const outputPath = path.join(tmpDir, 'github_output.txt');
  const summaryPath = path.join(tmpDir, 'github_summary.md');
  fs.writeFileSync(outputPath, '');
  fs.writeFileSync(summaryPath, '');

  try {
    const { status, stdout, stderr } = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn('bash', ['-e', '-c', script], {
          cwd: cwd || tmpDir,
          env: {
            ...process.env,
            GITHUB_OUTPUT: outputPath,
            GITHUB_STEP_SUMMARY: summaryPath,
            ...envOverrides,
          },
        });

        let out = '';
        let err = '';
        child.stdout.on('data', chunk => {
          out += chunk.toString();
        });
        child.stderr.on('data', chunk => {
          err += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', code => {
          resolve({ status: code, stdout: out, stderr: err });
        });
      }
    );

    const rawOutputs = fs.readFileSync(outputPath, 'utf8');
    const outputs: Record<string, string> = {};
    for (const line of rawOutputs.split(/\r?\n/)) {
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        outputs[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
      }
    }

    const summary = fs.readFileSync(summaryPath, 'utf8');
    return { status, stdout, stderr, outputs, summary };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe('Rollback & Provider Deployment Workflows', () => {
  const deployYml = fs.readFileSync(DEPLOY_YML_PATH, 'utf8');
  const deployStageYml = fs.readFileSync(DEPLOY_STAGE_YML_PATH, 'utf8');
  const deployProviderYml = fs.readFileSync(DEPLOY_PROVIDER_YML_PATH, 'utf8');
  const rollbackYml = fs.readFileSync(ROLLBACK_YML_PATH, 'utf8');

  describe('Workflow YAML contracts & security guardrails', () => {
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

    it('keeps permissions: contents: read at the root of rollback.yml and deploy-stage.yml and avoids direct template interpolation in run blocks', () => {
      expect(rollbackYml).toMatch(/^permissions:\n\s+contents:\s*read/m);
      expect(deployStageYml).toMatch(/^permissions:\n\s+contents:\s*read/m);

      for (const [name, content] of [
        ['rollback.yml', rollbackYml],
        ['deploy-stage.yml', deployStageYml],
        ['deploy-provider.yml', deployProviderYml],
      ] as const) {
        const lines = content.split(/\r?\n/);
        let inRunBlock = false;
        let runIndent = 0;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const indent = line.search(/\S/);

          if (inRunBlock && indent <= runIndent) {
            inRunBlock = false;
          }
          if (!inRunBlock && /^(?:-\s*)?run:\s*/.test(trimmed)) {
            if (trimmed.endsWith('|') || trimmed.endsWith('>')) {
              inRunBlock = true;
              runIndent = indent;
            } else {
              expect(line).not.toContain('${{');
            }
          } else if (inRunBlock) {
            expect(`${name}:${i + 1}: ${line}`).not.toContain('${{');
          }
        }
      }
    });

    it('declares workflow_call secrets, commit_sha & rollback_environment inputs, and deploy-provider caller job in rollback.yml', () => {
      expect(rollbackYml).toContain('rollback_environment:');
      expect(rollbackYml.match(/^\s+commit_sha:\s*$/gm) ?? []).toHaveLength(2);
      expect(deployProviderYml.match(/^\s+commit_sha:\s*$/gm) ?? []).toHaveLength(2);
      for (const secretName of [
        'GCP_SA_KEY',
        'GCP_PROJECT_ID',
        'DEPLOY_WEBHOOK_URL',
        'DEPLOY_WEBHOOK_SECRET',
        'SERVICE_URL',
      ]) {
        expect(rollbackYml).toMatch(new RegExp(`^\\s+${secretName}:\\s*$`, 'm'));
      }
      expect(rollbackYml).toContain('uses: ./.github/workflows/deploy-provider.yml');
      expect(rollbackYml).toMatch(
        /Checkout Repository[\s\S]*?ref:\s*\$\{\{\s*inputs\.commit_sha\s*\}\}[\s\S]*?npm run lint:migrations/
      );
      expect(rollbackYml).not.toContain('npm ci');
      expect(rollbackYml).not.toContain("cache: 'npm'");
      expect(rollbackYml).not.toContain('Container service successfully restored to previous image tag.');

      // Verify lint:migrations executes natively on Node 22 in an isolated workspace without node_modules
      const isolatedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-zero-deps-'));
      try {
        fs.copyFileSync(path.join(process.cwd(), 'package.json'), path.join(isolatedDir, 'package.json'));
        fs.mkdirSync(path.join(isolatedDir, 'scripts'), { recursive: true });
        fs.copyFileSync(
          path.join(process.cwd(), 'scripts', 'verify-migration-compatibility.ts'),
          path.join(isolatedDir, 'scripts', 'verify-migration-compatibility.ts')
        );
        fs.mkdirSync(path.join(isolatedDir, 'prisma', 'migrations', '20260101000000_init'), { recursive: true });
        fs.writeFileSync(
          path.join(isolatedDir, 'prisma', 'migrations', '20260101000000_init', 'migration.sql'),
          'CREATE TABLE "TestTable" ("id" TEXT NOT NULL PRIMARY KEY);\n'
        );

        const lintRes = spawnSync('npm', ['run', 'lint:migrations'], {
          cwd: isolatedDir,
          encoding: 'utf8',
        });
        expect(lintRes.status).toBe(0);
        expect(lintRes.stdout).toContain('Migration compatibility check passed');
      } finally {
        fs.rmSync(isolatedDir, { recursive: true, force: true });
      }
    });

    it('passes previous_image_tag, previous_image_digest, commit_sha, and provider from deploy.yml and deploy-stage.yml to rollback.yml without defaulting to latest', () => {
      expect(deployYml).toContain('uses: ./.github/workflows/deploy-stage.yml');
      expect(deployYml).toContain("previous_tag: ${{ inputs.previous_tag || '' }}");
      expect(deployYml).not.toContain("previous_tag: ${{ inputs.previous_tag || 'latest' }}");
      expect(deployStageYml).toContain('needs.deploy-provider.outputs.previous_image_tag');
      expect(deployStageYml).toContain('needs.deploy-provider.outputs.previous_image_digest');
      expect(deployStageYml).toContain('commit_sha: ${{ inputs.commit_sha }}');
      expect(deployStageYml).toContain('caller_holds_lock: true');
      expect(deployProviderYml).toContain('previous_image_tag:');
      expect(deployProviderYml).toContain('previous_image_digest:');
      expect(deployProviderYml).toContain('--fail-with-body');
      expect(deployProviderYml).toContain(
        '  deploy:\n    name: Deploy Release Artifact to Provider\n    runs-on: ubuntu-latest\n    permissions:\n      actions: read\n      contents: read\n      packages: read\n      attestations: read\n      deployments: write\n      id-token: write'
      );
      expect(rollbackYml).toContain(
        '  redeploy:\n    name: Redeploy Previous Validated Container Image\n    permissions:\n      actions: read\n      contents: read\n      packages: read\n      attestations: read\n      deployments: write\n      id-token: write'
      );

      // Cloud Run service & region overrides forwarded across deploy.yml, deploy-stage.yml, deploy-provider.yml, and rollback.yml
      expect(deployYml).toContain("cloud_run_service: ${{ inputs.cloud_run_service || '' }}");
      expect(deployYml).toContain("cloud_run_region: ${{ inputs.cloud_run_region || '' }}");
      expect(deployStageYml).toContain(
        "cloud_run_service: ${{ inputs.cloud_run_service || needs.deploy-provider.outputs.cloud_run_service || '' }}"
      );
      expect(deployStageYml).toContain(
        "cloud_run_region: ${{ inputs.cloud_run_region || needs.deploy-provider.outputs.cloud_run_region || '' }}"
      );
      expect(rollbackYml).toContain("cloud_run_service: ${{ inputs.cloud_run_service || '' }}");
      expect(rollbackYml).toContain("cloud_run_region: ${{ inputs.cloud_run_region || '' }}");

      // rollback.yml must never pause twice on production gates (verify job has no environment gate)
      const rollbackDoc = parseDocument(rollbackYml, { version: '1.2', strict: true }).toJS() as {
        on?: {
          workflow_call?: {
            inputs?: Record<string, { type?: string; default?: unknown; required?: boolean }>;
          };
        };
        concurrency?: {
          group?: string;
          'cancel-in-progress'?: boolean;
          queue?: string;
        };
        jobs?: Record<
          string,
          {
            environment?: unknown;
            timeout_minutes?: number;
            'timeout-minutes'?: number;
            with?: Record<string, unknown>;
          }
        >;
      };
      expect(rollbackDoc.jobs?.verify?.environment).toBeUndefined();
      expect(rollbackDoc.jobs?.verify?.['timeout-minutes']).toBe(5);
      expect(rollbackDoc.on?.workflow_call?.inputs?.caller_holds_lock).toMatchObject({
        type: 'boolean',
        default: false,
      });
      expect(rollbackDoc.concurrency?.['cancel-in-progress']).toBe(false);
      expect(rollbackDoc.concurrency?.queue).toBe('max');
      expect(rollbackDoc.concurrency?.group).toContain("format('deploy-env-{0}', inputs.target_environment || 'production')");
      expect(rollbackDoc.concurrency?.group).toContain('caller-rollback-');
      expect(rollbackDoc.concurrency?.group).not.toContain('rollback_environment');
      expect(rollbackDoc.jobs?.redeploy?.with?.caller_holds_lock).toBe(true);
    });
  });

  describe('deploy-provider.yml executable step behavior', () => {
    it('captures the currently serving Cloud Run image tag and digest under both GCP_SA_KEY and OIDC Workload Identity while honoring environment-isolated service names and regions', () => {
      const script = extractStepRunScript(deployProviderYml, 'Capture Active Image Tag Before Rollout');
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-gcloud-'));
      const gcloudLog = path.join(binDir, 'gcloud-calls.log');
      fs.writeFileSync(gcloudLog, '');

      try {
        const mockGcloud = path.join(binDir, 'gcloud');
        fs.writeFileSync(
          mockGcloud,
          `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(gcloudLog)}
if [[ "$*" == *"services describe"* ]]; then
  cat <<'JSON'
{"status":{"traffic":[{"revisionName":"wedding-website-00008-xyz","percent":100}]},"spec":{"template":{"spec":{"containers":[{"image":"ghcr.io/example/wedding_website:1111111111111111111111111111111111111111"}]}}}}
JSON
elif [[ "$*" == *"revisions describe wedding-website-00008-xyz"* ]]; then
  echo "\${MOCK_REVISION_IMAGE:-ghcr.io/example/wedding_website:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb}"
fi
`,
          { mode: 0o755 }
        );

        const res = runBashStep(script, {
          PATH: `${binDir}:${process.env.PATH || ''}`,
          PROVIDER: 'google-cloud-run',
          TARGET_ENV: 'production',
          INCOMING_TAG: 'cccccccccccccccccccccccccccccccccccccccc',
          INCOMING_DIGEST: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          CURRENT_SHA: 'cccccccccccccccccccccccccccccccccccccccc',
          DRY_RUN: 'false',
          GCP_SA_KEY: '{"project_id":"demo-project"}',
          GCP_PROJECT_ID: 'demo-project',
          GITHUB_TOKEN: '',
          GITHUB_REPOSITORY: '',
        });

        expect(res.status).toBe(0);
        expect(res.outputs.previous_image_tag).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
        expect(res.outputs.previous_image_digest).toBe(
          'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        );
        expect(res.outputs.previous_tag_source).toBe('cloud-run');
        expect(res.outputs.cloud_run_service).toBe('wedding-website');
        expect(res.outputs.cloud_run_region).toBe('us-central1');

        // OIDC Workload Identity Federation (no GCP_SA_KEY) on staging with digest-only @sha256: revision populates both previous_image_digest and attested previous_image_tag
        const attestedStagingSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
        const mockGh = path.join(binDir, 'gh');
        fs.writeFileSync(
          mockGh,
          `#!/usr/bin/env bash
if [[ "$1" == "attestation" && "$2" == "verify" ]]; then
  cat <<'JSON'
[{"verificationResult":{"statement":{"predicate":{"buildDefinition":{"resolvedDependencies":[{"uri":"git+https://github.com/example/wedding_website@refs/heads/main","digest":{"gitCommit":"${attestedStagingSha}"}}]}}}}}]
JSON
  exit 0
fi
exit 1
`,
          { mode: 0o755 }
        );

        fs.writeFileSync(gcloudLog, '');
        const oidcStagingRes = runBashStep(script, {
          PATH: `${binDir}:${process.env.PATH || ''}`,
          MOCK_REVISION_IMAGE:
            'ghcr.io/example/wedding_website@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          PROVIDER: 'google-cloud-run',
          TARGET_ENV: 'staging',
          CLOUD_RUN_REGION: 'europe-west1',
          INCOMING_TAG: 'cccccccccccccccccccccccccccccccccccccccc',
          INCOMING_DIGEST: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          CURRENT_SHA: 'cccccccccccccccccccccccccccccccccccccccc',
          DRY_RUN: 'false',
          GCP_WORKLOAD_IDENTITY_PROVIDER:
            'projects/123456789/locations/global/workloadIdentityPools/github/providers/oidc',
          GCP_SERVICE_ACCOUNT: 'deployer@oidc-project.iam.gserviceaccount.com',
          GCP_SA_KEY: '',
          GCP_PROJECT_ID: '',
          GITHUB_TOKEN: 'ghs_mock_token',
          GH_TOKEN: 'ghs_mock_token',
          GITHUB_REPOSITORY: 'example/wedding_website',
          REPO_OWNER: 'example',
          SIGNER_WORKFLOW: 'example/wedding_website/.github/workflows/publish-artifact.yml',
        });

        expect(oidcStagingRes.status).toBe(0);
        expect(oidcStagingRes.outputs.previous_image_digest).toBe(
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
        );
        expect(oidcStagingRes.outputs.previous_image_tag).toBe(attestedStagingSha);
        expect(oidcStagingRes.outputs.previous_tag_source).toBe('cloud-run-attestation');
        expect(oidcStagingRes.outputs.cloud_run_service).toBe('wedding-website-staging');
        expect(oidcStagingRes.outputs.cloud_run_region).toBe('europe-west1');
        const loggedCalls = fs.readFileSync(gcloudLog, 'utf8');
        expect(loggedCalls).toContain(
          'run services describe wedding-website-staging --region=europe-west1 --project=oidc-project'
        );

        // Digest-only @sha256: Cloud Run JSON revision with commit-sha label also populates matching previous_image_digest and previous_image_tag when gh attestation is unavailable
        fs.unlinkSync(mockGh);
        const labeledSha = 'abababababababababababababababababababab';
        const labeledDigest = 'sha256:efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef';
        fs.writeFileSync(
          mockGcloud,
          `#!/usr/bin/env bash
if [[ "$*" == *"services describe"* ]]; then
  cat <<'JSON'
{"status":{"traffic":[{"revisionName":"wedding-website-00012-lbl","percent":100}]}}
JSON
elif [[ "$*" == *"revisions describe wedding-website-00012-lbl"* ]]; then
  cat <<'JSON'
{"metadata":{"labels":{"commit-sha":"${labeledSha}"}},"spec":{"containers":[{"image":"ghcr.io/example/wedding_website@${labeledDigest}"}]}}
JSON
fi
`,
          { mode: 0o755 }
        );
        const labelFallbackRes = runBashStep(script, {
          PATH: `${binDir}:${process.env.PATH || ''}`,
          PROVIDER: 'google-cloud-run',
          TARGET_ENV: 'production',
          INCOMING_TAG: 'cccccccccccccccccccccccccccccccccccccccc',
          INCOMING_DIGEST: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          CURRENT_SHA: 'cccccccccccccccccccccccccccccccccccccccc',
          DRY_RUN: 'false',
          GCP_SA_KEY: '{"project_id":"demo-project"}',
          GCP_PROJECT_ID: 'demo-project',
          GITHUB_TOKEN: '',
          GITHUB_REPOSITORY: '',
        });
        expect(labelFallbackRes.status).toBe(0);
        expect(labelFallbackRes.outputs.previous_image_digest).toBe(labeledDigest);
        expect(labelFallbackRes.outputs.previous_image_tag).toBe(labeledSha);
        expect(labelFallbackRes.outputs.previous_tag_source).toBe('cloud-run-revision-label');
      } finally {
        fs.rmSync(binDir, { recursive: true, force: true });
      }
    });

    it('falls back to git first-parent release SHA when provider tag is latest or unavailable', () => {
      const script = extractStepRunScript(deployProviderYml, 'Capture Active Image Tag Before Rollout');
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-git-'));

      try {
        execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
        execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
        execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
        fs.writeFileSync(path.join(repoDir, 'a.txt'), 'v1');
        execSync('git add a.txt && git commit -m "first"', { cwd: repoDir, stdio: 'ignore' });
        const parentSha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

        fs.writeFileSync(path.join(repoDir, 'a.txt'), 'v2');
        execSync('git add a.txt && git commit -m "second"', { cwd: repoDir, stdio: 'ignore' });
        const headSha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

        const res = runBashStep(
          script,
          {
            PROVIDER: 'generic-webhook',
            INCOMING_TAG: headSha,
            CURRENT_SHA: headSha,
            DRY_RUN: 'false',
            GCP_SA_KEY: '',
            GCP_PROJECT_ID: '',
            GITHUB_TOKEN: '',
            GITHUB_REPOSITORY: '',
          },
          repoDir
        );

        expect(res.status).toBe(0);
        expect(res.outputs.previous_image_tag).toBe(parentSha);
        expect(res.outputs.previous_tag_source).toBe('git-parent-sha');
      } finally {
        fs.rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it('ignores staging and dry_run workflow runs for generic-webhook rollbacks, tracks GitHub Deployments, and withstands 1-commit and 2-commit main advances', async () => {
      const captureScript = extractStepRunScript(deployProviderYml, 'Capture Active Image Tag Before Rollout');
      const recordScript = extractStepRunScript(deployProviderYml, 'Record Environment Deployment State');
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-advance-git-'));

      execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });

      const mkCommit = (label: string) => {
        fs.writeFileSync(path.join(repoDir, 'release.txt'), label);
        execSync(`git add release.txt && git commit -m "${label}"`, { cwd: repoDir, stdio: 'ignore' });
        return execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
      };

      const shaProdHealthy = mkCommit('c0-prod-healthy');
      const shaTargetRelease = mkCommit('c1-target-release');
      const shaAdvance1 = mkCommit('c2-staging-only-advance-1');
      const shaAdvance2 = mkCommit('c3-dry-run-advance-2');
      const prodHealthyDigest = 'sha256:1010101010101010101010101010101010101010101010101010101010101010';
      const targetDigest = 'sha256:2020202020202020202020202020202020202020202020202020202020202020';

      const recordedDeployments: Array<{
        id: number;
        sha: string;
        environment: string;
        payload: Record<string, unknown>;
        statuses: Array<{ state: string }>;
      }> = [];

      const apiServer = http.createServer((req, res) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          if (req.method === 'POST' && url.pathname === '/repos/example/wedding_website/deployments') {
            const parsed = JSON.parse(body) as {
              ref: string;
              environment: string;
              payload: Record<string, unknown>;
            };
            const id = 500 + recordedDeployments.length + 1;
            recordedDeployments.unshift({
              id,
              sha: parsed.ref,
              environment: parsed.environment,
              payload: parsed.payload,
              statuses: [],
            });
            res.writeHead(201);
            res.end(JSON.stringify({ id }));
            return;
          }
          const statusPostMatch = url.pathname.match(/^\/repos\/example\/wedding_website\/deployments\/(\d+)\/statuses$/);
          if (req.method === 'POST' && statusPostMatch) {
            const depId = Number(statusPostMatch[1]);
            const parsed = JSON.parse(body) as { state: string; auto_inactive?: boolean };
            const target = recordedDeployments.find((d) => d.id === depId);
            if (target) {
              if (parsed.auto_inactive) {
                for (const other of recordedDeployments) {
                  if (other.id !== depId && other.environment === target.environment) {
                    other.statuses.unshift({ state: 'inactive' });
                  }
                }
              }
              target.statuses.unshift({ state: parsed.state });
            }
            res.writeHead(201);
            res.end(JSON.stringify({ state: parsed.state }));
            return;
          }
          if (req.method === 'GET' && url.pathname === '/repos/example/wedding_website/deployments') {
            const envFilter = url.searchParams.get('environment') || '';
            const list = recordedDeployments.filter((d) => !envFilter || d.environment === envFilter);
            res.writeHead(200);
            res.end(JSON.stringify(list));
            return;
          }
          if (req.method === 'GET' && statusPostMatch) {
            const depId = Number(statusPostMatch[1]);
            const target = recordedDeployments.find((d) => d.id === depId);
            res.writeHead(200);
            res.end(JSON.stringify(target?.statuses ?? []));
            return;
          }
          if (req.method === 'GET' && url.pathname === '/repos/example/wedding_website/actions/workflows/deploy.yml/runs') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                workflow_runs: [
                  { id: 903, head_sha: shaAdvance2 },
                  { id: 902, head_sha: shaAdvance1 },
                  { id: 901, head_sha: shaProdHealthy },
                ],
              })
            );
            return;
          }
          if (req.method === 'GET' && url.pathname === '/repos/example/wedding_website/actions/runs/903/jobs') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                jobs: [
                  {
                    name: 'Production Provider Deployment / Deploy Release Artifact to Provider',
                    conclusion: 'success',
                    steps: [
                      { name: 'Verify Selected Provider Credentials', conclusion: 'skipped' },
                      { name: 'Dry-run Provider Adapter Validation', conclusion: 'success' },
                    ],
                  },
                  { name: 'Production Post-Deployment Health Verification', conclusion: 'success', steps: [] },
                ],
              })
            );
            return;
          }
          if (req.method === 'GET' && url.pathname === '/repos/example/wedding_website/actions/runs/902/jobs') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                jobs: [
                  { name: 'Staging Provider Deployment', conclusion: 'success', steps: [] },
                  { name: 'Staging Post-Deployment Health Verification', conclusion: 'success', steps: [] },
                  { name: 'Production Provider Deployment', conclusion: 'skipped', steps: [] },
                  { name: 'Production Post-Deployment Health Verification', conclusion: 'skipped', steps: [] },
                ],
              })
            );
            return;
          }
          if (req.method === 'GET' && url.pathname === '/repos/example/wedding_website/actions/runs/901/jobs') {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                jobs: [
                  {
                    name: 'Production Provider Deployment / Deploy Release Artifact to Provider',
                    conclusion: 'success',
                    steps: [
                      { name: 'Verify Selected Provider Credentials', conclusion: 'success' },
                      { name: 'Dry-run Provider Adapter Validation', conclusion: 'skipped' },
                    ],
                  },
                  { name: 'Production Post-Deployment Health Verification', conclusion: 'success', steps: [] },
                ],
              })
            );
            return;
          }
          res.writeHead(404);
          res.end(JSON.stringify({ message: 'not found' }));
        });
      });

      await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', () => resolve()));
      const addr = apiServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const apiBase = `http://127.0.0.1:${port}`;

      try {
        // 1. Before any GitHub Deployments exist, workflow-runs filter skips run 903 (dry_run) and run 902 (staging-only)
        // under both 1-commit and 2-commit main advances, selecting run 901 (shaProdHealthy).
        for (const advancedHeadSha of [shaAdvance1, shaAdvance2]) {
          const filteredRunsRes = await runBashStepAsync(
            captureScript,
            {
              PROVIDER: 'generic-webhook',
              TARGET_ENV: 'production',
              INCOMING_TAG: shaTargetRelease,
              INCOMING_DIGEST: targetDigest,
              INPUT_COMMIT_SHA: shaTargetRelease,
              CURRENT_SHA: advancedHeadSha,
              DRY_RUN: 'false',
              GITHUB_TOKEN: 'ghs_test_token',
              GITHUB_REPOSITORY: 'example/wedding_website',
              GITHUB_API_URL: apiBase,
            },
            repoDir
          );
          expect(filteredRunsRes.status).toBe(0);
          expect(filteredRunsRes.outputs.previous_image_tag).toBe(shaProdHealthy);
          expect(filteredRunsRes.outputs.previous_tag_source).toBe('workflow-runs');
        }

        // 2. Even with GitHub API disabled, commit_sha^1 resolves shaProdHealthy across 1-commit and 2-commit main advances
        for (const advancedHeadSha of [shaAdvance1, shaAdvance2]) {
          const gitTargetParentRes = await runBashStepAsync(
            captureScript,
            {
              PROVIDER: 'generic-webhook',
              TARGET_ENV: 'production',
              INCOMING_TAG: shaTargetRelease,
              INCOMING_DIGEST: targetDigest,
              INPUT_COMMIT_SHA: shaTargetRelease,
              CURRENT_SHA: advancedHeadSha,
              DRY_RUN: 'false',
              GITHUB_TOKEN: '',
              GITHUB_REPOSITORY: '',
            },
            repoDir
          );
          expect(gitTargetParentRes.status).toBe(0);
          expect(gitTargetParentRes.outputs.previous_image_tag).toBe(shaProdHealthy);
          expect(gitTargetParentRes.outputs.previous_tag_source).toBe('git-parent-sha');
        }

        // 3. Record Environment Deployment State writes production deployment state, and subsequent webhook rollout reads both tag & digest from GitHub Deployments
        const recordProdRes = await runBashStepAsync(
          recordScript,
          {
            GITHUB_TOKEN: 'ghs_test_token',
            GITHUB_REPOSITORY: 'example/wedding_website',
            GITHUB_API_URL: apiBase,
            TARGET_ENV: 'production',
            PROVIDER: 'generic-webhook',
            IMAGE_URI: `ghcr.io/example/wedding_website@${prodHealthyDigest}`,
            IMAGE_DIGEST: prodHealthyDigest,
            IMAGE_TAG: shaProdHealthy,
            INPUT_COMMIT_SHA: shaProdHealthy,
            CURRENT_SHA: shaProdHealthy,
            VAR_SERVICE_URL: 'https://wedding.example.com',
            CLOUDRUN_URL: '',
          },
          repoDir
        );
        expect(recordProdRes.status).toBe(0);
        expect(recordProdRes.outputs.deployment_id).toBe('501');

        // Also record a staging deployment to ensure environment isolation in GitHub Deployments
        await runBashStepAsync(
          recordScript,
          {
            GITHUB_TOKEN: 'ghs_test_token',
            GITHUB_REPOSITORY: 'example/wedding_website',
            GITHUB_API_URL: apiBase,
            TARGET_ENV: 'staging',
            PROVIDER: 'generic-webhook',
            IMAGE_URI: `ghcr.io/example/wedding_website@${targetDigest}`,
            IMAGE_DIGEST: targetDigest,
            IMAGE_TAG: shaAdvance1,
            INPUT_COMMIT_SHA: shaAdvance1,
            CURRENT_SHA: shaAdvance1,
            VAR_SERVICE_URL: 'https://staging.wedding.example.com',
            CLOUDRUN_URL: '',
          },
          repoDir
        );

        const deploymentsCaptureRes = await runBashStepAsync(
          captureScript,
          {
            PROVIDER: 'generic-webhook',
            TARGET_ENV: 'production',
            INCOMING_TAG: shaTargetRelease,
            INCOMING_DIGEST: targetDigest,
            INPUT_COMMIT_SHA: shaTargetRelease,
            CURRENT_SHA: shaAdvance2,
            DRY_RUN: 'false',
            GITHUB_TOKEN: 'ghs_test_token',
            GITHUB_REPOSITORY: 'example/wedding_website',
            GITHUB_API_URL: apiBase,
          },
          repoDir
        );
        expect(deploymentsCaptureRes.status).toBe(0);
        expect(deploymentsCaptureRes.outputs.previous_image_tag).toBe(shaProdHealthy);
        expect(deploymentsCaptureRes.outputs.previous_image_digest).toBe(prodHealthyDigest);
        expect(deploymentsCaptureRes.outputs.previous_tag_source).toBe('github-deployments');
      } finally {
        await new Promise<void>((resolve) => apiServer.close(() => resolve()));
        fs.rmSync(repoDir, { recursive: true, force: true });
      }
    });

    it('queries environment-scoped GitHub Deployments when Cloud Run serves a digest-only @sha256 URI without cross-environment pollution', async () => {
      const script = extractStepRunScript(deployProviderYml, 'Capture Active Image Tag Before Rollout');
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-gcloud-deployments-'));

      const targetSha = '2222222222222222222222222222222222222222';
      const newerStagingSha = '3333333333333333333333333333333333333333';
      const failedProdSha = '4444444444444444444444444444444444444444';
      const inProgressProdSha = '5555555555555555555555555555555555555555';
      const healthyProdSha = '1111111111111111111111111111111111111111';
      const olderProdSha = '0000000000000000000000000000000000000000';
      const servingDigest = 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';

      const requestedPaths: string[] = [];
      const server = http.createServer((req, res) => {
        const reqUrl = req.url || '';
        requestedPaths.push(reqUrl);
        res.setHeader('Content-Type', 'application/json');

        if (reqUrl.startsWith('/repos/fderuiter/wedding_website/deployments?')) {
          // Deliberately include a newer staging deployment in the response payload as well
          // to verify both query-string filtering (?environment=production) and jq environment filtering.
          res.writeHead(200);
          res.end(
            JSON.stringify([
              { id: 901, environment: 'staging', sha: newerStagingSha },
              { id: 900, environment: 'production', sha: targetSha },
              { id: 899, environment: 'production', sha: failedProdSha },
              { id: 898, environment: 'production', sha: inProgressProdSha },
              { id: 897, environment: 'production', sha: 'v1.0.0-non-sha-ref' },
              { id: 896, environment: 'production', sha: healthyProdSha },
              { id: 895, environment: 'production', sha: olderProdSha },
            ])
          );
          return;
        }

        if (reqUrl.startsWith('/repos/fderuiter/wedding_website/deployments/901/statuses')) {
          res.writeHead(200);
          res.end(JSON.stringify([{ state: 'success' }]));
          return;
        }
        if (reqUrl.startsWith('/repos/fderuiter/wedding_website/deployments/899/statuses')) {
          // Superseded failed deployment (auto_inactive appended inactive above failure)
          res.writeHead(200);
          res.end(JSON.stringify([{ state: 'inactive' }, { state: 'failure' }, { state: 'in_progress' }]));
          return;
        }
        if (reqUrl.startsWith('/repos/fderuiter/wedding_website/deployments/898/statuses')) {
          res.writeHead(200);
          res.end(JSON.stringify([{ state: 'in_progress' }]));
          return;
        }
        if (reqUrl.startsWith('/repos/fderuiter/wedding_website/deployments/896/statuses')) {
          // Prior healthy production deployment superseded by current deployment's inactive state
          res.writeHead(200);
          res.end(JSON.stringify([{ state: 'inactive' }, { state: 'success' }, { state: 'in_progress' }]));
          return;
        }
        if (reqUrl.startsWith('/repos/fderuiter/wedding_website/deployments/895/statuses')) {
          res.writeHead(200);
          res.end(JSON.stringify([{ state: 'success' }]));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ message: 'Not Found' }));
      });

      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      try {
        const mockGcloud = path.join(binDir, 'gcloud');
        fs.writeFileSync(
          mockGcloud,
          `#!/usr/bin/env bash
if [[ "$*" == *"services describe"* ]]; then
  cat <<'JSON'
{"status":{"traffic":[{"revisionName":"wedding-website-00012-abc","percent":100}]},"spec":{"template":{"spec":{"containers":[{"image":"ghcr.io/fderuiter/wedding_website@${servingDigest}"}]}}}}
JSON
elif [[ "$*" == *"revisions describe wedding-website-00012-abc"* ]]; then
  echo "ghcr.io/fderuiter/wedding_website@${servingDigest}"
fi
`,
          { mode: 0o755 }
        );

        const res = await runBashStepAsync(script, {
          PATH: `${binDir}:${process.env.PATH || ''}`,
          PROVIDER: 'google-cloud-run',
          TARGET_ENV: 'production',
          INCOMING_TAG: targetSha,
          INCOMING_DIGEST: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
          INPUT_COMMIT_SHA: targetSha,
          CURRENT_SHA: newerStagingSha,
          DRY_RUN: 'false',
          GCP_SA_KEY: '{"project_id":"demo-project"}',
          GCP_PROJECT_ID: 'demo-project',
          GITHUB_TOKEN: 'ghs_test_token',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
        });

        expect(res.status).toBe(0);
        expect(res.outputs.previous_image_digest).toBe(servingDigest);
        expect(res.outputs.previous_image_tag).toBe(healthyProdSha);
        expect(res.outputs.previous_tag_source).toBe('github-deployments');
        expect(requestedPaths).toContain(
          '/repos/fderuiter/wedding_website/deployments?environment=production&per_page=20'
        );
        // Never queried statuses for staging deployment 901, current targetSha 900, or older 895 after 896 matched
        expect(requestedPaths.some((p) => p.includes('/deployments/901/statuses'))).toBe(false);
        expect(requestedPaths.some((p) => p.includes('/deployments/900/statuses'))).toBe(false);
        expect(requestedPaths.some((p) => p.includes('/deployments/895/statuses'))).toBe(false);
      } finally {
        fs.rmSync(binDir, { recursive: true, force: true });
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    });

    it('resolves parent SHA relative to pinned commit_sha across 0, +1, and +2 main branch drift and validates commit_sha format', async () => {
      const validateShaScript = extractStepRunScript(deployProviderYml, 'Validate Commit SHA Input');
      const captureScript = extractStepRunScript(deployProviderYml, 'Capture Active Image Tag Before Rollout');
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-git-drift-'));
      const shallowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-git-shallow-'));

      try {
        // 1. Validate 40-char hex enforcement in Validate Commit SHA Input and capture-previous
        for (const badSha of ['not-a-hex-sha', '0123456789abcdef', '0123456789abcdef0123456789abcdef0123456g']) {
          const invalidValidate = runBashStep(validateShaScript, { INPUT_COMMIT_SHA: badSha });
          expect(invalidValidate.status).toBe(1);
          expect(invalidValidate.stdout + invalidValidate.stderr).toContain('Invalid commit_sha');

          const invalidCapture = runBashStep(captureScript, {
            PROVIDER: 'generic-webhook',
            INPUT_COMMIT_SHA: badSha,
            CURRENT_SHA: badSha,
            DRY_RUN: 'false',
          });
          expect(invalidCapture.status).toBe(1);
          expect(invalidCapture.stdout + invalidCapture.stderr).toContain('Invalid commit_sha');
        }

        expect(runBashStep(validateShaScript, { INPUT_COMMIT_SHA: '' }).status).toBe(0);

        // 2. Build commit chain c0 (healthy prior) -> c1 (target_sha) -> c2 (+1 drift) -> c3 (+2 drift)
        execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
        execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
        execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });

        const commits: string[] = [];
        for (let idx = 0; idx < 4; idx++) {
          fs.writeFileSync(path.join(repoDir, 'release.txt'), `release-${idx}`);
          execSync(`git add release.txt && git commit -m "commit-${idx}"`, { cwd: repoDir, stdio: 'ignore' });
          commits.push(execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim());
        }
        const [c0HealthyPrior, c1TargetSha, c2SingleDrift, c3MultiDrift] = commits;

        for (const headAtExecution of [c1TargetSha, c2SingleDrift, c3MultiDrift]) {
          execSync(`git checkout --quiet ${headAtExecution}`, { cwd: repoDir, stdio: 'ignore' });
          const driftRes = runBashStep(
            captureScript,
            {
              PROVIDER: 'generic-webhook',
              TARGET_ENV: 'production',
              INCOMING_TAG: c1TargetSha,
              INPUT_COMMIT_SHA: c1TargetSha,
              CURRENT_SHA: c1TargetSha,
              GITHUB_SHA: headAtExecution,
              DRY_RUN: 'false',
              GITHUB_TOKEN: '',
              GITHUB_REPOSITORY: '',
            },
            repoDir
          );
          expect(driftRes.status).toBe(0);
          expect(driftRes.outputs.previous_image_tag).toBe(c0HealthyPrior);
          expect(driftRes.outputs.previous_tag_source).toBe('git-parent-sha');
        }

        // 3. When inputs.commit_sha is omitted, falls back to github.sha (c2SingleDrift -> parent c1TargetSha)
        execSync(`git checkout --quiet ${c2SingleDrift}`, { cwd: repoDir, stdio: 'ignore' });
        const defaultShaRes = runBashStep(
          captureScript,
          {
            PROVIDER: 'generic-webhook',
            TARGET_ENV: 'production',
            INCOMING_TAG: c2SingleDrift,
            INPUT_COMMIT_SHA: '',
            CURRENT_SHA: c2SingleDrift,
            GITHUB_SHA: c2SingleDrift,
            DRY_RUN: 'false',
            GITHUB_TOKEN: '',
            GITHUB_REPOSITORY: '',
          },
          repoDir
        );
        expect(defaultShaRes.status).toBe(0);
        expect(defaultShaRes.outputs.previous_image_tag).toBe(c1TargetSha);
        expect(defaultShaRes.outputs.previous_tag_source).toBe('git-parent-sha');

        // 4. When no prior environment deployment and no local git parent exist, commits API resolves ?sha=c1TargetSha parents[0].sha under +2 drift
        execSync('git init -b main', { cwd: shallowDir, stdio: 'ignore' });
        const apiPaths: string[] = [];
        const server = http.createServer((req, res) => {
          const reqUrl = req.url || '';
          apiPaths.push(reqUrl);
          res.setHeader('Content-Type', 'application/json');
          if (reqUrl.startsWith('/repos/fderuiter/wedding_website/deployments?')) {
            res.writeHead(200);
            res.end(JSON.stringify([]));
            return;
          }
          if (reqUrl === `/repos/fderuiter/wedding_website/commits?sha=${c1TargetSha}&per_page=2`) {
            res.writeHead(200);
            res.end(
              JSON.stringify([
                { sha: c1TargetSha, parents: [{ sha: c0HealthyPrior }] },
                { sha: c0HealthyPrior, parents: [] },
              ])
            );
            return;
          }
          res.writeHead(404);
          res.end(JSON.stringify({ message: 'Unexpected URL' }));
        });

        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;

        try {
          const apiFallbackRes = await runBashStepAsync(
            captureScript,
            {
              PROVIDER: 'generic-webhook',
              TARGET_ENV: 'staging',
              INCOMING_TAG: c1TargetSha,
              INPUT_COMMIT_SHA: c1TargetSha,
              CURRENT_SHA: c3MultiDrift,
              GITHUB_SHA: c3MultiDrift,
              DRY_RUN: 'false',
              GITHUB_TOKEN: 'ghs_test_token',
              GITHUB_REPOSITORY: 'fderuiter/wedding_website',
              GITHUB_API_URL: `http://127.0.0.1:${port}`,
            },
            shallowDir
          );
          expect(apiFallbackRes.status).toBe(0);
          expect(apiFallbackRes.outputs.previous_image_tag).toBe(c0HealthyPrior);
          expect(apiFallbackRes.outputs.previous_tag_source).toBe('github-commits-api');
          expect(apiPaths).toContain('/repos/fderuiter/wedding_website/deployments?environment=staging&per_page=20');
          expect(apiPaths).toContain(`/repos/fderuiter/wedding_website/commits?sha=${c1TargetSha}&per_page=2`);
        } finally {
          await new Promise<void>((resolve) => server.close(() => resolve()));
        }
      } finally {
        fs.rmSync(repoDir, { recursive: true, force: true });
        fs.rmSync(shallowDir, { recursive: true, force: true });
      }
    });

    it('enforces HMAC-SHA256 signed --fail-with-body generic webhook deployments and never coerces live runs to dry-run', async () => {
      const webhookScript = extractStepRunScript(deployProviderYml, 'Deploy via Generic Webhook Adapter');
      const resolveUrlScript = extractStepRunScript(deployProviderYml, 'Resolve Service URL Output');

      // Live run (INPUT_DRY_RUN=false) with empty credentials/URLs must NEVER coerce is_dry_run to true
      const liveEmptyRes = runBashStep(resolveUrlScript, {
        VAR_SERVICE_URL: '',
        CLOUDRUN_URL: '',
        SECRET_SERVICE_URL: '',
        INPUT_DRY_RUN: 'false',
      });
      expect(liveEmptyRes.status).toBe(0);
      expect(liveEmptyRes.outputs.is_dry_run).toBe('false');
      expect(liveEmptyRes.outputs.service_url).toBe('');

      // Explicit dry-run (INPUT_DRY_RUN=true) sets is_dry_run=true and placeholder localhost URL
      const explicitDryRes = runBashStep(resolveUrlScript, {
        VAR_SERVICE_URL: '',
        CLOUDRUN_URL: '',
        SECRET_SERVICE_URL: '',
        INPUT_DRY_RUN: 'true',
      });
      expect(explicitDryRes.status).toBe(0);
      expect(explicitDryRes.outputs.is_dry_run).toBe('true');
      expect(explicitDryRes.outputs.service_url).toBe('http://127.0.0.1:3000');

      let requestCount = 0;
      let nextStatus = 500;
      let receivedBody = '';
      let receivedHeaders: http.IncomingHttpHeaders = {};
      const server = http.createServer((req, res) => {
        requestCount += 1;
        receivedHeaders = req.headers;
        let data = '';
        req.on('data', chunk => {
          data += chunk;
        });
        req.on('end', () => {
          receivedBody = data;
          res.writeHead(nextStatus, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: nextStatus === 200,
              message: nextStatus === 200 ? 'deployed' : 'upstream failure',
            })
          );
        });
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const webhookSecret = 'super-secret-hmac-signing-key-2026';
      const digest = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

      try {
        // Missing DEPLOY_WEBHOOK_SECRET must fail closed without sending any HTTP request
        const missingSecretRes = await runBashStepAsync(webhookScript, {
          IMAGE_URI: `ghcr.io/example/wedding_website@${digest}`,
          IMAGE_DIGEST: digest,
          TARGET_ENV: 'production',
          DEPLOY_WEBHOOK_URL: `http://127.0.0.1:${port}/deploy`,
          DEPLOY_WEBHOOK_SECRET: '',
        });
        expect(missingSecretRes.status).not.toBe(0);
        expect(missingSecretRes.stdout + missingSecretRes.stderr).toContain('Missing DEPLOY_WEBHOOK_SECRET');
        expect(requestCount).toBe(0);

        const failRes = await runBashStepAsync(webhookScript, {
          IMAGE_URI: `ghcr.io/example/wedding_website@${digest}`,
          IMAGE_DIGEST: digest,
          TARGET_ENV: 'production',
          DEPLOY_WEBHOOK_URL: `http://127.0.0.1:${port}/deploy`,
          DEPLOY_WEBHOOK_SECRET: webhookSecret,
        });
        expect(failRes.status).not.toBe(0);
        expect(failRes.stdout + failRes.stderr).toContain('upstream failure');

        nextStatus = 200;
        const okRes = await runBashStepAsync(webhookScript, {
          IMAGE_URI: `ghcr.io/example/wedding_website@${digest}`,
          IMAGE_DIGEST: digest,
          TARGET_ENV: 'production',
          DEPLOY_WEBHOOK_URL: `http://127.0.0.1:${port}/deploy`,
          DEPLOY_WEBHOOK_SECRET: webhookSecret,
        });
        expect(okRes.status).toBe(0);
        expect(JSON.parse(receivedBody)).toEqual({
          image: `ghcr.io/example/wedding_website@${digest}`,
          digest,
          environment: 'production',
        });

        const expectedBodySig = crypto
          .createHmac('sha256', webhookSecret)
          .update(receivedBody)
          .digest('hex');
        const timestampHeader = String(receivedHeaders['x-deploy-timestamp'] || '');
        expect(timestampHeader).toMatch(/^\d+$/);
        const expectedTimestampSig = crypto
          .createHmac('sha256', webhookSecret)
          .update(`${timestampHeader}.${receivedBody}`)
          .digest('hex');

        expect(receivedHeaders['x-hub-signature-256']).toBe(`sha256=${expectedBodySig}`);
        expect(receivedHeaders['x-deploy-signature-256']).toBe(`sha256=${expectedTimestampSig}`);

        // Verify payload is multi-line jq -n formatted JSON where re-serializing via JSON.stringify would break HMAC
        expect(receivedBody).toContain('\n  "image":');
        const compactReserialized = JSON.stringify(JSON.parse(receivedBody));
        expect(compactReserialized).not.toBe(receivedBody);
        const brokenCompactSig = crypto
          .createHmac('sha256', webhookSecret)
          .update(compactReserialized)
          .digest('hex');
        expect(`sha256=${brokenCompactSig}`).not.toBe(receivedHeaders['x-hub-signature-256']);

        // Reference stateless webhook receiver check (constant-time signature comparison + 300s timestamp window)
        const nowSeconds = Math.floor(Date.now() / 1000);
        expect(Math.abs(nowSeconds - Number(timestampHeader))).toBeLessThanOrEqual(300);
        expect(
          crypto.timingSafeEqual(
            Buffer.from(String(receivedHeaders['x-hub-signature-256'])),
            Buffer.from(`sha256=${expectedBodySig}`)
          )
        ).toBe(true);
        expect(
          crypto.timingSafeEqual(
            Buffer.from(String(receivedHeaders['x-deploy-signature-256'])),
            Buffer.from(`sha256=${expectedTimestampSig}`)
          )
        ).toBe(true);

        // Verify digest field is omitted cleanly when IMAGE_DIGEST is empty while preserving both HMAC formulas
        const noDigestRes = await runBashStepAsync(webhookScript, {
          IMAGE_URI: 'ghcr.io/example/wedding_website:v1.0.0',
          IMAGE_DIGEST: '',
          TARGET_ENV: 'staging',
          DEPLOY_WEBHOOK_URL: `http://127.0.0.1:${port}/deploy`,
          DEPLOY_WEBHOOK_SECRET: webhookSecret,
        });
        expect(noDigestRes.status).toBe(0);
        expect(JSON.parse(receivedBody)).toEqual({
          image: 'ghcr.io/example/wedding_website:v1.0.0',
          environment: 'staging',
        });
        const noDigestTs = String(receivedHeaders['x-deploy-timestamp'] || '');
        expect(receivedHeaders['x-hub-signature-256']).toBe(
          `sha256=${crypto.createHmac('sha256', webhookSecret).update(receivedBody).digest('hex')}`
        );
        expect(receivedHeaders['x-deploy-signature-256']).toBe(
          `sha256=${crypto.createHmac('sha256', webhookSecret).update(`${noDigestTs}.${receivedBody}`).digest('hex')}`
        );
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    });

    it('captures the prior production tag and sha256 digest for docker-host after staging and dry_run runs', async () => {
      const captureScript = extractStepRunScript(deployProviderYml, 'Capture Active Image Tag Before Rollout');
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-docker-prod-'));
      const prodPriorSha = '1111111111111111111111111111111111111111';
      const stagingSha = '2222222222222222222222222222222222222222';
      const dryRunSha = '3333333333333333333333333333333333333333';
      const incomingSha = '4444444444444444444444444444444444444444';
      const prodPriorDigest = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const incomingDigest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

      const dockerShim = path.join(binDir, 'docker');
      fs.writeFileSync(
        dockerShim,
        `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'login') process.exit(0);
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'inspect') {
  const ref = args[args.length - 1];
  const map = {
    'ghcr.io/fderuiter/wedding_website:${prodPriorSha}': '${prodPriorDigest}',
    'ghcr.io/fderuiter/wedding_website:${stagingSha}': 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'ghcr.io/fderuiter/wedding_website:${dryRunSha}': 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
    'ghcr.io/fderuiter/wedding_website:v1.2.0': 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  };
  if (map[ref]) {
    process.stdout.write(map[ref]);
    process.exit(0);
  }
  process.exit(1);
}
process.exit(1);
`,
        { mode: 0o755 }
      );

      let standaloneProviderWins = false;
      const apiServer = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const url = req.url ?? '';
        if (url.includes('/actions/workflows/deploy.yml/runs')) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              workflow_runs: [
                {
                  id: 404,
                  event: 'workflow_dispatch',
                  conclusion: 'success',
                  head_sha: dryRunSha,
                  head_branch: 'main',
                  updated_at: '2026-11-22T12:04:00Z',
                },
                {
                  id: 403,
                  event: 'workflow_run',
                  conclusion: 'success',
                  head_sha: stagingSha,
                  head_branch: 'main',
                  updated_at: '2026-11-22T12:03:00Z',
                },
                {
                  id: 401,
                  event: 'workflow_run',
                  conclusion: 'success',
                  head_sha: prodPriorSha,
                  head_branch: 'main',
                  updated_at: '2026-11-22T12:01:00Z',
                },
              ],
            })
          );
          return;
        }
        if (url.includes('/actions/workflows/deploy-provider.yml/runs')) {
          const runs = [
            {
              id: 402,
              event: 'workflow_dispatch',
              conclusion: 'success',
              head_sha: stagingSha,
              head_branch: 'main',
              updated_at: '2026-11-22T12:02:00Z',
            },
          ];
          if (standaloneProviderWins) {
            runs.unshift({
              id: 405,
              event: 'workflow_dispatch',
              conclusion: 'success',
              head_sha: prodPriorSha,
              head_branch: 'v1.2.0',
              updated_at: '2026-11-22T12:05:00Z',
            });
          }
          res.writeHead(200);
          res.end(JSON.stringify({ workflow_runs: runs }));
          return;
        }
        if (url.includes('/deployments?environment=production')) {
          res.writeHead(200);
          res.end(JSON.stringify([{ sha: prodPriorSha, ref: standaloneProviderWins ? 'v1.2.0' : 'main' }]));
          return;
        }
        if (url.includes('/actions/runs/404/jobs')) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              jobs: [
                {
                  name: 'Production Provider Deployment / Deploy Release Artifact to Provider',
                  conclusion: 'success',
                  steps: [{ name: 'Dry-run Provider Adapter Validation', conclusion: 'success' }],
                },
                { name: 'Production Post-Deployment Health Verification', conclusion: 'success', steps: [] },
              ],
            })
          );
          return;
        }
        if (url.includes('/actions/runs/403/jobs')) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              jobs: [
                {
                  name: 'Staging Provider Deployment / Deploy Release Artifact to Provider',
                  conclusion: 'success',
                  steps: [{ name: 'Dry-run Provider Adapter Validation', conclusion: 'skipped' }],
                },
                { name: 'Staging Post-Deployment Health Verification', conclusion: 'success', steps: [] },
                { name: 'Production Provider Deployment', conclusion: 'skipped', steps: [] },
                { name: 'Production Post-Deployment Health Verification', conclusion: 'skipped', steps: [] },
              ],
            })
          );
          return;
        }
        if (url.includes('/actions/runs/402/jobs')) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              jobs: [
                {
                  name: 'Deploy Release Artifact to Provider',
                  conclusion: 'success',
                  steps: [
                    { name: 'Record Target Environment (staging)', conclusion: 'success' },
                    { name: 'Record Target Environment (production)', conclusion: 'skipped' },
                    { name: 'Dry-run Provider Adapter Validation', conclusion: 'skipped' },
                  ],
                },
              ],
            })
          );
          return;
        }
        if (url.includes('/actions/runs/401/jobs')) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              jobs: [
                {
                  name: 'Production Provider Deployment / Deploy Release Artifact to Provider',
                  conclusion: 'success',
                  steps: [{ name: 'Dry-run Provider Adapter Validation', conclusion: 'skipped' }],
                },
                { name: 'Production Post-Deployment Health Verification', conclusion: 'success', steps: [] },
              ],
            })
          );
          return;
        }
        if (url.includes('/actions/runs/405/jobs')) {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              jobs: [
                {
                  name: 'Deploy Release Artifact to Provider',
                  conclusion: 'success',
                  steps: [
                    { name: 'Record Target Environment (staging)', conclusion: 'skipped' },
                    { name: 'Record Target Environment (production)', conclusion: 'success' },
                    { name: 'Dry-run Provider Adapter Validation', conclusion: 'skipped' },
                  ],
                },
              ],
            })
          );
          return;
        }
        res.writeHead(404);
        res.end('{}');
      });

      await new Promise<void>(resolve => apiServer.listen(0, '127.0.0.1', () => resolve()));
      const addr = apiServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      try {
        const res = await runBashStepAsync(captureScript, {
          PATH: `${binDir}:${process.env.PATH || ''}`,
          PROVIDER: 'docker-host',
          TARGET_ENV: 'production',
          INCOMING_TAG: incomingSha,
          INCOMING_DIGEST: incomingDigest,
          CURRENT_SHA: incomingSha,
          DRY_RUN: 'false',
          GITHUB_TOKEN: 'ghs_mock_token',
          GITHUB_ACTOR_LOGIN: 'octocat',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
        });

        expect(res.status).toBe(0);
        expect(res.outputs.previous_image_tag).toBe(prodPriorSha);
        expect(res.outputs.previous_image_digest).toBe(prodPriorDigest);
        expect(res.outputs.previous_tag_source).toBe('workflow-runs');

        // Also verify newer standalone deploy-provider.yml production tag run is selected ahead of older deploy.yml run
        standaloneProviderWins = true;
        const standaloneRes = await runBashStepAsync(captureScript, {
          PATH: `${binDir}:${process.env.PATH || ''}`,
          PROVIDER: 'docker-host',
          TARGET_ENV: 'production',
          INCOMING_TAG: incomingSha,
          INCOMING_DIGEST: incomingDigest,
          CURRENT_SHA: incomingSha,
          DRY_RUN: 'false',
          GITHUB_TOKEN: 'ghs_mock_token',
          GITHUB_ACTOR_LOGIN: 'octocat',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
        });
        expect(standaloneRes.status).toBe(0);
        expect(standaloneRes.outputs.previous_image_tag).toBe('v1.2.0');
        expect(standaloneRes.outputs.previous_image_digest).toBe(
          'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
        );
        expect(standaloneRes.outputs.previous_tag_source).toBe('workflow-runs');
      } finally {
        await new Promise<void>(resolve => apiServer.close(() => resolve()));
        fs.rmSync(binDir, { recursive: true, force: true });
      }
    });

    it('skips unpublished HEAD^1 commits lacking a GHCR tag and selects the latest GHCR-published release for rollback.yml', async () => {
      const captureScript = extractStepRunScript(deployProviderYml, 'Capture Active Image Tag Before Rollout');
      const resolveScript = extractStepRunScript(deployProviderYml, 'Resolve Artifact Image URI');
      const rollbackValidateScript = extractStepRunScript(rollbackYml, 'Log Rollback Request Details');
      const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-git-ghcr-'));
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-docker-ghcr-'));
      const publishedDigest = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';
      const incomingDigest = 'sha256:8888888888888888888888888888888888888888888888888888888888888888';

      execSync('git init -b main', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoDir, 'a.txt'), 'release-1');
      execSync('git add a.txt && git commit -m "published release"', { cwd: repoDir, stdio: 'ignore' });
      const publishedSha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

      fs.writeFileSync(path.join(repoDir, 'a.txt'), 'intermediate-unpublished');
      execSync('git add a.txt && git commit -m "unpublished HEAD^1"', { cwd: repoDir, stdio: 'ignore' });
      const unpublishedParentSha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

      fs.writeFileSync(path.join(repoDir, 'a.txt'), 'head-commit');
      execSync('git add a.txt && git commit -m "head commit"', { cwd: repoDir, stdio: 'ignore' });
      const headSha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();

      // Shallow clone simulation with fetch-depth=2 (only HEAD and unpublished HEAD^1 locally)
      const shallowDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-shallow-'));
      execSync(`git clone --depth=2 "file://${repoDir}" "${shallowDir}"`, { stdio: 'ignore' });

      const dockerShim = path.join(binDir, 'docker');
      fs.writeFileSync(
        dockerShim,
        `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'login') process.exit(0);
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'inspect') {
  const ref = args[args.length - 1];
  // HEAD^1 (${unpublishedParentSha}) is NOT published in GHCR; ${publishedSha} IS published
  if (ref === 'ghcr.io/fderuiter/wedding_website:${publishedSha}') {
    process.stdout.write('${publishedDigest}');
    process.exit(0);
  }
  process.exit(1);
}
process.exit(1);
`,
        { mode: 0o755 }
      );

      const apiServer = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        const url = req.url ?? '';
        if (url.includes('/actions/workflows/')) {
          res.writeHead(200);
          res.end(JSON.stringify({ workflow_runs: [] }));
          return;
        }
        if (url.includes('/deployments')) {
          res.writeHead(200);
          res.end(JSON.stringify([]));
          return;
        }
        if (url.includes('/commits?')) {
          res.writeHead(200);
          res.end(
            JSON.stringify([
              { sha: headSha },
              { sha: unpublishedParentSha },
              { sha: publishedSha },
            ])
          );
          return;
        }
        res.writeHead(404);
        res.end('{}');
      });

      await new Promise<void>(resolve => apiServer.listen(0, '127.0.0.1', () => resolve()));
      const addr = apiServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      try {
        const captureRes = await runBashStepAsync(
          captureScript,
          {
            PATH: `${binDir}:${process.env.PATH || ''}`,
            PROVIDER: 'docker-host',
            TARGET_ENV: 'production',
            INCOMING_TAG: headSha,
            INCOMING_DIGEST: incomingDigest,
            CURRENT_SHA: headSha,
            DRY_RUN: 'false',
            GITHUB_TOKEN: 'ghs_mock_token',
            GITHUB_ACTOR_LOGIN: 'octocat',
            GITHUB_REPOSITORY: 'fderuiter/wedding_website',
            GITHUB_API_URL: `http://127.0.0.1:${port}`,
          },
          shallowDir
        );

        expect(captureRes.status).toBe(0);
        expect(captureRes.outputs.previous_image_tag).not.toBe(unpublishedParentSha);
        expect(captureRes.outputs.previous_image_tag).toBe(publishedSha);
        expect(captureRes.outputs.previous_image_digest).toBe(publishedDigest);
        expect(captureRes.outputs.previous_tag_source).toBe('github-commits-api');

        // Verify rollback.yml preflight + deploy-provider.yml Resolve Artifact Image URI succeed with exit code 0
        const rollbackPreflight = runBashStep(rollbackValidateScript, {
          TARGET_ENV: 'production',
          ROLLBACK_ENV: 'production-rollback',
          PREVIOUS_TAG: captureRes.outputs.previous_image_tag,
          PREVIOUS_DIGEST: captureRes.outputs.previous_image_digest,
          PROVIDER: 'docker-host',
          REASON: 'Automated post-deployment health check failure',
          DRY_RUN: 'false',
          CURRENT_SHA: headSha,
        });
        expect(rollbackPreflight.status).toBe(0);
        expect(rollbackPreflight.outputs.effective_tag).toBe(publishedSha);
        expect(rollbackPreflight.outputs.effective_digest).toBe(publishedDigest);

        const resolveRes = runBashStep(resolveScript, {
          PATH: `${binDir}:${process.env.PATH || ''}`,
          GH_TOKEN: 'ghs_mock_token',
          GITHUB_ACTOR_LOGIN: 'octocat',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          RAW_DIGEST: rollbackPreflight.outputs.effective_digest,
          RAW_TAG: rollbackPreflight.outputs.effective_tag,
          TARGET_ENV: 'production',
          ROLLBACK_ENV: 'production-rollback',
          PROVIDER: 'docker-host',
          DRY_RUN: 'false',
        });
        expect(resolveRes.status).toBe(0);
        expect(resolveRes.outputs.image_digest).toBe(publishedDigest);
        expect(resolveRes.outputs.image_uri).toBe(`ghcr.io/fderuiter/wedding_website@${publishedDigest}`);
      } finally {
        await new Promise<void>(resolve => apiServer.close(() => resolve()));
        fs.rmSync(shallowDir, { recursive: true, force: true });
        fs.rmSync(repoDir, { recursive: true, force: true });
        fs.rmSync(binDir, { recursive: true, force: true });
      }
    });
  });

  describe('rollback.yml executable step behavior', () => {
    const validateScript = extractStepRunScript(rollbackYml, 'Log Rollback Request Details');
    const healthProbeScript = extractStepRunScript(rollbackYml, 'Poll Restored Service Health');
    const reportScript = extractStepRunScript(rollbackYml, 'Send Rollback Notification');

    it('rejects mutable latest and failing github.sha outside explicit dry-run mode, but allows explicit dry-run', () => {
      const failingSha = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      const validSha = '0123456789abcdef0123456789abcdef01234567';

      const latestRes = runBashStep(validateScript, {
        TARGET_ENV: 'production',
        ROLLBACK_ENV: 'production-rollback',
        PREVIOUS_TAG: 'latest',
        PROVIDER: 'google-cloud-run',
        REASON: 'Health check failed',
        DRY_RUN: 'false',
        CURRENT_SHA: failingSha,
      });
      expect(latestRes.status).toBe(1);
      expect(latestRes.stdout + latestRes.stderr).toContain("Mutable image tag 'latest' is rejected");

      const sameShaRes = runBashStep(validateScript, {
        TARGET_ENV: 'staging',
        ROLLBACK_ENV: '',
        PREVIOUS_TAG: failingSha,
        PROVIDER: 'google-cloud-run',
        REASON: 'Health check failed',
        DRY_RUN: 'false',
        CURRENT_SHA: failingSha,
      });
      expect(sameShaRes.status).toBe(1);
      expect(sameShaRes.stdout + sameShaRes.stderr).toContain('matches the failing commit SHA');

      const dryRunRes = runBashStep(validateScript, {
        TARGET_ENV: 'staging',
        ROLLBACK_ENV: '',
        PREVIOUS_TAG: 'latest',
        PROVIDER: 'google-cloud-run',
        REASON: 'Dry-run check',
        DRY_RUN: 'true',
        CURRENT_SHA: failingSha,
      });
      expect(dryRunRes.status).toBe(0);
      expect(dryRunRes.outputs.effective_tag).toBe('latest');

      const validRes = runBashStep(validateScript, {
        TARGET_ENV: 'production',
        ROLLBACK_ENV: 'production-rollback',
        PREVIOUS_TAG: validSha,
        PROVIDER: 'generic-webhook',
        REASON: 'Automated post-deployment health check failure',
        DRY_RUN: 'false',
        CURRENT_SHA: failingSha,
      });
      expect(validRes.status).toBe(0);
      expect(validRes.outputs.validation_status).toBe('passed');
      expect(validRes.outputs.effective_tag).toBe(validSha);

      // Digest-only rollback (previous_digest set with empty previous_tag) succeeds outside dry-run
      const validDigestOnly = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';
      const digestOnlyRes = runBashStep(validateScript, {
        TARGET_ENV: 'production',
        ROLLBACK_ENV: 'production-rollback',
        PREVIOUS_TAG: '',
        PREVIOUS_DIGEST: validDigestOnly,
        PROVIDER: 'google-cloud-run',
        REASON: 'Digest-pinned rollback restoration',
        DRY_RUN: 'false',
        INPUT_COMMIT_SHA: failingSha,
        CURRENT_SHA: validSha,
      });
      expect(digestOnlyRes.status).toBe(0);
      expect(digestOnlyRes.outputs.validation_status).toBe('passed');
      expect(digestOnlyRes.outputs.effective_tag).toBe('');
      expect(digestOnlyRes.outputs.effective_digest).toBe(validDigestOnly);

      // Compares previous_tag against commit_sha rather than github.sha when main has advanced or an older digest failed promotion
      const advancedGithubSha = 'ffffffffffffffffffffffffffffffffffffffff';
      const matchesFailingShaRes = runBashStep(validateScript, {
        TARGET_ENV: 'production',
        ROLLBACK_ENV: 'production-rollback',
        PREVIOUS_TAG: failingSha,
        PREVIOUS_DIGEST: '',
        PROVIDER: 'generic-webhook',
        REASON: 'Automated rollback after 2-commit advance',
        DRY_RUN: 'false',
        INPUT_COMMIT_SHA: failingSha,
        CURRENT_SHA: advancedGithubSha,
      });
      expect(matchesFailingShaRes.status).toBe(1);
      expect(matchesFailingShaRes.stdout + matchesFailingShaRes.stderr).toContain(
        `matches the failing commit SHA '${failingSha}'`
      );

      // Restoring github.sha is permitted when commit_sha was an older promoted release that failed health checks
      const restoreHeadAfterOlderFailRes = runBashStep(validateScript, {
        TARGET_ENV: 'production',
        ROLLBACK_ENV: 'production-rollback',
        PREVIOUS_TAG: advancedGithubSha,
        PREVIOUS_DIGEST: '',
        PROVIDER: 'generic-webhook',
        REASON: 'Restore serving HEAD release after older digest failed',
        DRY_RUN: 'false',
        INPUT_COMMIT_SHA: failingSha,
        CURRENT_SHA: advancedGithubSha,
      });
      expect(restoreHeadAfterOlderFailRes.status).toBe(0);
      expect(restoreHeadAfterOlderFailRes.outputs.effective_tag).toBe(advancedGithubSha);

      // Rejects tag matching pinned INPUT_COMMIT_SHA (target_sha) case-insensitively even when github.sha drifted ahead on main
      const driftedMainSha = '9999999999999999999999999999999999999999';
      const targetShaSelfRollbackRes = runBashStep(validateScript, {
        TARGET_ENV: 'production',
        ROLLBACK_ENV: 'production-rollback',
        PREVIOUS_TAG: failingSha.toUpperCase(),
        PROVIDER: 'google-cloud-run',
        REASON: 'Health check failed during main branch drift',
        DRY_RUN: 'false',
        INPUT_COMMIT_SHA: failingSha,
        CURRENT_SHA: driftedMainSha,
      });
      expect(targetShaSelfRollbackRes.status).toBe(1);
      expect(targetShaSelfRollbackRes.stdout + targetShaSelfRollbackRes.stderr).toContain(
        'matches the failing commit SHA'
      );

      // Rejects malformed non-40-hex INPUT_COMMIT_SHA
      const badCommitShaRes = runBashStep(validateScript, {
        TARGET_ENV: 'production',
        ROLLBACK_ENV: 'production-rollback',
        PREVIOUS_TAG: validSha,
        PROVIDER: 'google-cloud-run',
        REASON: 'Health check failed',
        DRY_RUN: 'false',
        INPUT_COMMIT_SHA: 'invalid-sha',
        CURRENT_SHA: failingSha,
      });
      expect(badCommitShaRes.status).toBe(1);
      expect(badCommitShaRes.stdout + badCommitShaRes.stderr).toContain('Invalid commit_sha');
    });

    it('polls /api/health to verify wrapped recovery, unwrapped fallback, .success==false rejection, malformed JSON, and degraded payloads', async () => {
      let attempt = 0;
      let mode: 'recover' | 'unwrapped' | 'success-false' | 'malformed' | 'degraded' = 'recover';

      const server = http.createServer((req, res) => {
        if (req.url !== '/api/health') {
          res.writeHead(404);
          res.end();
          return;
        }
        attempt += 1;
        if (mode === 'recover') {
          if (attempt === 1) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Database connection failed' }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: true,
                data: { status: 'ok', timestamp: '2026-11-20T00:00:00.000Z', database: 'connected' },
              })
            );
          }
        } else if (mode === 'unwrapped') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', database: 'connected' }));
        } else if (mode === 'success-false') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: false,
              status: 'ok',
              database: 'connected',
              data: { status: 'ok', database: 'connected' },
            })
          );
        } else if (mode === 'malformed') {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('{"success":true,"data":{"status":"ok"');
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: { status: 'degraded', database: 'disconnected' },
            })
          );
        }
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const fastRecoverScript = healthProbeScript
        .replace('MAX_TIMEOUT=55', 'MAX_TIMEOUT=5')
        .replace('DELAY=2', 'DELAY=1');
      const fastFailScript = healthProbeScript
        .replace('MAX_TIMEOUT=55', 'MAX_TIMEOUT=2')
        .replace('DELAY=2', 'DELAY=1');

      try {
        const okRes = await runBashStepAsync(fastRecoverScript, {
          ENV_SERVICE_URL: `http://127.0.0.1:${port}/`,
          PROVIDER_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(okRes.status).toBe(0);
        expect(okRes.outputs.health_status).toBe('healthy');
        expect(attempt).toBeGreaterThanOrEqual(2);

        mode = 'unwrapped';
        attempt = 0;
        const unwrappedRes = await runBashStepAsync(fastRecoverScript, {
          ENV_SERVICE_URL: `http://127.0.0.1:${port}`,
          PROVIDER_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(unwrappedRes.status).toBe(0);
        expect(unwrappedRes.outputs.health_status).toBe('healthy');
        expect(attempt).toBe(1);

        mode = 'success-false';
        attempt = 0;
        const successFalseRes = await runBashStepAsync(fastFailScript, {
          ENV_SERVICE_URL: `http://127.0.0.1:${port}`,
          PROVIDER_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(successFalseRes.status).toBe(1);
        expect(successFalseRes.outputs.health_status).toBe('unhealthy');
        expect(attempt).toBeGreaterThanOrEqual(1);

        mode = 'malformed';
        attempt = 0;
        const malformedRes = await runBashStepAsync(fastFailScript, {
          ENV_SERVICE_URL: `http://127.0.0.1:${port}`,
          PROVIDER_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(malformedRes.status).toBe(1);
        expect(malformedRes.outputs.health_status).toBe('unhealthy');
        expect(attempt).toBeGreaterThanOrEqual(1);

        mode = 'degraded';
        attempt = 0;
        const failRes = await runBashStepAsync(fastFailScript, {
          ENV_SERVICE_URL: `http://127.0.0.1:${port}`,
          PROVIDER_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(failRes.status).toBe(1);
        expect(failRes.outputs.health_status).toBe('unhealthy');
        expect(attempt).toBeGreaterThanOrEqual(1);
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }, 25000);

    it('prefers vars.SERVICE_URL ahead of secrets.SERVICE_URL and needs.redeploy.outputs.service_url and exports unmasked service_url into $GITHUB_STEP_SUMMARY', async () => {
      const server = http.createServer((req, res) => {
        if (req.url === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: { status: 'ok', timestamp: '2026-11-20T00:00:00.000Z', database: 'connected' },
            })
          );
          return;
        }
        res.writeHead(404);
        res.end();
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const varsUrl = `http://127.0.0.1:${port}`;

      try {
        // vars.SERVICE_URL defined without secrets.SERVICE_URL -> unmasked service_url exported to report summary
        const varsProbeRes = await runBashStepAsync(healthProbeScript, {
          VAR_SERVICE_URL: `${varsUrl}/`,
          ENV_SERVICE_URL: '',
          PROVIDER_SERVICE_URL: 'http://127.0.0.1:9',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(varsProbeRes.status).toBe(0);
        expect(varsProbeRes.outputs.health_status).toBe('healthy');
        expect(varsProbeRes.outputs.service_url).toBe(varsUrl);

        const reportRes = runBashStep(reportScript, {
          TARGET_ENV: 'production',
          ROLLBACK_ENV: 'production-rollback',
          PREVIOUS_TAG: 'v1.2.2',
          PROVIDER: 'google-cloud-run',
          REASON: 'Health probe failed',
          PREFLIGHT_RESULT: 'success',
          PREFLIGHT_FAILED_STAGE: '',
          DB_COMPAT_STATUS: 'verified',
          REDEPLOY_RESULT: 'success',
          VERIFY_RESULT: 'success',
          VERIFY_URL: varsProbeRes.outputs.service_url,
          VERIFY_HTTP_STATUS: varsProbeRes.outputs.http_status,
        });
        expect(reportRes.status).toBe(0);
        expect(reportRes.summary).toContain(`(URL: \`${varsUrl}\`)`);

        // vars.SERVICE_URL also takes precedence over a stale secrets.SERVICE_URL
        const overrideProbeRes = await runBashStepAsync(healthProbeScript, {
          VAR_SERVICE_URL: varsUrl,
          ENV_SERVICE_URL: 'http://127.0.0.1:9',
          PROVIDER_SERVICE_URL: 'http://127.0.0.1:9',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(overrideProbeRes.status).toBe(0);
        expect(overrideProbeRes.outputs.service_url).toBe(varsUrl);

        // Secret-only fallback succeeds without leaking secret value to outputs.service_url
        const legacySecretProbeRes = await runBashStepAsync(healthProbeScript, {
          VAR_SERVICE_URL: '',
          ENV_SERVICE_URL: varsUrl,
          PROVIDER_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(legacySecretProbeRes.status).toBe(0);
        expect(legacySecretProbeRes.outputs.health_status).toBe('healthy');
        expect(legacySecretProbeRes.outputs.service_url).toBe('');
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }

      // Live run (IS_DRY_RUN=false) rejects missing SERVICE_URL immediately
      const missingLiveRes = await runBashStepAsync(healthProbeScript, {
        VAR_SERVICE_URL: '',
        ENV_SERVICE_URL: '',
        PROVIDER_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
        TARGET_ENV: 'production',
        RESTORED_TAG: 'v1.2.2',
      });
      expect(missingLiveRes.status).toBe(1);
      expect(missingLiveRes.outputs.health_status).toBe('unhealthy');
      expect(missingLiveRes.outputs.http_status).toBe('invalid-url');

      // Live run (IS_DRY_RUN=false) rejects unreachable endpoint
      const fastLiveUnreachableScript = healthProbeScript
        .replace('MAX_TIMEOUT=55', 'MAX_TIMEOUT=1')
        .replace('DELAY=2', 'DELAY=1');
      const unreachableLiveRes = await runBashStepAsync(fastLiveUnreachableScript, {
        VAR_SERVICE_URL: 'http://127.0.0.1:9',
        ENV_SERVICE_URL: '',
        PROVIDER_SERVICE_URL: '',
        IS_DRY_RUN: 'false',
        TARGET_ENV: 'production',
        RESTORED_TAG: 'v1.2.2',
      });
      expect(unreachableLiveRes.status).toBe(1);
      expect(unreachableLiveRes.outputs.health_status).toBe('unhealthy');

      // Explicit dry-run validation passes when SERVICE_URL is omitted or unreachable
      const fastDryProbeScript = healthProbeScript
        .replace('DELAY=2', 'DELAY=1')
        .replace('ELAPSED -ge 2', 'ELAPSED -ge 0');
      const dryProbeRes = await runBashStepAsync(fastDryProbeScript, {
        VAR_SERVICE_URL: '',
        ENV_SERVICE_URL: '',
        PROVIDER_SERVICE_URL: '',
        IS_DRY_RUN: 'true',
        TARGET_ENV: 'staging',
        RESTORED_TAG: 'latest',
      });
      expect(dryProbeRes.status).toBe(0);
      expect(dryProbeRes.outputs.health_status).toBe('healthy');
      expect(dryProbeRes.outputs.service_url).toBe('http://127.0.0.1:3000');
    });

    it('gates $GITHUB_STEP_SUMMARY reporting on upstream outcomes so failures log FAILED and exit non-zero', () => {
      const successReport = runBashStep(reportScript, {
        TARGET_ENV: 'production',
        ROLLBACK_ENV: 'production-rollback',
        PREVIOUS_TAG: 'v1.2.2',
        PROVIDER: 'google-cloud-run',
        REASON: 'Health probe failed',
        PREFLIGHT_RESULT: 'success',
        PREFLIGHT_FAILED_STAGE: '',
        DB_COMPAT_STATUS: 'verified',
        REDEPLOY_RESULT: 'success',
        VERIFY_RESULT: 'success',
        VERIFY_URL: 'https://wedding.example.com',
        VERIFY_HTTP_STATUS: '200',
      });
      expect(successReport.status).toBe(0);
      expect(successReport.summary).toContain('**Overall Rollback Status:** `SUCCESS`');

      const failureCases = [
        {
          name: 'validation error',
          env: {
            PREFLIGHT_RESULT: 'failure',
            PREFLIGHT_FAILED_STAGE: 'Input Validation',
            DB_COMPAT_STATUS: '',
            REDEPLOY_RESULT: 'skipped',
            VERIFY_RESULT: 'skipped',
          },
          expectedStage: 'Input Validation',
        },
        {
          name: 'lint:migrations failure',
          env: {
            PREFLIGHT_RESULT: 'failure',
            PREFLIGHT_FAILED_STAGE: 'Pre-Rollback Database Compatibility Gate (lint:migrations)',
            DB_COMPAT_STATUS: '',
            REDEPLOY_RESULT: 'skipped',
            VERIFY_RESULT: 'skipped',
          },
          expectedStage: 'Pre-Rollback Database Compatibility Gate (lint:migrations)',
        },
        {
          name: 'provider error',
          env: {
            PREFLIGHT_RESULT: 'success',
            PREFLIGHT_FAILED_STAGE: '',
            DB_COMPAT_STATUS: 'verified',
            REDEPLOY_RESULT: 'failure',
            VERIFY_RESULT: 'skipped',
          },
          expectedStage: 'Provider Container Redeployment (failure)',
        },
        {
          name: 'health probe failure',
          env: {
            PREFLIGHT_RESULT: 'success',
            PREFLIGHT_FAILED_STAGE: '',
            DB_COMPAT_STATUS: 'verified',
            REDEPLOY_RESULT: 'success',
            VERIFY_RESULT: 'failure',
          },
          expectedStage: 'Post-Rollback Health Verification (/api/health)',
        },
      ];

      for (const tc of failureCases) {
        const res = runBashStep(reportScript, {
          TARGET_ENV: 'production',
          ROLLBACK_ENV: 'production-rollback',
          PREVIOUS_TAG: 'v1.2.2',
          PROVIDER: 'google-cloud-run',
          REASON: 'Health probe failed',
          VERIFY_URL: 'https://wedding.example.com',
          VERIFY_HTTP_STATUS: '503',
          ...tc.env,
        });
        expect(res.status).toBe(1);
        expect(res.summary).toContain('**Overall Rollback Status:** `FAILED`');
        expect(res.summary).not.toContain('**Overall Rollback Status:** `SUCCESS`');
        expect(res.summary).toContain(`**Failed Stage:** \`${tc.expectedStage}\``);
      }
    });
  });
});
