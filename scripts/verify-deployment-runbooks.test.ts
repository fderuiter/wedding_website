import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractPrismaMigrateCommands, verifyDeploymentRunbooks } from './verify-deployment-runbooks';

function copyRepoFixture(srcRoot: string, destRoot: string): void {
  const filesToCopy = [
    '.nvmrc',
    'package.json',
    'prisma.config.ts',
    'prisma/schema.prisma',
    'Dockerfile',
    'docker-entrypoint.sh',
    'docker-compose.yml',
    'docker-compose.ci.yml',
    'docker-compose.rollout.yml',
    'next.config.ts',
    'vercel.json',
    'src/env.ts',
    'src/lib/config.ts',
    'src/lib/modules.ts',
    'src/middleware.ts',
    'src/app/api/uploads/[...path]/route.ts',
    'src/app/api/admin/maintenance/export/route.ts',
    'scripts/preflight-env.ts',
    'ARCHITECTURE.md',
    'CHANGELOG.md',
    'DEPLOYMENT.md',
    'docs/upgrading.md',
    'docs/versioning.md',
    'docs/runtime-contract.md',
    'docs/deployment/README.md',
    'docs/deployment/vercel.md',
    'docs/deployment/gcp-cloud-run.md',
    'docs/deployment/docker-vps.md',
    'docs/deployment/railway-render.md',
    'scripts/generate-docs.ts',
    '.github/dependabot.yml',
  ];

  for (const relPath of filesToCopy) {
    const srcPath = path.join(srcRoot, relPath);
    const destPath = path.join(destRoot, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }

  const workflowsSrc = path.join(srcRoot, '.github/workflows');
  const workflowsDest = path.join(destRoot, '.github/workflows');
  fs.mkdirSync(workflowsDest, { recursive: true });
  for (const entry of fs.readdirSync(workflowsSrc)) {
    if (entry.endsWith('.yml') || entry.endsWith('.yaml')) {
      fs.copyFileSync(path.join(workflowsSrc, entry), path.join(workflowsDest, entry));
    }
  }

  const migrationsSrc = path.join(srcRoot, 'prisma/migrations');
  const migrationsDest = path.join(destRoot, 'prisma/migrations');
  fs.mkdirSync(migrationsDest, { recursive: true });
  for (const entry of fs.readdirSync(migrationsSrc, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      fs.mkdirSync(path.join(migrationsDest, entry.name), { recursive: true });
    }
  }
}

describe('verify-deployment-runbooks', () => {
  const repoRoot = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-runbooks-test-'));
    copyRepoFixture(repoRoot, tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes with zero errors against the live repository', () => {
    expect(verifyDeploymentRunbooks(repoRoot)).toEqual([]);
  });

  it('extracts multi-line and chained prisma migrate commands from fenced and inline code', () => {
    const markdown = [
      'Inline override: `DATABASE_URL="$POSTGRES_URL_NON_POOLING" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy && next build`',
      '',
      '```bash',
      '# Generate rollback SQL',
      'npx prisma migrate diff \\',
      '  --from-config-datasource \\',
      '  --to-schema prisma/schema.prisma \\',
      '  --script > rollback.sql',
      '```',
    ].join('\n');

    const extracted = extractPrismaMigrateCommands('DEPLOYMENT.md', markdown);
    expect(extracted).toHaveLength(2);
    expect(extracted[0]).toMatchObject({
      subcommand: 'deploy',
      flags: [],
      isFencedBlock: false,
    });
    expect(extracted[1]).toMatchObject({
      subcommand: 'diff',
      flags: ['--from-config-datasource', '--to-schema', '--script'],
      isFencedBlock: true,
    });
  });

  it('rejects removed Prisma <7 migrate diff flags and missing Vercel DATABASE_URL override', () => {
    const deploymentPath = path.join(tempDir, 'DEPLOYMENT.md');
    const brokenDeployment = fs
      .readFileSync(deploymentPath, 'utf8')
      .replace(
        '--from-config-datasource --to-schema prisma/schema.prisma',
        '--from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma'
      );
    fs.writeFileSync(deploymentPath, brokenDeployment);

    const vercelPath = path.join(tempDir, 'docs/deployment/vercel.md');
    const brokenVercel = fs
      .readFileSync(vercelPath, 'utf8')
      .replace(
        'DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy && next build',
        'npx prisma migrate deploy && next build'
      );
    fs.writeFileSync(vercelPath, brokenVercel);

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Removed Prisma <7 flag "--from-schema-datasource"'),
        expect.stringContaining('Removed Prisma <7 flag "--to-schema-datamodel"'),
        expect.stringContaining('docs/deployment/vercel.md: `npx prisma migrate deploy` must explicitly override DATABASE_URL='),
      ])
    );
  });

  it('rejects stale Cloud Run service names, mutable :latest image tags, missing WIF or parameterized Cloud Run docs, and missing GUEST_SESSION_SECRET', () => {
    const gcpPath = path.join(tempDir, 'docs/deployment/gcp-cloud-run.md');
    const original = fs
      .readFileSync(gcpPath, 'utf8')
      .replace(/CLOUD_RUN_SERVICE/g, 'REMOVED_SERVICE_VAR')
      .replace(/GCP_WORKLOAD_IDENTITY_PROVIDER/g, 'REMOVED_WIF_VAR');
    const brokenGcp = `${original}\n\n\`\`\`bash\ngcloud run deploy wedding-service --image gcr.io/demo/wedding-website:latest --set-secrets="DATABASE_URL=DATABASE_URL:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest,GUEST_PASSCODE=GUEST_PASSCODE:latest"\n\`\`\`\n`;
    fs.writeFileSync(gcpPath, brokenGcp);

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('References stale service name "wedding-service" instead of "wedding-website"'),
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Must document parameterized Cloud Run target variables CLOUD_RUN_SERVICE and CLOUD_RUN_REGION'
        ),
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Must document Workload Identity Federation with GCP_WORKLOAD_IDENTITY_PROVIDER and GCP_SERVICE_ACCOUNT'
        ),
        expect.stringContaining('Container image "gcr.io/demo/wedding-website:latest" must pull from primary registry "ghcr.io/"'),
        expect.stringContaining('Mutable ":latest" image tag prohibited'),
        expect.stringContaining('Manual `gcloud run deploy` command omits mandatory GUEST_SESSION_SECRET'),
      ])
    );
  });

  it('rejects Workload Identity Federation claims in gcp-cloud-run.md when deploy-provider.yml only authenticates via credentials_json', () => {
    const deployProviderPath = path.join(tempDir, '.github/workflows/deploy-provider.yml');
    const keyOnlyWorkflow = fs
      .readFileSync(deployProviderPath, 'utf8')
      .replace(/workload_identity_provider:/g, '# key-only-test:');
    fs.writeFileSync(deployProviderPath, keyOnlyWorkflow);

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Claims Workload Identity Federation'),
      ])
    );
  });

  it('rejects missing Compose migration service, E2E_TEST=false omission, and unmapped standalone docker run rollbacks', () => {
    const dockerPath = path.join(tempDir, 'docs/deployment/docker-vps.md');
    const brokenDocker = fs
      .readFileSync(dockerPath, 'utf8')
      .replace(/\bmigration\b/g, 'legacy-migrator')
      .replace(/E2E_TEST=false/g, 'E2E_TEST=true')
      .replace(
        /docker run -d --name app-rollback[\s\S]*?wedding-website:previous/,
        'docker run -d --name wedding-app --env-file .env wedding-website:latest'
      );
    fs.writeFileSync(dockerPath, brokenDocker);

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('docs/deployment/docker-vps.md: Missing docker-compose.yml service "migration"'),
        expect.stringContaining('docs/deployment/docker-vps.md: Must document E2E_TEST=false'),
        expect.stringContaining('Rollback `docker run` command lacks host port mapping'),
        expect.stringContaining('Rollback `docker run` command lacks Compose network attachment'),
        expect.stringContaining('Rollback `docker run` command must not deploy mutable :latest tag'),
      ])
    );
  });

  it('rejects phantom non-workflow secrets and missing workflow/CI identifiers in DEPLOYMENT.md', () => {
    const deploymentPath = path.join(tempDir, 'DEPLOYMENT.md');
    const brokenDeployment = fs
      .readFileSync(deploymentPath, 'utf8')
      .replace(/storybook\.yml/g, 'removed-workflow.yml')
      .replace(/build:export/g, 'legacy-export')
      .replace(
        '| `DOCKERHUB_TOKEN` |',
        '| `ADMIN_PASSWORD` | Runtime only |\n| `DOCKERHUB_TOKEN` |'
      );
    fs.writeFileSync(deploymentPath, brokenDeployment);

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DEPLOYMENT.md: Missing GitHub Actions workflow reference "storybook.yml"'),
        expect.stringContaining('DEPLOYMENT.md: Missing static HTML showcase script reference "build:export"'),
        expect.stringContaining('Secret "ADMIN_PASSWORD" in Setup and Secrets table is not referenced via secrets.*'),
      ])
    );
  });

  it('rejects missing HOSTNAME=0.0.0.0, missing uploads_data volume, missing webhook exclusion, unwrapped rollback jq, missing v* tag logic, and missing vercel.json cron', () => {
    fs.writeFileSync(
      path.join(tempDir, 'Dockerfile'),
      fs.readFileSync(path.join(tempDir, 'Dockerfile'), 'utf8').replace('ENV HOSTNAME="0.0.0.0"', 'ENV HOSTNAME="127.0.0.1"')
    );
    fs.writeFileSync(
      path.join(tempDir, 'docker-compose.yml'),
      fs
        .readFileSync(path.join(tempDir, 'docker-compose.yml'), 'utf8')
        .replace('HOSTNAME: "0.0.0.0"', 'HOSTNAME: "localhost"')
        .replace('- uploads_data:/app/public/uploads', '- ./tmp:/tmp')
    );
    fs.writeFileSync(
      path.join(tempDir, 'src/middleware.ts'),
      fs
        .readFileSync(path.join(tempDir, 'src/middleware.ts'), 'utf8')
        .replace("(normalizedPath === '/api/registry/webhook/stripe' && method === 'POST') ||", '')
    );
    fs.writeFileSync(
      path.join(tempDir, '.github/workflows/rollback.yml'),
      fs
        .readFileSync(path.join(tempDir, '.github/workflows/rollback.yml'), 'utf8')
        .replace("jq -r '.data.status // empty'", "jq -r '.status // empty'")
    );
    fs.writeFileSync(
      path.join(tempDir, '.github/workflows/publish-artifact.yml'),
      fs
        .readFileSync(path.join(tempDir, '.github/workflows/publish-artifact.yml'), 'utf8')
        .replace(/GITHUB_REF_NAME/g, 'UNUSED_REF')
    );
    fs.writeFileSync(path.join(tempDir, 'vercel.json'), JSON.stringify({ crons: [] }));

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Dockerfile: Missing `ENV HOSTNAME="0.0.0.0"`'),
        expect.stringContaining('docker-compose.yml: `app` service must set `HOSTNAME: "0.0.0.0"`'),
        expect.stringContaining('docker-compose.yml: `app` service must mount `uploads_data:/app/public/uploads`'),
        expect.stringContaining('src/middleware.ts: Must exclude `/api/registry/webhook/stripe`'),
        expect.stringContaining('.github/workflows/rollback.yml: Unwrapped `.status` or `.database` jq query detected'),
        expect.stringContaining('.github/workflows/publish-artifact.yml: Must publish `GITHUB_REF_NAME`'),
        expect.stringContaining('vercel.json: Must configure a valid 5-field cron schedule for `/api/cron/broadcasts`'),
      ])
    );
  });

  it('rejects documenting GitHub Actions Variables (e.g. SERVICE_URL, CLOUD_RUN_SERVICE) as GitHub Environment Secrets', () => {
    const deploymentPath = path.join(tempDir, 'DEPLOYMENT.md');
    const brokenDeployment = fs
      .readFileSync(deploymentPath, 'utf8')
      .replace(
        '| `DOCKERHUB_TOKEN` | Docker Hub access token (optional secondary registry) | `publish-artifact.yml` |',
        '| `DOCKERHUB_TOKEN` | Docker Hub access token (optional secondary registry) | `publish-artifact.yml` |\n| `SERVICE_URL` | Legacy secret placement | `deploy.yml` |\n| `CLOUD_RUN_SERVICE` | Misclassified variable | `deploy-provider.yml` |'
      );
    fs.writeFileSync(deploymentPath, brokenDeployment);

    const gcpPath = path.join(tempDir, 'docs/deployment/gcp-cloud-run.md');
    const brokenGcp = fs
      .readFileSync(gcpPath, 'utf8')
      .replace(
        '*   **GitHub Environment Secrets** (`staging`, `production`, and optional `production-rollback` without `DATABASE_URL`):',
        '*   **GitHub Environment Secrets** (`staging`, `production`, and optional `production-rollback` without `DATABASE_URL`):\n    *   `SERVICE_URL`: Stale secret placement.\n    *   `GCP_WORKLOAD_IDENTITY_PROVIDER`: Misclassified variable.'
      );
    fs.writeFileSync(gcpPath, brokenGcp);

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          '"SERVICE_URL" must be documented as a primary GitHub Actions Variable (vars.SERVICE_URL)'
        ),
        expect.stringContaining(
          '"CLOUD_RUN_SERVICE" must be documented as a primary GitHub Actions Variable (vars.CLOUD_RUN_SERVICE)'
        ),
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Lists SERVICE_URL under GitHub Environment Secrets instead of GitHub Environment Variables'
        ),
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Lists GCP_WORKLOAD_IDENTITY_PROVIDER under GitHub Environment Secrets instead of GitHub Environment Variables'
        ),
      ])
    );
  });

  it('rejects unquoted leading ! tags and invalid YAML 1.2 syntax in .github/workflows/', () => {
    const deployProviderPath = path.join(tempDir, '.github/workflows/deploy-provider.yml');
    const brokenWorkflow = fs
      .readFileSync(deployProviderPath, 'utf8')
      .replace(
        'if: "!(inputs.dry_run && inputs.image_digest == \'\' && inputs.image_tag == \'latest\')"',
        "if: !(inputs.dry_run && inputs.image_digest == '' && inputs.image_tag == 'latest')"
      );
    fs.writeFileSync(deployProviderPath, brokenWorkflow);
    const expectedLine =
      brokenWorkflow
        .split(/\r?\n/)
        .findIndex((line) =>
          line.includes("if: !(inputs.dry_run && inputs.image_digest == '' && inputs.image_tag == 'latest')")
        ) + 1;

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `.github/workflows/deploy-provider.yml:${expectedLine}: Invalid YAML 1.2 tag/warning (TAG_RESOLVE_FAILED)`
        ),
      ])
    );
  });

  it('rejects fallback secrets, non-loopback db ports, E2E_TEST=true, missing 21-key forwarding, and broken docker-compose.ci.yml overrides', () => {
    const composePath = path.join(tempDir, 'docker-compose.yml');
    fs.writeFileSync(
      composePath,
      fs
        .readFileSync(composePath, 'utf8')
        .replace('127.0.0.1:${DB_PORT:-5432}:5432', '${DB_PORT:-5432}:5432')
        .replace(/\$\{CONTAINER_DATABASE_URL:-/g, '${DATABASE_URL:-')
        .replace('${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}', '${ADMIN_PASSWORD:-scrypt:c2FsdA==:aGFzaA==}')
        .replace('E2E_TEST: ${E2E_TEST:-false}', 'E2E_TEST: ${E2E_TEST:-true}')
        .replace('      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:-}\n', '')
    );

    const ciComposePath = path.join(tempDir, 'docker-compose.ci.yml');
    fs.writeFileSync(
      ciComposePath,
      fs
        .readFileSync(ciComposePath, 'utf8')
        .replace('E2E_TEST: ${E2E_TEST:-true}', 'E2E_TEST: ${E2E_TEST:-false}')
    );

    const dockerMdPath = path.join(tempDir, 'docs/deployment/docker-vps.md');
    fs.writeFileSync(
      dockerMdPath,
      `${fs.readFileSync(dockerMdPath, 'utf8')}\nADMIN_PASSWORD="scrypt:c2FsdA==:aGFzaA=="\n`
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('docker-compose.yml: `db` service must bind PostgreSQL strictly to loopback'),
        expect.stringContaining(
          'docker-compose.yml: `migration` service must scope container `DATABASE_URL` overrides via `${CONTAINER_DATABASE_URL:-...}`'
        ),
        expect.stringContaining(
          'docker-compose.yml: `app` service must scope container `DATABASE_URL` overrides via `${CONTAINER_DATABASE_URL:-...}`'
        ),
        expect.stringContaining('docker-compose.yml: Must require explicit operator value via ${ADMIN_PASSWORD:?...}'),
        expect.stringContaining('docker-compose.yml: Must not contain invalid 4-byte placeholder hash'),
        expect.stringContaining('docker-compose.yml: `app` service must set `E2E_TEST: ${E2E_TEST:-false}`'),
        expect.stringContaining('docker-compose.yml: `app` service environment must forward runtime variable "STRIPE_SECRET_KEY"'),
        expect.stringContaining('docker-compose.ci.yml: `app` service must isolate `E2E_TEST: ${E2E_TEST:-true}`'),
        expect.stringContaining('docs/deployment/docker-vps.md: Must not document invalid 4-byte placeholder hash'),
      ])
    );
  });

  it('rejects invalid documented DATABASE_URL, POSTGRES_URL_NON_POOLING, and PostgreSQL URIs across all seven runbooks', () => {
    const runbookMutations: Array<{
      relPath: string;
      snippetToAppend: string;
      expectedSubstring: string;
    }> = [
      {
        relPath: 'docs/deployment/gcp-cloud-run.md',
        snippetToAppend:
          '\n```env\nDATABASE_URL="postgresql://wedding_user:STRONG_PASSWORD@/wedding_db?host=/cloudsql/my-proj:us-central1:wedding-db"\n```\n',
        expectedSubstring: 'docs/deployment/gcp-cloud-run.md: Invalid documented DATABASE_URL connection string',
      },
      {
        relPath: 'DEPLOYMENT.md',
        snippetToAppend:
          '\nBroken inline URI: `postgresql://wedding:secret@/wedding_db`\n',
        expectedSubstring: 'DEPLOYMENT.md: Invalid documented PostgreSQL URI',
      },
      {
        relPath: 'docs/runtime-contract.md',
        snippetToAppend:
          '\n```env\nDATABASE_URL="mysql://root:pass@localhost:3306/wedding"\n```\n',
        expectedSubstring: 'docs/runtime-contract.md: Invalid documented DATABASE_URL connection string',
      },
      {
        relPath: 'docs/deployment/README.md',
        snippetToAppend:
          '\n```env\nDATABASE_URL="postgresql://user:pass@localhost:5432/wedding?sslmode=bogus"\n```\n',
        expectedSubstring: 'docs/deployment/README.md: Invalid documented DATABASE_URL connection string',
      },
      {
        relPath: 'docs/deployment/vercel.md',
        snippetToAppend:
          '\n```env\nPOSTGRES_URL_NON_POOLING="postgresql://user:pass@/wedding_db"\n```\n',
        expectedSubstring: 'docs/deployment/vercel.md: Invalid documented POSTGRES_URL_NON_POOLING connection string',
      },
      {
        relPath: 'docs/deployment/docker-vps.md',
        snippetToAppend:
          '\n```env\nDATABASE_URL="postgresql://user:pass@db:5432/wedding?connection_limit=0"\n```\n',
        expectedSubstring: 'docs/deployment/docker-vps.md: Invalid documented DATABASE_URL connection string',
      },
      {
        relPath: 'docs/deployment/railway-render.md',
        snippetToAppend:
          '\n```env\nDATABASE_URL="postgres://"\n```\n',
        expectedSubstring: 'docs/deployment/railway-render.md: Invalid documented DATABASE_URL connection string',
      },
    ];

    for (const mutation of runbookMutations) {
      const fullPath = path.join(tempDir, mutation.relPath);
      fs.writeFileSync(fullPath, `${fs.readFileSync(fullPath, 'utf8')}${mutation.snippetToAppend}`);
    }

    const errors = verifyDeploymentRunbooks(tempDir);
    for (const mutation of runbookMutations) {
      expect(errors).toEqual(
        expect.arrayContaining([expect.stringContaining(mutation.expectedSubstring)])
      );
    }
    expect(JSON.stringify(errors)).not.toContain('STRONG_PASSWORD');
  });

  it('rejects Node.js and PostgreSQL major version drift across Dockerfile, compose, workflows, generate-docs.ts, runtime/architecture docs, and dependabot.yml', () => {
    const dockerfilePath = path.join(tempDir, 'Dockerfile');
    fs.writeFileSync(
      dockerfilePath,
      fs.readFileSync(dockerfilePath, 'utf8').replace('node:22-bookworm-slim@', 'node:26-bookworm-slim@')
    );

    const composePath = path.join(tempDir, 'docker-compose.yml');
    fs.writeFileSync(
      composePath,
      fs.readFileSync(composePath, 'utf8').replace('postgres:15-alpine@', 'postgres:18-alpine@')
    );

    const storybookWorkflowPath = path.join(tempDir, '.github/workflows/storybook.yml');
    fs.writeFileSync(
      storybookWorkflowPath,
      fs.readFileSync(storybookWorkflowPath, 'utf8').replace("node-version-file: '.nvmrc'", 'node-version: 22')
    );

    const publishWorkflowPath = path.join(tempDir, '.github/workflows/publish-artifact.yml');
    fs.writeFileSync(
      publishWorkflowPath,
      fs
        .readFileSync(publishWorkflowPath, 'utf8')
        .replace(
          / {6}- uses: actions\/setup-node@[^\n]+\n {8}with:\n {10}node-version-file: '\.nvmrc'\n\n/,
          ''
        )
    );

    const generateDocsPath = path.join(tempDir, 'scripts/generate-docs.ts');
    fs.writeFileSync(
      generateDocsPath,
      fs.readFileSync(generateDocsPath, 'utf8').replace("'22.x'", "'26.x'")
    );

    const architecturePath = path.join(tempDir, 'ARCHITECTURE.md');
    fs.writeFileSync(
      architecturePath,
      fs.readFileSync(architecturePath, 'utf8').replace('- **Node.js**: v22.x', '- **Node.js**: v26.x')
    );

    const runtimeContractPath = path.join(tempDir, 'docs/runtime-contract.md');
    fs.writeFileSync(
      runtimeContractPath,
      fs.readFileSync(runtimeContractPath, 'utf8').replace('v22.x LTS', 'v26.x LTS')
    );

    const dependabotPath = path.join(tempDir, '.github/dependabot.yml');
    fs.writeFileSync(
      dependabotPath,
      fs
        .readFileSync(dependabotPath, 'utf8')
        .replace('@types/node', '@types/legacy-node')
        .replace('dependency-name: "postgres"', 'dependency-name: "legacy-postgres"')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Dockerfile: Must pin `node:22-bookworm-slim@sha256:<64-hex>` matching .nvmrc'),
        expect.stringContaining(
          'docker-compose.yml: `db` service must pin `postgres:15-alpine@sha256:<64-hex>` to preserve `db_data` volume compatibility'
        ),
        expect.stringContaining(
          ".github/workflows/storybook.yml (job \"build\"): `actions/setup-node` must set `node-version-file: '.nvmrc'`"
        ),
        expect.stringContaining(
          '.github/workflows/publish-artifact.yml (job "build"): Workflow job invokes node/npm/npx without `actions/setup-node` bound to `.nvmrc`'
        ),
        expect.stringContaining(
          'scripts/generate-docs.ts: `generateEnvSpecs` must specify Node.js `22.x` matching .nvmrc'
        ),
        expect.stringContaining('ARCHITECTURE.md: Must specify `- **Node.js**: v22.x` matching .nvmrc'),
        expect.stringContaining('docs/runtime-contract.md: Must specify Node.js v22.x LTS and `node:22-bookworm-slim`'),
        expect.stringContaining(
          '.github/dependabot.yml: Missing `version-update:semver-major` ignore rule for `postgres` under `docker-compose` ecosystem'
        ),
        expect.stringContaining(
          '.github/dependabot.yml: Missing `version-update:semver-major` ignore rule for `@types/node` under `npm` ecosystem'
        ),
      ])
    );
  });

  it('rejects PostgreSQL < 15 claims, /api/health liveness prose, Docker Compose npx migrate claims, and missing Dependabot >= 23.0.0 rules', () => {
    const deploymentPath = path.join(tempDir, 'DEPLOYMENT.md');
    fs.writeFileSync(
      deploymentPath,
      fs
        .readFileSync(deploymentPath, 'utf8')
        .replace('PostgreSQL 15 or higher', 'PostgreSQL 14 or higher')
        .replace(
          'dedicated `migration` task service executes `./node_modules/.bin/prisma migrate deploy` offline',
          'dedicated `migration` task service executes `npx prisma migrate deploy`'
        )
        .replace(
          /## Health Checks & Liveness Probes[\s\S]*?---/,
          '## Health Checks & Liveness Probes\n\nContainers and orchestrators query `/api/health` for liveness and readiness monitoring.\n\n---'
        )
    );

    const dependabotPath = path.join(tempDir, '.github/dependabot.yml');
    fs.writeFileSync(
      dependabotPath,
      fs.readFileSync(dependabotPath, 'utf8').replace(/versions:\s*\[">= 23\.0\.0"\]\n/g, '')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DEPLOYMENT.md: References unsupported PostgreSQL < 15 floor'),
        expect.stringContaining(
          'DEPLOYMENT.md: Must document offline `./node_modules/.bin/prisma migrate deploy` (not `npx prisma migrate deploy`) for the Docker Compose `migration` service'
        ),
        expect.stringContaining(
          'DEPLOYMENT.md: Must direct container and orchestrator liveness probes to `/api/live` instead of `/api/health`'
        ),
        expect.stringContaining(
          'DEPLOYMENT.md: `## Health Checks & Liveness Probes` section must direct container liveness probes to `/api/live`'
        ),
        expect.stringContaining(
          '.github/dependabot.yml: Missing `versions: [">= 23.0.0"]` ignore rule for `node` under `docker` ecosystem'
        ),
      ])
    );
  });

  it('rejects --command="npx" on Cloud Run jobs, unguarded DATABASE_URL overrides on docker compose run, and missing /usr/local/etc/npmrc in Dockerfile', () => {
    const gcpPath = path.join(tempDir, 'docs/deployment/gcp-cloud-run.md');
    fs.writeFileSync(
      gcpPath,
      fs
        .readFileSync(gcpPath, 'utf8')
        .replace(
          '--args="./node_modules/.bin/prisma,migrate,deploy"',
          '--command="npx" \\\n    --args="prisma,migrate,deploy"'
        )
    );

    const dockerPath = path.join(tempDir, 'docs/deployment/docker-vps.md');
    fs.writeFileSync(
      dockerPath,
      `${fs.readFileSync(dockerPath, 'utf8')}\nUnguarded Compose override: \`docker compose run --rm -e DATABASE_URL="$POSTGRES_URL_NON_POOLING" migration\`\n`
    );

    const dockerfilePath = path.join(tempDir, 'Dockerfile');
    fs.writeFileSync(
      dockerfilePath,
      fs.readFileSync(dockerfilePath, 'utf8').replace('/usr/local/etc/npmrc', '/tmp/unused-npmrc')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Cloud Run job command'
        ),
        expect.stringContaining('must not override ENTRYPOINT with `--command`'),
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Cloud Run migration job must pass `--args="./node_modules/.bin/prisma,migrate,deploy"` without `--command`'
        ),
        expect.stringContaining(
          'docs/deployment/docker-vps.md: `docker compose run --rm -e DATABASE_URL="$POSTGRES_URL_NON_POOLING" migration` overrides DATABASE_URL on `docker compose run` without unsetting or clearing POSTGRES_URL_NON_POOLING'
        ),
        expect.stringContaining(
          'Dockerfile: Must write `update-notifier=false` to `/usr/local/etc/npmrc`'
        ),
      ])
    );
  });

  it('rejects invalid Cloud Run --startup-probe-* / --liveness-probe-* flags and Host overrides in container healthchecks', () => {
    const gcpPath = path.join(tempDir, 'docs/deployment/gcp-cloud-run.md');
    fs.writeFileSync(
      gcpPath,
      fs
        .readFileSync(gcpPath, 'utf8')
        .replace(
          '--liveness-probe=httpGet.path=/api/live,httpGet.port=3000,periodSeconds=30',
          '--startup-probe-request-path=/api/health --liveness-probe-request-path=/api/live'
        )
    );

    const runtimeContractPath = path.join(tempDir, 'docs/runtime-contract.md');
    fs.writeFileSync(
      runtimeContractPath,
      `${fs.readFileSync(runtimeContractPath, 'utf8')}\nLegacy flag: \`--startup-probe-request-path=/api/health\`\n`
    );

    const dockerfilePath = path.join(tempDir, 'Dockerfile');
    fs.writeFileSync(
      dockerfilePath,
      fs
        .readFileSync(dockerfilePath, 'utf8')
        .replace(
          "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/live')",
          "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/live',{headers:{Host:h}})"
        )
    );

    const composePath = path.join(tempDir, 'docker-compose.yml');
    fs.writeFileSync(
      composePath,
      fs
        .readFileSync(composePath, 'utf8')
        .replace(
          "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/live')",
          "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/live',{headers:{Host:h}})"
        )
    );

    const rolloutComposePath = path.join(tempDir, 'docker-compose.rollout.yml');
    fs.writeFileSync(
      rolloutComposePath,
      fs
        .readFileSync(rolloutComposePath, 'utf8')
        .replace(
          "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/live')",
          "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/live',{headers:{Host:h}})"
        )
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Invalid Cloud Run CLI flag "--startup-probe-request-path"'
        ),
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Invalid Cloud Run CLI flag "--liveness-probe-request-path"'
        ),
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Must document `--liveness-probe=httpGet.path=/api/live,httpGet.port=3000,periodSeconds=30`'
        ),
        expect.stringContaining(
          'docs/runtime-contract.md: Invalid Cloud Run CLI flag "--startup-probe-request-path"'
        ),
        expect.stringContaining(
          'Dockerfile: `HEALTHCHECK` on `/api/live` must not override `Host` header in `fetch()`'
        ),
        expect.stringContaining(
          'docker-compose.yml: `app` `healthcheck` on `/api/live` must not override `Host` header in `fetch()`'
        ),
        expect.stringContaining(
          'docker-compose.rollout.yml: `app-standby` `healthcheck` on `/api/live` must not override `Host` header in `fetch()`'
        ),
      ])
    );
  });

  it('rejects missing webhook wire docs, missing release_ref promotion alignment, omitted CI verify scripts, and storybook.yml cache drift', () => {
    const dockerPath = path.join(tempDir, 'docs/deployment/docker-vps.md');
    fs.writeFileSync(
      dockerPath,
      fs
        .readFileSync(dockerPath, 'utf8')
        .replace(/\$\{X-Deploy-Timestamp\}\.\$\{PAYLOAD\}/g, 'REMOVED_HMAC_FORMULA')
        .replace(/DEPLOY_WEBHOOK_SECRET/g, 'REMOVED_WEBHOOK_SECRET')
    );

    const deploymentPath = path.join(tempDir, 'DEPLOYMENT.md');
    fs.writeFileSync(
      deploymentPath,
      fs
        .readFileSync(deploymentPath, 'utf8')
        .replace(/check:setup-guides/g, 'removed-setup-check')
        .replace(/check:spec-contracts/g, 'removed-spec-check')
        .replace(/release_ref/g, 'removed_ref_input')
    );

    const gcpPath = path.join(tempDir, 'docs/deployment/gcp-cloud-run.md');
    fs.writeFileSync(
      gcpPath,
      fs.readFileSync(gcpPath, 'utf8').replace(/release_ref/g, 'removed_ref_input')
    );

    const storybookWorkflowPath = path.join(tempDir, '.github/workflows/storybook.yml');
    fs.writeFileSync(
      storybookWorkflowPath,
      fs
        .readFileSync(storybookWorkflowPath, 'utf8')
        .replace('node_modules/.cache/storybook\n', '')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'docs/deployment/docker-vps.md: Signed webhook adapter documentation is missing "DEPLOY_WEBHOOK_SECRET"'
        ),
        expect.stringContaining(
          'docs/deployment/docker-vps.md: Must document timestamp-prefixed HMAC formula `${X-Deploy-Timestamp}.${PAYLOAD}`'
        ),
        expect.stringContaining(
          'DEPLOYMENT.md: `verify` (`ci.yml`) job overview omits CI verification script "check:setup-guides"'
        ),
        expect.stringContaining(
          'DEPLOYMENT.md: `verify` (`ci.yml`) job overview omits CI verification script "check:spec-contracts"'
        ),
        expect.stringContaining(
          'DEPLOYMENT.md: Must document `release_ref` and `target_sha` commit resolution'
        ),
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Must document `release_ref` and `target_sha` commit resolution'
        ),
        expect.stringContaining(
          '.github/workflows/storybook.yml: `actions/cache` must cache "node_modules/.cache/storybook"'
        ),
      ])
    );
  });

  it('fails with remediation hints when Prisma migrations, envSchema keys, or docker-compose :? guards drift from CHANGELOG.md and docs/upgrading.md', () => {
    fs.mkdirSync(path.join(tempDir, 'prisma/migrations/20261215000000_add_shuttle_manifest'), {
      recursive: true,
    });

    const envTsPath = path.join(tempDir, 'src/env.ts');
    fs.writeFileSync(
      envTsPath,
      fs
        .readFileSync(envTsPath, 'utf8')
        .replace(
          "NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),",
          "NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),\n  SHUTTLE_API_KEY: z.string().optional(),"
        )
    );

    const composePath = path.join(tempDir, 'docker-compose.yml');
    fs.writeFileSync(
      composePath,
      fs
        .readFileSync(composePath, 'utf8')
        .replace(
          'STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:-}',
          'STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:-}\n      SHUTTLE_API_KEY: ${SHUTTLE_API_KEY:?SHUTTLE_API_KEY is required}'
        )
        .replace('  uploads_data:', '  uploads_data:\n  archive_data:')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CHANGELOG.md: Migration count drift'),
        expect.stringContaining('20261215000000_add_shuttle_manifest'),
        expect.stringContaining('Added runtime environment variable "SHUTTLE_API_KEY" in src/env.ts is missing'),
        expect.stringContaining('CHANGELOG.md: Docker Compose mandatory `:?` secret guard "SHUTTLE_API_KEY"'),
        expect.stringContaining('docs/upgrading.md: Docker Compose mandatory `:?` secret guard "SHUTTLE_API_KEY"'),
        expect.stringContaining('CHANGELOG.md: Persistent Docker Compose volume "archive_data"'),
        expect.stringContaining('docs/upgrading.md: Persistent Docker Compose volume "archive_data"'),
        expect.stringContaining('Remediation:'),
      ])
    );
  });

  it('rejects Adopter Action Required: No, ModuleConfigSchema / BACKUP_SCHEMA_VERSION drift, and missing preflight/rollback steps in docs/upgrading.md', () => {
    const changelogPath = path.join(tempDir, 'CHANGELOG.md');
    fs.writeFileSync(
      changelogPath,
      fs
        .readFileSync(changelogPath, 'utf8')
        .replace('> **Adopter Action Required**: Yes', '> **Adopter Action Required**: No')
    );

    const exportRoutePath = path.join(tempDir, 'src/app/api/admin/maintenance/export/route.ts');
    fs.writeFileSync(
      exportRoutePath,
      fs
        .readFileSync(exportRoutePath, 'utf8')
        .replace("const BACKUP_SCHEMA_VERSION = '2.0';", "const BACKUP_SCHEMA_VERSION = '3.0';")
    );

    const modulesPath = path.join(tempDir, 'src/lib/modules.ts');
    fs.writeFileSync(
      modulesPath,
      fs
        .readFileSync(modulesPath, 'utf8')
        .replace('interactive3D: z.boolean().default(true),', 'interactive3D: z.boolean().default(true),\n  photoBooth: z.boolean().default(true),')
    );

    const upgradingPath = path.join(tempDir, 'docs/upgrading.md');
    fs.writeFileSync(
      upgradingPath,
      fs
        .readFileSync(upgradingPath, 'utf8')
        .replace(/preflight-env\.ts/g, 'verify-env-docs.ts')
        .replace(/preflight:env/g, 'check:env-docs')
        .replace(/RUN_MIGRATIONS=true/g, 'LEGACY_MIGRATE=1')
        .replace(
          /docker run -d --name app-rollback[\s\S]*?wedding-website:previous/,
          'docker run -d --name app-rollback --env-file .env wedding-website:latest'
        )
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Sets `Adopter Action Required: No` despite'),
        expect.stringContaining('CHANGELOG.md: Backup schema version drift — src/app/api/admin/maintenance/export/route.ts sets BACKUP_SCHEMA_VERSION="3.0"'),
        expect.stringContaining('docs/upgrading.md: Backup schema version drift — expected `schemaVersion: "3.0"`'),
        expect.stringContaining('CHANGELOG.md: Module toggle contract drift with src/lib/modules.ts'),
        expect.stringContaining('docs/upgrading.md: Module toggle contract drift with src/lib/modules.ts'),
        expect.stringContaining('docs/upgrading.md: Step 7 must invoke the local operator `.env` preflight CLI'),
        expect.stringContaining('docs/upgrading.md: Standalone Docker upgrade track must document `RUN_MIGRATIONS=true`'),
        expect.stringContaining('docs/upgrading.md: Rollback `docker run` command lacks host port mapping'),
        expect.stringContaining('docs/upgrading.md: Rollback `docker run` command lacks Compose network attachment'),
        expect.stringContaining('docs/upgrading.md: Rollback `docker run` command must not deploy mutable :latest tag'),
      ])
    );
  });
});
