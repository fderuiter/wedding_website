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
    'docker-compose.yml',
    'docker-compose.ci.yml',
    'next.config.ts',
    'vercel.json',
    'src/env.ts',
    'src/lib/config.ts',
    'src/middleware.ts',
    'src/app/api/uploads/[...path]/route.ts',
    'DEPLOYMENT.md',
    'docs/runtime-contract.md',
    'docs/deployment/README.md',
    'docs/deployment/vercel.md',
    'docs/deployment/gcp-cloud-run.md',
    'docs/deployment/docker-vps.md',
    'docs/deployment/railway-render.md',
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

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          '.github/workflows/deploy-provider.yml:275: Invalid YAML 1.2 tag/warning (TAG_RESOLVE_FAILED)'
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

  it('rejects Node.js major version drift across Dockerfile, setup-node workflows, runtime docs, and dependabot.yml', () => {
    const dockerfilePath = path.join(tempDir, 'Dockerfile');
    fs.writeFileSync(
      dockerfilePath,
      fs.readFileSync(dockerfilePath, 'utf8').replace('node:22-bookworm-slim@', 'node:26-bookworm-slim@')
    );

    const storybookWorkflowPath = path.join(tempDir, '.github/workflows/storybook.yml');
    fs.writeFileSync(
      storybookWorkflowPath,
      fs.readFileSync(storybookWorkflowPath, 'utf8').replace("node-version-file: '.nvmrc'", 'node-version: 22')
    );

    const runtimeContractPath = path.join(tempDir, 'docs/runtime-contract.md');
    fs.writeFileSync(
      runtimeContractPath,
      fs.readFileSync(runtimeContractPath, 'utf8').replace('v22.x LTS', 'v26.x LTS')
    );

    const dependabotPath = path.join(tempDir, '.github/dependabot.yml');
    fs.writeFileSync(
      dependabotPath,
      fs.readFileSync(dependabotPath, 'utf8').replace('@types/node', '@types/legacy-node')
    );

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Dockerfile: Must pin `node:22-bookworm-slim@sha256:<64-hex>` matching .nvmrc'),
        expect.stringContaining(
          ".github/workflows/storybook.yml (job \"build\"): `actions/setup-node` must set `node-version-file: '.nvmrc'`"
        ),
        expect.stringContaining('docs/runtime-contract.md: Must specify Node.js v22.x LTS and `node:22-bookworm-slim`'),
        expect.stringContaining(
          '.github/dependabot.yml: Missing `version-update:semver-major` ignore rule for `@types/node` under `npm` ecosystem'
        ),
      ])
    );
  });
});
