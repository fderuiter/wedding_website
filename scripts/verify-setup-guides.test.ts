import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseEnvAssignments, verifySetupGuides } from './verify-setup-guides';

function copyFixtureFiles(srcRoot: string, destRoot: string): void {
  const filesToCopy = [
    '.nvmrc',
    '.npmrc',
    '.env.example',
    '.env.ci',
    '.env.test',
    'prisma.config.ts',
    'package.json',
    'tsconfig.json',
    'tsconfig.build.json',
    'docker-compose.yml',
    'docker-compose.ci.yml',
    'eslint.config.mjs',
    'playwright.config.ts',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    'scripts/install-git-hooks.js',
    'scripts/check-quality.ts',
    'scripts/pretest.mjs',
    'scripts/a11y-report.mjs',
    'scripts/seed.ts',
    'scripts/verify-doc-sync.ts',
    'scripts/test-standalone.mjs',
    'scripts/test-container.mjs',
    'README.md',
    'docs/developer-setup.md',
    'docs/versioning.md',
    '.github/CONTRIBUTING.md',
    '.github/TESTING.md',
    'AGENTS.md',
    '.github/ISSUE_TEMPLATE/documentation.md',
  ];

  for (const relPath of filesToCopy) {
    const srcPath = path.join(srcRoot, relPath);
    const destPath = path.join(destRoot, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(srcPath, destPath);
  }

  const readmeDirs = [
    '.githooks',
    '.github',
    '.storybook',
    'assets',
    'docs',
    'docs-portal',
    'e2e',
    'eslint-rules',
    'prisma',
    'public',
    'scripts',
    'src/app',
    'src/components',
    'src/core',
    'src/features',
    'src/hooks',
    'src/lib',
    'src/mocks',
    'src/testing',
    'src/utils',
  ];
  for (const relDir of readmeDirs) {
    fs.mkdirSync(path.join(destRoot, relDir), { recursive: true });
  }
}

describe('verify-setup-guides contract check', () => {
  const repoRoot = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-setup-guides-'));
    copyFixtureFiles(repoRoot, tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('passes with zero contract errors against the live repository', () => {
    expect(verifySetupGuides(repoRoot)).toEqual([]);
  });

  it('parses active and commented .env.example assignments cleanly', () => {
    const parsed = parseEnvAssignments(
      [
        'NODE_ENV=development',
        'DATABASE_URL="postgresql://wedding:wedding123@localhost:5432/wedding?schema=public"',
        '# POSTGRES_URL_NON_POOLING="postgresql://wedding:wedding123@localhost:5432/wedding_shadow?schema=public"',
        '# S3_BUCKET="my-wedding-bucket"',
      ].join('\n')
    );

    expect(parsed.active.get('NODE_ENV')).toBe('development');
    expect(parsed.active.get('DATABASE_URL')).toContain('localhost:5432/wedding');
    expect(parsed.active.has('POSTGRES_URL_NON_POOLING')).toBe(false);
    expect(parsed.commented.has('POSTGRES_URL_NON_POOLING')).toBe(true);
    expect(parsed.commented.has('S3_BUCKET')).toBe(true);
  });

  it('rejects uncommented optional S3_*/POSTGRES_URL_NON_POOLING placeholders, dummy_shadow fallbacks, and db:seed without dotenv', () => {
    const envExamplePath = path.join(tempDir, '.env.example');
    const driftedEnvExample = fs
      .readFileSync(envExamplePath, 'utf8')
      .replace('# POSTGRES_URL_NON_POOLING=', 'POSTGRES_URL_NON_POOLING=')
      .replace('# S3_BUCKET="my-wedding-bucket"', 'S3_BUCKET="my-wedding-bucket"');
    fs.writeFileSync(envExamplePath, driftedEnvExample);

    const prismaConfigPath = path.join(tempDir, 'prisma.config.ts');
    fs.writeFileSync(
      prismaConfigPath,
      fs
        .readFileSync(prismaConfigPath, 'utf8')
        .replace(
          'shadowDatabaseUrl: resolvePrismaShadowDatabaseUrl(process.env.POSTGRES_URL_NON_POOLING, process.env.DATABASE_URL),',
          "shadowDatabaseUrl: process.env.POSTGRES_URL_NON_POOLING ?? 'postgresql://dummy:dummy@localhost:5432/dummy_shadow',"
        )
    );

    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      fs
        .readFileSync(pkgPath, 'utf8')
        .replace(
          '"db:seed": "dotenv -c development -- tsx scripts/seed.ts"',
          '"db:seed": "tsx scripts/seed.ts"'
        )
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Optional variable "POSTGRES_URL_NON_POOLING" must stay commented out'),
        expect.stringContaining('Optional variable "S3_BUCKET" must stay commented out'),
        expect.stringContaining('prisma.config.ts: shadowDatabaseUrl must not fall back'),
        expect.stringContaining('package.json: "db:seed"'),
      ])
    );
  });

  it('rejects stale maintenance banner, nonexistent Project Structure directories, missing README capabilities, and missing developer-setup.md contracts', () => {
    const readmePath = path.join(tempDir, 'README.md');
    fs.writeFileSync(
      readmePath,
      `# NOTE CURRENTLY UNDER MAINTAINANCE AND REFACTORING\n${fs
        .readFileSync(readmePath, 'utf8')
        .replace('*   `src/core`:', '*   `src/data`: Static fallback data.\n*   `src/core`:')
        .replace(/seating charts/gi, 'table plans')}`
    );

    const devSetupPath = path.join(tempDir, 'docs/developer-setup.md');
    fs.writeFileSync(
      devSetupPath,
      fs
        .readFileSync(devSetupPath, 'utf8')
        .replace(/Step 4/g, 'Phase Four')
        .replace(/isSiteInitialized/g, 'checkInitialized')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        'README.md: Must not contain outdated maintenance banner',
        'README.md: Project Structure lists nonexistent path "src/data"',
        expect.stringContaining('README.md: Must list shipped capability "seating charts"'),
        'docs/developer-setup.md: Must document Step 4 of SetupWizard',
        expect.stringContaining('docs/developer-setup.md: Must document that seeding AppConfig satisfies isSiteInitialized'),
      ])
    );
  });

  it('rejects stale issue template names, /app/src/utils/ container paths, non-strict lint claims, and missing pre-push scripts in CONTRIBUTING.md', () => {
    const contributingPath = path.join(tempDir, '.github/CONTRIBUTING.md');
    const driftedContributing = fs
      .readFileSync(contributingPath, 'utf8')
      .replace(/Documentation Improvement/g, 'Docs Improvement')
      .replace('`src/utils/`', '`/app/src/utils/`')
      .replace(/check:action-pins/g, 'check:legacy')
      .concat('\nRun npm run lint (though it is not super strict right now).\n');
    fs.writeFileSync(contributingPath, driftedContributing);

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Must cite exact issue template name "Documentation Improvement"'),
        expect.stringContaining('Contains stale issue template name "Docs Improvement"'),
        expect.stringContaining('Must use repository-relative "src/utils/"'),
        expect.stringContaining('Must not describe npm run lint as non-strict'),
        expect.stringContaining('Missing .githooks/pre-push check script "check:action-pins"'),
      ])
    );
  });

  it('rejects .env.test GUEST_PASSCODE drift, missing smoke test volume warnings, missing tsconfig exclusions, and missing unified quality commands in AGENTS.md', () => {
    const testingPath = path.join(tempDir, '.github/TESTING.md');
    fs.writeFileSync(
      testingPath,
      fs
        .readFileSync(testingPath, 'utf8')
        .replace(/build-fallback-guest-passcode/g, 'playwright-e2e-guest-passcode')
        .replace(/docker compose(?:\s+(?:--env-file|-f)\s+\S+)*\s+down\s+-v/g, 'docker compose stop')
    );

    const agentsPath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      fs
        .readFileSync(agentsPath, 'utf8')
        .replace(/`jest\.setup\.js`, /g, '')
        .replace('`**/*.stories.tsx`, ', '')
        .replace(/npm run quality/g, 'npm run legacy-gate')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        '.github/TESTING.md: Must report .env.test GUEST_PASSCODE value "build-fallback-guest-passcode"',
        expect.stringContaining('.github/TESTING.md: Must warn that scripts/test-standalone.mjs requires "npm run build"'),
        'AGENTS.md: Missing tsconfig.json exclude entry "jest.setup.js" in TypeScript Configuration Split section',
        'AGENTS.md: Missing tsconfig.build.json exclude entry "**/*.stories.tsx" in TypeScript Configuration Split section',
        expect.stringContaining('AGENTS.md: Verification & Quality Gates section must prescribe "npm run check:static" and "npm run quality"'),
      ])
    );
  });

  it('rejects missing pretest* hooks, DEFAULT_DOC_FILES drift, and staticSteps / pre-push parity gaps', () => {
    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      fs
        .readFileSync(pkgPath, 'utf8')
        .replace('    "pretest:cov": "npm run pretest",\n', '')
        .replace('    "test:e2e:smoke": "playwright test --grep @smoke",\n', '')
    );

    const prePushPath = path.join(tempDir, '.githooks/pre-push');
    fs.writeFileSync(
      prePushPath,
      fs
        .readFileSync(prePushPath, 'utf8')
        .replace(
          "  { name: 'Deployment runbooks verification check', script: 'check:runbooks' },\n",
          "  { name: 'Standalone check', script: 'check:standalone' },\n"
        )
    );

    const verifyDocSyncPath = path.join(tempDir, 'scripts/verify-doc-sync.ts');
    fs.writeFileSync(
      verifyDocSyncPath,
      fs
        .readFileSync(verifyDocSyncPath, 'utf8')
        .replace("'FEATURE_MODULES.md',", "'FEATURE_MODULES.md',\n  'GENERATED_SCHEMAS.md',")
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Jest script "test:cov" requires lifecycle hook "pretest:cov"'),
        expect.stringContaining('Missing "pretest:cov" pretest hook for "test:cov"'),
        expect.stringContaining('package.json: "test:e2e:smoke" must invoke "playwright test --grep @smoke"'),
        '.githooks/pre-push: Must enforce lightweight static check "check:runbooks"',
        '.githooks/pre-push: Must exclude heavy build step "check:standalone" so local pushes stay fast',
        '.github/CONTRIBUTING.md: "npm run check:doc-sync" documentation is missing DEFAULT_DOC_FILES entry "GENERATED_SCHEMAS.md"',
      ])
    );
  });

  it('rejects destructive git stash/reset/checkout commands, workspace checks in pre-commit, heavy builds in hooks, and missing pre-push installer permissions', () => {
    fs.writeFileSync(
      path.join(tempDir, '.githooks/pre-commit'),
      [
        '#!/usr/bin/env node',
        'function pushStash() { return "git stash push"; }',
        "const checks = [{ name: 'Build portal', script: 'docs:build' }];",
        'export { pushStash, checks };',
      ].join('\n')
    );

    fs.writeFileSync(
      path.join(tempDir, '.githooks/pre-push'),
      `${fs.readFileSync(path.join(tempDir, '.githooks/pre-push'), 'utf8')}\n// git checkout -- . && git reset --hard\nconst extra = { name: 'Storybook', script: 'build-storybook' };\nvoid extra;\n`
    );

    fs.writeFileSync(
      path.join(tempDir, 'scripts/install-git-hooks.js'),
      fs.readFileSync(path.join(tempDir, 'scripts/install-git-hooks.js'), 'utf8').replace(/pre-push/g, 'post-merge')
    );

    const testingPath = path.join(tempDir, '.github/TESTING.md');
    fs.writeFileSync(
      testingPath,
      fs.readFileSync(testingPath, 'utf8').replace(/\.githooks\/pre-push/g, '.githooks/legacy')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        '.githooks/pre-commit: Must run "npx lint-staged" on staged files',
        '.githooks/pre-commit: Must remove legacy stash helper "pushStash"',
        '.githooks/pre-commit: Must run only "npx lint-staged" without sequential workspace checks',
        '.githooks/pre-commit: Must not invoke destructive workspace command "git stash"',
        '.githooks/pre-commit: Must exclude heavy build step "docs:build" so local commits stay fast',
        '.githooks/pre-push: Must not invoke destructive workspace command "git reset"',
        '.githooks/pre-push: Must not invoke destructive workspace command "git checkout -- ."',
        '.githooks/pre-push: Must exclude heavy build step "build-storybook" so local pushes stay fast',
        'scripts/install-git-hooks.js: Must configure executable 0o755 permissions on both .githooks/pre-commit and .githooks/pre-push',
        '.github/TESTING.md: Must reference both ".githooks/pre-commit" and ".githooks/pre-push"',
      ])
    );
  });

  it('rejects playwright server reuse regressions, seed empty update objects, missing a11y reseeding, and stale db:seed pre-steps', () => {
    const playwrightPath = path.join(tempDir, 'playwright.config.ts');
    fs.writeFileSync(
      playwrightPath,
      fs
        .readFileSync(playwrightPath, 'utf8')
        .replace(
          "const reuseExistingServer = !process.env.CI && process.env.PLAYWRIGHT_REUSE_SERVER === 'true';",
          'const reuseExistingServer = !process.env.CI;'
        )
        .replace('reuseExistingServer,', 'reuseExistingServer: !process.env.CI,')
    );

    const seedPath = path.join(tempDir, 'scripts/seed.ts');
    fs.writeFileSync(
      seedPath,
      fs.readFileSync(seedPath, 'utf8').replace('update: defaultAppConfig,', 'update: {},')
    );

    const a11yPath = path.join(tempDir, 'scripts/a11y-report.mjs');
    fs.writeFileSync(
      a11yPath,
      fs.readFileSync(a11yPath, 'utf8').replace('scripts/seed.ts', 'scripts/noop.ts')
    );

    const testingPath = path.join(tempDir, '.github/TESTING.md');
    fs.writeFileSync(
      testingPath,
      fs
        .readFileSync(testingPath, 'utf8')
        .replace(/PLAYWRIGHT_REUSE_SERVER/g, 'LEGACY_REUSE_FLAG')
        .replace('npm run test:a11y\n  ```', 'npm run db:seed && npm run test:a11y\n  ```')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('playwright.config.ts: Must disable automatic server reuse by default'),
        expect.stringContaining('scripts/seed.ts: appConfig.upsert must populate update fields'),
        expect.stringContaining('scripts/a11y-report.mjs: runA11ySuite must reseed wedding_test via "scripts/seed.ts"'),
        expect.stringContaining('.github/TESTING.md: Accessibility section must not prescribe running "db:seed" before "test:a11y"'),
        expect.stringContaining('.github/TESTING.md: Must document PLAYWRIGHT_REUSE_SERVER opt-in'),
      ])
    );
  });

  it('rejects fallback secrets in docker-compose.yml, 4-byte placeholder scrypt hashes, and missing docker-compose.ci.yml overrides', () => {
    const composePath = path.join(tempDir, 'docker-compose.yml');
    fs.writeFileSync(
      composePath,
      fs
        .readFileSync(composePath, 'utf8')
        .replace('${DB_PASSWORD:?DB_PASSWORD is required}', '${DB_PASSWORD:-wedding123}')
        .replace('127.0.0.1:${DB_PORT:-5432}:5432', '${DB_PORT:-5432}:5432')
    );

    const testContainerPath = path.join(tempDir, 'scripts/test-container.mjs');
    fs.writeFileSync(
      testContainerPath,
      fs.readFileSync(testContainerPath, 'utf8').replace(/docker-compose\.ci\.yml/g, 'docker-compose.legacy.yml')
    );

    const envExamplePath = path.join(tempDir, '.env.example');
    fs.writeFileSync(
      envExamplePath,
      `${fs
        .readFileSync(envExamplePath, 'utf8')
        .replace('# NODE_ENV=development', 'NODE_ENV=development')
        .replace('DB_PASSWORD="wedding123"', '# DB_PASSWORD="wedding123"')}\n# legacy scrypt:c2FsdA==:aGFzaA==\n`
    );

    const playwrightPath = path.join(tempDir, 'playwright.config.ts');
    fs.writeFileSync(
      playwrightPath,
      fs
        .readFileSync(playwrightPath, 'utf8')
        .replace("NODE_ENV: process.env.CI ? 'production' : 'development',", "NODE_ENV: 'production',")
    );

    const readmePath = path.join(tempDir, 'README.md');
    fs.writeFileSync(
      readmePath,
      fs
        .readFileSync(readmePath, 'utf8')
        .replace('\ndocker compose up -d db\n', '\nDB_PASSWORD=wedding123 docker compose up -d db\n')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('docker-compose.yml: Must not declare default fallback secret ${DB_PASSWORD:-...}'),
        expect.stringContaining('docker-compose.yml: Must bind PostgreSQL strictly to 127.0.0.1:${DB_PORT:-5432}:5432'),
        expect.stringContaining(
          'scripts/test-container.mjs: Must pass "--env-file .env.ci" with isolated "docker-compose.ci.yml" override manifest'
        ),
        expect.stringContaining('.env.example: Must omit active NODE_ENV assignment'),
        expect.stringContaining('.env.example: Must define active DB_PASSWORD="wedding123"'),
        expect.stringContaining('playwright.config.ts: Must set webServer.env.NODE_ENV to "development" locally'),
        expect.stringContaining('README.md: Must prescribe bare "docker compose up -d db"'),
        expect.stringContaining('.env.example: Must not contain invalid 4-byte placeholder hash'),
      ])
    );
  });

  it('rejects Node.js/npm engine drift, --legacy-peer-deps pretest regressions, npm install bootstrap drift, and stale alpine versioning docs', () => {
    fs.writeFileSync(path.join(tempDir, '.npmrc'), '# missing engine-strict\n');

    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      fs.readFileSync(pkgPath, 'utf8').replace('"@types/node": "^22.12.0"', '"@types/node": "^26.6.5"')
    );

    const pretestPath = path.join(tempDir, 'scripts/pretest.mjs');
    fs.writeFileSync(
      pretestPath,
      fs.readFileSync(pretestPath, 'utf8').replace("['ci']", "['ci', '--legacy-peer-deps']")
    );

    const readmePath = path.join(tempDir, 'README.md');
    fs.writeFileSync(
      readmePath,
      fs.readFileSync(readmePath, 'utf8').replace('\nnpm ci\n', '\nnpm install\n')
    );

    const versioningPath = path.join(tempDir, 'docs/versioning.md');
    fs.writeFileSync(
      versioningPath,
      fs.readFileSync(versioningPath, 'utf8').replace('node:22-bookworm-slim', 'node:22-alpine')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        '.npmrc: Must set "engine-strict=true" at the repository root',
        expect.stringContaining('package.json: "@types/node" ("^26.6.5") must target Node.js 22 matching .nvmrc'),
        'scripts/pretest.mjs: Must run "npm ci" without "--legacy-peer-deps" to match CI',
        'README.md: Installation section must prescribe "npm ci" rather than "npm install"',
        'docs/versioning.md: Must cite "node:22-bookworm-slim" (not stale alpine or mismatched Node.js major)',
      ])
    );
  });

  it('rejects duplicate h1 headings, missing or broken Table of Contents entries, and undocumented root directories while ignoring build/cache folders', () => {
    fs.mkdirSync(path.join(tempDir, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.next'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '.swc'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'coverage'), { recursive: true });
    expect(verifySetupGuides(tempDir)).toEqual([]);

    fs.mkdirSync(path.join(tempDir, 'packages'), { recursive: true });

    const readmePath = path.join(tempDir, 'README.md');
    fs.writeFileSync(
      readmePath,
      `# NOTE CURRENTLY UNDER MAINTAINANCE\n\n${fs
        .readFileSync(readmePath, 'utf8')
        .replace('5.  [Upgrading & Upstream Maintenance](#upgrading--upstream-maintenance)\n', '5.  [Stale Section](#stale-section)\n')}`
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        'README.md: Must contain exactly one top-level "#" (h1) heading, found 2',
        'README.md: Table of Contents is missing entry for "Upgrading & Upstream Maintenance" (#upgrading--upstream-maintenance)',
        'README.md: Table of Contents links to nonexistent heading "#stale-section"',
        'README.md: Project Structure is missing root directory "packages"',
      ])
    );
  });
});
