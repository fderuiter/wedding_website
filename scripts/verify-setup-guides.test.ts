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
    'tsconfig.scripts.json',
    'tsconfig.e2e.json',
    'tsconfig.test.json',
    'docker-compose.yml',
    'docker-compose.ci.yml',
    'eslint.config.mjs',
    'playwright.config.ts',
    '.githooks/pre-commit',
    '.githooks/pre-push',
    'jest.setup.js',
    'scripts/install-git-hooks.js',
    'scripts/check-quality.ts',
    'scripts/quality/run-typecheck.mjs',
    'scripts/quality/worktree-cache.mjs',
    'scripts/pretest.mjs',
    'scripts/a11y-report.mjs',
    'scripts/seed.ts',
    'scripts/verify-doc-sync.ts',
    'scripts/build-export.mjs',
    'scripts/test-standalone.mjs',
    'scripts/test-container.mjs',
    'README.md',
    'docs/developer-setup.md',
    'docs/runtime-contract.md',
    'docs/versioning.md',
    '.github/CONTRIBUTING.md',
    '.github/TESTING.md',
    'AGENTS.md',
    '.github/ISSUE_TEMPLATE/documentation.md',
    'DEPLOYMENT.md',
    'docs-portal/.vitepress/config.mts',
    'docs-portal/index.md',
    'src/lib/basePath.ts',
    'src/components/demo/DemoToolbar.tsx',
    'src/app/project-info/ProjectInfoClient.tsx',
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
    'docker',
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

  it('rejects stale issue template names, /app/src/utils/ container paths, non-strict lint claims, and missing shared pre-push profile reference in CONTRIBUTING.md', () => {
    const contributingPath = path.join(tempDir, '.github/CONTRIBUTING.md');
    const driftedContributing = fs
      .readFileSync(contributingPath, 'utf8')
      .replace(/Documentation Improvement/g, 'Docs Improvement')
      .replace('`src/utils/`', '`/app/src/utils/`')
      .replace(/check:pre-push/g, 'legacy-push-list')
      .replace(/\.\.\/scripts\/check-quality\.ts/g, '../scripts/legacy-hook.ts')
      .replace(/scripts\/check-quality\.ts/g, 'scripts/legacy-hook.ts')
      .concat('\nRun npm run lint (though it is not super strict right now).\n');
    fs.writeFileSync(contributingPath, driftedContributing);

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Must cite exact issue template name "Documentation Improvement"'),
        expect.stringContaining('Contains stale issue template name "Docs Improvement"'),
        expect.stringContaining('Must use repository-relative "src/utils/"'),
        expect.stringContaining('Must not describe npm run lint as non-strict'),
        expect.stringContaining(
          'Push to Your Fork section must reference shared pre-push profile ("npm run check:pre-push" / "scripts/check-quality.ts")'
        ),
      ])
    );
  });

  it('rejects .env.test GUEST_PASSCODE drift, missing smoke project isolation docs, stale db_data wipe warnings, missing tsconfig exclusions, and missing unified quality commands in AGENTS.md', () => {
    const testingPath = path.join(tempDir, '.github/TESTING.md');
    fs.writeFileSync(
      testingPath,
      fs
        .readFileSync(testingPath, 'utf8')
        .replace(/build-fallback-guest-passcode/g, 'playwright-e2e-guest-passcode')
        .replace(/docker compose(?:\s+(?:-p|--env-file|-f)\s+\S+)*\s+down\s+-v/g, 'docker compose stop')
        .concat('\nDeleting local Docker Compose PostgreSQL volumes (`db_data`).\n')
    );

    const agentsPath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      fs
        .readFileSync(agentsPath, 'utf8')
        .replace(/`jest\.setup\.js`, /g, '')
        .replace(/`\.next\/export-stage`, /g, '')
        .replace('`**/*.stories.tsx`, ', '')
        .replace(/npm run quality/g, 'npm run legacy-gate')
    );

    const runtimeContractPath = path.join(tempDir, 'docs/runtime-contract.md');
    fs.writeFileSync(
      runtimeContractPath,
      fs
        .readFileSync(runtimeContractPath, 'utf8')
        .replace(/\.next\/export-stage/g, '.legacy-stage')
    );

    const testContainerPath = path.join(tempDir, 'scripts/test-container.mjs');
    fs.writeFileSync(
      testContainerPath,
      `${fs.readFileSync(testContainerPath, 'utf8').replace(/wedding-smoke-container/g, 'default-stack')}\n// lsof -ti:3000 | xargs kill -9\n`
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        '.github/TESTING.md: Must report .env.test GUEST_PASSCODE value "build-fallback-guest-passcode"',
        expect.stringContaining('.github/TESTING.md: Must document that scripts/test-standalone.mjs requires "npm run build"'),
        expect.stringContaining('.github/TESTING.md: Stale warning claiming smoke scripts delete/wipe local Docker Compose PostgreSQL volumes'),
        'AGENTS.md: Missing tsconfig.json exclude entry "jest.setup.js" in TypeScript Configuration Split section',
        'AGENTS.md: Missing tsconfig.json exclude entry ".next/export-stage" in TypeScript Configuration Split section',
        'AGENTS.md: Missing tsconfig.build.json exclude entry "**/*.stories.tsx" in TypeScript Configuration Split section',
        expect.stringContaining('AGENTS.md: Verification & Quality Gates section must prescribe "npm run check:static" and "npm run quality"'),
        expect.stringContaining('docs/runtime-contract.md: Must document staged static exports inside ".next/export-stage"'),
        'scripts/test-container.mjs: Must isolate Docker Compose project via "-p wedding-smoke-container"',
        'scripts/test-container.mjs: Must select a free loopback port instead of killing port 3000 processes',
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

    const checkQualityPath = path.join(tempDir, 'scripts/check-quality.ts');
    fs.writeFileSync(
      checkQualityPath,
      fs
        .readFileSync(checkQualityPath, 'utf8')
        .replace(
          "command: 'npm run check:standalone -- --static-only',",
          "command: 'npm run check:standalone',"
        )
        .replace(
          "{ name: 'Knip Unused Export Analysis', script: 'lint:unused', command: 'npm run lint:unused' },",
          "{ name: 'Portal Build', script: 'docs:build', command: 'npm run docs:build' },"
        )
    );

    const prePushPath = path.join(tempDir, '.githooks/pre-push');
    fs.writeFileSync(
      prePushPath,
      fs
        .readFileSync(prePushPath, 'utf8')
        .replace("args: ['--', '--static-only']", 'args: []')
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
        'scripts/check-quality.ts: prePushSteps must invoke "check:standalone" with "--static-only" so pre-push runs without a prior .next build',
        'scripts/check-quality.ts: prePushSteps must include "lint:unused"',
        'scripts/check-quality.ts: prePushSteps must exclude heavy step "docs:build"',
        '.githooks/pre-push: Must invoke "check:standalone" with "--static-only" so pre-push runs without a prior .next build',
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

  it('rejects missing CI-aware pretest and jest.setup.js contracts or missing guide pretest tokens', () => {
    const pretestPath = path.join(tempDir, 'scripts/pretest.mjs');
    fs.writeFileSync(
      pretestPath,
      fs.readFileSync(pretestPath, 'utf8').replace(/\.package-lock\.json/g, '.legacy-marker')
    );

    const jestSetupPath = path.join(tempDir, 'jest.setup.js');
    fs.writeFileSync(
      jestSetupPath,
      fs.readFileSync(jestSetupPath, 'utf8').replace(/TEST_DATABASE_URL/g, 'LEGACY_DB_FLAG')
    );

    const testingPath = path.join(tempDir, '.github/TESTING.md');
    fs.writeFileSync(
      testingPath,
      fs.readFileSync(testingPath, 'utf8').replace(/\.package-lock\.json/g, '.legacy-lock-marker')
    );

    const agentsPath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      `${fs.readFileSync(agentsPath, 'utf8')}\nLegacy flag: --legacy-peer-deps\n`
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('scripts/pretest.mjs: Must enforce CI-aware ".package-lock.json" alignment'),
        expect.stringContaining('jest.setup.js: Must preserve explicit DATABASE_URL'),
        '.github/TESTING.md: Missing scripts/pretest.mjs or coverage workflow reference ".package-lock.json"',
        'AGENTS.md: Must not document "--legacy-peer-deps" for pretest/CI bootstrap',
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

  it('rejects postinstall lock-hash omission, pretest portal/lifecycle regressions, missing TEST_DATABASE_URL support, and stale pretest guide claims', () => {
    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      fs
        .readFileSync(pkgPath, 'utf8')
        .replace(
          ' && node scripts/pretest.mjs --record-install-state',
          ''
        )
    );

    const pretestPath = path.join(tempDir, 'scripts/pretest.mjs');
    fs.writeFileSync(
      pretestPath,
      fs
        .readFileSync(pretestPath, 'utf8')
        .replace(/TEST_DATABASE_URL/g, 'LEGACY_DB_OVERRIDE')
        .concat('\n// stale process.env.npm_lifecycle_event && scripts/generate-portal.ts\n')
    );

    const checkQualityPath = path.join(tempDir, 'scripts/check-quality.ts');
    fs.writeFileSync(
      checkQualityPath,
      fs.readFileSync(checkQualityPath, 'utf8').replace('npm run test:cov', 'npm test')
    );

    const testingPath = path.join(tempDir, '.github/TESTING.md');
    fs.writeFileSync(
      testingPath,
      fs
        .readFileSync(testingPath, 'utf8')
        .replace(/TEST_DATABASE_URL/g, 'LEGACY_OVERRIDE_DOC')
        .replace(
          '### Pretest Lifecycle & Database Automation\n',
          '### Pretest Lifecycle & Database Automation\n\nLegacy `npm_lifecycle_event` and `npx tsx scripts/generate-portal.ts` step.\n'
        )
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        'package.json: "postinstall" must record lockfile state via "scripts/pretest.mjs --record-install-state" or ".package-lock-hash"',
        'scripts/pretest.mjs: Must not unconditionally run "scripts/generate-portal.ts" during test preflight',
        'scripts/pretest.mjs: Must not inspect "npm_lifecycle_event" or fall back to "npm run build"',
        'scripts/pretest.mjs: Must honor explicit "TEST_DATABASE_URL" overrides before falling back to local Docker defaults',
        'scripts/check-quality.ts: Must run "npm run test:cov" to enforce global coverage thresholds',
        '.github/TESTING.md: Missing scripts/pretest.mjs or coverage workflow reference "TEST_DATABASE_URL"',
        '.github/TESTING.md: Pretest Lifecycle section must not claim scripts/pretest.mjs runs "npx tsx scripts/generate-portal.ts" or inspects "npm_lifecycle_event"',
      ])
    );
  });

  it('rejects VitePress same-tab Storybook regressions, collapsed DemoToolbar link omissions, stale /project-info claims, missing build:export quality summaries, and missing demo runtime docs', () => {
    const configPath = path.join(tempDir, 'docs-portal/.vitepress/config.mts');
    fs.writeFileSync(
      configPath,
      fs
        .readFileSync(configPath, 'utf8')
        .replace(
          "{ text: 'Storybook', link: '/storybook/', target: '_blank', rel: 'noopener noreferrer' }",
          "{ text: 'Storybook', link: '/storybook/', target: '_self' }"
        )
    );

    const indexPath = path.join(tempDir, 'docs-portal/index.md');
    fs.writeFileSync(
      indexPath,
      fs.readFileSync(indexPath, 'utf8').replace(/target:\s*_blank/g, 'target: _self')
    );

    const toolbarPath = path.join(tempDir, 'src/components/demo/DemoToolbar.tsx');
    fs.writeFileSync(
      toolbarPath,
      fs
        .readFileSync(toolbarPath, 'utf8')
        .replace('data-testid="demo-link-api"', 'data-testid="demo-link-api-drifted"')
    );

    const projectInfoPath = path.join(tempDir, 'src/app/project-info/ProjectInfoClient.tsx');
    fs.writeFileSync(
      projectInfoPath,
      fs
        .readFileSync(projectInfoPath, 'utf8')
        .replace('TanStack Query & Zod', 'Fuse.js')
        .replace('Railway &amp; Render', 'Netlify')
        .replace('npm ci', 'npm install')
        .replace('.github/CONTRIBUTING.md', 'CONTRIBUTING.md')
    );

    const contributingPath = path.join(tempDir, '.github/CONTRIBUTING.md');
    fs.writeFileSync(
      contributingPath,
      fs
        .readFileSync(contributingPath, 'utf8')
        .replace('and static HTML showcase (`npm run build:export`) ', '')
    );

    const devSetupPath = path.join(tempDir, 'docs/developer-setup.md');
    fs.writeFileSync(
      devSetupPath,
      fs
        .readFileSync(devSetupPath, 'utf8')
        .replace(/src\/lib\/demo\/demoApiHandler\.ts/g, 'src/lib/demo/legacyMock.ts')
    );

    const readmePath = path.join(tempDir, 'README.md');
    fs.writeFileSync(
      readmePath,
      fs
        .readFileSync(readmePath, 'utf8')
        .replace(/\(\.\/docs\/developer-setup\.md\)/g, '(./docs/missing-setup.md)')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        "docs-portal/.vitepress/config.mts: Nav link \"/storybook/\" must open in a new tab with target: '_blank' and rel: 'noopener noreferrer'",
        'docs-portal/index.md: Every "/storybook/" action and feature card must set target: _blank and rel: noopener noreferrer',
        'src/components/demo/DemoToolbar.tsx: Showcase link "demo-link-api" must render in both expanded and collapsed states with data-static-demo-bypass="true"',
        'src/app/project-info/ProjectInfoClient.tsx: Must not claim unshipped "Fuse.js" library absent from package.json',
        'src/app/project-info/ProjectInfoClient.tsx: Must not claim unsupported "Netlify" hosting absent from DEPLOYMENT.md Support Tier Matrix',
        'src/app/project-info/ProjectInfoClient.tsx: Must list supported hosting target "Railway & Render" from DEPLOYMENT.md Support Tier Matrix',
        'src/app/project-info/ProjectInfoClient.tsx: Must prescribe "npm ci" rather than "npm install"',
        'src/app/project-info/ProjectInfoClient.tsx: Must link CONTRIBUTING.md to ".github/CONTRIBUTING.md"',
        '.github/CONTRIBUTING.md: "Run All Quality Checks" (npm run quality) summary must include "npm run build:export"',
        'docs/developer-setup.md: Missing interactive demo runtime module documentation for "src/lib/demo/demoApiHandler.ts"',
        'README.md: Must cross-link to canonical demo setup guide "docs/developer-setup.md" (verified via rewriteMarkdownLinks -> /development/developer-setup)',
      ])
    );
  });

  it('rejects missing lint-staged cache/ignore flags, missing docs:sync, non-incremental tsconfig.build.json, and missing pre-push worktree/lint/audit checks', () => {
    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      fs
        .readFileSync(pkgPath, 'utf8')
        .replace('--cache --cache-location .eslintcache --no-warn-ignored ', '')
        .replace('    ".github/workflows/*.{yml,yaml}": "npm run check:action-pins",\n', '')
        .replace('    "docs:sync": "npx tsx scripts/generate-openapi.ts && npx tsx scripts/generate-docs.ts --skip-openapi",\n', '')
    );

    const tsconfigBuildPath = path.join(tempDir, 'tsconfig.build.json');
    fs.writeFileSync(
      tsconfigBuildPath,
      fs.readFileSync(tsconfigBuildPath, 'utf8').replace('"incremental": true', '"incremental": false')
    );

    const prePushPath = path.join(tempDir, '.githooks/pre-push');
    fs.writeFileSync(
      prePushPath,
      fs
        .readFileSync(prePushPath, 'utf8')
        .replace("  'package.json',\n", '')
        .replace("  { name: 'ESLint code linting', script: 'lint' },\n", '')
        .replace(/\bworktree\b/gi, 'tempdir')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        'package.json: "lint-staged" must pass "--cache --cache-location .eslintcache --no-warn-ignored --fix --max-warnings=0"',
        'package.json: "lint-staged" must route staged files to "check:action-pins"',
        'package.json: "docs:sync" must invoke "scripts/generate-openapi.ts" and "scripts/generate-docs.ts"',
        'tsconfig.build.json: Must enable "incremental": true with "tsBuildInfoFile": "./tsconfig.build.tsbuildinfo"',
        '.githooks/pre-push: Must run "lint"',
        '.githooks/pre-push: Must guard "check:audit" against "package.json", "package-lock.json", "docker/prisma-cli/package.json", and "docker/prisma-cli/package-lock.json"',
        '.githooks/pre-push: Must verify dirty pushes inside an ephemeral detached git worktree',
      ])
    );
  });

  it('handles backtick info strings, multi-line HTML comments, backticked comment literals, and angle-bracket links in README', () => {
    const readmePath = path.join(tempDir, 'README.md');
    const updatedReadme = fs
      .readFileSync(readmePath, 'utf8')
      .replace(
        /\(\.\/docs\/developer-setup\.md\)/g,
        '(<./docs/developer-setup.md>)'
      )
      .replace(
        /(^##\s+Table of Contents\r?\n)/m,
        '$1<!--\n- [Commented Ghost Section](#ghost-section)\n-->\n'
      )
      .replace(
        /\(#table-of-contents\)/,
        '(<#table-of-contents>)'
      )
      .concat(
        '\nInline ```npm ci` span and `<!-- literal comment -->` stay active outside fences.\n<!--\n## Ghost Heading Inside Comment\n-->\n'
      );
    fs.writeFileSync(readmePath, updatedReadme, 'utf8');

    expect(verifySetupGuides(tempDir)).toEqual([]);
  });

  it('rejects utimesSync/tsc -b typecheck scripts, --untracked-files=no pre-push regression, duplicate tsBuildInfoFile paths, missing --skip-generate, and stale tsc -b docs', () => {
    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      fs
        .readFileSync(pkgPath, 'utf8')
        .replace(
          '"typecheck": "node --max-old-space-size=4096 scripts/quality/run-typecheck.mjs"',
          '"typecheck": "node -e \\"fs.utimesSync\\" && tsc -b --noEmit"'
        )
    );

    const prePushPath = path.join(tempDir, '.githooks/pre-push');
    fs.writeFileSync(
      prePushPath,
      fs
        .readFileSync(prePushPath, 'utf8')
        .replace('--untracked-files=normal', '--untracked-files=no')
        .replace("args: ['--', '--skip-generate']", 'args: []')
    );

    const tsconfigTestPath = path.join(tempDir, 'tsconfig.test.json');
    fs.writeFileSync(
      tsconfigTestPath,
      fs
        .readFileSync(tsconfigTestPath, 'utf8')
        .replace('./tsconfig.test.tsbuildinfo', './tsconfig.e2e.tsbuildinfo')
    );

    const agentsPath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      fs
        .readFileSync(agentsPath, 'utf8')
        .replace('content-hashed `scripts/quality/run-typecheck.mjs` pass', 'unified `tsc -b --noEmit` build graph')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        'package.json: "typecheck" must invoke "scripts/quality/run-typecheck.mjs"',
        'package.json: "typecheck" must not rely on "utimesSync" or timestamp-based "tsc -b"',
        expect.stringContaining(
          '.githooks/pre-push: trackedFilesMatchCommit must use "--untracked-files=normal"'
        ),
        '.githooks/pre-push: Must pass "--skip-generate" to "check:prisma" after pre-pool Prisma Client preparation',
        'tsconfig.test.json: Duplicate "tsBuildInfoFile" ("./tsconfig.e2e.tsbuildinfo") across tsconfig*.json projects',
        expect.stringContaining(
          'AGENTS.md: TypeScript Configuration Split section must document content-hashed "scripts/quality/run-typecheck.mjs"'
        ),
      ])
    );
  });
});
