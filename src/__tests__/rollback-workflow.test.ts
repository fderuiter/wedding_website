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

    it('keeps permissions: contents: read at the root of rollback.yml and avoids direct template interpolation in run blocks', () => {
      expect(rollbackYml).toMatch(/^permissions:\n\s+contents:\s*read/m);

      for (const [name, content] of [
        ['rollback.yml', rollbackYml],
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

    it('declares workflow_call secrets, rollback_environment input, and deploy-provider caller job in rollback.yml', () => {
      expect(rollbackYml).toContain('rollback_environment:');
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
      expect(rollbackYml).toContain('npm run lint:migrations');
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

    it('passes previous_image_tag, previous_image_digest, and provider from deploy.yml to rollback.yml without defaulting to latest', () => {
      expect(deployYml).toContain('needs.staging-deploy-provider.outputs.previous_image_tag');
      expect(deployYml).toContain('needs.production-deploy-provider.outputs.previous_image_tag');
      expect(deployYml).toContain('needs.staging-deploy-provider.outputs.previous_image_digest');
      expect(deployYml).toContain('needs.production-deploy-provider.outputs.previous_image_digest');
      expect(deployYml).not.toContain("previous_tag: ${{ inputs.previous_tag || 'latest' }}");
      expect(deployProviderYml).toContain('previous_image_tag:');
      expect(deployProviderYml).toContain('previous_image_digest:');
      expect(deployProviderYml).toContain('--fail-with-body');
      expect(rollbackYml).toContain(
        '  redeploy:\n    name: Redeploy Previous Validated Container Image\n    permissions:\n      contents: read\n      packages: read\n      attestations: read\n      id-token: write'
      );
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

        // OIDC Workload Identity Federation (no GCP_SA_KEY) on staging defaults to isolated wedding-website-staging
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
          GITHUB_TOKEN: '',
          GITHUB_REPOSITORY: '',
        });

        expect(oidcStagingRes.status).toBe(0);
        expect(oidcStagingRes.outputs.previous_image_digest).toBe(
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
        );
        expect(oidcStagingRes.outputs.cloud_run_service).toBe('wedding-website-staging');
        expect(oidcStagingRes.outputs.cloud_run_region).toBe('europe-west1');
        const loggedCalls = fs.readFileSync(gcloudLog, 'utf8');
        expect(loggedCalls).toContain(
          'run services describe wedding-website-staging --region=europe-west1 --project=oidc-project'
        );
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
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
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
