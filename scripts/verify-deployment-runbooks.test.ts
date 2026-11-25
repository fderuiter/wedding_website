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
    'src/lib/prisma.ts',
    'src/lib/postgres-url.js',
    'src/lib/modules.ts',
    'src/middleware.ts',
    'src/utils/withApiMiddleware.ts',
    'src/app/api/uploads/[...path]/route.ts',
    'src/app/api/admin/maintenance/export/route.ts',
    'scripts/preflight-env.ts',
    'scripts/test-container.mjs',
    'scripts/rollout-vps.sh',
    'scripts/verify-migration-compatibility.ts',
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
    'docker/prisma-cli/package.json',
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
      .replace(/static-export-build/g, 'removed-demo-job')
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
        expect.stringContaining('DEPLOYMENT.md: Missing ci.yml job reference "static-export-build"'),
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
      path.join(tempDir, '.github/workflows/deploy-stage.yml'),
      fs
        .readFileSync(path.join(tempDir, '.github/workflows/deploy-stage.yml'), 'utf8')
        .replace('READY_ENDPOINT="${TARGET_URL}/api/ready"', 'READY_ENDPOINT=""')
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
        expect.stringContaining(
          '.github/workflows/deploy-stage.yml: Post-deployment/rollback probe must poll both `/api/health` and `/api/ready`'
        ),
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

    const ciWorkflowPath = path.join(tempDir, '.github/workflows/ci.yml');
    fs.writeFileSync(
      ciWorkflowPath,
      fs
        .readFileSync(ciWorkflowPath, 'utf8')
        .replace(
          'image: ${{ needs.verify.outputs.db_image }}',
          'image: postgres:18-alpine@sha256:e18480a22d6e48f4d816a6696769b1ec09ac73a824c5649e49c7d8b684913f3d'
        )
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
          '.github/workflows/ci.yml: PostgreSQL service containers must pin `postgres:15-alpine@sha256:<64-hex>` (or `${{ needs.verify.outputs.db_image }}`) matching docker-compose.yml'
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

  it('requires updating docs/runtime-contract.md (plus release/upgrade model names) without count drift or touching provider hosting runbooks when Prisma schema fields or models are added', () => {
    const schemaPath = path.join(tempDir, 'prisma/schema.prisma');
    fs.writeFileSync(
      schemaPath,
      fs
        .readFileSync(schemaPath, 'utf8')
        .replace(
          'model AppConfig {\n',
          'model AppConfig {\n  ceremonyLivestreamUrl String? @default("")\n'
        )
        .concat('\nmodel GuestSurveyResponse {\n  id String @id @default(cuid())\n}\n')
    );

    const missingErrors = verifyDeploymentRunbooks(tempDir);
    expect(missingErrors).toEqual(
      expect.arrayContaining([
        'docs/runtime-contract.md: Missing persisted prisma/schema.prisma model `GuestSurveyResponse` in canonical runtime entity summary',
        expect.stringContaining('CHANGELOG.md: Post-0.1.0 Prisma model "GuestSurveyResponse"'),
        expect.stringContaining('docs/upgrading.md: Prisma model "GuestSurveyResponse"'),
      ])
    );
    expect(missingErrors.some((err) => err.includes('count drift'))).toBe(false);
    expect(missingErrors.some((err) => err.startsWith('DEPLOYMENT.md:') || err.startsWith('docs/deployment/'))).toBe(
      false
    );

    const runtimeContractPath = path.join(tempDir, 'docs/runtime-contract.md');
    fs.writeFileSync(
      runtimeContractPath,
      fs
        .readFileSync(runtimeContractPath, 'utf8')
        .replace('`AuthLockout`', '`AuthLockout`, `GuestSurveyResponse`')
    );

    const changelogPath = path.join(tempDir, 'CHANGELOG.md');
    fs.writeFileSync(
      changelogPath,
      fs
        .readFileSync(changelogPath, 'utf8')
        .replace('`AuthLockout`', '`AuthLockout`, `GuestSurveyResponse`')
    );

    const upgradingPath = path.join(tempDir, 'docs/upgrading.md');
    fs.writeFileSync(
      upgradingPath,
      fs
        .readFileSync(upgradingPath, 'utf8')
        .replace('`SnapshotVersion`', '`SnapshotVersion`, `GuestSurveyResponse`')
    );

    expect(verifyDeploymentRunbooks(tempDir)).toEqual([]);
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

  it('rejects missing Dependabot minor/patch container tag ignores, debian suite bounds, github-actions grouping, prisma security grouping, and prisma-cli manifest range drift', () => {
    const dependabotPath = path.join(tempDir, '.github/dependabot.yml');
    fs.writeFileSync(
      dependabotPath,
      fs
        .readFileSync(dependabotPath, 'utf8')
        .replace('open-pull-requests-limit: 10', 'open-pull-requests-limit: 5')
        .replace(
          /\s*- dependency-name: "node"\n\s*update-types:\n\s*- "version-update:semver-minor"\n\s*- "version-update:semver-patch"/,
          ''
        )
        .replace(/\s*- dependency-name: "debian"\n\s*update-types: \["version-update:semver-major"\]/, '')
        .replace(/\s*- "version-update:semver-minor"\n\s*- "version-update:semver-patch"/, '')
        .replace('applies-to: "security-updates"', 'applies-to: "version-updates"')
    );

    const prismaCliPkgPath = path.join(tempDir, 'docker/prisma-cli/package.json');
    const prismaCliPkg = JSON.parse(fs.readFileSync(prismaCliPkgPath, 'utf8')) as {
      dependencies: Record<string, string>;
      overrides: Record<string, string>;
    };
    prismaCliPkg.dependencies.prisma = '7.10.1';
    prismaCliPkg.overrides.effect = '3.22.5';
    fs.writeFileSync(prismaCliPkgPath, `${JSON.stringify(prismaCliPkg, null, 2)}\n`, 'utf8');

    const architecturePath = path.join(tempDir, 'ARCHITECTURE.md');
    fs.writeFileSync(
      architecturePath,
      fs.readFileSync(architecturePath, 'utf8').replace('- **Next.js**: 16.x', '- **Next.js**: ^16.4.6')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          '.github/dependabot.yml: Missing unscoped `version-update:semver-minor` ignore rule for `node` under `docker` ecosystem'
        ),
        expect.stringContaining(
          '.github/dependabot.yml: Missing `version-update:semver-major` ignore rule for `debian` under `docker` ecosystem'
        ),
        expect.stringContaining(
          '.github/dependabot.yml: Missing unscoped `version-update:semver-minor` ignore rule for `postgres` under `docker-compose` ecosystem'
        ),
        expect.stringContaining(
          '.github/dependabot.yml: `github-actions` ecosystem must configure `open-pull-requests-limit: 10` and a minor/patch update group'
        ),
        expect.stringContaining(
          '.github/dependabot.yml: Missing `applies-to: "security-updates"` Prisma group declaring `prisma`, `@prisma/*`, and `effect` under `npm` ecosystem'
        ),
        expect.stringContaining('docker/prisma-cli/package.json: `dependencies["prisma"]` ("7.10.1") must match'),
        expect.stringContaining('docker/prisma-cli/package.json: `overrides["effect"]` ("3.22.5") must match'),
        expect.stringContaining(
          'ARCHITECTURE.md: Must specify major release line `- **Next.js**: 16.x` instead of raw semver range'
        ),
      ])
    );
  });

  it('rejects gcloud run deploy commands missing TRUST_PROXY=2 and Compose manifests missing TRUST_PROXY: ${TRUST_PROXY:-1}', () => {
    const gcpPath = path.join(tempDir, 'docs/deployment/gcp-cloud-run.md');
    fs.writeFileSync(
      gcpPath,
      fs.readFileSync(gcpPath, 'utf8').replace(/[|,]TRUST_PROXY=2/g, '')
    );

    const composePath = path.join(tempDir, 'docker-compose.yml');
    fs.writeFileSync(
      composePath,
      fs.readFileSync(composePath, 'utf8').replace('TRUST_PROXY: ${TRUST_PROXY:-1}', 'TRUST_PROXY: ${TRUST_PROXY:-false}')
    );

    const rolloutComposePath = path.join(tempDir, 'docker-compose.rollout.yml');
    fs.writeFileSync(
      rolloutComposePath,
      fs.readFileSync(rolloutComposePath, 'utf8').replace('TRUST_PROXY: ${TRUST_PROXY:-1}', 'TRUST_PROXY: ${TRUST_PROXY:-false}')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('docs/deployment/gcp-cloud-run.md: Manual `gcloud run deploy` command must set TRUST_PROXY=2'),
        expect.stringContaining('docker-compose.yml: `app` service must set `TRUST_PROXY: ${TRUST_PROXY:-1}` by default'),
        expect.stringContaining('docker-compose.rollout.yml: `app-standby` service must set `TRUST_PROXY: ${TRUST_PROXY:-1}` by default'),
      ])
    );
  });

  it('rejects invalid Cloud Run probe flags, unescaped --set-env-vars commas, npx wedding-migrate jobs, Docker host node / ${DB_*} rollbacks, Render Release Command, Nixpacks omissions, and missing Section 4 S3_ENDPOINT keys', () => {
    const gcpPath = path.join(tempDir, 'docs/deployment/gcp-cloud-run.md');
    fs.writeFileSync(
      gcpPath,
      fs
        .readFileSync(gcpPath, 'utf8')
        .replace(
          '--args="./node_modules/.bin/prisma,migrate,deploy"',
          '--command="npx" \\\n    --args="prisma,migrate,deploy"'
        )
        .replace('    --set-cloudsql-instances=YOUR_PROJECT_ID:us-central1:wedding-db \\\n', '')
        .replace(
          '--set-env-vars="^|^NODE_ENV=production|TRUST_PROXY=2|ALLOWED_HOSTS=wedding.mydomain.com,*.run.app"',
          '--set-env-vars="NODE_ENV=production,TRUST_PROXY=2,ALLOWED_HOSTS=wedding.mydomain.com,*.run.app"'
        )
        .replace(
          '--liveness-probe=httpGet.path=/api/live,httpGet.port=3000,periodSeconds=30',
          '--startup-probe-request-path=/api/health'
        )
    );

    const dockerPath = path.join(tempDir, 'docs/deployment/docker-vps.md');
    fs.writeFileSync(
      dockerPath,
      fs
        .readFileSync(dockerPath, 'utf8')
        .replace(
          'DATABASE_URL=postgresql://wedding_user:secure_password@db_host:5432/wedding_db?schema=public&sslmode=prefer',
          'DATABASE_URL="postgresql://wedding_user:secure_password@db_host:5432/wedding_db?schema=public&sslmode=prefer"'
        )
        .replace(
          'ADMIN_HASH=$(docker run --rm wedding-website:latest node scripts/generate-password-hash.mjs "replace-with-strong-admin-password")',
          'ADMIN_HASH=$(node scripts/generate-password-hash.mjs "replace-with-strong-admin-password")'
        )
        .replace(
          '--env-file .env \\\n           -e E2E_TEST=false',
          '--env-file .env \\\n           -e DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}" \\\n           -e E2E_TEST=false'
        )
    );

    const railwayPath = path.join(tempDir, 'docs/deployment/railway-render.md');
    fs.writeFileSync(
      railwayPath,
      fs
        .readFileSync(railwayPath, 'utf8')
        .replace('Pre-Deploy Command', 'Release Command')
        .replace('npm ci --include=dev && npm run build && npm run postbuild', 'npm run build')
        .replace(/healthcheck\.railway\.app/g, 'removed-probe-host')
    );

    const vercelPath = path.join(tempDir, 'docs/deployment/vercel.md');
    const vercelText = fs.readFileSync(vercelPath, 'utf8');
    const sec4Start = vercelText.indexOf('## 4. Asset Storage');
    const sec5Start = vercelText.indexOf('## 5. Custom Domain');
    fs.writeFileSync(
      vercelPath,
      vercelText.slice(0, sec4Start) +
        vercelText.slice(sec4Start, sec5Start).replace(/S3_ENDPOINT/g, 'REMOVED_S3_KEY') +
        vercelText.slice(sec5Start)
    );

    const upgradingPath = path.join(tempDir, 'docs/upgrading.md');
    fs.writeFileSync(
      upgradingPath,
      fs
        .readFileSync(upgradingPath, 'utf8')
        .replace(
          '--env-file .env \\\n     -e E2E_TEST=false',
          '--env-file .env \\\n     -e DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@db:5432/${DB_NAME}" \\\n     -e E2E_TEST=false'
        )
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Invalid Cloud Run CLI flag "--startup-probe-request-path"'),
        expect.stringContaining('Unescaped delimiter/comma in gcloud `--set-env-vars`'),
        expect.stringContaining('must not override ENTRYPOINT with `--command`'),
        expect.stringContaining(
          'docs/deployment/gcp-cloud-run.md: Cloud Run migration job must pass `--args="./node_modules/.bin/prisma,migrate,deploy"` without `--command`'
        ),
        expect.stringContaining('`wedding-migrate` Cloud Run Job must attach Cloud SQL via `--set-cloudsql-instances`'),
        expect.stringContaining('docs/deployment/docker-vps.md (Section 1): Must not wrap `.env` DATABASE_URL'),
        expect.stringContaining('docs/deployment/docker-vps.md (Section 6): Must generate `ADMIN_HASH` inside Docker'),
        expect.stringContaining('docs/deployment/docker-vps.md: Rollback `docker run` command must not expand unset host ${DB_*} variables'),
        expect.stringContaining('docs/upgrading.md: Rollback `docker run` command must not expand unset host ${DB_*} variables'),
        expect.stringContaining('References nonexistent Render "Release Command"'),
        expect.stringContaining('Railway Nixpacks instructions must include `npm ci --include=dev` and `npm run postbuild`'),
        expect.stringContaining('docs/deployment/railway-render.md: Must document `healthcheck.railway.app`'),
        expect.stringContaining('docs/deployment/vercel.md (Section 4): Missing S3 configuration keys: S3_ENDPOINT'),
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

  it('rejects stale PostgreSQL 14, Compose npx migration claims, /api/health liveness claims, /opt/prisma-cli under /app, missing 503 isHealthProbe fields, and missing 15s graceful shutdown docs', () => {
    const runtimeContractPath = path.join(tempDir, 'docs/runtime-contract.md');
    fs.writeFileSync(
      runtimeContractPath,
      fs
        .readFileSync(runtimeContractPath, 'utf8')
        .replace(/outside `\/app` at `\/opt\/prisma-cli`/g, 'packaged under `/app` at `/opt/prisma-cli`')
        .replace(/\/app\/scripts\/generate-password-hash\.mjs/g, '/app/scripts')
        .replace(/5000ms/g, '1000ms')
        .replace(/"status": "degraded"/g, '"status": "removed"')
        .replace(/\^10\.9\.0/g, '^9.0.0')
    );

    const deploymentPath = path.join(tempDir, 'DEPLOYMENT.md');
    fs.writeFileSync(
      deploymentPath,
      fs
        .readFileSync(deploymentPath, 'utf8')
        .replace(/PostgreSQL 15(?:\+|\s+or\s+higher)/, 'PostgreSQL 14 or higher')
        .replace(
          'In local Docker Compose environments, a dedicated `migration` task service executes `./node_modules/.bin/prisma migrate deploy`',
          'In Docker Compose (`docker-compose.yml`), a dedicated `migration` service executes `npx prisma migrate deploy`'
        )
        .replace(
          '- **Container Liveness Probe (`GET /api/live`)**:',
          '- **Container Liveness Probe**: Containers query `/api/health` for liveness.'
        )
        .replace(/--stop-timeout 15/g, '--stop-timeout 5')
    );

    const dockerMdPath = path.join(tempDir, 'docs/deployment/docker-vps.md');
    fs.writeFileSync(
      dockerMdPath,
      fs
        .readFileSync(dockerMdPath, 'utf8')
        .replace(/--stop-timeout 15\s+\\\n\s+/g, '')
        .replace(/stop_grace_period: 15s/g, 'stop_grace_period: 5s')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'docs/runtime-contract.md: Must document Node `>=22.22.1 <23.0.0` and `npm` `^10.9.0` (`devEngines` in `package.json`)'
        ),
        expect.stringContaining('docs/runtime-contract.md: Must state that Dockerfile installs `/opt/prisma-cli` outside `/app`'),
        expect.stringContaining('docs/runtime-contract.md: Stale claim that `/opt/prisma-cli` is packaged under `/app`'),
        expect.stringContaining(
          'docs/runtime-contract.md: Must state that Dockerfile copies `/app/scripts/generate-password-hash.mjs`'
        ),
        expect.stringContaining(
          'docs/runtime-contract.md: Must document that `GET /api/health` (`isHealthProbe`) preserves `status`, `database`, and `timestamp`'
        ),
        expect.stringContaining('docs/runtime-contract.md: Must document Prisma `globalThis` pool sharing'),
        expect.stringContaining('DEPLOYMENT.md: References stale "PostgreSQL 14" instead of PostgreSQL 15+'),
        expect.stringContaining(
          'DEPLOYMENT.md: Stale claim that Docker Compose `migration` service runs `npx prisma migrate deploy` instead of `./node_modules/.bin/prisma migrate deploy`'
        ),
        expect.stringContaining(
          'DEPLOYMENT.md: Health Checks & Liveness Probes section must direct container liveness checks to `/api/live` rather than `/api/health`'
        ),
        expect.stringContaining('DEPLOYMENT.md: Must document `stop_grace_period: 15s` and `--stop-timeout 15`'),
        expect.stringContaining('docs/deployment/docker-vps.md: Must document `stop_grace_period: 15s` and `--stop-timeout 15`'),
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
        expect.stringContaining('20261215000000_add_shuttle_manifest'),
        expect.stringContaining('Added runtime environment variable "SHUTTLE_API_KEY" in src/env.ts is missing'),
        expect.stringContaining('CHANGELOG.md: Docker Compose mandatory `:?` secret guard "SHUTTLE_API_KEY"'),
        expect.stringContaining('docs/upgrading.md: Docker Compose mandatory `:?` secret guard "SHUTTLE_API_KEY"'),
        expect.stringContaining('CHANGELOG.md: Persistent Docker Compose volume "archive_data"'),
        expect.stringContaining('docs/upgrading.md: Persistent Docker Compose volume "archive_data"'),
        expect.stringContaining('Remediation:'),
      ])
    );
    expect(errors.some((err) => err.includes('Migration count drift'))).toBe(false);
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

  it('rejects conflating local npm run migrate:deploy with production npx prisma migrate deploy, referencing DIRECT_URL, or breaking canonical docs/upgrading.md cross-links', () => {
    const upgradingPath = path.join(tempDir, 'docs/upgrading.md');
    fs.writeFileSync(
      upgradingPath,
      fs
        .readFileSync(upgradingPath, 'utf8')
        .replace('dotenv -e .env -- npx prisma migrate deploy', 'npm run migrate:deploy')
        .replace(/dotenv -c development/g, 'dotenv-cli')
    );

    const versioningPath = path.join(tempDir, 'docs/versioning.md');
    fs.writeFileSync(
      versioningPath,
      `${fs
        .readFileSync(versioningPath, 'utf8')
        .replace(
          'DATABASE_URL="${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}" env -u POSTGRES_URL_NON_POOLING npx prisma migrate deploy',
          'DATABASE_URL="$POSTGRES_URL_NON_POOLING" npx prisma migrate deploy'
        )}\nDownstream adopters execute \`npm run migrate:deploy\` (\`npx prisma migrate deploy\`) against \`DIRECT_URL\`.\n`
    );

    const architecturePath = path.join(tempDir, 'ARCHITECTURE.md');
    fs.writeFileSync(
      architecturePath,
      fs
        .readFileSync(architecturePath, 'utf8')
        .replace(/\(\.\/docs\/upgrading\.md\)/g, '(./docs/missing-upgrading.md)')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'docs/upgrading.md: Track C (Host Node.js Runtime) fenced production commands must not invoke `npm run migrate:deploy`'
        ),
        expect.stringContaining(
          'docs/upgrading.md: Must clarify that `npm run migrate:deploy` wraps `dotenv -c development` and cascades local `.env.development` files'
        ),
        expect.stringContaining(
          'docs/versioning.md: `DATABASE_URL="$POSTGRES_URL_NON_POOLING" npx prisma migrate deploy` overrides DATABASE_URL from POSTGRES_URL_NON_POOLING without `env -u POSTGRES_URL_NON_POOLING`'
        ),
        expect.stringContaining(
          'docs/versioning.md: Conflates local `npm run migrate:deploy` (`dotenv -c development`) as an unqualified alias for `prisma migrate deploy`'
        ),
        expect.stringContaining(
          'docs/versioning.md: References unsupported "DIRECT_URL" environment variable instead of "DATABASE_URL" / "POSTGRES_URL_NON_POOLING"'
        ),
        expect.stringContaining(
          'ARCHITECTURE.md: Must cross-link to canonical migration CLI runbook "docs/upgrading.md" (verified via rewriteMarkdownLinks -> /guides/upgrading)'
        ),
      ])
    );
  });

  it('rejects stale two-phase database breaking-change policy, missing Expand-Migrate-Contract cross-links, or duplicated canonical phase specs in summary guides', () => {
    const versioningPath = path.join(tempDir, 'docs/versioning.md');
    fs.writeFileSync(
      versioningPath,
      fs
        .readFileSync(versioningPath, 'utf8')
        .replace(/Expand-Migrate-Contract/g, 'two-phase release process')
        .replace('Phase 3: Contract', 'Phase 2: Cleanup')
        .replace(/scripts\/verify-migration-compatibility\.ts/g, 'scripts/lint-migrations.ts')
    );

    const architecturePath = path.join(tempDir, 'ARCHITECTURE.md');
    fs.writeFileSync(
      architecturePath,
      fs
        .readFileSync(architecturePath, 'utf8')
        .replace(/Expand-Migrate-Contract/g, 'Forward-Only Schema')
        .replace(/\(\.\/docs\/versioning\.md\)/g, '(./docs/missing-versioning.md)')
    );

    const upgradingPath = path.join(tempDir, 'docs/upgrading.md');
    fs.writeFileSync(
      upgradingPath,
      `${fs.readFileSync(upgradingPath, 'utf8')}\nUse -- allow-destructive: cleanup for Phase 3 drops.\n`
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'docs/versioning.md: Missing three-phase "Expand-Migrate-Contract" database migration policy alignment'
        ),
        expect.stringContaining(
          'docs/versioning.md: Contains stale "two-phase release process" database migration policy instead of three-phase "Expand-Migrate-Contract"'
        ),
        expect.stringContaining(
          'docs/versioning.md: Must explicitly define "Phase 1: Expand", "Phase 2: Migrate", and "Phase 3: Contract"'
        ),
        expect.stringContaining(
          'docs/versioning.md: References non-existent "scripts/lint-migrations.ts" instead of "scripts/verify-migration-compatibility.ts"'
        ),
        expect.stringContaining(
          'ARCHITECTURE.md: Missing "Expand-Migrate-Contract" database migration policy summary'
        ),
        expect.stringContaining(
          'ARCHITECTURE.md: Must cross-link to canonical Expand-Migrate-Contract policy in "docs/versioning.md" (verified via rewriteMarkdownLinks -> /architecture/versioning)'
        ),
        expect.stringContaining(
          'docs/upgrading.md: Duplicates three-phase Expand-Migrate-Contract / `-- allow-destructive:` specification owned canonically by "docs/versioning.md"'
        ),
      ])
    );
  });

  it('rejects TypeScript major version drift and unrestricted npm Dependabot groups', () => {
    const pkgPath = path.join(tempDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    if (pkg.devDependencies) {
      pkg.devDependencies.typescript = '^7.0.2';
    }
    fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const dependabotPath = path.join(tempDir, '.github/dependabot.yml');
    fs.writeFileSync(
      dependabotPath,
      fs
        .readFileSync(dependabotPath, 'utf8')
        .replace(
          /\s*- dependency-name: "typescript"\n\s*versions: \[">= 6\.1\.0"\](?:\n\s*update-types: \["version-update:semver-major"\])?/g,
          ''
        )
        .replace(/\s*update-types:\n\s*- "minor"\n\s*- "patch"/g, '')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'package.json: `devDependencies["typescript"]` ("^7.0.2") must pin the TypeScript 5.9 release line (< 6.1.0)'
        ),
        expect.stringContaining(
          '.github/dependabot.yml: Missing `versions: [">= 6.1.0"]` ignore rule for `typescript` under `npm` ecosystem'
        ),
        expect.stringContaining(
          '.github/dependabot.yml: Group `production-dependencies` under `npm` ecosystem must restrict `update-types` to `["minor", "patch"]`'
        ),
        expect.stringContaining(
          '.github/dependabot.yml: Group `development-dependencies` under `npm` ecosystem must restrict `update-types` to `["minor", "patch"]`'
        ),
      ])
    );
  });

  it('rejects forbidden fetch/curl Host header overrides, resolve_probe_host, and missing rollback tags or rollout phases in scripts/rollout-vps.sh', () => {
    const rolloutScriptPath = path.join(tempDir, 'scripts/rollout-vps.sh');
    const brokenRolloutScript = fs
      .readFileSync(rolloutScriptPath, 'utf8')
      .replace(
        'curl -fsS --max-time 3 -o /dev/null "${url}" 2>/dev/null',
        'resolve_probe_host && curl -fsS --max-time 3 -H "Host: ${PROBE_HOST}" -o /dev/null "${url}" 2>/dev/null'
      )
      .replace(
        'fetch(process.argv[1],{signal:AbortSignal.timeout(3000)})',
        'fetch(process.argv[1],{headers:{Host:process.argv[2]},signal:AbortSignal.timeout(3000)})'
      )
      .replace('docker tag wedding-website:latest wedding-website:previous\n', '')
      .replace('ROLLOUT_PHASE="cutover"\n', '');
    fs.writeFileSync(rolloutScriptPath, brokenRolloutScript);

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'scripts/rollout-vps.sh: Loopback probes must not override forbidden `Host` header in `fetch()`'
        ),
        expect.stringContaining(
          'scripts/rollout-vps.sh: Loopback probes must omit `resolve_probe_host` and `Host` header overrides'
        ),
        expect.stringContaining(
          'scripts/rollout-vps.sh: Must snapshot `wedding-website:latest` as `wedding-website:previous` before `docker compose ... build app`'
        ),
        expect.stringContaining(
          'scripts/rollout-vps.sh: Exit trap must track `pre-cutover`, `cutover`, and `completed` rollout phases'
        ),
      ])
    );
  });
});
