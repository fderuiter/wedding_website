/**
 * @jest-environment node
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
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
  const migrateWorkflow = readWorkflow('db-migrate.yml');
  const deployProviderWorkflow = readWorkflow('deploy-provider.yml');
  const rollbackWorkflow = readWorkflow('rollback.yml');

  it('preserves CI workflow triggers, job names, upstream action-pin verification, and zero-secret execution', () => {
    expect(ciWorkflow).toContain('name: CI');
    const onSection = extractTopLevelSection(ciWorkflow, 'on');
    expect(onSection).toContain('push:');
    expect(onSection).toContain('branches: [ main ]');
    expect(onSection).toContain('pull_request:');

    for (const jobId of ['verify:', 'unit-test:', 'build:', 'e2e-test:', 'deploy-docs:']) {
      expect(ciWorkflow).toContain(`  ${jobId}`);
    }
    expect(ciWorkflow).toContain('GITHUB_TOKEN: ${{ github.token }}');
    expect(ciWorkflow).toContain('run: npm run check:action-pins -- --verify-upstream');
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

  it('scopes top-level permissions to contents: read and restricts write/actions/deployments permissions to individual jobs', () => {
    for (const [name, content] of [
      ['publish-artifact.yml', publishWorkflow],
      ['deploy.yml', deployWorkflow],
      ['db-migrate.yml', migrateWorkflow],
      ['deploy-provider.yml', deployProviderWorkflow],
      ['rollback.yml', rollbackWorkflow],
    ] as const) {
      const topPermissions = extractTopLevelSection(content, 'permissions');
      expect({ name, topPermissions }).toEqual({
        name,
        topPermissions: expect.stringMatching(/^permissions:\s*\n\s+contents:\s*read\s*$/),
      });
    }

    const [buildJobSection = '', publishJobSection = ''] = publishWorkflow.split(/\n  publish:\n/);

    // Job build retains only contents: read and security-events: write, with zero registry credentials
    expect(buildJobSection).toMatch(
      /build:\n[\s\S]*?permissions:\n\s+contents: read\n\s+security-events: write\n\s+strategy:/
    );
    expect(buildJobSection).not.toContain('packages: write');
    expect(buildJobSection).not.toContain('id-token: write');
    expect(buildJobSection).not.toContain('attestations: write');
    expect(buildJobSection).not.toContain('docker/login-action');
    expect(buildJobSection).not.toContain('DOCKERHUB_USERNAME');
    expect(buildJobSection).not.toContain('DOCKERHUB_TOKEN');

    // Job publish scopes registry write + OIDC provenance signing and drops unused security-events: write
    expect(publishJobSection).toMatch(
      /permissions:\n\s+contents: read\n\s+packages: write\n\s+id-token: write\n\s+attestations: write\n\s+outputs:/
    );
    expect(publishJobSection).not.toContain('security-events: write');

    // Caller deploy.yml retains union of callee-required permissions for publish-artifact workflow_call
    expect(deployWorkflow).toMatch(
      /publish-artifact:\n[\s\S]*?permissions:\n\s+contents: read\n\s+packages: write\n\s+security-events: write\n\s+id-token: write\n\s+attestations: write/
    );

    // actions: read in deploy.yml lives strictly inside ci-gate
    const actionsReadMatches = deployWorkflow.match(/actions:\s*read/g) ?? [];
    expect(actionsReadMatches).toHaveLength(1);
    expect(deployWorkflow).toMatch(/ci-gate:[\s\S]*?permissions:\n\s+actions: read/);

    // deployments: read lives strictly at job scope in caller jobs and deploy-provider.yml
    expect(deployWorkflow.match(/deployments:\s*read/g) ?? []).toHaveLength(4);
    expect(deployProviderWorkflow.match(/deployments:\s*read/g) ?? []).toHaveLength(1);
    expect(rollbackWorkflow.match(/deployments:\s*read/g) ?? []).toHaveLength(1);
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

  it('verifies a completed successful CI run for github.sha on workflow_dispatch and workflow_call and propagates resolved target_sha', () => {
    // Preflight gate checks ci.yml runs for targetSha on manual/reusable invocations
    expect(deployWorkflow).toContain("workflow_id: 'ci.yml'");
    expect(deployWorkflow).toContain('WORKFLOW_RUN_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}');
    expect(deployWorkflow).toContain('CURRENT_SHA: ${{ github.sha }}');

    // Resolved SHA aligned in schema-compatibility only on workflow_run after ancestry check (preventing default-branch cache poisoning on workflow_dispatch) and passed to workflow calls
    expect(deployWorkflow).not.toContain('ref: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(deployWorkflow).toMatch(
      /schema-compatibility:[\s\S]*?fetch-depth:\s*0[\s\S]*?if:\s*github\.event_name == 'workflow_run'[\s\S]*?TARGET_SHA:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}[\s\S]*?git merge-base --is-ancestor "\$TARGET_SHA" HEAD[\s\S]*?git checkout --detach "\$TARGET_SHA"/
    );
    expect(deployWorkflow).toContain('commit_sha: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(
      deployWorkflow.match(/commit_sha:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}/g) ?? []
    ).toHaveLength(7);
    expect(deployWorkflow).toMatch(
      /staging-deploy-provider:[\s\S]*?commit_sha:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}/
    );
    expect(deployWorkflow).toMatch(
      /staging-rollback:[\s\S]*?needs:\s*\[ci-gate,\s*publish-artifact,\s*staging-deploy-provider,\s*staging-verify-deployment\][\s\S]*?commit_sha:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}/
    );
    expect(deployWorkflow).toMatch(
      /production-deploy-provider:[\s\S]*?commit_sha:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}/
    );
    expect(deployWorkflow).toMatch(
      /production-rollback:[\s\S]*?needs:\s*\[ci-gate,\s*publish-artifact,\s*production-deploy-provider,\s*production-verify-deployment\][\s\S]*?commit_sha:\s*\$\{\{\s*needs\.ci-gate\.outputs\.target_sha\s*\}\}/
    );
    expect(deployWorkflow).toContain('tag_name: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(deployWorkflow).not.toContain('|| github.sha');

    expect(publishWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
    expect(publishWorkflow).toContain('INPUT_COMMIT_SHA: ${{ inputs.commit_sha }}');
    expect(migrateWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
    expect(deployProviderWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
    expect(deployProviderWorkflow).toContain('fetch-depth: 2');
    expect(deployProviderWorkflow).toContain('CURRENT_SHA: ${{ inputs.commit_sha || github.sha }}');
    expect(rollbackWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
    expect(rollbackWorkflow).toContain('CURRENT_SHA: ${{ inputs.commit_sha || github.sha }}');
    expect(rollbackWorkflow).toContain("commit_sha: ${{ inputs.commit_sha || '' }}");
  });

  it('passes event fields and inputs via env variables with zero direct ${{ ... }} interpolation in run scripts', () => {
    for (const [name, content] of [
      ['deploy.yml', deployWorkflow],
      ['publish-artifact.yml', publishWorkflow],
      ['db-migrate.yml', migrateWorkflow],
      ['deploy-provider.yml', deployProviderWorkflow],
      ['rollback.yml', rollbackWorkflow],
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

  it('publishes GITHUB_REF_NAME alongside commit SHA when triggered by a v* tag push in publish-artifact.yml', () => {
    const runBlocks = extractRunBlocks(publishWorkflow);
    const computeTagScript = runBlocks.find((block) => block.includes('primary_uri='));
    expect(computeTagScript).toBeDefined();

    const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-tag-test-'));
    const outputFile = path.join(tempOutDir, 'github_output.txt');
    const sampleSha = '0123456789abcdef0123456789abcdef01234567';

    try {
      fs.writeFileSync(outputFile, '');
      const tagRes = spawnSync('bash', ['-eo', 'pipefail', '-c', computeTagScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          REGISTRY: 'ghcr.io',
          GITHUB_REPOSITORY: 'FdeRuiter/Wedding_Website',
          GITHUB_SHA: sampleSha,
          GITHUB_REF: 'refs/tags/v0.1.0',
          GITHUB_REF_NAME: 'v0.1.0',
          RAW_INPUT_TAG: '',
          INPUT_COMMIT_SHA: '',
          DOCKERHUB_USERNAME: 'fderuiter',
          DOCKERHUB_TOKEN: 'dckr_pat_test',
        },
      });
      expect(tagRes.status).toBe(0);

      const outputs = fs.readFileSync(outputFile, 'utf8');
      expect(outputs).toContain('tag_name=v0.1.0');
      expect(outputs).toContain('primary_uri=ghcr.io/fderuiter/wedding_website:v0.1.0');
      expect(outputs).toContain(
        `tags=ghcr.io/fderuiter/wedding_website:v0.1.0,ghcr.io/fderuiter/wedding_website:${sampleSha},ghcr.io/fderuiter/wedding_website:latest,fderuiter/wedding-website:v0.1.0,fderuiter/wedding-website:${sampleSha},fderuiter/wedding-website:latest`
      );

      // Verify pre-release v* tag publishes version + SHA without overwriting :latest on either registry
      fs.writeFileSync(outputFile, '');
      const preReleaseRes = spawnSync('bash', ['-eo', 'pipefail', '-c', computeTagScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          REGISTRY: 'ghcr.io',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_SHA: sampleSha,
          GITHUB_REF: 'refs/tags/v0.2.0-rc.1',
          GITHUB_REF_NAME: 'v0.2.0-rc.1',
          RAW_INPUT_TAG: '',
          INPUT_COMMIT_SHA: '',
          DOCKERHUB_USERNAME: 'fderuiter',
          DOCKERHUB_TOKEN: 'dckr_pat_test',
        },
      });
      expect(preReleaseRes.status).toBe(0);
      const preReleaseOutputs = fs.readFileSync(outputFile, 'utf8');
      expect(preReleaseOutputs).toContain(
        `tags=ghcr.io/fderuiter/wedding_website:v0.2.0-rc.1,ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:v0.2.0-rc.1,fderuiter/wedding-website:${sampleSha}`
      );
      expect(preReleaseOutputs).not.toContain(':latest');

      // Verify branch dispatch with Docker Hub credentials never overwrites :latest on GHCR or Docker Hub
      fs.writeFileSync(outputFile, '');
      const branchDispatchRes = spawnSync('bash', ['-eo', 'pipefail', '-c', computeTagScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          REGISTRY: 'ghcr.io',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_SHA: sampleSha,
          GITHUB_REF: 'refs/heads/feature/test-branch',
          GITHUB_REF_NAME: 'feature/test-branch',
          RAW_INPUT_TAG: '',
          INPUT_COMMIT_SHA: '',
          DOCKERHUB_USERNAME: 'fderuiter',
          DOCKERHUB_TOKEN: 'dckr_pat_test',
        },
      });
      expect(branchDispatchRes.status).toBe(0);
      const branchOutputs = fs.readFileSync(outputFile, 'utf8');
      expect(branchOutputs).toContain(
        `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
      );
      expect(branchOutputs).not.toContain(':latest');

      // Verify workflow_call with explicit commit SHA tag publishes only the SHA tag
      fs.writeFileSync(outputFile, '');
      const shaRes = spawnSync('bash', ['-eo', 'pipefail', '-c', computeTagScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          REGISTRY: 'ghcr.io',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_SHA: sampleSha,
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          RAW_INPUT_TAG: sampleSha,
          INPUT_COMMIT_SHA: sampleSha,
          DOCKERHUB_USERNAME: 'fderuiter',
          DOCKERHUB_TOKEN: 'dckr_pat_test',
        },
      });
      expect(shaRes.status).toBe(0);
      const shaOutputs = fs.readFileSync(outputFile, 'utf8');
      expect(shaOutputs).toContain(`tag_name=${sampleSha}`);
      expect(shaOutputs).toContain(
        `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
      );
      expect(shaOutputs).not.toContain(':latest');
    } finally {
      fs.rmSync(tempOutDir, { recursive: true, force: true });
    }
  });

  it('builds, Trivy-scans, and smoke-tests native amd64 and arm64 OCI archives once without registry credentials before verifying and publishing provenance-attested multi-platform indexes', () => {
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

    // Verify build job compiles once as an OCI archive with provenance: false & sbom: false, loads wedding-website:latest, scans, smoke-tests, and uploads zstd archive without registry login
    const buildJobSection = publishWorkflow.split(/\n  publish:\n/)[0] ?? '';
    expect(buildJobSection.match(/uses:\s*docker\/build-push-action@/g)).toHaveLength(1);
    expect(buildJobSection).toContain('provenance: false');
    expect(buildJobSection).toContain('sbom: false');
    expect(buildJobSection).toContain('outputs: type=oci,dest=/tmp/oci-${{ matrix.arch }}.tar');
    expect(buildJobSection).not.toContain('push-by-digest=true');
    expect(buildJobSection).not.toContain('docker/login-action');

    const buildArchiveIdx = buildJobSection.indexOf('outputs: type=oci,dest=/tmp/oci-${{ matrix.arch }}.tar');
    const loadDaemonIdx = buildJobSection.indexOf('skopeo copy "oci-archive:${OCI_TAR}" "docker-daemon:wedding-website:latest"');
    const trivyIdx = buildJobSection.indexOf('aquasecurity/trivy-action');
    const sarifIdx = buildJobSection.indexOf('github/codeql-action/upload-sarif');
    const smokeIdx = buildJobSection.indexOf('node scripts/test-container.mjs');
    const compressIdx = buildJobSection.indexOf('zstd -T0 -f "$OCI_TAR"');
    const uploadArtifactIdx = buildJobSection.indexOf('actions/upload-artifact@');

    expect(buildArchiveIdx).toBeGreaterThan(-1);
    expect(loadDaemonIdx).toBeGreaterThan(buildArchiveIdx);
    expect(trivyIdx).toBeGreaterThan(loadDaemonIdx);
    expect(sarifIdx).toBeGreaterThan(trivyIdx);
    expect(smokeIdx).toBeGreaterThan(sarifIdx);
    expect(compressIdx).toBeGreaterThan(smokeIdx);
    expect(uploadArtifactIdx).toBeGreaterThan(compressIdx);

    expect(buildJobSection).toContain('image-ref: wedding-website:latest');
    expect(buildJobSection).toContain("severity: 'CRITICAL,HIGH'");
    expect(buildJobSection).toContain("exit-code: '1'");
    expect(buildJobSection).toContain("category: 'trivy-${{ matrix.arch }}'");
    expect(buildJobSection).toContain('compression-level: 0');

    // Verify publish job step ordering: download -> login -> skopeo inspect & copy --preserve-digests -> merge -> v4.2.2 primary & secondary attestations
    const publishJobSection = publishWorkflow.split(/\n  publish:\n/)[1] ?? '';
    expect(publishJobSection).toContain('needs: [build]');

    const downloadIdx = publishJobSection.indexOf('actions/download-artifact@');
    const ghcrLoginIdx = publishJobSection.indexOf('registry: ghcr.io');
    const skopeoInspectIdx = publishJobSection.indexOf("skopeo inspect --format '{{.Digest}}'");
    const skopeoCopyIdx = publishJobSection.indexOf('skopeo copy --preserve-digests');
    const mergeIdx = publishJobSection.indexOf('docker buildx imagetools create');
    const primaryAttestIdx = publishJobSection.indexOf('- name: Attest Build Provenance');
    const secondaryAttestIdx = publishJobSection.indexOf(
      '- name: Attest Docker Hub Build Provenance (optional)'
    );

    expect(downloadIdx).toBeGreaterThan(-1);
    expect(ghcrLoginIdx).toBeGreaterThan(downloadIdx);
    expect(skopeoInspectIdx).toBeGreaterThan(ghcrLoginIdx);
    expect(skopeoCopyIdx).toBeGreaterThan(skopeoInspectIdx);
    expect(mergeIdx).toBeGreaterThan(skopeoCopyIdx);
    expect(primaryAttestIdx).toBeGreaterThan(mergeIdx);
    expect(secondaryAttestIdx).toBeGreaterThan(primaryAttestIdx);

    expect(publishJobSection).not.toContain('c0744595e72338575084a4bf85ed76e1eb521ddf');
    expect(
      publishJobSection.match(
        /uses:\s*actions\/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4\.2\.2/g
      )
    ).toHaveLength(2);
    expect(publishJobSection).toContain('subject-name: docker.io/${{ steps.meta.outputs.dockerhub_repository }}');
    expect(publishJobSection).toContain('subject-digest: ${{ steps.merge.outputs.dockerhub_digest }}');
    expect(publishJobSection).toContain('create-storage-record: false');
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

  it('re-verifies compressed OCI archive digests with skopeo inspect before pushing with skopeo copy --preserve-digests and halts before any upload on digest mismatch', () => {
    const runBlocks = extractRunBlocks(publishWorkflow);
    const verifyAndPushScript = runBlocks.find((block) =>
      block.includes('skopeo copy --preserve-digests')
    );
    expect(verifyAndPushScript).toBeDefined();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-oci-handoff-test-'));
    const binDir = path.join(tempDir, 'bin');
    const handoffDir = path.join('/tmp', 'oci-handoff');
    const digestsDir = path.join('/tmp', 'digests');
    const callsFile = path.join(tempDir, 'skopeo_calls.log');

    const amd64Digest = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
    const arm64Digest = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';
    const tamperedDigest = 'sha256:9999999999999999999999999999999999999999999999999999999999999999';

    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.rmSync(handoffDir, { recursive: true, force: true });
      fs.rmSync(digestsDir, { recursive: true, force: true });
      fs.mkdirSync(handoffDir, { recursive: true });
      fs.writeFileSync(path.join(handoffDir, 'amd64.digest'), `${amd64Digest}\n`);
      fs.writeFileSync(path.join(handoffDir, 'arm64.digest'), `${arm64Digest}\n`);
      fs.writeFileSync(path.join(handoffDir, 'oci-amd64.tar.zst'), 'compressed-amd64');
      fs.writeFileSync(path.join(handoffDir, 'oci-arm64.tar.zst'), 'compressed-arm64');
      fs.writeFileSync(callsFile, '');

      const zstdShim = path.join(binDir, 'zstd');
      fs.writeFileSync(
        zstdShim,
        `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const outIdx = args.indexOf('-o');
if (args.includes('-d') && outIdx !== -1 && args[outIdx + 1]) {
  fs.writeFileSync(args[outIdx + 1], 'decompressed-oci-tar');
  process.exit(0);
}
process.exit(1);
`,
        { mode: 0o755 }
      );

      const skopeoShim = path.join(binDir, 'skopeo');
      fs.writeFileSync(
        skopeoShim,
        `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsFile)}, args.join(' ') + '\\n');
if (args[0] === 'inspect') {
  const target = args[args.length - 1] || '';
  if (target.includes('oci-amd64.tar')) {
    process.stdout.write('${amd64Digest}\\n');
    process.exit(0);
  }
  if (target.includes('oci-arm64.tar')) {
    process.stdout.write((process.env.TAMPER_ARM64 === 'true' ? '${tamperedDigest}' : '${arm64Digest}') + '\\n');
    process.exit(0);
  }
}
if (args[0] === 'copy') {
  process.exit(0);
}
process.exit(1);
`,
        { mode: 0o755 }
      );

      // 1. Tampered arm64 archive fails closed BEFORE any skopeo copy upload occurs (even for amd64)
      const tamperRes = spawnSync('bash', ['-eo', 'pipefail', '-c', verifyAndPushScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
          TAMPER_ARM64: 'true',
        },
      });
      expect(tamperRes.status).not.toBe(0);
      expect(tamperRes.stdout + tamperRes.stderr).toContain('OCI archive digest mismatch');
      expect(fs.readFileSync(callsFile, 'utf8')).not.toContain('copy --preserve-digests');

      // 2. Valid amd64 + arm64 archives push via skopeo copy --preserve-digests to GHCR and docker.io/
      fs.writeFileSync(callsFile, '');
      const okRes = spawnSync('bash', ['-eo', 'pipefail', '-c', verifyAndPushScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
        },
      });
      expect(okRes.status).toBe(0);
      const calls = fs.readFileSync(callsFile, 'utf8');
      expect(calls).toContain(
        `copy --preserve-digests oci-archive:/tmp/oci-handoff/oci-amd64.tar docker://ghcr.io/fderuiter/wedding_website@${amd64Digest}`
      );
      expect(calls).toContain(
        `copy --preserve-digests oci-archive:/tmp/oci-handoff/oci-amd64.tar docker://docker.io/fderuiter/wedding-website@${amd64Digest}`
      );
      expect(calls).toContain(
        `copy --preserve-digests oci-archive:/tmp/oci-handoff/oci-arm64.tar docker://ghcr.io/fderuiter/wedding_website@${arm64Digest}`
      );
      expect(calls).toContain(
        `copy --preserve-digests oci-archive:/tmp/oci-handoff/oci-arm64.tar docker://docker.io/fderuiter/wedding-website@${arm64Digest}`
      );
    } finally {
      fs.rmSync(handoffDir, { recursive: true, force: true });
      fs.rmSync(digestsDir, { recursive: true, force: true });
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('merges verified amd64 and arm64 digests into multi-platform OCI indexes on GHCR and Docker Hub and fails closed if either architecture manifest is missing', () => {
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
    process.stdout.write(JSON.stringify({ manifests }));
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
        },
      });
      expect(okRes.status).toBe(0);
      const mergeOutputs = fs.readFileSync(outputFile, 'utf8');
      expect(mergeOutputs).toContain(`digest=${mergedDigest}`);
      expect(mergeOutputs).toContain(`dockerhub_digest=${mergedDigest}`);

      const calls = fs.readFileSync(callsFile, 'utf8');
      expect(calls).toContain(
        `buildx imagetools create --tag ghcr.io/fderuiter/wedding_website:v0.1.0 --tag ghcr.io/fderuiter/wedding_website:latest ghcr.io/fderuiter/wedding_website@${amd64Digest} ghcr.io/fderuiter/wedding_website@${arm64Digest}`
      );
      expect(calls).toContain(
        `buildx imagetools create --tag fderuiter/wedding-website:v0.1.0 --tag fderuiter/wedding-website:latest fderuiter/wedding-website@${amd64Digest} fderuiter/wedding-website@${arm64Digest}`
      );
      expect(calls).toContain(
        'buildx imagetools inspect --format {{.Manifest.Digest}} fderuiter/wedding-website:v0.1.0'
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
          OMIT_ARM64: 'true',
        },
      });
      expect(failRes.status).not.toBe(0);
    } finally {
      fs.rmSync(digestsDir, { recursive: true, force: true });
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves target_sha from release_ref or image_digest OIDC provenance and checks out the tag commit in schema-compatibility', async () => {
    const http = await import('http');
    const { spawn } = await import('child_process');
    const runBashAsync = (
      script: string,
      options: { cwd?: string; env: NodeJS.ProcessEnv }
    ): Promise<{ status: number | null; stdout: string; stderr: string }> =>
      new Promise((resolve) => {
        const child = spawn('bash', ['-eo', 'pipefail', '-c', script], {
          cwd: options.cwd,
          env: options.env,
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('close', (code) => {
          resolve({ status: code, stdout, stderr });
        });
      });

    const runBlocks = extractRunBlocks(deployWorkflow);
    const resolveShaScript = runBlocks.find((block) => block.includes('REF_RESOLVED_SHA='));
    const alignWorkspaceScript = runBlocks.find((block) => block.includes('git checkout --detach "$TARGET_SHA"'));
    expect(resolveShaScript).toBeDefined();
    expect(alignWorkspaceScript).toBeDefined();

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-release-ref-test-'));
    const binDir = path.join(tempDir, 'bin');
    const repoDir = path.join(tempDir, 'repo');
    const outputFile = path.join(tempDir, 'github_output.txt');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(repoDir, { recursive: true });

    // Create real git repo where v0.1.0 is tagged on an earlier commit and main HEAD has a newer migration
    spawnSync('git', ['init', '-b', 'main'], { cwd: repoDir });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
    fs.mkdirSync(path.join(repoDir, 'prisma', 'migrations', '0001_v010'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'prisma', 'migrations', '0001_v010', 'migration.sql'), 'SELECT 1;');
    spawnSync('git', ['add', '.'], { cwd: repoDir });
    spawnSync('git', ['commit', '-m', 'v0.1.0 release'], { cwd: repoDir });
    const v010Sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim();
    spawnSync('git', ['tag', '-a', 'v0.1.0', '-m', 'Release v0.1.0'], { cwd: repoDir });

    fs.mkdirSync(path.join(repoDir, 'prisma', 'migrations', '0002_unreleased_main'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, 'prisma', 'migrations', '0002_unreleased_main', 'migration.sql'),
      'ALTER TABLE "Guest" ADD COLUMN "futureField" TEXT;'
    );
    spawnSync('git', ['add', '.'], { cwd: repoDir });
    spawnSync('git', ['commit', '-m', 'unreleased main migration'], { cwd: repoDir });
    const mainHeadSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim();
    expect(v010Sha).not.toBe(mainHeadSha);

    const sampleDigest = 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const otherDigest = 'sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

    const ghShim = path.join(binDir, 'gh');
    fs.writeFileSync(
      ghShim,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'attestation' && args[1] === 'verify' && args.includes('--format') && args.includes('json')) {
  const uri = args[2] || '';
  if (uri.endsWith('@${sampleDigest}')) {
    process.stdout.write(JSON.stringify([
      {
        verificationResult: {
          statement: {
            predicate: {
              buildDefinition: {
                resolvedDependencies: [
                  {
                    uri: 'git+https://github.com/fderuiter/wedding_website@refs/tags/v0.1.0',
                    digest: { gitCommit: '${v010Sha}' }
                  }
                ]
              }
            }
          }
        }
      }
    ]));
    process.exit(0);
  }
  if (uri.endsWith('@${otherDigest}')) {
    process.stdout.write(JSON.stringify([
      {
        verificationResult: {
          statement: {
            predicate: {
              buildDefinition: {
                resolvedDependencies: [
                  { digest: { gitCommit: '${mainHeadSha}' } }
                ]
              }
            }
          }
        }
      }
    ]));
    process.exit(0);
  }
}
process.exit(1);
`,
      { mode: 0o755 }
    );

    const apiServer = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/repos/fderuiter/wedding_website/commits/v0.1.0') {
        res.writeHead(200);
        res.end(JSON.stringify({ sha: v010Sha }));
        return;
      }
      res.writeHead(404);
      res.end(JSON.stringify({ message: 'Not Found' }));
    });
    await new Promise<void>((resolve) => apiServer.listen(0, '127.0.0.1', () => resolve()));
    const addr = apiServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    try {
      // 1. Dispatching with release_ref: v0.1.0 resolves target_sha to v0.1.0's commit instead of main HEAD
      fs.writeFileSync(outputFile, '');
      const refRes = await runBashAsync(resolveShaScript!, {
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
          GH_TOKEN: 'ghs_test_token',
          REPO_OWNER: 'fderuiter',
          SIGNER_WORKFLOW: 'fderuiter/wedding_website/.github/workflows/publish-artifact.yml',
          EVENT_NAME: 'workflow_dispatch',
          WORKFLOW_RUN_HEAD_SHA: '',
          CURRENT_SHA: mainHeadSha,
          RELEASE_REF: 'v0.1.0',
          IMAGE_DIGEST: '',
        },
      });
      expect(refRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${v010Sha}`);

      // 2. Dispatching with image_digest resolves target_sha from OIDC provenance attestation JSON
      fs.writeFileSync(outputFile, '');
      const digestRes = await runBashAsync(resolveShaScript!, {
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
          GH_TOKEN: 'ghs_test_token',
          REPO_OWNER: 'fderuiter',
          SIGNER_WORKFLOW: 'fderuiter/wedding_website/.github/workflows/publish-artifact.yml',
          EVENT_NAME: 'workflow_dispatch',
          WORKFLOW_RUN_HEAD_SHA: '',
          CURRENT_SHA: mainHeadSha,
          RELEASE_REF: '',
          IMAGE_DIGEST: sampleDigest,
        },
      });
      expect(digestRes.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(`target_sha=${v010Sha}`);

      // 3. Mismatched release_ref + image_digest fails closed
      const mismatchRes = await runBashAsync(resolveShaScript!, {
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_API_URL: `http://127.0.0.1:${port}`,
          GH_TOKEN: 'ghs_test_token',
          REPO_OWNER: 'fderuiter',
          SIGNER_WORKFLOW: 'fderuiter/wedding_website/.github/workflows/publish-artifact.yml',
          EVENT_NAME: 'workflow_dispatch',
          WORKFLOW_RUN_HEAD_SHA: '',
          CURRENT_SHA: mainHeadSha,
          RELEASE_REF: 'v0.1.0',
          IMAGE_DIGEST: otherDigest,
        },
      });
      expect(mismatchRes.status).not.toBe(0);
      expect(mismatchRes.stdout + mismatchRes.stderr).toContain('Commit mismatch');

      // 4. schema-compatibility Align Workspace to Verified Commit SHA checks out v0.1.0 commit (excluding unreleased main migration)
      const alignRes = await runBashAsync(alignWorkspaceScript!, {
        cwd: repoDir,
        env: {
          ...process.env,
          EVENT_NAME: 'workflow_dispatch',
          GITHUB_REF: 'refs/heads/main',
          TARGET_SHA: v010Sha,
        },
      });
      expect(alignRes.status).toBe(0);
      const checkedOutHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim();
      expect(checkedOutHead).toBe(v010Sha);
      expect(fs.existsSync(path.join(repoDir, 'prisma', 'migrations', '0002_unreleased_main'))).toBe(false);
    } finally {
      await new Promise<void>((resolve) => apiServer.close(() => resolve()));
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
