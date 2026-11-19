import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractPrismaMigrateCommands, verifyDeploymentRunbooks } from './verify-deployment-runbooks';

function copyRepoFixture(srcRoot: string, destRoot: string): void {
  const filesToCopy = [
    'package.json',
    'prisma.config.ts',
    'docker-compose.yml',
    'src/env.ts',
    'src/lib/config.ts',
    'DEPLOYMENT.md',
    'docs/runtime-contract.md',
    'docs/deployment/README.md',
    'docs/deployment/vercel.md',
    'docs/deployment/gcp-cloud-run.md',
    'docs/deployment/docker-vps.md',
    'docs/deployment/railway-render.md',
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

  it('rejects stale Cloud Run service names, mutable :latest image tags, Workload Identity claims, and missing GUEST_SESSION_SECRET', () => {
    const gcpPath = path.join(tempDir, 'docs/deployment/gcp-cloud-run.md');
    const original = fs.readFileSync(gcpPath, 'utf8');
    const brokenGcp = `${original}\n\nWorkload Identity Federation\n\`\`\`bash\ngcloud run deploy wedding-service --image gcr.io/demo/wedding-website:latest --set-secrets="DATABASE_URL=DATABASE_URL:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest,GUEST_PASSCODE=GUEST_PASSCODE:latest"\n\`\`\`\n`;
    fs.writeFileSync(gcpPath, brokenGcp);

    const errors = verifyDeploymentRunbooks(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('References stale service name "wedding-service" instead of "wedding-website"'),
        expect.stringContaining('Container image "gcr.io/demo/wedding-website:latest" must pull from primary registry "ghcr.io/"'),
        expect.stringContaining('Mutable ":latest" image tag prohibited'),
        expect.stringContaining('Claims Workload Identity Federation'),
        expect.stringContaining('Manual `gcloud run deploy` command omits mandatory GUEST_SESSION_SECRET'),
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
});
