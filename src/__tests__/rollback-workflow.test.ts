/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { execSync, spawn, spawnSync } from 'child_process';

const ROOT_DIR = process.cwd();
const DEPLOY_YML_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'deploy.yml');
const DEPLOY_PROVIDER_YML_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'deploy-provider.yml');
const ROLLBACK_YML_PATH = path.join(ROOT_DIR, '.github', 'workflows', 'rollback.yml');

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
      for (const secretName of ['GCP_SA_KEY', 'GCP_PROJECT_ID', 'DEPLOY_WEBHOOK_URL', 'SERVICE_URL']) {
        expect(rollbackYml).toMatch(new RegExp(`^\\s+${secretName}:\\s*$`, 'm'));
      }
      expect(rollbackYml).toContain('uses: ./.github/workflows/deploy-provider.yml');
      expect(rollbackYml).toContain('npm run lint:migrations');
      expect(rollbackYml).not.toContain('Container service successfully restored to previous image tag.');
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
        '  redeploy:\n    name: Redeploy Previous Validated Container Image\n    permissions:\n      contents: read\n      packages: read\n      attestations: read'
      );
    });
  });

  describe('deploy-provider.yml executable step behavior', () => {
    it('captures the currently serving Cloud Run image tag and digest before rollout (including digest-only revisions)', () => {
      const script = extractStepRunScript(deployProviderYml, 'Capture Active Image Tag Before Rollout');
      const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mock-gcloud-'));

      try {
        const mockGcloud = path.join(binDir, 'gcloud');
        fs.writeFileSync(
          mockGcloud,
          `#!/usr/bin/env bash
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

        const digestOnlyRes = runBashStep(script, {
          PATH: `${binDir}:${process.env.PATH || ''}`,
          MOCK_REVISION_IMAGE:
            'ghcr.io/example/wedding_website@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          PROVIDER: 'google-cloud-run',
          INCOMING_TAG: 'cccccccccccccccccccccccccccccccccccccccc',
          INCOMING_DIGEST: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
          CURRENT_SHA: 'cccccccccccccccccccccccccccccccccccccccc',
          DRY_RUN: 'false',
          GCP_SA_KEY: '{"project_id":"demo-project"}',
          GCP_PROJECT_ID: 'demo-project',
          GITHUB_TOKEN: '',
          GITHUB_REPOSITORY: '',
        });

        expect(digestOnlyRes.status).toBe(0);
        expect(digestOnlyRes.outputs.previous_image_digest).toBe(
          'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
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

    it('enforces --fail-with-body on generic webhook deployments and preserves dry-run output detection', async () => {
      const webhookScript = extractStepRunScript(deployProviderYml, 'Deploy via Generic Webhook Adapter');
      const resolveUrlScript = extractStepRunScript(deployProviderYml, 'Resolve Service URL Output');

      const dryRes = runBashStep(resolveUrlScript, {
        CLOUDRUN_URL: '',
        GCP_SA_KEY: '',
        DEPLOY_WEBHOOK_URL: '',
        INPUT_DRY_RUN: 'false',
        DEFAULT_SERVICE_URL: 'http://127.0.0.1:3000',
      });
      expect(dryRes.status).toBe(0);
      expect(dryRes.outputs.is_dry_run).toBe('true');

      let nextStatus = 500;
      let receivedBody = '';
      const server = http.createServer((req, res) => {
        let data = '';
        req.on('data', chunk => {
          data += chunk;
        });
        req.on('end', () => {
          receivedBody = data;
          res.writeHead(nextStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: nextStatus === 200, message: nextStatus === 200 ? 'deployed' : 'upstream failure' }));
        });
      });

      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;

      try {
        const failRes = await runBashStepAsync(webhookScript, {
          IMAGE_URI: 'ghcr.io/example/wedding_website:v1.2.3',
          TARGET_ENV: 'production',
          DEPLOY_WEBHOOK_URL: `http://127.0.0.1:${port}/deploy`,
        });
        expect(failRes.status).not.toBe(0);
        expect(failRes.stdout + failRes.stderr).toContain('upstream failure');

        nextStatus = 200;
        const okRes = await runBashStepAsync(webhookScript, {
          IMAGE_URI: 'ghcr.io/example/wedding_website:v1.2.3',
          TARGET_ENV: 'production',
          DEPLOY_WEBHOOK_URL: `http://127.0.0.1:${port}/deploy`,
        });
        expect(okRes.status).toBe(0);
        expect(JSON.parse(receivedBody)).toEqual({
          image: 'ghcr.io/example/wedding_website:v1.2.3',
          environment: 'production',
        });
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

    it('polls /api/health to verify HTTP 200 with .data.status=="ok" and .data.database=="connected"', async () => {
      let attempt = 0;
      let mode: 'recover' | 'degraded' | 'unwrapped' = 'recover';

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
            res.end(JSON.stringify({ success: false, error: 'Database unreachable' }));
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
      const fastProbeScript = healthProbeScript.replace('MAX_TIMEOUT=55', 'MAX_TIMEOUT=2').replace('DELAY=2', 'DELAY=1');

      try {
        const okRes = await runBashStepAsync(fastProbeScript, {
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
        const unwrappedRes = await runBashStepAsync(fastProbeScript, {
          ENV_SERVICE_URL: `http://127.0.0.1:${port}`,
          PROVIDER_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(unwrappedRes.status).toBe(1);
        expect(unwrappedRes.outputs.health_status).toBe('unhealthy');

        mode = 'degraded';
        attempt = 0;
        const failRes = await runBashStepAsync(fastProbeScript, {
          ENV_SERVICE_URL: `http://127.0.0.1:${port}`,
          PROVIDER_SERVICE_URL: '',
          IS_DRY_RUN: 'false',
          TARGET_ENV: 'production',
          RESTORED_TAG: 'v1.2.2',
        });
        expect(failRes.status).toBe(1);
        expect(failRes.outputs.health_status).toBe('unhealthy');
      } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
      }
    }, 15000);

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
