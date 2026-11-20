import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { parseDocument } from 'yaml';

const REPO_ROOT = path.resolve(__dirname, '../..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.github', 'workflows');
const DEPLOY_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy.yml');
const DEPLOY_PROVIDER_YML_PATH = path.join(WORKFLOWS_DIR, 'deploy-provider.yml');
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

  let tempDir: string;
  let binDir: string;
  let outputFile: string;
  let summaryFile: string;
  let callLogFile: string;

  const VALID_DIGEST = 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-provider-test-'));
    binDir = path.join(tempDir, 'bin');
    outputFile = path.join(tempDir, 'github_output.txt');
    summaryFile = path.join(tempDir, 'github_summary.md');
    callLogFile = path.join(tempDir, 'cli_calls.log');

    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(outputFile, '');
    fs.writeFileSync(summaryFile, '');
    fs.writeFileSync(callLogFile, '');

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
  process.stdout.write('Verification succeeded!\\n');
  process.exit(0);
}
process.exit(1);
`
    );
    fs.chmodSync(ghShim, 0o755);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function runBashStep(script: string, envOverrides: Record<string, string>) {
    return spawnSync('bash', ['-eo', 'pipefail', '-c', script], {
      cwd: tempDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
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

  it('keeps top-level permissions at contents: read and scopes attestations/packages read to deployment jobs', () => {
    expect(deployYml).toMatch(/^permissions:\n  contents: read\n/m);
    expect(deployProviderYml).toMatch(/^permissions:\n  contents: read\n/m);

    expect(deployProviderYml).toContain(
      '    permissions:\n      contents: read\n      packages: read\n      attestations: read'
    );
    expect(deployYml).toContain(
      '  staging-deploy-provider:\n    name: Staging Provider Deployment\n    permissions:\n      contents: read\n      packages: read\n      attestations: read'
    );
    expect(deployYml).toContain(
      '  production-deploy-provider:\n    name: Production Provider Deployment\n    permissions:\n      contents: read\n      packages: read\n      attestations: read'
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
    expect(fs.readFileSync(outputFile, 'utf8')).toContain('attestation_status=verified');

    const cliCalls = fs.readFileSync(callLogFile, 'utf8');
    expect(cliCalls).not.toContain('docker buildx imagetools inspect');
    expect(cliCalls).toContain(
      `gh attestation verify oci://${expectedUri} --owner OwnerOrg --signer-workflow OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml [token=present]`
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

  it('verifies deploy.yml health probes succeed under simulated runner secret output redaction with vars.SERVICE_URL or legacy secrets.SERVICE_URL', async () => {
    const stagingProbeScript = extractStepRunScript(deployYml, 'Execute Staging Health Probe Verification');
    const prodProbeScript = extractStepRunScript(deployYml, 'Execute Production Health Probe Verification');

    const server = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', database: 'connected' }));
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
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

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
  });
});
