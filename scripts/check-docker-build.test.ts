/**
 * @jest-environment node
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { checkDockerBuild } from './check-docker-build';

const REPO_ROOT = process.cwd();
const CHECK_SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'check-docker-build.ts');
const TSX_CLI_PATH = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const NODE_DIGEST = 'sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee';
const POSTGRES_DIGEST = 'sha256:e18480a22d6e48f4d816a6696769b1ec09ac73a824c5649e49c7d8b684913f3d';
const ALT_DIGEST = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';

function writeValidFixtureWorkspace(targetDir: string): void {
  const workflowsDir = path.join(targetDir, '.github', 'workflows');
  fs.mkdirSync(workflowsDir, { recursive: true });

  fs.writeFileSync(path.join(targetDir, '.nvmrc'), '22\n');
  fs.writeFileSync(
    path.join(targetDir, 'package.json'),
    `${JSON.stringify(
      {
        name: 'wedding-website-fixture',
        private: true,
        engines: {
          node: '^22.12.0',
          npm: '^10.9.0',
        },
        devEngines: {
          runtime: {
            name: 'node',
            version: '^22.12.0',
            onFail: 'error',
          },
          packageManager: {
            name: 'npm',
            version: '^10.9.0',
            onFail: 'error',
          },
        },
      },
      null,
      2
    )}\n`
  );

  fs.writeFileSync(
    path.join(targetDir, 'Dockerfile'),
    [
      '# syntax=docker/dockerfile:1',
      `FROM node:22-bookworm-slim@${NODE_DIGEST} AS base`,
      'WORKDIR /app',
      'RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\',
      '    --mount=type=cache,target=/var/lib/apt,sharing=locked \\',
      '    rm -f /etc/apt/apt.conf.d/docker-clean && \\',
      '    apt-get update && apt-get install -y --no-install-recommends \\',
      '    openssl \\',
      '    ca-certificates \\',
      '    tini',
      'FROM base AS prisma-cli',
      'WORKDIR /opt/prisma-cli',
      'FROM base AS builder',
      'COPY package.json package-lock.json .npmrc ./',
      'RUN --mount=type=cache,target=/root/.npm,sharing=locked \\',
      '    npm ci --ignore-scripts',
      'COPY prisma ./prisma',
      'COPY prisma.config.ts next.config.ts postcss.config.mjs tsconfig.json tsconfig.build.json next-env.d.ts ./',
      'COPY assets ./assets',
      'COPY public ./public',
      'COPY src ./src',
      'COPY scripts/generate-password-hash.mjs ./scripts/generate-password-hash.mjs',
      'RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \\',
      '    npm run build:docker',
      'FROM base AS runner',
      'RUN addgroup --system --gid 1001 nodejs && \\',
      '    adduser --system --uid 1001 --ingroup nodejs nextjs',
      'COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli',
      'COPY --from=builder /app/prisma.config.ts ./prisma.config.ts',
      'COPY --from=builder /app/scripts/generate-password-hash.mjs ./scripts/generate-password-hash.mjs',
      'RUN ln -sf /usr/local/bin/prisma /app/node_modules/.bin/prisma && \\',
      '    find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null || true',
      'HEALTHCHECK CMD node -e "fetch(\'http://127.0.0.1:3000/api/live\')"',
      'ENTRYPOINT ["/usr/bin/tini", "-s", "--", "docker-entrypoint.sh"]',
      'CMD ["node", "server.js"]',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(targetDir, '.dockerignore'),
    ['node_modules', '.next', '.dockerignore', 'Dockerfile', 'docker-compose*.yml', ''].join('\n')
  );

  fs.writeFileSync(
    path.join(targetDir, 'docker-compose.yml'),
    [
      'services:',
      '  db:',
      `    image: postgres:15-alpine@${POSTGRES_DIGEST}`,
      '  migration:',
      '    image: wedding-website:latest',
      '    build:',
      '      context: .',
      '  app:',
      '    image: wedding-website:latest',
      '    init: true',
      '    stop_grace_period: 15s',
      '    build:',
      '      context: .',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(targetDir, 'docker-compose.ci.yml'),
    [
      'services:',
      '  migration:',
      '    build:',
      '      cache_from:',
      '        - type=gha,scope=${GHA_CACHE_SCOPE:-app-amd64}',
      '  app:',
      '    build:',
      '      cache_from:',
      '        - type=gha,scope=${GHA_CACHE_SCOPE:-app-amd64}',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(workflowsDir, 'ci.yml'),
    [
      'name: CI',
      'on:',
      '  pull_request:',
      'jobs:',
      '  unit-test:',
      '    runs-on: ubuntu-latest',
      '    services:',
      '      db:',
      `        image: postgres:15-alpine@${POSTGRES_DIGEST}`,
      '    steps:',
      '      - run: npm test',
      '  deploy:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: google-github-actions/deploy-cloudrun@2028e2d7d30a78c6910e0632e48dd561b064884d',
      '        with:',
      '          image: ${{ steps.resolve.outputs.image_uri }}',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(targetDir, 'docker-entrypoint.sh'),
    [
      '#!/bin/sh',
      'export NPM_CONFIG_UPDATE_NOTIFIER=false',
      'if [ "$RUN_MIGRATIONS" = "true" ] || [ "$RUN_MIGRATIONS" = "1" ]; then',
      '  ./node_modules/.bin/prisma migrate deploy',
      'fi',
      'exec "$@"',
      '',
    ].join('\n')
  );

  fs.writeFileSync(
    path.join(targetDir, 'next.config.ts'),
    ["const nextConfig = { output: 'standalone' };", 'export default nextConfig;', ''].join('\n')
  );
}

describe('check-docker-build', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-docker-build-test-'));
    writeValidFixtureWorkspace(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes with zero violations on the live repository configuration', () => {
    const { violations } = checkDockerBuild(REPO_ROOT);
    expect(violations).toEqual([]);
  });

  it('accepts pinned digests, internal stage aliases, local Compose build services, and ${{ ... }} workflow expressions', () => {
    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual([]);

    const cliResult = spawnSync(process.execPath, [TSX_CLI_PATH, CHECK_SCRIPT_PATH], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    expect(cliResult.status).toBe(0);
    expect(cliResult.stdout).toContain('passed');
  });

  it('rejects unpinned tags across Dockerfile, docker-compose.yml, and .github/workflows/*.yml', () => {
    const dockerfilePath = path.join(tempDir, 'Dockerfile');
    fs.writeFileSync(
      dockerfilePath,
      fs.readFileSync(dockerfilePath, 'utf8').replace(`@${NODE_DIGEST}`, '')
    );

    const composePath = path.join(tempDir, 'docker-compose.yml');
    fs.writeFileSync(
      composePath,
      fs.readFileSync(composePath, 'utf8').replace(`@${POSTGRES_DIGEST}`, '')
    );

    const ciPath = path.join(tempDir, '.github', 'workflows', 'ci.yml');
    fs.writeFileSync(
      ciPath,
      fs.readFileSync(ciPath, 'utf8').replace(`@${POSTGRES_DIGEST}`, '@sha256:short')
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'Dockerfile',
          lineNumber: 2,
          imageRef: 'node:22-bookworm-slim',
          reason: expect.stringContaining('missing an immutable "@sha256:<64-hex>" digest'),
        }),
        expect.objectContaining({
          filePath: 'docker-compose.yml',
          lineNumber: 3,
          imageRef: 'postgres:15-alpine',
          reason: expect.stringContaining('missing an immutable "@sha256:<64-hex>" digest'),
        }),
        expect.objectContaining({
          filePath: '.github/workflows/ci.yml',
          lineNumber: 9,
          imageRef: 'postgres:15-alpine@sha256:short',
          reason: expect.stringContaining('invalid digest "sha256:short"'),
        }),
      ])
    );

    const cliResult = spawnSync(process.execPath, [TSX_CLI_PATH, CHECK_SCRIPT_PATH], {
      cwd: tempDir,
      encoding: 'utf8',
    });
    expect(cliResult.status).toBe(1);
    expect(cliResult.stderr).toContain('missing an immutable "@sha256:<64-hex>" digest');
  });

  it('rejects mismatched @sha256 digests for the same image across docker-compose.yml and workflows', () => {
    const ciPath = path.join(tempDir, '.github', 'workflows', 'ci.yml');
    fs.writeFileSync(
      ciPath,
      fs.readFileSync(ciPath, 'utf8').replace(POSTGRES_DIGEST, ALT_DIGEST)
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      filePath: '.github/workflows/ci.yml',
      lineNumber: 9,
    });
    expect(violations[0].reason).toContain('does not match');
    expect(violations[0].reason).toContain('docker-compose.yml:3');
  });

  it('enforces BuildKit APT cache rules and --no-install-recommends in Dockerfile', () => {
    fs.writeFileSync(
      path.join(tempDir, 'Dockerfile'),
      [
        '# syntax=docker/dockerfile:1',
        `FROM node:22-bookworm-slim@${NODE_DIGEST} AS base`,
        'WORKDIR /app',
        'RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\',
        '    --mount=type=cache,target=/var/lib/apt,sharing=locked \\',
        '    apt-get update && apt-get install -y \\',
        '    openssl \\',
        '    ca-certificates \\',
        '    && rm -rf /var/lib/apt/lists/*',
        'FROM base AS prisma-cli',
        'WORKDIR /opt/prisma-cli',
        'FROM base AS builder',
        'COPY . .',
        'FROM base AS runner',
        'COPY --from=prisma-cli --chown=nextjs:nodejs /opt/prisma-cli /opt/prisma-cli',
        'COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts',
        'CMD ["node", "server.js"]',
        '',
      ].join('\n')
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'Dockerfile',
          lineNumber: 4,
          imageRef: '/etc/apt/apt.conf.d/docker-clean',
          reason: expect.stringContaining('rm -f /etc/apt/apt.conf.d/docker-clean'),
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          lineNumber: 4,
          imageRef: 'apt-get install',
          reason: expect.stringContaining('--no-install-recommends'),
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          lineNumber: 4,
          imageRef: '/var/lib/apt/lists/*',
          reason: expect.stringContaining('must not delete "/var/lib/apt/lists/*"'),
        }),
      ])
    );
  });

  it('rejects missing BuildKit APT cache mounts and docker-clean placed after apt-get', () => {
    fs.writeFileSync(
      path.join(tempDir, 'Dockerfile'),
      [
        '# syntax=docker/dockerfile:1',
        `FROM node:22-bookworm-slim@${NODE_DIGEST} AS base`,
        'WORKDIR /app',
        'RUN apt-get update && apt-get install -y --no-install-recommends openssl && \\',
        '    rm -f /etc/apt/apt.conf.d/docker-clean',
        'FROM base AS prisma-cli',
        'WORKDIR /opt/prisma-cli',
        'FROM base AS builder',
        'COPY . .',
        'FROM base AS runner',
        'COPY --from=prisma-cli --chown=nextjs:nodejs /opt/prisma-cli /opt/prisma-cli',
        'COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts',
        'CMD ["node", "server.js"]',
        '',
      ].join('\n')
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'Dockerfile',
          lineNumber: 4,
          imageRef: '/var/cache/apt',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          lineNumber: 4,
          imageRef: '/var/lib/apt',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          lineNumber: 4,
          imageRef: '/etc/apt/apt.conf.d/docker-clean',
        }),
      ])
    );
  });

  it('validates job container images and docker:// action references in workflows', () => {
    fs.writeFileSync(
      path.join(tempDir, '.github', 'workflows', 'containers.yml'),
      [
        'name: Containers',
        'on:',
        '  workflow_dispatch:',
        'jobs:',
        '  job-container:',
        '    runs-on: ubuntu-latest',
        '    container: alpine:3.20',
        '    steps:',
        '      - uses: docker://busybox:1.36',
        '',
      ].join('\n')
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: '.github/workflows/containers.yml',
          lineNumber: 7,
          imageRef: 'alpine:3.20',
        }),
        expect.objectContaining({
          filePath: '.github/workflows/containers.yml',
          lineNumber: 9,
          imageRef: 'busybox:1.36',
        }),
      ])
    );
  });

  it('enforces least-privilege runner ownership, tini PID 1, /api/live HEALTHCHECK, and offline entrypoint rules', () => {
    fs.writeFileSync(
      path.join(tempDir, 'Dockerfile'),
      [
        '# syntax=docker/dockerfile:1',
        `FROM node:22-bookworm-slim@${NODE_DIGEST} AS base`,
        'WORKDIR /app',
        'RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\',
        '    --mount=type=cache,target=/var/lib/apt,sharing=locked \\',
        '    rm -f /etc/apt/apt.conf.d/docker-clean && \\',
        '    apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates',
        'FROM base AS prisma-cli',
        'WORKDIR /opt/prisma-cli',
        'FROM base AS builder',
        'COPY . .',
        'FROM base AS runner',
        'COPY --from=prisma-cli --chown=nextjs:nodejs /opt/prisma-cli /opt/prisma-cli',
        'COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts',
        'CMD ["node", "server.js"]',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(tempDir, 'docker-entrypoint.sh'),
      ['#!/bin/sh', 'npx -y prisma migrate deploy', 'exec "$@"', ''].join('\n')
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: '--chown=nextjs:nodejs',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: '/usr/bin/tini',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'nextjs:nodejs',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'chmod a-s',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'HEALTHCHECK /api/live',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: '/app/node_modules/.bin/prisma',
        }),
        expect.objectContaining({
          filePath: 'docker-entrypoint.sh',
          imageRef: 'npx',
        }),
        expect.objectContaining({
          filePath: 'docker-entrypoint.sh',
          imageRef: './node_modules/.bin/prisma migrate deploy',
        }),
        expect.objectContaining({
          filePath: 'docker-entrypoint.sh',
          imageRef: 'NPM_CONFIG_UPDATE_NOTIFIER=false',
        }),
      ])
    );
  });

  it('rejects Node.js major version drift across Dockerfile, .nvmrc, and package.json', () => {
    const dockerfilePath = path.join(tempDir, 'Dockerfile');
    fs.writeFileSync(
      dockerfilePath,
      fs
        .readFileSync(dockerfilePath, 'utf8')
        .replace(`node:22-bookworm-slim@${NODE_DIGEST}`, `node:26-bookworm-slim@${NODE_DIGEST}`)
    );

    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      `${JSON.stringify(
        {
          name: 'wedding-website-fixture',
          private: true,
          engines: {
            node: '^20.11.0',
            npm: '^10.9.0',
          },
        },
        null,
        2
      )}\n`
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'Dockerfile',
          lineNumber: 2,
          imageRef: 'node:26-bookworm-slim',
          reason: expect.stringContaining('does not match expected "node:22-bookworm-slim" from .nvmrc'),
        }),
        expect.objectContaining({
          filePath: 'package.json',
          imageRef: 'engines.node',
          reason: expect.stringContaining('does not match .nvmrc ("22")'),
        }),
      ])
    );
  });

  it('rejects premature prisma copy before npm ci, COPY . ., missing explicit builder inputs, and docker-entrypoint.sh in builder', () => {
    fs.writeFileSync(
      path.join(tempDir, 'Dockerfile'),
      [
        '# syntax=docker/dockerfile:1',
        `FROM node:22-bookworm-slim@${NODE_DIGEST} AS base`,
        'WORKDIR /app',
        'RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \\',
        '    --mount=type=cache,target=/var/lib/apt,sharing=locked \\',
        '    rm -f /etc/apt/apt.conf.d/docker-clean && \\',
        '    apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini',
        'FROM base AS prisma-cli',
        'WORKDIR /opt/prisma-cli',
        'FROM base AS builder',
        'COPY package.json package-lock.json ./',
        'COPY prisma ./prisma',
        'RUN npm ci',
        'COPY . .',
        'COPY docker-entrypoint.sh ./',
        'RUN npm run build:docker',
        'FROM base AS runner',
        'RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs nextjs',
        'COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli',
        'COPY --from=builder /app/prisma.config.ts ./prisma.config.ts',
        'RUN ln -sf /usr/local/bin/prisma /app/node_modules/.bin/prisma && find / -xdev -perm /6000 -type f -exec chmod a-s {} + 2>/dev/null || true',
        'HEALTHCHECK CMD node -e "fetch(\'http://127.0.0.1:3000/api/live\')"',
        'ENTRYPOINT ["/usr/bin/tini", "-s", "--", "docker-entrypoint.sh"]',
        'CMD ["node", "server.js"]',
        '',
      ].join('\n')
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'prisma',
          reason: expect.stringContaining('before "npm ci --ignore-scripts"'),
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: '/root/.npm',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'npm ci --ignore-scripts',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'COPY . .',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'docker-entrypoint.sh',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: '/app/.next/cache',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'assets',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'tsconfig.build.json',
        }),
      ])
    );
  });

  it('enforces Dockerfile exclusion in .dockerignore and GHA cache isolation in docker-compose.ci.yml', () => {
    fs.writeFileSync(
      path.join(tempDir, '.dockerignore'),
      ['node_modules', '.next', 'docker-entrypoint.sh', ''].join('\n')
    );

    fs.writeFileSync(
      path.join(tempDir, 'docker-compose.yml'),
      [
        'services:',
        '  db:',
        `    image: postgres:15-alpine@${POSTGRES_DIGEST}`,
        '  app:',
        '    image: wedding-website:latest',
        '    build:',
        '      context: .',
        '      cache_from:',
        '        - type=gha,scope=${GHA_CACHE_SCOPE:-app-amd64}',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(tempDir, 'docker-compose.ci.yml'),
      [
        'services:',
        '  migration:',
        '    environment:',
        '      DATABASE_URL: postgres://wedding:wedding123@db:5432/wedding',
        '  app:',
        '    build:',
        '      cache_from:',
        '        - type=gha,scope=${GHA_CACHE_SCOPE:-app-amd64}',
        '      cache_to:',
        '        - type=gha,scope=${GHA_CACHE_SCOPE:-app-amd64},mode=max',
        '',
      ].join('\n')
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: '.dockerignore',
          imageRef: 'Dockerfile',
        }),
        expect.objectContaining({
          filePath: '.dockerignore',
          imageRef: 'docker-entrypoint.sh',
        }),
        expect.objectContaining({
          filePath: 'docker-compose.yml',
          imageRef: 'type=gha',
        }),
        expect.objectContaining({
          filePath: 'docker-compose.ci.yml',
          imageRef: 'migration.build.cache_from',
        }),
        expect.objectContaining({
          filePath: 'docker-compose.ci.yml',
          imageRef: 'app.build.cache_to',
        }),
      ])
    );
  });

  it('rejects devEngines drift, /opt/prisma-cli under /app, broad /app/scripts copy, missing RUN_MIGRATIONS=1, and short stop_grace_period', () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      `${JSON.stringify(
        {
          name: 'wedding-website-fixture',
          private: true,
          engines: {
            node: '^22.12.0',
            npm: '^9.0.0',
          },
          devEngines: {
            runtime: {
              name: 'node',
              version: '^22.0.0',
              onFail: 'warn',
            },
            packageManager: {
              name: 'npm',
              version: '^9.0.0',
              onFail: 'warn',
            },
          },
        },
        null,
        2
      )}\n`
    );

    const dockerfilePath = path.join(tempDir, 'Dockerfile');
    fs.writeFileSync(
      dockerfilePath,
      fs
        .readFileSync(dockerfilePath, 'utf8')
        .replace(
          'COPY --from=prisma-cli /opt/prisma-cli /opt/prisma-cli',
          'COPY --from=prisma-cli /opt/prisma-cli ./prisma-cli'
        )
        .replace(
          'COPY --from=builder /app/scripts/generate-password-hash.mjs ./scripts/generate-password-hash.mjs',
          'COPY --from=builder /app/scripts ./scripts'
        )
    );

    const composePath = path.join(tempDir, 'docker-compose.yml');
    fs.writeFileSync(
      composePath,
      fs
        .readFileSync(composePath, 'utf8')
        .replace('    init: true\n', '')
        .replace('    stop_grace_period: 15s', '    stop_grace_period: 5s')
    );

    const entrypointPath = path.join(tempDir, 'docker-entrypoint.sh');
    fs.writeFileSync(
      entrypointPath,
      fs
        .readFileSync(entrypointPath, 'utf8')
        .replace(
          'if [ "$RUN_MIGRATIONS" = "true" ] || [ "$RUN_MIGRATIONS" = "1" ]; then',
          'if [ "$RUN_MIGRATIONS" = "true" ]; then'
        )
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'package.json',
          imageRef: 'engines.npm',
        }),
        expect.objectContaining({
          filePath: 'package.json',
          imageRef: 'devEngines.runtime',
        }),
        expect.objectContaining({
          filePath: 'package.json',
          imageRef: 'devEngines.packageManager',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: '/opt/prisma-cli',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: '/app/prisma-cli',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: 'scripts/generate-password-hash.mjs',
        }),
        expect.objectContaining({
          filePath: 'Dockerfile',
          imageRef: '/app/scripts',
        }),
        expect.objectContaining({
          filePath: 'docker-compose.yml',
          imageRef: 'app.init',
        }),
        expect.objectContaining({
          filePath: 'docker-compose.yml',
          imageRef: 'app.stop_grace_period',
        }),
        expect.objectContaining({
          filePath: 'docker-entrypoint.sh',
          imageRef: 'RUN_MIGRATIONS=1',
        }),
      ])
    );
  });

  it('allows pull_policy: never services sharing a local build image across docker-compose.yml and docker-compose.rollout.yml', () => {
    fs.writeFileSync(
      path.join(tempDir, 'docker-compose.yml'),
      [
        'services:',
        '  db:',
        `    image: postgres:15-alpine@${POSTGRES_DIGEST}`,
        '  migration:',
        '    image: wedding-website:latest',
        '    pull_policy: never',
        '  app:',
        '    image: wedding-website:latest',
        '    init: true',
        '    stop_grace_period: 15s',
        '    build:',
        '      context: .',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(tempDir, 'docker-compose.rollout.yml'),
      [
        'services:',
        '  app-standby:',
        '    image: wedding-website:latest',
        '    pull_policy: never',
        '',
      ].join('\n')
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual([]);
  });

  it('rejects Compose services without build when pull_policy: never is omitted or image is not locally built, and rejects merge keys in docker-compose.rollout.yml', () => {
    fs.writeFileSync(
      path.join(tempDir, 'docker-compose.yml'),
      [
        'services:',
        '  db:',
        `    image: postgres:15-alpine@${POSTGRES_DIGEST}`,
        '  migration:',
        '    image: wedding-website:latest',
        '  app:',
        '    image: wedding-website:latest',
        '    init: true',
        '    stop_grace_period: 15s',
        '    build:',
        '      context: .',
        '',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(tempDir, 'docker-compose.rollout.yml'),
      [
        'x-defaults: &defaults',
        '  read_only: true',
        'services:',
        '  app-standby:',
        '    <<: *defaults',
        '    image: unpinned-external-image:latest',
        '    pull_policy: never',
        '',
      ].join('\n')
    );

    const { violations } = checkDockerBuild(tempDir);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filePath: 'docker-compose.yml',
          imageRef: 'wedding-website:latest',
        }),
        expect.objectContaining({
          filePath: 'docker-compose.rollout.yml',
          imageRef: 'unpinned-external-image:latest',
        }),
        expect.objectContaining({
          filePath: 'docker-compose.rollout.yml',
          reason: expect.stringContaining('<<'),
        }),
      ])
    );
  });

  describe('standalone output verification (pre-build vs --require-standalone)', () => {
    function writeValidStandaloneBundle(targetDir: string): void {
      const standaloneDir = path.join(targetDir, '.next', 'standalone');
      const staticChunksDir = path.join(standaloneDir, '.next', 'static', 'chunks');
      const publicAssetsDir = path.join(standaloneDir, 'public', 'assets');
      fs.mkdirSync(staticChunksDir, { recursive: true });
      fs.mkdirSync(publicAssetsDir, { recursive: true });
      fs.writeFileSync(path.join(standaloneDir, 'server.js'), 'console.log("standalone");\n');
      fs.writeFileSync(path.join(staticChunksDir, 'main.js'), 'console.log("chunk");\n');
      fs.writeFileSync(path.join(publicAssetsDir, 'favicon.png'), 'png-bytes');
    }

    it('passes in pre-build mode when .next does not exist, and fails with --require-standalone', () => {
      expect(checkDockerBuild(tempDir).violations).toEqual([]);

      const requireRes = checkDockerBuild(tempDir, { requireStandalone: true });
      expect(requireRes.violations).toEqual([
        expect.objectContaining({
          filePath: '.next',
          imageRef: '.next',
        }),
      ]);

      const cliResult = spawnSync(
        process.execPath,
        [TSX_CLI_PATH, CHECK_SCRIPT_PATH, '--require-standalone'],
        {
          cwd: tempDir,
          encoding: 'utf8',
        }
      );
      expect(cliResult.status).toBe(1);
      expect(cliResult.stderr).toContain('.next build output directory is missing');
    });

    it('exits with code 0 under --require-standalone when server.js, .next/static, and public are staged cleanly', () => {
      writeValidStandaloneBundle(tempDir);

      expect(checkDockerBuild(tempDir, { requireStandalone: true }).violations).toEqual([]);

      const cliResult = spawnSync(
        process.execPath,
        [TSX_CLI_PATH, CHECK_SCRIPT_PATH, '--require-standalone'],
        {
          cwd: tempDir,
          encoding: 'utf8',
        }
      );
      expect(cliResult.status).toBe(0);
      expect(cliResult.stdout).toContain('passed');
    });

    it('fails with --require-standalone when server.js, .next/standalone/.next/static, or .next/standalone/public is missing', () => {
      writeValidStandaloneBundle(tempDir);
      fs.rmSync(path.join(tempDir, '.next', 'standalone', 'server.js'));
      fs.rmSync(path.join(tempDir, '.next', 'standalone', '.next', 'static'), {
        recursive: true,
        force: true,
      });
      fs.rmSync(path.join(tempDir, '.next', 'standalone', 'public'), {
        recursive: true,
        force: true,
      });

      const { violations } = checkDockerBuild(tempDir, { requireStandalone: true });
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            filePath: '.next/standalone/server.js',
            imageRef: 'server.js',
          }),
          expect.objectContaining({
            filePath: '.next/standalone/.next/static',
            imageRef: '.next/standalone/.next/static',
          }),
          expect.objectContaining({
            filePath: '.next/standalone/public',
            imageRef: '.next/standalone/public',
          }),
        ])
      );

      const cliResult = spawnSync(
        process.execPath,
        [TSX_CLI_PATH, CHECK_SCRIPT_PATH, '--require-standalone'],
        {
          cwd: tempDir,
          encoding: 'utf8',
        }
      );
      expect(cliResult.status).toBe(1);
    });

    it('fails when standalone assets contain nested duplicate directories or mockServiceWorker.js contamination', () => {
      writeValidStandaloneBundle(tempDir);
      fs.mkdirSync(path.join(tempDir, '.next', 'standalone', 'public', 'public'), {
        recursive: true,
      });
      fs.mkdirSync(path.join(tempDir, '.next', 'standalone', '.next', 'static', 'static'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(tempDir, '.next', 'standalone', 'public', 'mockServiceWorker.js'),
        '// dev worker\n'
      );

      const { violations } = checkDockerBuild(tempDir, { requireStandalone: true });
      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            filePath: '.next/standalone/public/public',
            imageRef: 'public/public',
          }),
          expect.objectContaining({
            filePath: '.next/standalone/.next/static/static',
            imageRef: 'static/static',
          }),
          expect.objectContaining({
            filePath: '.next/standalone/public/mockServiceWorker.js',
            imageRef: 'mockServiceWorker.js',
          }),
        ])
      );
    });
  });
});
