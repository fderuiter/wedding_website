import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseEnvAssignments, verifySetupGuides } from './verify-setup-guides';

function copyFixtureFiles(srcRoot: string, destRoot: string): void {
  const filesToCopy = [
    '.nvmrc',
    '.npmrc',
    '.env.example',
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
    'jest.setup.js',
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
    'src/app',
    'src/components',
    'src/core',
    'src/features',
    'src/hooks',
    'src/lib',
    'src/mocks',
    'src/testing',
    'src/utils',
    'prisma',
    'public',
    'e2e',
    'scripts',
    'docs',
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
          'shadowDatabaseUrl: process.env.POSTGRES_URL_NON_POOLING || undefined,',
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

  it('rejects nonexistent Project Structure directories, missing SetupWizard steps, and missing db:seed bypass notes in README.md and developer-setup.md', () => {
    const readmePath = path.join(tempDir, 'README.md');
    fs.writeFileSync(
      readmePath,
      fs
        .readFileSync(readmePath, 'utf8')
        .replace('*   `src/core`:', '*   `src/data`: Static fallback data.\n*   `src/core`:')
        .replace(/Step 4/g, 'Phase Four')
    );

    const devSetupPath = path.join(tempDir, 'docs/developer-setup.md');
    fs.writeFileSync(
      devSetupPath,
      fs.readFileSync(devSetupPath, 'utf8').replace(/isSiteInitialized/g, 'checkInitialized')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        'README.md: Project Structure lists nonexistent path "src/data"',
        'README.md: Must document Step 4 of SetupWizard',
        expect.stringContaining('docs/developer-setup.md: Must document that seeding AppConfig satisfies isSiteInitialized'),
      ])
    );
  });

  it('rejects stale issue template names, /app/src/utils/ container paths, non-strict lint claims, and missing pre-commit scripts in CONTRIBUTING.md', () => {
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
        expect.stringContaining('Missing .githooks/pre-commit check script "check:action-pins"'),
      ])
    );
  });

  it('rejects .env.test GUEST_PASSCODE drift, missing smoke test volume warnings, missing tsconfig exclusions, and misordered check-quality.ts steps', () => {
    const testingPath = path.join(tempDir, '.github/TESTING.md');
    fs.writeFileSync(
      testingPath,
      fs
        .readFileSync(testingPath, 'utf8')
        .replace(/build-fallback-guest-passcode/g, 'playwright-e2e-guest-passcode')
        .replace(/docker compose(?:\s+-f\s+\S+)*\s+down\s+-v/g, 'docker compose stop')
    );

    const agentsPath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      fs
        .readFileSync(agentsPath, 'utf8')
        .replace(/`jest\.setup\.js`, /g, '')
        .replace('`**/*.stories.tsx`, ', '')
        .replace(
          '8. TypeScript Typecheck across all four project configs (`npm run typecheck`)\n9. ESLint Code Linting (`npm run lint`)\n10. Knip Unused Export Analysis (`npm run lint:unused`)\n11. Verify Migration Compatibility (`npm run lint:migrations`)',
          '8. Verify Migration Compatibility (`npm run lint:migrations`)\n9. TypeScript Typecheck across all four project configs (`npm run typecheck`)\n10. ESLint Code Linting (`npm run lint`)\n11. Knip Unused Export Analysis (`npm run lint:unused`)'
        )
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        '.github/TESTING.md: Must report .env.test GUEST_PASSCODE value "build-fallback-guest-passcode"',
        expect.stringContaining('.github/TESTING.md: Must warn that scripts/test-standalone.mjs requires "npm run build"'),
        'AGENTS.md: Missing tsconfig.json exclude entry "jest.setup.js" in TypeScript Configuration Split section',
        'AGENTS.md: Missing tsconfig.build.json exclude entry "**/*.stories.tsx" in TypeScript Configuration Split section',
        'AGENTS.md: Full Local Quality Gate section misorders check-quality.ts step "npm run lint:migrations"',
      ])
    );
  });

  it('rejects missing pretest* hooks, DEFAULT_DOC_FILES drift, and check:static / pre-commit parity gaps', () => {
    const pkgPath = path.join(tempDir, 'package.json');
    fs.writeFileSync(
      pkgPath,
      fs
        .readFileSync(pkgPath, 'utf8')
        .replace('    "pretest:cov": "npm run pretest",\n', '')
        .replace('    "test:e2e:smoke": "playwright test --grep @smoke",\n', '')
    );

    const preCommitPath = path.join(tempDir, '.githooks/pre-commit');
    fs.writeFileSync(
      preCommitPath,
      fs
        .readFileSync(preCommitPath, 'utf8')
        .replace("    { name: 'Deployment runbooks verification check', script: 'check:runbooks' },\n", '')
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
        '.githooks/pre-commit: Must enforce check:static sub-script "check:runbooks"',
        expect.stringContaining('Commit Your Changes claims "twelve" sequential workspace checks, expected "eleven"'),
        '.github/CONTRIBUTING.md: "npm run check:doc-sync" documentation is missing DEFAULT_DOC_FILES entry "GENERATED_SCHEMAS.md"',
        '.github/TESTING.md: "npm run check:doc-sync" documentation is missing DEFAULT_DOC_FILES entry "GENERATED_SCHEMAS.md"',
        'AGENTS.md: "npm run check:doc-sync" documentation is missing DEFAULT_DOC_FILES entry "GENERATED_SCHEMAS.md"',
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

    const agentsPath = path.join(tempDir, 'AGENTS.md');
    fs.writeFileSync(
      agentsPath,
      fs
        .readFileSync(agentsPath, 'utf8')
        .replace(
          'npm run build\nCI=true npm run test:a11y',
          'npm run build\nDATABASE_URL="postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public" npm run db:seed\nCI=true npm run test:a11y'
        )
    );

    const testingPath = path.join(tempDir, '.github/TESTING.md');
    fs.writeFileSync(
      testingPath,
      fs.readFileSync(testingPath, 'utf8').replace(/PLAYWRIGHT_REUSE_SERVER/g, 'LEGACY_REUSE_FLAG')
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('playwright.config.ts: Must disable automatic server reuse by default'),
        expect.stringContaining('scripts/seed.ts: appConfig.upsert must populate update fields'),
        expect.stringContaining('scripts/a11y-report.mjs: runA11ySuite must reseed wedding_test via "scripts/seed.ts"'),
        expect.stringContaining('AGENTS.md: Accessibility Quality Gate must not prescribe running "db:seed" before "test:a11y"'),
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
      `${fs.readFileSync(envExamplePath, 'utf8')}\n# legacy scrypt:c2FsdA==:aGFzaA==\n`
    );

    const errors = verifySetupGuides(tempDir);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('docker-compose.yml: Must not declare default fallback secret ${DB_PASSWORD:-...}'),
        expect.stringContaining('docker-compose.yml: Must bind PostgreSQL strictly to 127.0.0.1:${DB_PORT:-5432}:5432'),
        expect.stringContaining('scripts/test-container.mjs: Must invoke isolated "docker-compose.ci.yml" override manifest'),
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
      fs.readFileSync(readmePath, 'utf8').replace('    npm ci', '    npm install')
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
      fs.readFileSync(testingPath, 'utf8').replace(/--stage-only/g, '')
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
        '.github/TESTING.md: Missing scripts/pretest.mjs step reference "--stage-only"',
        'AGENTS.md: Must not document "--legacy-peer-deps" for pretest/CI bootstrap',
      ])
    );
  });
});
