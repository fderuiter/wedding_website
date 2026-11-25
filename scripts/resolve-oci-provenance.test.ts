/**
 * @jest-environment node
 */
import { spawnSync } from 'child_process';
import path from 'path';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'resolve-oci-provenance.sh');

const C1_SHA = '1111111111111111111111111111111111111111';
const C2_SHA = '2222222222222222222222222222222222222222';
const C3_SHA = '3333333333333333333333333333333333333333';

function runResolver(options: {
  attestation?: unknown;
  rawManifest?: unknown;
  args?: string[];
}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ATTESTATION_JSON;
  delete env.RAW_MANIFEST_JSON;

  if (options.rawManifest !== undefined) {
    env.RAW_MANIFEST_JSON =
      typeof options.rawManifest === 'string'
        ? options.rawManifest
        : JSON.stringify(options.rawManifest);
  }

  const input =
    options.attestation === undefined
      ? ''
      : typeof options.attestation === 'string'
        ? options.attestation
        : JSON.stringify(options.attestation);

  return spawnSync('bash', [SCRIPT_PATH, ...(options.args ?? [])], {
    input,
    encoding: 'utf8',
    env,
  });
}

describe('scripts/resolve-oci-provenance.sh', () => {
  it('prioritizes OCI org.opencontainers.image.revision and SLSA inputs.commit_sha ahead of drifted OIDC GITHUB_SHA fields', () => {
    const driftedAttestation = [
      {
        verificationResult: {
          signature: {
            certificate: {
              sourceRepositoryDigest: C2_SHA,
              sourceRepositoryRef: 'refs/heads/main',
            },
          },
          statement: {
            subject: [{ name: 'ghcr.io/example/wedding_website' }],
            predicate: {
              buildDefinition: {
                externalParameters: {},
                internalParameters: { github: { sha: C2_SHA } },
                resolvedDependencies: [{ digest: { gitCommit: C2_SHA, sha1: C2_SHA } }],
              },
              invocation: { configSource: { digest: { sha1: C2_SHA } } },
            },
          },
        },
      },
    ];

    // 1. OCI index org.opencontainers.image.revision wins over drifted OIDC C2 fields
    const indexRes = runResolver({
      attestation: driftedAttestation,
      rawManifest: {
        annotations: { 'org.opencontainers.image.revision': C1_SHA.toUpperCase() },
      },
    });
    expect(indexRes.status).toBe(0);
    expect(indexRes.stdout.trim()).toBe(`${C1_SHA}|${C1_SHA}|${C2_SHA}|oci-revision-label`);

    // 2. Platform manifest annotation and config.Labels fallback also resolve C1
    const childManifestRes = runResolver({
      attestation: driftedAttestation,
      rawManifest: {
        manifests: [{ annotations: { 'org.opencontainers.image.revision': C1_SHA } }],
      },
    });
    expect(childManifestRes.status).toBe(0);
    expect(childManifestRes.stdout.trim()).toBe(`${C1_SHA}|${C1_SHA}|${C2_SHA}|oci-revision-label`);

    // 3. SLSA inputs.commit_sha wins over OIDC sourceRepositoryDigest / resolvedDependencies when OCI manifest is unavailable
    const slsaInputRes = runResolver({
      attestation: [
        {
          verificationResult: {
            signature: { certificate: { sourceRepositoryDigest: C2_SHA } },
            statement: {
              predicate: {
                buildDefinition: {
                  externalParameters: { inputs: { commit_sha: C1_SHA } },
                  internalParameters: { github: { sha: C2_SHA } },
                  resolvedDependencies: [{ digest: { gitCommit: C2_SHA } }],
                },
              },
            },
          },
        },
      ],
    });
    expect(slsaInputRes.status).toBe(0);
    expect(slsaInputRes.stdout.trim()).toBe(`${C1_SHA}||${C1_SHA}|slsa-provenance`);

    // 4. Attested SLSA subject org.opencontainers.image.revision wins over OIDC fields
    const subjectAnnotationRes = runResolver({
      attestation: [
        {
          verificationResult: {
            signature: { certificate: { sourceRepositoryDigest: C2_SHA } },
            statement: {
              subject: [
                {
                  name: 'ghcr.io/example/wedding_website',
                  annotations: { 'org.opencontainers.image.revision': C1_SHA },
                },
              ],
              predicate: {
                buildDefinition: {
                  internalParameters: { github: { sha: C2_SHA } },
                },
              },
            },
          },
        },
      ],
    });
    expect(subjectAnnotationRes.status).toBe(0);
    expect(subjectAnnotationRes.stdout.trim()).toBe(`${C1_SHA}||${C1_SHA}|slsa-provenance`);
  });

  it('fails closed in error mode and emits empty resolved revision in warn mode when OCI index revision conflicts with SLSA inputs.commit_sha', () => {
    const conflictingAttestation = [
      {
        verificationResult: {
          statement: {
            predicate: {
              buildDefinition: {
                externalParameters: { inputs: { commit_sha: C3_SHA } },
              },
            },
          },
        },
      },
    ];
    const rawManifest = {
      annotations: { 'org.opencontainers.image.revision': C1_SHA },
    };

    const errorRes = runResolver({
      attestation: conflictingAttestation,
      rawManifest,
      args: ['--conflict-mode', 'error', '--image-label', 'ghcr.io/example/wedding_website@sha256:abc'],
    });
    expect(errorRes.status).toBe(2);
    expect(errorRes.stderr).toContain(
      `Attested OCI index revision '${C1_SHA}' conflicts with SLSA input commit_sha '${C3_SHA}'`
    );

    const warnRes = runResolver({
      attestation: conflictingAttestation,
      rawManifest,
      args: ['--conflict-mode', 'warn', '--image-label', 'ghcr.io/example/wedding_website@sha256:abc'],
    });
    expect(warnRes.status).toBe(0);
    expect(warnRes.stdout.trim()).toBe(`|${C1_SHA}|${C3_SHA}|conflict`);
    expect(warnRes.stderr).toContain('::warning::');
  });

  it('handles empty attestation input and invalid non-40-char annotations gracefully', () => {
    const emptyRes = runResolver({ attestation: '' });
    expect(emptyRes.status).toBe(0);
    expect(emptyRes.stdout.trim()).toBe('|||none');

    const invalidAnnotationRes = runResolver({
      attestation: [
        {
          verificationResult: {
            signature: { certificate: { sourceRepositoryDigest: C2_SHA } },
          },
        },
      ],
      rawManifest: {
        annotations: { 'org.opencontainers.image.revision': 'not-a-valid-sha' },
      },
    });
    expect(invalidAnnotationRes.status).toBe(0);
    expect(invalidAnnotationRes.stdout.trim()).toBe(`${C2_SHA}||${C2_SHA}|slsa-provenance`);
  });
});
