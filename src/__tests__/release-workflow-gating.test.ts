/**
 * @jest-environment node
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseDocument } from 'yaml';

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

  it('preserves CI workflow triggers, job names, and zero-secret execution', () => {
    expect(ciWorkflow).toContain('name: CI');
    const onSection = extractTopLevelSection(ciWorkflow, 'on');
    expect(onSection).toContain('push:');
    expect(onSection).toContain('branches: [ main ]');
    expect(onSection).toContain('pull_request:');

    for (const jobId of ['verify:', 'unit-test:', 'build:', 'container-arm64:', 'e2e-test:', 'deploy-docs:']) {
      expect(ciWorkflow).toContain(`  ${jobId}`);
    }
    expect(ciWorkflow).not.toContain('secrets.');

    const trivyMatches =
      ciWorkflow.match(/aquasecurity\/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25/g) ?? [];
    expect(trivyMatches).toHaveLength(2);

    const buildSection = ciWorkflow.split(/\n  container-arm64:\n/)[0]?.split(/\n  build:\n/)[1] ?? '';
    const arm64Section = ciWorkflow.split(/\n  storybook-build:\n/)[0]?.split(/\n  container-arm64:\n/)[1] ?? '';
    for (const section of [buildSection, arm64Section]) {
      expect(section).toContain('aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25');
      expect(section).toContain('image-ref: wedding-website:latest');
      expect(section).toContain("severity: 'CRITICAL,HIGH'");
      expect(section).toContain("exit-code: '1'");
    }
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
      ['db-migrate.yml', migrateWorkflow],
    ] as const) {
      const topPermissions = extractTopLevelSection(content, 'permissions');
      expect({ name, topPermissions }).toEqual({
        name,
        topPermissions: expect.stringMatching(/^permissions:\s*\n\s+contents:\s*read\s*$/),
      });
    }

    // Write permissions in publish-artifact.yml live strictly inside build/publish jobs, and actions: read strictly inside preflight
    expect(publishWorkflow).toMatch(
      /preflight:\n[\s\S]*?permissions:\n\s+contents: read\n\s+actions: read/
    );
    expect(publishWorkflow.match(/actions:\s*read/g) ?? []).toHaveLength(1);
    expect(publishWorkflow).toMatch(
      /publish:\n[\s\S]*?permissions:\n\s+contents: read\n\s+packages: write\n\s+security-events: write\n\s+id-token: write\n\s+attestations: write/
    );

    // actions: read in deploy.yml lives strictly inside ci-gate and reusable-workflow caller jobs (never top-level)
    const actionsReadMatches = deployWorkflow.match(/actions:\s*read/g) ?? [];
    expect(actionsReadMatches).toHaveLength(6);
    expect(deployWorkflow).toMatch(/ci-gate:[\s\S]*?permissions:\n\s+actions: read/);

    // Shared release concurrency group prevents v* tag and main runs from racing on :latest or BuildKit caches
    const publishConcurrency = extractTopLevelSection(publishWorkflow, 'concurrency');
    expect(publishConcurrency).toContain('group: publish-artifact-release');
    expect(publishConcurrency).toContain('cancel-in-progress: false');
    expect(publishConcurrency).not.toContain('github.ref');
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
    expect(deployWorkflow).toContain('tag_name: ${{ needs.ci-gate.outputs.target_sha }}');
    expect(deployWorkflow).not.toContain('|| github.sha');

    expect(publishWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
    expect(publishWorkflow).toContain('INPUT_COMMIT_SHA: ${{ inputs.commit_sha }}');
    expect(migrateWorkflow).toContain('ref: ${{ inputs.commit_sha }}');
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

      // Verify manual workflow_dispatch on main with explicit commit_sha (empty tag_name) publishes ONLY the SHA tag and never overwrites :latest
      fs.writeFileSync(outputFile, '');
      const manualCommitShaRes = spawnSync('bash', ['-eo', 'pipefail', '-c', computeTagScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          REGISTRY: 'ghcr.io',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          RAW_INPUT_TAG: '',
          INPUT_COMMIT_SHA: sampleSha,
          DOCKERHUB_USERNAME: 'fderuiter',
          DOCKERHUB_TOKEN: 'dckr_pat_test',
        },
      });
      expect(manualCommitShaRes.status).toBe(0);
      const manualCommitShaOutputs = fs.readFileSync(outputFile, 'utf8');
      expect(manualCommitShaOutputs).toContain(`tag_name=${sampleSha}`);
      expect(manualCommitShaOutputs).toContain(
        `tags=ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:${sampleSha}`
      );
      expect(manualCommitShaOutputs).not.toContain(':latest');

      // Verify manual workflow_dispatch on main with explicit commit_sha and custom tag_name publishes custom + SHA tags and never :latest
      fs.writeFileSync(outputFile, '');
      const manualCustomTagRes = spawnSync('bash', ['-eo', 'pipefail', '-c', computeTagScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          REGISTRY: 'ghcr.io',
          GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          GITHUB_SHA: 'ffffffffffffffffffffffffffffffffffffffff',
          GITHUB_REF: 'refs/heads/main',
          GITHUB_REF_NAME: 'main',
          RAW_INPUT_TAG: 'hotfix-20261122',
          INPUT_COMMIT_SHA: sampleSha,
          DOCKERHUB_USERNAME: 'fderuiter',
          DOCKERHUB_TOKEN: 'dckr_pat_test',
        },
      });
      expect(manualCustomTagRes.status).toBe(0);
      const manualCustomTagOutputs = fs.readFileSync(outputFile, 'utf8');
      expect(manualCustomTagOutputs).toContain('tag_name=hotfix-20261122');
      expect(manualCustomTagOutputs).toContain(
        `tags=ghcr.io/fderuiter/wedding_website:hotfix-20261122,ghcr.io/fderuiter/wedding_website:${sampleSha},fderuiter/wedding-website:hotfix-20261122,fderuiter/wedding-website:${sampleSha}`
      );
      expect(manualCustomTagOutputs).not.toContain(':latest');

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

    // Verify single Buildx build exports local OCI archive, loads it, scans with Trivy, runs smoke test, and pushes scanned OCI archive by digest without rebuilding
    expect(publishWorkflow.match(/docker\/build-push-action@/g) ?? []).toHaveLength(1);
    const buildJobSection = publishWorkflow.split(/\n  publish:\n/)[0]?.split(/\n  build:\n/)[1] ?? '';
    expect(buildJobSection).toContain('needs: [preflight]');
    expect(buildJobSection).toContain('outputs: type=oci,dest=/tmp/wedding-website-${{ matrix.arch }}.oci.tar');
    expect(buildJobSection).toContain('input: /tmp/wedding-website-${{ matrix.arch }}.oci.tar');
    expect(buildJobSection).not.toContain('push-by-digest=true');

    const buildArchiveIdx = buildJobSection.indexOf('docker/build-push-action');
    const loadArchiveIdx = buildJobSection.indexOf('docker load -i "$OCI_ARCHIVE"');
    const trivyIdx = buildJobSection.indexOf('aquasecurity/trivy-action');
    const sarifIdx = buildJobSection.indexOf('github/codeql-action/upload-sarif');
    const smokeIdx = buildJobSection.indexOf('node scripts/test-container.mjs');
    const loginIdx = buildJobSection.indexOf('docker/login-action');
    const pushDigestIdx = buildJobSection.indexOf('--preserve-digests');

    expect(buildArchiveIdx).toBeGreaterThan(-1);
    expect(loadArchiveIdx).toBeGreaterThan(buildArchiveIdx);
    expect(trivyIdx).toBeGreaterThan(loadArchiveIdx);
    expect(sarifIdx).toBeGreaterThan(trivyIdx);
    expect(smokeIdx).toBeGreaterThan(sarifIdx);
    expect(loginIdx).toBeGreaterThan(smokeIdx);
    expect(pushDigestIdx).toBeGreaterThan(loginIdx);

    expect(buildJobSection).toContain("severity: 'CRITICAL,HIGH'");
    expect(buildJobSection).toContain("exit-code: '1'");
    expect(buildJobSection).toContain("category: 'trivy-${{ matrix.arch }}'");
    expect(buildJobSection).toContain('docker://${IMAGE_REPO}@${EXPECTED_DIGEST}');
    expect(buildJobSection).toContain('docker://docker.io/${DOCKERHUB_REPO}@${EXPECTED_DIGEST}');

    // Verify publish job merges per-architecture digests, verifies linux/amd64 & linux/arm64 manifests on GHCR and Docker Hub, attests provenance on both registries, and preserves outputs
    const publishJobSection = publishWorkflow.split(/\n  publish:\n/)[1] ?? '';
    expect(publishJobSection).toContain('needs: [build]');
    expect(publishJobSection).toContain('docker buildx imagetools create');
    expect(publishJobSection.match(/actions\/attest-build-provenance@/g) ?? []).toHaveLength(2);
    expect(publishJobSection).toContain('subject-name: docker.io/${{ steps.meta.outputs.dockerhub_repository }}');
    expect(publishJobSection).toContain('subject-digest: ${{ steps.merge.outputs.dockerhub_digest }}');
    expect(publishJobSection).toContain("if: steps.meta.outputs.dockerhub_repository != ''");
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
  const targetRef = args[args.length - 1] || '';
  const isDockerHub = targetRef.startsWith('docker.io/');
  if (args.includes('--raw')) {
    const omitArm =
      process.env.OMIT_ARM64 === 'true' ||
      (isDockerHub && process.env.OMIT_DOCKERHUB_ARM64 === 'true');
    const manifests = omitArm
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
        'buildx imagetools inspect --format {{.Manifest.Digest}} docker.io/fderuiter/wedding-website:v0.1.0'
      );
      expect(calls).toContain('buildx imagetools inspect --raw docker.io/fderuiter/wedding-website:v0.1.0');

      // Verify missing linux/arm64 manifest on Docker Hub also fails closed
      const dockerHubFailRes = spawnSync('bash', ['-eo', 'pipefail', '-c', mergeScript!], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: outputFile,
          IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
          DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
          TAG_NAME: 'v0.1.0',
          PRIMARY_URI: 'ghcr.io/fderuiter/wedding_website:v0.1.0',
          TAGS: 'ghcr.io/fderuiter/wedding_website:v0.1.0,fderuiter/wedding-website:v0.1.0',
          OMIT_DOCKERHUB_ARM64: 'true',
        },
      });
      expect(dockerHubFailRes.status).not.toBe(0);
      expect(dockerHubFailRes.stdout + dockerHubFailRes.stderr).toContain(
        "Published Docker Hub multi-platform index 'docker.io/fderuiter/wedding-website:v0.1.0' is missing linux/arm64 manifest"
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

  it('enforces origin/main ancestry and completed successful ci.yml run in publish-artifact.yml preflight before building', async () => {
    const parsed = parseDocument(publishWorkflow, { version: '1.2', strict: true }).toJS() as {
      jobs?: {
        preflight?: {
          steps?: Array<{ name?: string; run?: string; with?: { script?: string } }>;
        };
      };
    };
    const steps = parsed.jobs?.preflight?.steps ?? [];
    const ancestryStep = steps.find((s) => s.name === 'Verify Commit SHA & Main Branch Ancestry');
    const ciStep = steps.find((s) => s.name === 'Verify Successful CI Run for Commit');
    expect(ancestryStep?.run).toBeDefined();
    expect(ciStep?.with?.script).toBeDefined();

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-preflight-test-'));
    const bareOrigin = path.join(tempRoot, 'origin.git');
    const workRepo = path.join(tempRoot, 'work');
    const outputFile = path.join(tempRoot, 'github_output.txt');

    try {
      spawnSync('git', ['init', '--bare', bareOrigin], { stdio: 'pipe' });
      spawnSync('git', ['init', '-b', 'main', workRepo], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'config', 'user.email', 'ci@example.com'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'config', 'user.name', 'CI Bot'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'remote', 'add', 'origin', bareOrigin], { stdio: 'pipe' });

      fs.writeFileSync(path.join(workRepo, 'file.txt'), 'v1\n');
      spawnSync('git', ['-C', workRepo, 'add', 'file.txt'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'commit', '-m', 'c1'], { stdio: 'pipe' });
      const ancestorSha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

      fs.writeFileSync(path.join(workRepo, 'file.txt'), 'v2\n');
      spawnSync('git', ['-C', workRepo, 'add', 'file.txt'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'commit', '-m', 'c2'], { stdio: 'pipe' });
      const mainHeadSha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
      spawnSync('git', ['-C', workRepo, 'push', 'origin', 'main'], { stdio: 'pipe' });

      spawnSync('git', ['-C', workRepo, 'checkout', '-b', 'feature/unmerged', ancestorSha], { stdio: 'pipe' });
      fs.writeFileSync(path.join(workRepo, 'feature.txt'), 'unmerged\n');
      spawnSync('git', ['-C', workRepo, 'add', 'feature.txt'], { stdio: 'pipe' });
      spawnSync('git', ['-C', workRepo, 'commit', '-m', 'unmerged commit'], { stdio: 'pipe' });
      const unmergedSha = spawnSync('git', ['-C', workRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

      // Ancestor of origin/main succeeds
      fs.writeFileSync(outputFile, '');
      const okAncestor = spawnSync('bash', ['-eo', 'pipefail', '-c', ancestryStep!.run!], {
        cwd: workRepo,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          INPUT_COMMIT_SHA: ancestorSha,
          CURRENT_SHA: mainHeadSha,
        },
      });
      expect(okAncestor.status).toBe(0);
      expect(fs.readFileSync(outputFile, 'utf8')).toContain(`resolved_sha=${ancestorSha}`);

      // Unmerged commit fails closed
      fs.writeFileSync(outputFile, '');
      const badBranch = spawnSync('bash', ['-eo', 'pipefail', '-c', ancestryStep!.run!], {
        cwd: workRepo,
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          INPUT_COMMIT_SHA: '',
          CURRENT_SHA: unmergedSha,
        },
      });
      expect(badBranch.status).not.toBe(0);
      expect(badBranch.stdout + badBranch.stderr).toContain('is not an ancestor of origin/main');

      // Execute github-script CI gate against simulated GitHub REST API responses
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        ...args: string[]
      ) => (github: unknown, context: unknown, core: unknown) => Promise<void>;
      const runCiGate = new AsyncFunction('github', 'context', 'core', ciStep!.with!.script!);

      const prevTarget = process.env.TARGET_SHA;
      process.env.TARGET_SHA = mainHeadSha;
      try {
        const failedMessages: string[] = [];
        await runCiGate(
          {
            rest: { actions: { listWorkflowRuns: 'listWorkflowRuns' } },
            paginate: async () => [
              { conclusion: 'failure', head_sha: mainHeadSha, head_repository: { full_name: 'fderuiter/wedding_website' } },
            ],
          },
          { repo: { owner: 'fderuiter', repo: 'wedding_website' } },
          { setFailed: (msg: string) => failedMessages.push(msg), info: () => undefined }
        );
        expect(failedMessages).toHaveLength(1);
        expect(failedMessages[0]).toContain('No completed successful CI workflow run found');

        const okFailures: string[] = [];
        const okInfos: string[] = [];
        await runCiGate(
          {
            rest: { actions: { listWorkflowRuns: 'listWorkflowRuns' } },
            paginate: async () => [
              {
                id: 901,
                run_number: 42,
                conclusion: 'success',
                head_sha: mainHeadSha,
                head_repository: { full_name: 'fderuiter/wedding_website' },
              },
            ],
          },
          { repo: { owner: 'fderuiter', repo: 'wedding_website' } },
          { setFailed: (msg: string) => okFailures.push(msg), info: (msg: string) => okInfos.push(msg) }
        );
        expect(okFailures).toHaveLength(0);
        expect(okInfos[0]).toContain('Verified successful CI run #42');
      } finally {
        if (prevTarget === undefined) delete process.env.TARGET_SHA;
        else process.env.TARGET_SHA = prevTarget;
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('pins isolated prisma-cli dependencies to package-lock.json via npm ci in Dockerfile', () => {
    const dockerfile = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
    const prismaStage = dockerfile.split('# Builder stage')[0] ?? '';
    expect(prismaStage).toContain('/opt/prisma-cli/package-lock.json');
    expect(prismaStage).toContain('npm ci --omit=dev --no-audit --no-fund');
    expect(prismaStage).not.toContain('npm install');
  });
});
