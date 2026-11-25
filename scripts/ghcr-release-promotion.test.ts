/**
 * @jest-environment node
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = process.cwd();
const PROMOTION_SCRIPT = path.join(REPO_ROOT, 'scripts', 'ghcr-release-promotion.sh');
const PERSIST_MOUNTS_SCRIPT = path.join(REPO_ROOT, 'scripts', 'persist-buildkit-mounts.sh');

const TARGET_SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);
const INDEX_DIGEST = `sha256:${'1'.repeat(64)}`;
const AMD64_DIGEST = `sha256:${'2'.repeat(64)}`;
const ARM64_DIGEST = `sha256:${'3'.repeat(64)}`;

interface MockRegistryState {
  tagDigest?: string;
  rawManifests: Record<string, unknown>;
  provenanceBySubject: Record<string, unknown>;
  spdxV23BySubject?: Record<string, unknown>;
  spdxLegacyBySubject?: Record<string, unknown>;
  dockerCalls: string[][];
  ghCalls: string[][];
  skopeoCalls: string[][];
}

function makeProvenancePayload(options: {
  sourceRef?: string;
  oidcDigest?: string;
  subjectRevision?: string;
  inputCommitSha?: string;
}): unknown[] {
  const {
    sourceRef = 'refs/heads/main',
    oidcDigest = TARGET_SHA,
    subjectRevision = TARGET_SHA,
    inputCommitSha,
  } = options;

  return [
    {
      verificationResult: {
        signature: {
          certificate: {
            sourceRepositoryRef: sourceRef,
            sourceRepositoryDigest: oidcDigest,
          },
        },
        statement: {
          subject: [
            {
              name: 'ghcr.io/fderuiter/wedding_website',
              annotations: subjectRevision
                ? { 'org.opencontainers.image.revision': subjectRevision }
                : {},
            },
          ],
          predicate: {
            buildDefinition: {
              externalParameters: inputCommitSha
                ? { inputs: { commit_sha: inputCommitSha } }
                : {},
              resolvedDependencies: [
                {
                  uri: 'git+https://github.com/fderuiter/wedding_website',
                  digest: { gitCommit: oidcDigest },
                },
              ],
            },
          },
        },
      },
    },
  ];
}

function makeSpdxPayload(archLabel: string, sourceRef = 'refs/heads/main'): unknown[] {
  return [
    {
      verificationResult: {
        signature: {
          certificate: {
            sourceRepositoryRef: sourceRef,
          },
        },
        statement: {
          predicate: {
            spdxVersion: 'SPDX-2.3',
            name: `wedding-website-${archLabel}`,
            packages: [{ name: 'wedding-website', SPDXID: `SPDXRef-${archLabel}` }],
          },
        },
      },
    },
  ];
}

function buildValidState(): MockRegistryState {
  const repo = 'ghcr.io/fderuiter/wedding_website';
  const indexUri = `${repo}@${INDEX_DIGEST}`;
  const amd64Uri = `${repo}@${AMD64_DIGEST}`;
  const arm64Uri = `${repo}@${ARM64_DIGEST}`;

  return {
    tagDigest: INDEX_DIGEST,
    rawManifests: {
      [indexUri]: {
        schemaVersion: 2,
        annotations: {
          'org.opencontainers.image.revision': TARGET_SHA,
        },
        manifests: [
          {
            digest: AMD64_DIGEST,
            platform: { os: 'linux', architecture: 'amd64' },
          },
          {
            digest: ARM64_DIGEST,
            platform: { os: 'linux', architecture: 'arm64' },
          },
        ],
      },
      [amd64Uri]: {
        schemaVersion: 2,
        annotations: {
          'org.opencontainers.image.revision': TARGET_SHA,
        },
      },
      [arm64Uri]: {
        schemaVersion: 2,
        annotations: {
          'org.opencontainers.image.revision': TARGET_SHA,
        },
      },
    },
    provenanceBySubject: {
      [`oci://${indexUri}`]: makeProvenancePayload({}),
      [`oci://${amd64Uri}`]: makeProvenancePayload({}),
      [`oci://${arm64Uri}`]: makeProvenancePayload({}),
    },
    spdxV23BySubject: {
      [`oci://${indexUri}`]: makeSpdxPayload('index'),
      [`oci://${amd64Uri}`]: makeSpdxPayload('amd64'),
      [`oci://${arm64Uri}`]: makeSpdxPayload('arm64'),
    },
    spdxLegacyBySubject: {},
    dockerCalls: [],
    ghCalls: [],
    skopeoCalls: [],
  };
}

function setupMockCliHarness(initialState: MockRegistryState): {
  tmpDir: string;
  binDir: string;
  stateFile: string;
  outputFile: string;
  summaryFile: string;
  readState: () => MockRegistryState;
  cleanup: () => void;
} {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ghcr-promo-test-'));
  const binDir = path.join(tmpDir, 'bin');
  fs.mkdirSync(binDir, { recursive: true });

  const stateFile = path.join(tmpDir, 'state.json');
  const outputFile = path.join(tmpDir, 'github-output.txt');
  const summaryFile = path.join(tmpDir, 'step-summary.md');
  fs.writeFileSync(stateFile, JSON.stringify(initialState, null, 2));
  fs.writeFileSync(outputFile, '');
  fs.writeFileSync(summaryFile, '');

  const mockDocker = `#!/usr/bin/env node
const fs = require('fs');
const stateFile = process.env.MOCK_STATE_FILE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const args = process.argv.slice(2);
state.dockerCalls.push(args);
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

if (args[0] === 'login') {
  process.exit(0);
}
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'inspect') {
  if (args[3] === '--format' && args[4] === '{{.Manifest.Digest}}') {
    if (!state.tagDigest) {
      process.exit(1);
    }
    process.stdout.write(state.tagDigest + '\\n');
    process.exit(0);
  }
  if (args[3] === '--raw') {
    const ref = args[4];
    const manifest = state.rawManifests[ref];
    if (!manifest) {
      process.exit(1);
    }
    process.stdout.write(JSON.stringify(manifest));
    process.exit(0);
  }
}
process.exit(1);
`;

  const mockGh = `#!/usr/bin/env node
const fs = require('fs');
const stateFile = process.env.MOCK_STATE_FILE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const args = process.argv.slice(2);
state.ghCalls.push(args);
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

if (args[0] === 'attestation' && args[1] === 'verify') {
  const subject = args[2];
  const predIdx = args.indexOf('--predicate-type');
  const predType = predIdx >= 0 ? args[predIdx + 1] : '';
  if (predType === 'https://slsa.dev/provenance/v1') {
    const payload = state.provenanceBySubject[subject];
    if (!payload) process.exit(1);
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  }
  if (predType === 'https://spdx.dev/Document/v2.3') {
    const payload = (state.spdxV23BySubject || {})[subject];
    if (!payload) process.exit(1);
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  }
  if (predType === 'https://spdx.dev/Document') {
    const payload = (state.spdxLegacyBySubject || {})[subject];
    if (!payload) process.exit(1);
    process.stdout.write(JSON.stringify(payload));
    process.exit(0);
  }
}
process.exit(1);
`;

  const mockSkopeo = `#!/usr/bin/env node
const fs = require('fs');
const stateFile = process.env.MOCK_STATE_FILE;
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
const args = process.argv.slice(2);
state.skopeoCalls.push(args);
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
process.exit(0);
`;

  for (const [name, content] of [
    ['docker', mockDocker],
    ['gh', mockGh],
    ['skopeo', mockSkopeo],
  ] as const) {
    const binPath = path.join(binDir, name);
    fs.writeFileSync(binPath, content, { mode: 0o755 });
  }

  return {
    tmpDir,
    binDir,
    stateFile,
    outputFile,
    summaryFile,
    readState: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')) as MockRegistryState,
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

function parseKeyValueFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    out[line.slice(0, eqIdx)] = line.slice(eqIdx + 1);
  }
  return out;
}

describe('GHCR release promotion and BuildKit cache mount helpers', () => {
  describe('workflow delegation contracts', () => {
    const ciWorkflow = fs.readFileSync(
      path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    const publishWorkflow = fs.readFileSync(
      path.join(REPO_ROOT, '.github', 'workflows', 'publish-artifact.yml'),
      'utf8'
    );

    it('wires ci.yml and publish-artifact.yml steps to shared scripts with bounded timeouts', () => {
      const ciPersistRefs =
        ciWorkflow.match(/run:\s*bash scripts\/persist-buildkit-mounts\.sh/g) ?? [];
      expect(ciPersistRefs).toHaveLength(2);
      expect(publishWorkflow).toContain('bash scripts/persist-buildkit-mounts.sh');
      expect(publishWorkflow).toContain('bash scripts/ghcr-release-promotion.sh inspect-preflight');
      expect(publishWorkflow).toContain(
        'bash scripts/ghcr-release-promotion.sh extract-promoted-sboms'
      );
      expect(publishWorkflow).toContain(
        'bash scripts/ghcr-release-promotion.sh mirror-promoted-digests'
      );
      expect(publishWorkflow).toContain(
        "- name: Download Verified OCI Archive Artifacts\n        if: needs.preflight.outputs.promote_existing != 'true'"
      );
    });
  });

  describe('scripts/ghcr-release-promotion.sh inspect-preflight', () => {
    it('skips GHCR inspection on workflow_call events without calling docker or gh', () => {
      const harness = setupMockCliHarness(buildValidState());
      try {
        const stdout = execFileSync('bash', [PROMOTION_SCRIPT, 'inspect-preflight'], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
            MOCK_STATE_FILE: harness.stateFile,
            GITHUB_OUTPUT: harness.outputFile,
            GITHUB_STEP_SUMMARY: harness.summaryFile,
            EVENT_NAME: 'workflow_call',
            RESOLVED_SHA: TARGET_SHA,
            GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          },
          encoding: 'utf8',
        });

        expect(stdout).toContain("Event 'workflow_call' builds fresh artifacts");
        expect(parseKeyValueFile(harness.outputFile)).toEqual({
          promote_existing: 'false',
          amd64_digest: '',
          arm64_digest: '',
          source_index_digest: '',
        });
        const recorded = harness.readState();
        expect(recorded.dockerCalls).toHaveLength(0);
        expect(recorded.ghCalls).toHaveLength(0);
      } finally {
        harness.cleanup();
      }
    });

    it('promotes verified multi-platform GHCR images on tag push and workflow_dispatch runs', () => {
      for (const eventName of ['push', 'workflow_dispatch'] as const) {
        const harness = setupMockCliHarness(buildValidState());
        try {
          execFileSync('bash', [PROMOTION_SCRIPT, 'inspect-preflight'], {
            cwd: REPO_ROOT,
            env: {
              ...process.env,
              PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
              MOCK_STATE_FILE: harness.stateFile,
              GITHUB_OUTPUT: harness.outputFile,
              GITHUB_STEP_SUMMARY: harness.summaryFile,
              GH_TOKEN: 'ghs_test_token',
              GITHUB_ACTOR_LOGIN: 'fderuiter',
              EVENT_NAME: eventName,
              RESOLVED_SHA: TARGET_SHA.toUpperCase(),
              GITHUB_REPOSITORY: 'FdeRuiter/Wedding_Website',
              REPO_OWNER: 'fderuiter',
              SIGNER_WORKFLOW: 'fderuiter/wedding_website/.github/workflows/publish-artifact.yml',
            },
            encoding: 'utf8',
          });

          expect(parseKeyValueFile(harness.outputFile)).toEqual({
            promote_existing: 'true',
            amd64_digest: AMD64_DIGEST,
            arm64_digest: ARM64_DIGEST,
            source_index_digest: INDEX_DIGEST,
          });
          const summary = fs.readFileSync(harness.summaryFile, 'utf8');
          expect(summary).toContain('Verified Existing Attested GHCR Artifact');
          expect(summary).toContain(AMD64_DIGEST);
          expect(summary).toContain(ARM64_DIGEST);

          const recorded = harness.readState();
          expect(recorded.dockerCalls[0]).toEqual([
            'login',
            'ghcr.io',
            '-u',
            'fderuiter',
            '--password-stdin',
          ]);
        } finally {
          harness.cleanup();
        }
      }
    });

    it('supports workflow_run burst-commit provenance while rejecting conflicting input vs subject revisions', () => {
      const burstState = buildValidState();
      const repo = 'ghcr.io/fderuiter/wedding_website';
      for (const uri of [
        `oci://${repo}@${INDEX_DIGEST}`,
        `oci://${repo}@${AMD64_DIGEST}`,
        `oci://${repo}@${ARM64_DIGEST}`,
      ]) {
        // OIDC certificate reflects newer main tip OTHER_SHA, while built subject & input_sha match TARGET_SHA
        burstState.provenanceBySubject[uri] = makeProvenancePayload({
          oidcDigest: OTHER_SHA,
          subjectRevision: TARGET_SHA,
          inputCommitSha: TARGET_SHA,
        });
      }

      const okHarness = setupMockCliHarness(burstState);
      try {
        execFileSync('bash', [PROMOTION_SCRIPT, 'inspect-preflight'], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PATH: `${okHarness.binDir}:${process.env.PATH ?? ''}`,
            MOCK_STATE_FILE: okHarness.stateFile,
            GITHUB_OUTPUT: okHarness.outputFile,
            EVENT_NAME: 'push',
            RESOLVED_SHA: TARGET_SHA,
            GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          },
          encoding: 'utf8',
        });
        expect(parseKeyValueFile(okHarness.outputFile).promote_existing).toBe('true');
      } finally {
        okHarness.cleanup();
      }

      const conflictState = buildValidState();
      conflictState.provenanceBySubject[`oci://${repo}@${AMD64_DIGEST}`] = makeProvenancePayload({
        oidcDigest: TARGET_SHA,
        subjectRevision: OTHER_SHA,
        inputCommitSha: TARGET_SHA,
      });

      const conflictHarness = setupMockCliHarness(conflictState);
      try {
        const stdout = execFileSync('bash', [PROMOTION_SCRIPT, 'inspect-preflight'], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PATH: `${conflictHarness.binDir}:${process.env.PATH ?? ''}`,
            MOCK_STATE_FILE: conflictHarness.stateFile,
            GITHUB_OUTPUT: conflictHarness.outputFile,
            EVENT_NAME: 'push',
            RESOLVED_SHA: TARGET_SHA,
            GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          },
          encoding: 'utf8',
        });
        expect(stdout).toContain('OIDC provenance attestation verification failed');
        expect(parseKeyValueFile(conflictHarness.outputFile).promote_existing).toBe('false');
      } finally {
        conflictHarness.cleanup();
      }
    });

    it('falls back cleanly when target commit predates scripts/ghcr-release-promotion.sh', () => {
      const harness = setupMockCliHarness(buildValidState());
      const gitDir = path.join(harness.tmpDir, 'repo');
      fs.mkdirSync(gitDir, { recursive: true });

      try {
        const gitEnv = {
          ...process.env,
          GIT_AUTHOR_NAME: 'Test',
          GIT_AUTHOR_EMAIL: 'test@example.com',
          GIT_COMMITTER_NAME: 'Test',
          GIT_COMMITTER_EMAIL: 'test@example.com',
        };
        execFileSync('git', ['init', '-b', 'main'], { cwd: gitDir, env: gitEnv });
        fs.writeFileSync(path.join(gitDir, 'README.md'), 'legacy commit\n');
        execFileSync('git', ['add', 'README.md'], { cwd: gitDir, env: gitEnv });
        execFileSync('git', ['commit', '-m', 'legacy'], { cwd: gitDir, env: gitEnv });
        const legacySha = execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: gitDir,
          env: gitEnv,
          encoding: 'utf8',
        }).trim();

        fs.mkdirSync(path.join(gitDir, 'scripts'), { recursive: true });
        fs.copyFileSync(PROMOTION_SCRIPT, path.join(gitDir, 'scripts', 'ghcr-release-promotion.sh'));
        execFileSync('git', ['add', 'scripts/ghcr-release-promotion.sh'], {
          cwd: gitDir,
          env: gitEnv,
        });
        execFileSync('git', ['commit', '-m', 'add helper'], { cwd: gitDir, env: gitEnv });

        const stdout = execFileSync(
          'bash',
          [path.join(gitDir, 'scripts', 'ghcr-release-promotion.sh'), 'inspect-preflight'],
          {
            cwd: gitDir,
            env: {
              ...process.env,
              PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
              MOCK_STATE_FILE: harness.stateFile,
              GITHUB_OUTPUT: harness.outputFile,
              EVENT_NAME: 'workflow_dispatch',
              RESOLVED_SHA: legacySha,
              GITHUB_REPOSITORY: 'fderuiter/wedding_website',
            },
            encoding: 'utf8',
          }
        );

        expect(stdout).toContain('predates scripts/ghcr-release-promotion.sh');
        expect(parseKeyValueFile(harness.outputFile).promote_existing).toBe('false');
        expect(harness.readState().dockerCalls).toHaveLength(0);
      } finally {
        harness.cleanup();
      }
    });

    it.each([
      [
        'missing GHCR tag manifest',
        (s: MockRegistryState) => {
          s.tagDigest = undefined;
        },
        'No existing GHCR manifest found',
      ],
      [
        'missing arm64 manifest in OCI index',
        (s: MockRegistryState) => {
          s.rawManifests[`ghcr.io/fderuiter/wedding_website@${INDEX_DIGEST}`] = {
            schemaVersion: 2,
            annotations: { 'org.opencontainers.image.revision': TARGET_SHA },
            manifests: [
              { digest: AMD64_DIGEST, platform: { os: 'linux', architecture: 'amd64' } },
            ],
          };
        },
        'missing valid linux/amd64 or linux/arm64 manifest digests',
      ],
      [
        'mismatched index revision annotation',
        (s: MockRegistryState) => {
          s.rawManifests[`ghcr.io/fderuiter/wedding_website@${INDEX_DIGEST}`] = {
            schemaVersion: 2,
            annotations: { 'org.opencontainers.image.revision': OTHER_SHA },
            manifests: [
              { digest: AMD64_DIGEST, platform: { os: 'linux', architecture: 'amd64' } },
              { digest: ARM64_DIGEST, platform: { os: 'linux', architecture: 'arm64' } },
            ],
          };
        },
        'does not match',
      ],
      [
        'untrusted pull_request certificate ref on provenance',
        (s: MockRegistryState) => {
          s.provenanceBySubject[`oci://ghcr.io/fderuiter/wedding_website@${ARM64_DIGEST}`] =
            makeProvenancePayload({ sourceRef: 'refs/pull/99/merge' });
        },
        'OIDC provenance attestation verification failed',
      ],
      [
        'missing SPDX SBOM attestation on architecture digest',
        (s: MockRegistryState) => {
          if (s.spdxV23BySubject) {
            delete s.spdxV23BySubject[`oci://ghcr.io/fderuiter/wedding_website@${ARM64_DIGEST}`];
          }
        },
        'OIDC SPDX SBOM attestation verification failed',
      ],
    ])('falls back to native matrix build on %s', (_label, mutate, expectedMessage) => {
      const state = buildValidState();
      mutate(state);
      const harness = setupMockCliHarness(state);
      try {
        const stdout = execFileSync('bash', [PROMOTION_SCRIPT, 'inspect-preflight'], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
            MOCK_STATE_FILE: harness.stateFile,
            GITHUB_OUTPUT: harness.outputFile,
            EVENT_NAME: 'push',
            RESOLVED_SHA: TARGET_SHA,
            GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          },
          encoding: 'utf8',
        });

        expect(stdout).toContain(expectedMessage);
        expect(parseKeyValueFile(harness.outputFile)).toEqual({
          promote_existing: 'false',
          amd64_digest: '',
          arm64_digest: '',
          source_index_digest: '',
        });
      } finally {
        harness.cleanup();
      }
    });

    it('fails closed when RESOLVED_SHA is malformed or GITHUB_REPOSITORY is missing', () => {
      const harness = setupMockCliHarness(buildValidState());
      try {
        expect(() =>
          execFileSync('bash', [PROMOTION_SCRIPT, 'inspect-preflight'], {
            cwd: REPO_ROOT,
            env: {
              ...process.env,
              PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
              MOCK_STATE_FILE: harness.stateFile,
              GITHUB_OUTPUT: harness.outputFile,
              EVENT_NAME: 'push',
              RESOLVED_SHA: 'not-a-sha',
              GITHUB_REPOSITORY: 'fderuiter/wedding_website',
            },
            stdio: 'pipe',
          })
        ).toThrow();

        expect(() =>
          execFileSync('bash', [PROMOTION_SCRIPT, 'inspect-preflight'], {
            cwd: REPO_ROOT,
            env: {
              ...process.env,
              PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
              MOCK_STATE_FILE: harness.stateFile,
              GITHUB_OUTPUT: harness.outputFile,
              EVENT_NAME: 'push',
              RESOLVED_SHA: TARGET_SHA,
              GITHUB_REPOSITORY: '',
            },
            stdio: 'pipe',
          })
        ).toThrow();
      } finally {
        harness.cleanup();
      }
    });
  });

  describe('scripts/ghcr-release-promotion.sh publish promotion subcommands', () => {
    it('extracts per-arch SPDX SBOMs (including legacy predicate fallback) and mirrors digests to Docker Hub', () => {
      const state = buildValidState();
      const arm64Subject = `oci://ghcr.io/fderuiter/wedding_website@${ARM64_DIGEST}`;
      if (state.spdxV23BySubject) {
        delete state.spdxV23BySubject[arm64Subject];
      }
      state.spdxLegacyBySubject = {
        [arm64Subject]: makeSpdxPayload('arm64-legacy', 'refs/tags/v1.2.3'),
      };

      const harness = setupMockCliHarness(state);
      const handoffDir = path.join(harness.tmpDir, 'oci-handoff');
      const digestsDir = path.join(harness.tmpDir, 'digests');

      try {
        execFileSync('bash', [PROMOTION_SCRIPT, 'extract-promoted-sboms'], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
            MOCK_STATE_FILE: harness.stateFile,
            OCI_HANDOFF_DIR: handoffDir,
            IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
            PROMOTED_AMD64_DIGEST: AMD64_DIGEST,
            PROMOTED_ARM64_DIGEST: ARM64_DIGEST,
            REVISION: '',
            RESOLVED_SHA: TARGET_SHA,
            GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          },
          encoding: 'utf8',
        });

        const amd64Sbom = JSON.parse(
          fs.readFileSync(path.join(handoffDir, 'sbom-amd64.spdx.json'), 'utf8')
        ) as { spdxVersion: string; name: string };
        const arm64Sbom = JSON.parse(
          fs.readFileSync(path.join(handoffDir, 'sbom-arm64.spdx.json'), 'utf8')
        ) as { spdxVersion: string; name: string };
        expect(amd64Sbom).toMatchObject({
          spdxVersion: 'SPDX-2.3',
          name: 'wedding-website-amd64',
        });
        expect(arm64Sbom).toMatchObject({
          spdxVersion: 'SPDX-2.3',
          name: 'wedding-website-arm64-legacy',
        });

        execFileSync('bash', [PROMOTION_SCRIPT, 'mirror-promoted-digests'], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
            MOCK_STATE_FILE: harness.stateFile,
            DIGESTS_DIR: digestsDir,
            IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
            DOCKERHUB_REPOSITORY: 'fderuiter/wedding-website',
            PROMOTED_INDEX_DIGEST: INDEX_DIGEST,
            PROMOTED_AMD64_DIGEST: AMD64_DIGEST,
            PROMOTED_ARM64_DIGEST: ARM64_DIGEST,
            REVISION: TARGET_SHA,
            GITHUB_REPOSITORY: 'fderuiter/wedding_website',
          },
          encoding: 'utf8',
        });

        expect(fs.readFileSync(path.join(digestsDir, 'amd64.digest'), 'utf8').trim()).toBe(
          AMD64_DIGEST
        );
        expect(fs.readFileSync(path.join(digestsDir, 'arm64.digest'), 'utf8').trim()).toBe(
          ARM64_DIGEST
        );
        expect(harness.readState().skopeoCalls).toEqual([
          [
            'copy',
            '--preserve-digests',
            `docker://ghcr.io/fderuiter/wedding_website@${AMD64_DIGEST}`,
            `docker://docker.io/fderuiter/wedding-website@${AMD64_DIGEST}`,
          ],
          [
            'copy',
            '--preserve-digests',
            `docker://ghcr.io/fderuiter/wedding_website@${ARM64_DIGEST}`,
            `docker://docker.io/fderuiter/wedding-website@${ARM64_DIGEST}`,
          ],
        ]);
      } finally {
        harness.cleanup();
      }
    });

    it('fails closed during publish promotion when index digests or revision drift from preflight', () => {
      const driftedState = buildValidState();
      driftedState.rawManifests[`ghcr.io/fderuiter/wedding_website@${INDEX_DIGEST}`] = {
        schemaVersion: 2,
        annotations: { 'org.opencontainers.image.revision': OTHER_SHA },
        manifests: [
          { digest: AMD64_DIGEST, platform: { os: 'linux', architecture: 'amd64' } },
          { digest: ARM64_DIGEST, platform: { os: 'linux', architecture: 'arm64' } },
        ],
      };

      const harness = setupMockCliHarness(driftedState);
      try {
        expect(() =>
          execFileSync('bash', [PROMOTION_SCRIPT, 'mirror-promoted-digests'], {
            cwd: REPO_ROOT,
            env: {
              ...process.env,
              PATH: `${harness.binDir}:${process.env.PATH ?? ''}`,
              MOCK_STATE_FILE: harness.stateFile,
              DIGESTS_DIR: path.join(harness.tmpDir, 'digests'),
              IMAGE_REPOSITORY: 'ghcr.io/fderuiter/wedding_website',
              PROMOTED_INDEX_DIGEST: INDEX_DIGEST,
              PROMOTED_AMD64_DIGEST: AMD64_DIGEST,
              PROMOTED_ARM64_DIGEST: ARM64_DIGEST,
              REVISION: TARGET_SHA,
              GITHUB_REPOSITORY: 'fderuiter/wedding_website',
            },
            stdio: 'pipe',
          })
        ).toThrow();
      } finally {
        harness.cleanup();
      }
    });
  });

  describe('scripts/persist-buildkit-mounts.sh', () => {
    it('skips docker buildx when both cache hits are true and omits empty tar archives on GHA layer hits', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'persist-mounts-test-'));
      const binDir = path.join(tmpDir, 'bin');
      const mountCacheDir = path.join(tmpDir, 'mounts');
      const callsFile = path.join(tmpDir, 'docker-calls.json');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(callsFile, '[]');

      const mockDocker = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const callsFile = process.env.MOCK_DOCKER_CALLS;
const calls = JSON.parse(fs.readFileSync(callsFile, 'utf8'));
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, 'utf8');
calls.push({ args, stdin });
fs.writeFileSync(callsFile, JSON.stringify(calls, null, 2));

const outArg = args.find((a) => a.startsWith('--output'));
const destIdx = args.indexOf('--output');
const outputSpec = destIdx >= 0 ? args[destIdx + 1] : (outArg || '');
const destMatch = outputSpec.match(/dest=([^,]+)/);
if (!destMatch) process.exit(1);
const outDir = destMatch[1];

const mode = process.env.MOCK_MOUNT_POPULATION || 'empty';
if (mode === 'empty-dirs-tar') {
  // Simulate an exporter producing a directory-only tar archive with zero regular files
  const stageDir = fs.mkdtempSync(path.join(outDir, 'stage-'));
  fs.mkdirSync(path.join(stageDir, 'app', '.next', 'cache'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'next'), { recursive: true });
  execFileSync('tar', ['-cf', path.join(outDir, 'next', 'mounts.tar'), '-C', stageDir, 'app/.next/cache']);
  fs.rmSync(stageDir, { recursive: true, force: true });
} else if (mode === 'populated') {
  const stageDir = fs.mkdtempSync(path.join(outDir, 'stage-'));
  fs.mkdirSync(path.join(stageDir, 'root', '.npm'), { recursive: true });
  fs.writeFileSync(path.join(stageDir, 'root', '.npm', 'pkg.tgz'), 'cached-npm-tarball');
  fs.mkdirSync(path.join(stageDir, 'var', 'cache', 'apt'), { recursive: true });
  fs.mkdirSync(path.join(stageDir, 'var', 'lib', 'apt'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'deps'), { recursive: true });
  execFileSync('tar', [
    '-cf',
    path.join(outDir, 'deps', 'mounts.tar'),
    '-C',
    stageDir,
    'var/cache/apt',
    'var/lib/apt',
    'root/.npm',
  ]);

  fs.mkdirSync(path.join(stageDir, 'app', '.next', 'cache'), { recursive: true });
  fs.writeFileSync(path.join(stageDir, 'app', '.next', 'cache', 'webpack.pack'), 'cached-next');
  fs.mkdirSync(path.join(outDir, 'next'), { recursive: true });
  execFileSync('tar', [
    '-cf',
    path.join(outDir, 'next', 'mounts.tar'),
    '-C',
    stageDir,
    'app/.next/cache',
  ]);
  fs.rmSync(stageDir, { recursive: true, force: true });
}
process.exit(0);
`;
      fs.writeFileSync(path.join(binDir, 'docker'), mockDocker, { mode: 0o755 });

      try {
        // 1. Both caches hit -> exits immediately without calling docker
        execFileSync('bash', [PERSIST_MOUNTS_SCRIPT], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ''}`,
            MOCK_DOCKER_CALLS: callsFile,
            TARGET_PLATFORM: 'linux/amd64',
            MOUNT_CACHE_DIR: mountCacheDir,
            DEPS_CACHE_HIT: 'true',
            NEXT_CACHE_HIT: 'true',
          },
        });
        expect(JSON.parse(fs.readFileSync(callsFile, 'utf8'))).toHaveLength(0);

        // 2. Empty BuildKit mounts (GHA layer hit) or directory-only tar -> zero mounts.tar persisted
        execFileSync('bash', [PERSIST_MOUNTS_SCRIPT], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ''}`,
            MOCK_DOCKER_CALLS: callsFile,
            MOCK_MOUNT_POPULATION: 'empty-dirs-tar',
            TARGET_PLATFORM: 'linux/amd64',
            MOUNT_CACHE_DIR: mountCacheDir,
            DEPS_CACHE_HIT: 'true',
            NEXT_CACHE_HIT: 'false',
          },
        });
        const callsAfterEmpty = JSON.parse(fs.readFileSync(callsFile, 'utf8')) as Array<{
          stdin: string;
        }>;
        expect(callsAfterEmpty).toHaveLength(1);
        expect(callsAfterEmpty[0]?.stdin).toContain('find /app/.next/cache -type f -print -quit');
        expect(fs.existsSync(path.join(mountCacheDir, 'next', 'mounts.tar'))).toBe(false);
        expect(fs.existsSync(path.join(mountCacheDir, 'deps', 'mounts.tar'))).toBe(false);

        // 3. Populated BuildKit mounts -> persists both deps/mounts.tar and next/mounts.tar
        execFileSync('bash', [PERSIST_MOUNTS_SCRIPT], {
          cwd: REPO_ROOT,
          env: {
            ...process.env,
            PATH: `${binDir}:${process.env.PATH ?? ''}`,
            MOCK_DOCKER_CALLS: callsFile,
            MOCK_MOUNT_POPULATION: 'populated',
            TARGET_PLATFORM: 'linux/arm64',
            MOUNT_CACHE_DIR: mountCacheDir,
            DEPS_CACHE_HIT: 'false',
            NEXT_CACHE_HIT: 'false',
          },
        });
        expect(fs.existsSync(path.join(mountCacheDir, 'deps', 'mounts.tar'))).toBe(true);
        expect(fs.existsSync(path.join(mountCacheDir, 'next', 'mounts.tar'))).toBe(true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
