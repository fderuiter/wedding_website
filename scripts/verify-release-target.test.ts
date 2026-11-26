/**
 * @jest-environment node
 */
import { execFileSync, spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = process.cwd();
const VERIFY_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'verify-release-target.sh');
const RESOLVE_PROVENANCE_PATH = path.join(REPO_ROOT, 'scripts', 'resolve-oci-provenance.sh');

const SAMPLE_DIGEST =
  'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

describe('scripts/verify-release-target.sh', () => {
  let tempDir: string;
  let bareOriginDir: string;
  let workRepoDir: string;
  let binDir: string;
  let ciRunsFile: string;
  let apiServerProc: ReturnType<typeof spawn>;
  let apiBaseUrl: string;

  let mainBaseSha: string;
  let mainHeadSha: string;
  let maintenanceSha: string;
  let unmergedBranchSha: string;
  let unattestedTagSha: string;

  function setMockCiRuns(runs: Array<Record<string, unknown>>) {
    fs.writeFileSync(ciRunsFile, JSON.stringify({ workflow_runs: runs }));
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-target-'));
    bareOriginDir = path.join(tempDir, 'origin.git');
    workRepoDir = path.join(tempDir, 'work');
    binDir = path.join(tempDir, 'bin');
    ciRunsFile = path.join(tempDir, 'ci_runs.json');

    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(path.join(workRepoDir, 'scripts'), { recursive: true });
    fs.copyFileSync(VERIFY_SCRIPT_PATH, path.join(workRepoDir, 'scripts', 'verify-release-target.sh'));
    fs.copyFileSync(
      RESOLVE_PROVENANCE_PATH,
      path.join(workRepoDir, 'scripts', 'resolve-oci-provenance.sh')
    );
    fs.chmodSync(path.join(workRepoDir, 'scripts', 'verify-release-target.sh'), 0o755);
    fs.chmodSync(path.join(workRepoDir, 'scripts', 'resolve-oci-provenance.sh'), 0o755);

    execFileSync('git', ['init', '--bare', bareOriginDir], { stdio: 'ignore' });
    execFileSync('git', ['init', '-b', 'main', workRepoDir], { stdio: 'ignore' });
    execFileSync('git', ['-C', workRepoDir, 'config', 'user.name', 'Test Bot'], { stdio: 'ignore' });
    execFileSync('git', ['-C', workRepoDir, 'config', 'user.email', 'ci@example.com'], {
      stdio: 'ignore',
    });
    execFileSync('git', ['-C', workRepoDir, 'remote', 'add', 'origin', bareOriginDir], {
      stdio: 'ignore',
    });

    // Base commit on main (tagged v1.0.0)
    fs.writeFileSync(path.join(workRepoDir, 'release.txt'), 'v1.0.0\n');
    execFileSync('git', ['-C', workRepoDir, 'add', 'release.txt'], { stdio: 'ignore' });
    execFileSync('git', ['-C', workRepoDir, 'commit', '-m', 'release v1.0.0'], { stdio: 'ignore' });
    mainBaseSha = execFileSync('git', ['-C', workRepoDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['-C', workRepoDir, 'tag', 'v1.0.0', mainBaseSha], { stdio: 'ignore' });

    // Maintenance branch off v1.0.0 (tagged v1.0.1, NOT merged to main)
    execFileSync('git', ['-C', workRepoDir, 'checkout', '-b', 'release/v1.0', mainBaseSha], {
      stdio: 'ignore',
    });
    fs.writeFileSync(path.join(workRepoDir, 'release.txt'), 'v1.0.1-hotfix\n');
    execFileSync('git', ['-C', workRepoDir, 'add', 'release.txt'], { stdio: 'ignore' });
    execFileSync('git', ['-C', workRepoDir, 'commit', '-m', 'hotfix v1.0.1'], { stdio: 'ignore' });
    maintenanceSha = execFileSync('git', ['-C', workRepoDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['-C', workRepoDir, 'tag', 'v1.0.1', maintenanceSha], { stdio: 'ignore' });

    // Unmerged feature branch and unattested v* tag
    execFileSync('git', ['-C', workRepoDir, 'checkout', '-b', 'feature/unmerged', mainBaseSha], {
      stdio: 'ignore',
    });
    fs.writeFileSync(path.join(workRepoDir, 'release.txt'), 'unmerged-feature\n');
    execFileSync('git', ['-C', workRepoDir, 'add', 'release.txt'], { stdio: 'ignore' });
    execFileSync('git', ['-C', workRepoDir, 'commit', '-m', 'unmerged feature'], { stdio: 'ignore' });
    unmergedBranchSha = execFileSync('git', ['-C', workRepoDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();

    fs.writeFileSync(path.join(workRepoDir, 'release.txt'), 'unattested-tag\n');
    execFileSync('git', ['-C', workRepoDir, 'add', 'release.txt'], { stdio: 'ignore' });
    execFileSync('git', ['-C', workRepoDir, 'commit', '-m', 'unattested tag commit'], {
      stdio: 'ignore',
    });
    unattestedTagSha = execFileSync('git', ['-C', workRepoDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['-C', workRepoDir, 'tag', 'v9.9.9-spoofed', unattestedTagSha], {
      stdio: 'ignore',
    });

    // Advance main HEAD and push main + tags to bare origin
    execFileSync('git', ['-C', workRepoDir, 'checkout', 'main'], { stdio: 'ignore' });
    fs.writeFileSync(path.join(workRepoDir, 'release.txt'), 'v2.0.0-main\n');
    execFileSync('git', ['-C', workRepoDir, 'add', 'release.txt'], { stdio: 'ignore' });
    execFileSync('git', ['-C', workRepoDir, 'commit', '-m', 'main v2.0.0'], { stdio: 'ignore' });
    mainHeadSha = execFileSync('git', ['-C', workRepoDir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['-C', workRepoDir, 'push', 'origin', 'main', '--tags'], { stdio: 'ignore' });

    // Shim gh CLI for OIDC attestation verification on v1.0.1 only
    const ghShim = path.join(binDir, 'gh');
    fs.writeFileSync(
      ghShim,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'attestation' && args[1] === 'verify' && args.includes('--format') && args.includes('json')) {
  const sourceRefIdx = args.indexOf('--source-ref');
  const sourceRef = sourceRefIdx >= 0 ? args[sourceRefIdx + 1] : '';
  const signerIdx = args.indexOf('--signer-workflow');
  const signer = signerIdx >= 0 ? args[signerIdx + 1] : '';
  if (
    sourceRef === 'refs/tags/v1.0.1' &&
    signer === 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml' &&
    process.env.MOCK_ATTESTATION_CONFLICT !== 'true'
  ) {
    process.stdout.write(JSON.stringify([
      {
        verificationResult: {
          signature: {
            certificate: {
              sourceRepositoryDigest: '${maintenanceSha}',
              sourceRepositoryRef: 'refs/tags/v1.0.1'
            }
          },
          statement: {
            predicate: {
              buildDefinition: {
                externalParameters: { inputs: { commit_sha: '${maintenanceSha}' } },
                resolvedDependencies: [{ digest: { gitCommit: '${maintenanceSha}' } }]
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

    const dockerShim = path.join(binDir, 'docker');
    fs.writeFileSync(
      dockerShim,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'login') process.exit(0);
if (args[0] === 'buildx' && args[1] === 'imagetools' && args[2] === 'inspect') {
  if (args.includes('--raw')) {
    const rev = process.env.MOCK_ATTESTATION_CONFLICT === 'true' ? '${mainHeadSha}' : '${maintenanceSha}';
    process.stdout.write(JSON.stringify({ annotations: { 'org.opencontainers.image.revision': rev } }));
    process.exit(0);
  }
  process.stdout.write('${SAMPLE_DIGEST}\\n');
  process.exit(0);
}
process.exit(1);
`,
      { mode: 0o755 }
    );

    setMockCiRuns([
      {
        id: 9101,
        head_sha: mainBaseSha,
        status: 'completed',
        conclusion: 'success',
        head_repository: { full_name: 'OwnerOrg/Wedding_Website' },
      },
      {
        id: 9102,
        head_sha: mainHeadSha,
        status: 'completed',
        conclusion: 'success',
        head_repository: { full_name: 'OwnerOrg/Wedding_Website' },
      },
      {
        id: 9103,
        head_sha: maintenanceSha,
        status: 'completed',
        conclusion: 'success',
        head_repository: { full_name: 'OwnerOrg/Wedding_Website' },
      },
      {
        id: 9104,
        head_sha: unmergedBranchSha,
        status: 'completed',
        conclusion: 'success',
        head_repository: { full_name: 'OwnerOrg/Wedding_Website' },
      },
      {
        id: 9105,
        head_sha: unattestedTagSha,
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
const url = require('url');
const runsFile = process.argv[1];
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url || '', true);
  if (parsed.pathname === '/repos/OwnerOrg/Wedding_Website/actions/workflows/ci.yml/runs') {
    const headSha = String(parsed.query.head_sha || '').toLowerCase();
    const payload = JSON.parse(fs.readFileSync(runsFile, 'utf8'));
    const filtered = (payload.workflow_runs || []).filter(
      (r) => !headSha || String(r.head_sha || '').toLowerCase() === headSha
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ workflow_runs: filtered }));
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\\n');
});
`,
        ciRunsFile,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );

    const port = await new Promise<string>((resolve, reject) => {
      let buf = '';
      apiServerProc.stdout?.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        const nl = buf.indexOf('\n');
        if (nl !== -1) resolve(buf.slice(0, nl).trim());
      });
      apiServerProc.on('error', reject);
    });
    apiBaseUrl = `http://127.0.0.1:${port}`;
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

  function runVerify(args: string[], envOverrides: Record<string, string> = {}, cwd?: string) {
    return spawnSync(
      'bash',
      [path.join(cwd ?? workRepoDir, 'scripts', 'verify-release-target.sh'), ...args],
      {
        cwd: cwd ?? workRepoDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
          GH_TOKEN: 'ghs_test_token',
          GITHUB_ACTOR_LOGIN: 'octocat',
          GITHUB_REPOSITORY: 'OwnerOrg/Wedding_Website',
          GITHUB_API_URL: apiBaseUrl,
          REPO_OWNER: 'OwnerOrg',
          SIGNER_WORKFLOW: 'OwnerOrg/Wedding_Website/.github/workflows/publish-artifact.yml',
          ...envOverrides,
        },
      }
    );
  }

  it('verifies origin/main commits and v* tags on origin/main with passing ci.yml runs', () => {
    const mainRes = runVerify(['--target-sha', mainHeadSha.toUpperCase()]);
    expect(mainRes.status).toBe(0);
    expect(mainRes.stdout.trim()).toBe(`${mainHeadSha}|origin-main||9102`);

    const tagOnMainRes = runVerify(['--release-tag', 'v1.0.0']);
    expect(tagOnMainRes.status).toBe(0);
    expect(tagOnMainRes.stdout.trim()).toBe(`${mainBaseSha}|origin-main|v1.0.0|9101`);
  });

  it('rejects unmerged feature branches and unattested unmerged v* tags even if ci.yml succeeded', () => {
    const branchRes = runVerify(['--target-sha', unmergedBranchSha]);
    expect(branchRes.status).toBe(1);
    expect(branchRes.stderr).toContain('is not an ancestor of origin/main');

    const spoofedTagRes = runVerify(['--release-tag', 'v9.9.9-spoofed']);
    expect(spoofedTagRes.status).toBe(1);
    expect(spoofedTagRes.stderr).toContain('lacks valid OIDC provenance signed by');

    const spoofedShaRes = runVerify(['--target-sha', unattestedTagSha]);
    expect(spoofedShaRes.status).toBe(1);
    expect(spoofedShaRes.stderr).toContain('lacks valid OIDC provenance signed by');
  });

  it('accepts OIDC-attested v* maintenance tags unless --require-main-ancestry is set, and fails closed on OCI/SLSA conflict', () => {
    const byTagRes = runVerify(['--release-tag', 'v1.0.1']);
    expect(byTagRes.status).toBe(0);
    expect(byTagRes.stdout.trim()).toBe(`${maintenanceSha}|maintenance-tag|v1.0.1|9103`);

    const byShaRes = runVerify(['--target-sha', maintenanceSha, '--image-digest', SAMPLE_DIGEST]);
    expect(byShaRes.status).toBe(0);
    expect(byShaRes.stdout.trim()).toBe(`${maintenanceSha}|maintenance-tag|v1.0.1|9103`);

    const strictMainRes = runVerify(['--target-sha', maintenanceSha, '--require-main-ancestry']);
    expect(strictMainRes.status).toBe(1);
    expect(strictMainRes.stderr).toContain('is not an ancestor of origin/main');

    const conflictRes = runVerify(['--release-tag', 'v1.0.1'], {
      MOCK_ATTESTATION_CONFLICT: 'true',
    });
    expect(conflictRes.status).toBe(1);
    expect(conflictRes.stderr).toContain('Conflicting OCI/SLSA provenance metadata');
  });

  it('requires a completed passing ci.yml run on GITHUB_REPOSITORY unless --skip-ci-check is passed', () => {
    // Fork CI run for the same SHA must be ignored
    setMockCiRuns([
      {
        id: 9900,
        head_sha: mainHeadSha,
        status: 'completed',
        conclusion: 'success',
        head_repository: { full_name: 'AttackerFork/Wedding_Website' },
      },
    ]);

    const forkOnlyRes = runVerify(['--target-sha', mainHeadSha]);
    expect(forkOnlyRes.status).toBe(1);
    expect(forkOnlyRes.stderr).toContain('No completed successful ci.yml workflow run found');

    const skipCiRes = runVerify(['--target-sha', mainHeadSha, '--skip-ci-check']);
    expect(skipCiRes.status).toBe(0);
    expect(skipCiRes.stdout.trim()).toBe(`${mainHeadSha}|origin-main||skipped`);
  });

  it('unshallows shallow clones and rejects latest, invalid inputs, and tag/SHA mismatches', () => {
    const shallowCloneDir = path.join(tempDir, 'shallow-clone');
    execFileSync('git', ['clone', '--depth', '1', `file://${bareOriginDir}`, shallowCloneDir], {
      stdio: 'ignore',
    });
    fs.mkdirSync(path.join(shallowCloneDir, 'scripts'), { recursive: true });
    fs.copyFileSync(
      VERIFY_SCRIPT_PATH,
      path.join(shallowCloneDir, 'scripts', 'verify-release-target.sh')
    );
    fs.copyFileSync(
      RESOLVE_PROVENANCE_PATH,
      path.join(shallowCloneDir, 'scripts', 'resolve-oci-provenance.sh')
    );

    const shallowRes = runVerify(['--target-sha', mainBaseSha], {}, shallowCloneDir);
    expect(shallowRes.status).toBe(0);
    expect(shallowRes.stdout.trim()).toBe(`${mainBaseSha}|origin-main||9101`);

    expect(runVerify(['--release-tag', 'latest']).status).toBe(1);
    expect(runVerify(['--release-tag', 'feature/branch']).status).toBe(1);
    expect(runVerify(['--target-sha', 'not-a-40-hex-sha']).status).toBe(1);
    expect(runVerify(['--target-sha', mainHeadSha, '--release-tag', 'v1.0.0']).status).toBe(1);
  });
});
