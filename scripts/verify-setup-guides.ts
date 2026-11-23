import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const COMMENTED_OPTIONAL_ENV_KEYS = [
  'POSTGRES_URL_NON_POOLING',
  'CRON_SECRET',
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'S3_PUBLIC_URL',
  'STRIPE_SECRET_KEY',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

export function parseEnvAssignments(content: string): {
  active: Map<string, string>;
  commented: Set<string>;
} {
  const active = new Map<string, string>();
  const commented = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const commentedMatch = trimmed.match(/^#\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/);
    if (commentedMatch) {
      commented.add(commentedMatch[1]);
      continue;
    }

    if (trimmed.startsWith('#')) {
      continue;
    }

    const activeMatch = trimmed.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (activeMatch) {
      const key = activeMatch[1];
      let val = activeMatch[2].trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith('\'') && val.endsWith('\''))
      ) {
        val = val.slice(1, -1);
      }
      active.set(key, val);
    }
  }

  return { active, commented };
}

function extractMarkdownSection(
  markdown: string,
  headingPattern: RegExp,
  stopHeadingPattern: RegExp
): string {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let inSection = false;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence;
    }
    if (!inFence && !inSection && headingPattern.test(line)) {
      inSection = true;
      continue;
    }
    if (!inFence && inSection && stopHeadingPattern.test(line)) {
      break;
    }
    if (inSection) {
      out.push(line);
    }
  }

  return out.join('\n');
}

function extractReadmeProjectStructurePaths(readmeContent: string): string[] {
  const section = extractMarkdownSection(readmeContent, /^##\s+Project Structure\b/, /^##\s+/);
  const paths: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*[*-]\s+`([^`]+)`\s*:/);
    if (match) {
      paths.push(match[1].trim());
    }
  }
  return paths;
}

function parseIssueTemplateFrontmatterName(markdown: string): string | null {
  const match = markdown.match(/^---\r?\n[\s\S]*?^name:\s*(.+?)\s*$/m);
  if (!match) {
    return null;
  }
  let name = match[1].trim();
  if (
    (name.startsWith('"') && name.endsWith('"')) ||
    (name.startsWith('\'') && name.endsWith('\''))
  ) {
    name = name.slice(1, -1);
  }
  return name;
}

function parsePreCommitScripts(preCommitContent: string): string[] {
  const scripts: string[] = [];
  const scriptRegex = /\{\s*name:\s*['"][^'"]+['"]\s*,\s*script:\s*['"]([^'"]+)['"]\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(preCommitContent)) !== null) {
    scripts.push(match[1]);
  }
  return scripts;
}

function parseStaticStepScripts(checkQualityContent: string): string[] {
  const staticBlockMatch = checkQualityContent.match(
    /export\s+const\s+staticSteps\s*(?::[^=]*)?=\s*\[([\s\S]*?)\];/
  );
  if (!staticBlockMatch) {
    return [];
  }
  const scripts = new Set<string>();
  const scriptPropRegex = /\bscript:\s*['"]([a-zA-Z0-9:_-]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = scriptPropRegex.exec(staticBlockMatch[1])) !== null) {
    scripts.add(match[1]);
  }
  const cmdRegex = /command:\s*['"]npm\s+run\s+([a-zA-Z0-9:_-]+)['"]/g;
  while ((match = cmdRegex.exec(staticBlockMatch[1])) !== null) {
    scripts.add(match[1]);
  }
  return Array.from(scripts);
}

function parseDefaultDocFiles(verifyDocSyncContent: string): string[] {
  const arrMatch = verifyDocSyncContent.match(
    /DEFAULT_DOC_FILES\s*(?::[^=]*)?=\s*\[([\s\S]*?)\]/
  );
  if (!arrMatch) {
    return [];
  }
  const files: string[] = [];
  const strRegex = /['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = strRegex.exec(arrMatch[1])) !== null) {
    files.push(match[1]);
  }
  return files;
}

function extractDocSyncBulletLines(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s+`npm run check:doc-sync`/.test(line))
    .join('\n');
}

function parseQualityStepCommands(checkQualityContent: string): string[] {
  const commands: string[] = [];
  const stepsSection = checkQualityContent.split('export function main')[0] ?? checkQualityContent;
  const cmdRegex = /command:\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = cmdRegex.exec(stepsSection)) !== null) {
    commands.push(match[1]);
  }
  return commands;
}

function parseDockerComposeDbDefaults(
  composeContent: string,
  ciComposeContent: string
): {
  dbUser: string;
  dbPassword: string;
  dbName: string;
  dbPort: string;
} {
  const userMatch = composeContent.match(/POSTGRES_USER:\s*\$\{DB_USER:-([^}]+)\}/);
  const passMatch = ciComposeContent.match(/POSTGRES_PASSWORD:\s*\$\{DB_PASSWORD:-([^}]+)\}/);
  const nameMatch = composeContent.match(/POSTGRES_DB:\s*\$\{DB_NAME:-([^}]+)\}/);
  const portMatch = composeContent.match(/127\.0\.0\.1:\$\{DB_PORT:-([^}]+)\}:5432/);

  return {
    dbUser: userMatch ? userMatch[1] : 'wedding',
    dbPassword: passMatch ? passMatch[1] : 'wedding123',
    dbName: nameMatch ? nameMatch[1] : 'wedding',
    dbPort: portMatch ? portMatch[1] : '5432',
  };
}

export function verifySetupGuides(repoRoot: string = process.cwd()): string[] {
  const errors: string[] = [];

  const requiredFiles = [
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

  for (const relPath of requiredFiles) {
    if (!fs.existsSync(path.join(repoRoot, relPath))) {
      errors.push(`Required repository file not found: ${relPath}`);
    }
  }
  if (errors.length > 0) {
    return errors;
  }

  const nvmrcRaw = fs.readFileSync(path.join(repoRoot, '.nvmrc'), 'utf8');
  const npmrcRaw = fs.readFileSync(path.join(repoRoot, '.npmrc'), 'utf8');
  const envExampleRaw = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  const envTestRaw = fs.readFileSync(path.join(repoRoot, '.env.test'), 'utf8');
  const prismaConfigRaw = fs.readFileSync(path.join(repoRoot, 'prisma.config.ts'), 'utf8');
  const packageJsonRaw = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8');
  const tsconfigRaw = fs.readFileSync(path.join(repoRoot, 'tsconfig.json'), 'utf8');
  const tsconfigBuildRaw = fs.readFileSync(path.join(repoRoot, 'tsconfig.build.json'), 'utf8');
  const composeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const ciComposeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.ci.yml'), 'utf8');
  const testStandaloneRaw = fs.readFileSync(path.join(repoRoot, 'scripts/test-standalone.mjs'), 'utf8');
  const testContainerRaw = fs.readFileSync(path.join(repoRoot, 'scripts/test-container.mjs'), 'utf8');
  const playwrightConfigRaw = fs.readFileSync(path.join(repoRoot, 'playwright.config.ts'), 'utf8');
  const preCommitRaw = fs.readFileSync(path.join(repoRoot, '.githooks/pre-commit'), 'utf8');
  const checkQualityRaw = fs.readFileSync(path.join(repoRoot, 'scripts/check-quality.ts'), 'utf8');
  const pretestMjsRaw = fs.readFileSync(path.join(repoRoot, 'scripts/pretest.mjs'), 'utf8');
  const a11yReportRaw = fs.readFileSync(path.join(repoRoot, 'scripts/a11y-report.mjs'), 'utf8');
  const seedRaw = fs.readFileSync(path.join(repoRoot, 'scripts/seed.ts'), 'utf8');
  const verifyDocSyncRaw = fs.readFileSync(
    path.join(repoRoot, 'scripts/verify-doc-sync.ts'),
    'utf8'
  );
  const readmeRaw = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const devSetupRaw = fs.readFileSync(path.join(repoRoot, 'docs/developer-setup.md'), 'utf8');
  const versioningRaw = fs.readFileSync(path.join(repoRoot, 'docs/versioning.md'), 'utf8');
  const contributingRaw = fs.readFileSync(path.join(repoRoot, '.github/CONTRIBUTING.md'), 'utf8');
  const testingRaw = fs.readFileSync(path.join(repoRoot, '.github/TESTING.md'), 'utf8');
  const agentsRaw = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  const docIssueTemplateRaw = fs.readFileSync(
    path.join(repoRoot, '.github/ISSUE_TEMPLATE/documentation.md'),
    'utf8'
  );

  // 1. .env.example, prisma.config.ts, & package.json bootstrap checks
  const envExample = parseEnvAssignments(envExampleRaw);
  for (const optionalKey of COMMENTED_OPTIONAL_ENV_KEYS) {
    if (envExample.active.has(optionalKey)) {
      errors.push(
        `.env.example: Optional variable "${optionalKey}" must stay commented out by default so copying .env.example does not break local setup`
      );
    }
    if (!envExample.commented.has(optionalKey)) {
      errors.push(
        `.env.example: Commented placeholder "# ${optionalKey}=..." is missing`
      );
    }
  }

  if (envExampleRaw.includes('mydb_shadow')) {
    errors.push('.env.example: Must not reference broken "mydb_shadow" shadow database URL');
  }

  if (!envExampleRaw.includes('scripts/generate-password-hash.mjs')) {
    errors.push(
      '.env.example: Must cite "scripts/generate-password-hash.mjs" so ADMIN_PASSWORD satisfies the 64-byte scrypt key check in src/utils/password.ts'
    );
  }

  const composeDb = parseDockerComposeDbDefaults(composeRaw, ciComposeRaw);
  const expectedComposeDbPrefix = `postgresql://${composeDb.dbUser}:${composeDb.dbPassword}@localhost:${composeDb.dbPort}/${composeDb.dbName}`;
  const envExampleDbUrl = envExample.active.get('DATABASE_URL') ?? '';
  if (!envExampleDbUrl.startsWith(expectedComposeDbPrefix)) {
    errors.push(
      `.env.example: DATABASE_URL ("${envExampleDbUrl}") must default to "${expectedComposeDbPrefix}..." matching local setup guides and docker-compose.ci.yml`
    );
  }

  // Validate hardened docker-compose.yml required-secret guards and isolated docker-compose.ci.yml overrides
  for (const requiredSecret of ['DB_PASSWORD', 'ADMIN_PASSWORD', 'GUEST_PASSCODE', 'GUEST_SESSION_SECRET']) {
    if (!new RegExp(`\\$\\{${requiredSecret}:\\?`).test(composeRaw)) {
      errors.push(
        `docker-compose.yml: Must require explicit operator value via \${${requiredSecret}:?...}`
      );
    }
    if (new RegExp(`\\$\\{${requiredSecret}:-`).test(composeRaw)) {
      errors.push(
        `docker-compose.yml: Must not declare default fallback secret \${${requiredSecret}:-...}`
      );
    }
  }
  if (!composeRaw.includes('127.0.0.1:${DB_PORT:-5432}:5432')) {
    errors.push('docker-compose.yml: Must bind PostgreSQL strictly to 127.0.0.1:${DB_PORT:-5432}:5432');
  }
  if (!/E2E_TEST:\s*\$\{E2E_TEST:-false\}/.test(composeRaw)) {
    errors.push('docker-compose.yml: Must set E2E_TEST: ${E2E_TEST:-false} by default');
  }
  if (
    !/POSTGRES_PASSWORD:\s*\$\{DB_PASSWORD:-wedding123\}/.test(ciComposeRaw) ||
    !/E2E_TEST:\s*\$\{E2E_TEST:-true\}/.test(ciComposeRaw)
  ) {
    errors.push(
      'docker-compose.ci.yml: Must isolate disposable CI database credentials and E2E_TEST: ${E2E_TEST:-true}'
    );
  }
  for (const [scriptLabel, scriptRaw] of [
    ['scripts/test-standalone.mjs', testStandaloneRaw],
    ['scripts/test-container.mjs', testContainerRaw],
  ] as const) {
    if (!scriptRaw.includes('docker-compose.ci.yml')) {
      errors.push(`${scriptLabel}: Must invoke isolated "docker-compose.ci.yml" override manifest`);
    }
  }
  for (const [label, rawText] of [
    ['.env.example', envExampleRaw],
    ['.env.test', envTestRaw],
    ['docker-compose.yml', composeRaw],
    ['docker-compose.ci.yml', ciComposeRaw],
    ['scripts/test-standalone.mjs', testStandaloneRaw],
    ['scripts/test-container.mjs', testContainerRaw],
    ['README.md', readmeRaw],
    ['docs/developer-setup.md', devSetupRaw],
    ['.github/TESTING.md', testingRaw],
    ['AGENTS.md', agentsRaw],
  ] as const) {
    if (rawText.includes('scrypt:c2FsdA==:aGFzaA==')) {
      errors.push(`${label}: Must not contain invalid 4-byte placeholder hash "scrypt:c2FsdA==:aGFzaA=="`);
    }
  }

  if (/shadowDatabaseUrl\s*:.*(?:dummy_shadow|mydb_shadow)/.test(prismaConfigRaw)) {
    errors.push(
      'prisma.config.ts: shadowDatabaseUrl must not fall back to a dummy/mydb_shadow URL when POSTGRES_URL_NON_POOLING is unset'
    );
  }

  const pkg = JSON.parse(packageJsonRaw) as {
    scripts?: Record<string, string>;
    engines?: Record<string, string>;
    devEngines?: {
      runtime?: { name?: string; version?: string; onFail?: string };
      packageManager?: { name?: string; version?: string; onFail?: string };
    };
    devDependencies?: Record<string, string>;
  };

  // Validate Node.js 22 LTS & npm@10.9.x toolchain parity across .nvmrc, .npmrc, package.json, pretest.mjs, and setup/versioning docs
  const nvmrcTrimmed = nvmrcRaw.trim();
  const nvmrcMajorMatch = nvmrcTrimmed.match(/^v?(\d+)(?:\.\d+\.\d+)?$/);
  const expectedNodeMajor = nvmrcMajorMatch ? nvmrcMajorMatch[1] : '22';
  if (!nvmrcMajorMatch || expectedNodeMajor !== '22') {
    errors.push(`.nvmrc: Must pin Node.js 22 LTS major ("22"), found "${nvmrcTrimmed}"`);
  }
  if (!/^engine-strict\s*=\s*true\s*$/m.test(npmrcRaw)) {
    errors.push('.npmrc: Must set "engine-strict=true" at the repository root');
  }
  const parseMajorFromRange = (range?: string): string | null => {
    if (!range) return null;
    const match = range.trim().match(/^(?:[\^~>=<v\s]*)(\d+)(?:\.\d+|\.x|\b|$)/i);
    return match ? match[1] : null;
  };
  if (parseMajorFromRange(pkg.engines?.node) !== expectedNodeMajor) {
    errors.push(
      `package.json: "engines.node" ("${pkg.engines?.node ?? ''}") must target Node.js ${expectedNodeMajor} matching .nvmrc`
    );
  }
  if (parseMajorFromRange(pkg.engines?.npm) !== '10' || !pkg.engines?.npm?.includes('10.9')) {
    errors.push(
      `package.json: "engines.npm" ("${pkg.engines?.npm ?? ''}") must target npm ^10.9.0`
    );
  }
  if (
    pkg.devEngines?.runtime?.name !== 'node' ||
    parseMajorFromRange(pkg.devEngines?.runtime?.version) !== expectedNodeMajor ||
    pkg.devEngines?.runtime?.onFail !== 'error'
  ) {
    errors.push(
      `package.json: "devEngines.runtime" must enforce Node.js ${expectedNodeMajor} with onFail: "error"`
    );
  }
  if (
    pkg.devEngines?.packageManager?.name !== 'npm' ||
    parseMajorFromRange(pkg.devEngines?.packageManager?.version) !== '10' ||
    !pkg.devEngines?.packageManager?.version?.includes('10.9') ||
    pkg.devEngines?.packageManager?.onFail !== 'error'
  ) {
    errors.push(
      'package.json: "devEngines.packageManager" must enforce npm ^10.9.0 with onFail: "error"'
    );
  }
  if (parseMajorFromRange(pkg.devDependencies?.['@types/node']) !== expectedNodeMajor) {
    errors.push(
      `package.json: "@types/node" ("${pkg.devDependencies?.['@types/node'] ?? ''}") must target Node.js ${expectedNodeMajor} matching .nvmrc`
    );
  }
  if (pretestMjsRaw.includes('--legacy-peer-deps')) {
    errors.push('scripts/pretest.mjs: Must run "npm ci" without "--legacy-peer-deps" to match CI');
  }
  if (testingRaw.includes('--legacy-peer-deps')) {
    errors.push('.github/TESTING.md: Must not document "--legacy-peer-deps" for pretest/CI bootstrap');
  }
  for (const [docLabel, docText] of [
    ['README.md', readmeRaw],
    ['docs/developer-setup.md', devSetupRaw],
    ['AGENTS.md', agentsRaw],
  ] as const) {
    if (!docText.includes('.nvmrc')) {
      errors.push(`${docLabel}: Must reference ".nvmrc" for Node.js ${expectedNodeMajor} LTS alignment`);
    }
    if (!docText.includes('10.9')) {
      errors.push(`${docLabel}: Must reference "npm@10.9.x" matching package.json devEngines`);
    }
    if (!/\bnpm\s+ci\b/.test(docText)) {
      errors.push(`${docLabel}: Must prescribe deterministic "npm ci" dependency installation`);
    }
    if (
      new RegExp(`\\bNode\\.js\\s+v?(?!${expectedNodeMajor}\\b)\\d+(?:\\.x)?(?:\\s+LTS|\\+)`).test(
        docText
      )
    ) {
      errors.push(
        `${docLabel}: Node.js major version does not match .nvmrc (expected Node.js ${expectedNodeMajor} LTS)`
      );
    }
  }
  const readmeSetupSection = extractMarkdownSection(
    readmeRaw,
    /^##\s+Setup & Installation\b/,
    /^##\s+/
  );
  if (!/\bnpm\s+ci\b/.test(readmeSetupSection) || /\bnpm\s+install\b/.test(readmeSetupSection)) {
    errors.push(
      'README.md: Installation section must prescribe "npm ci" rather than "npm install"'
    );
  }
  const devSetupInstallSection = extractMarkdownSection(
    devSetupRaw,
    /^##\s+2\.\s+Cloning the Repository & Installing Dependencies\b/,
    /^##\s+/
  );
  if (
    !/\bnpm\s+ci\b/.test(devSetupInstallSection) ||
    /\bnpm\s+install\b/.test(devSetupInstallSection)
  ) {
    errors.push(
      'docs/developer-setup.md: Cloning the Repository & Installing Dependencies section must prescribe "npm ci" rather than "npm install"'
    );
  }
  if (
    !versioningRaw.includes(`node:${expectedNodeMajor}-bookworm-slim`) ||
    /\bnode:\d+-alpine\b/.test(versioningRaw) ||
    new RegExp(`\\bnode:(?!${expectedNodeMajor}-bookworm-slim\\b)\\d+-bookworm-slim\\b`).test(
      versioningRaw
    )
  ) {
    errors.push(
      `docs/versioning.md: Must cite "node:${expectedNodeMajor}-bookworm-slim" (not stale alpine or mismatched Node.js major)`
    );
  }
  const scripts = pkg.scripts ?? {};
  const dbSeedCmd = scripts['db:seed'] ?? '';
  if (!/\bdotenv\s+-c\s+development\s+--\s+tsx\s+scripts\/seed\.ts\b/.test(dbSeedCmd)) {
    errors.push(
      `package.json: "db:seed" ("${dbSeedCmd}") must use "dotenv -c development -- tsx scripts/seed.ts"`
    );
  }

  if (!scripts['check:setup-guides']) {
    errors.push('package.json: Missing "check:setup-guides" script');
  }

  const checkStaticCmd = scripts['check:static'] ?? '';
  const staticStepScripts = parseStaticStepScripts(checkQualityRaw);
  if (
    !checkStaticCmd.includes('scripts/check-quality.ts') ||
    !checkStaticCmd.includes('--static')
  ) {
    errors.push(
      'package.json: "check:static" must delegate to "scripts/check-quality.ts --static" so local static checks, npm run quality, and CI share one static check source'
    );
  }
  if (!staticStepScripts.includes('check:setup-guides')) {
    errors.push('scripts/check-quality.ts: staticSteps must include "npm run check:setup-guides"');
  }
  if (!staticStepScripts.includes('check:standalone')) {
    errors.push('scripts/check-quality.ts: staticSteps must include "npm run check:standalone"');
  }

  const pretestCmd = scripts['pretest'] ?? '';
  if (!pretestCmd.includes('scripts/pretest.mjs')) {
    errors.push('package.json: "pretest" must invoke "scripts/pretest.mjs"');
  }
  for (const [scriptName, scriptCmd] of Object.entries(scripts)) {
    if (scriptName.startsWith('test') && /\bjest\b/.test(scriptCmd)) {
      const expectedHook = `pre${scriptName}`;
      const hookCmd = scripts[expectedHook] ?? '';
      if (!/scripts\/pretest\.mjs|\bnpm\s+run\s+pretest\b/.test(hookCmd)) {
        errors.push(
          `package.json: Jest script "${scriptName}" requires lifecycle hook "${expectedHook}" invoking "scripts/pretest.mjs" or "npm run pretest"`
        );
      }
    }
  }
  const testingRunSection = extractMarkdownSection(
    testingRaw,
    /^##\s+How to Run Tests\b/,
    /^##\s+/
  );
  const prescribedTestCmdRegex = /\bnpm\s+run\s+(test:[a-zA-Z0-9:_-]+)/g;
  let prescribedMatch: RegExpExecArray | null;
  while ((prescribedMatch = prescribedTestCmdRegex.exec(testingRunSection)) !== null) {
    const testScriptName = prescribedMatch[1];
    if (!scripts[testScriptName]) {
      errors.push(`.github/TESTING.md: Prescribes missing package.json script "${testScriptName}"`);
    } else if (/\bjest\b/.test(scripts[testScriptName])) {
      const hookName = `pre${testScriptName}`;
      if (!/scripts\/pretest\.mjs|\bnpm\s+run\s+pretest\b/.test(scripts[hookName] ?? '')) {
        errors.push(
          `package.json: Missing "${hookName}" pretest hook for "${testScriptName}" prescribed in .github/TESTING.md`
        );
      }
    }
  }

  // 2. Hook, staticSteps parity, E2E runner, & check-quality.ts registration checks
  const preCommitScripts = parsePreCommitScripts(preCommitRaw);
  if (!preCommitScripts.includes('check:setup-guides')) {
    errors.push('.githooks/pre-commit: Must run "check:setup-guides"');
  }
  for (const staticSubscript of staticStepScripts) {
    if (staticSubscript === 'check:standalone') {
      continue;
    }
    if (!preCommitScripts.includes(staticSubscript)) {
      errors.push(
        `.githooks/pre-commit: Must enforce lightweight static check "${staticSubscript}"`
      );
    }
  }
  for (const heavyBuildScript of ['check:standalone', 'docs:build', 'build-storybook', 'build']) {
    if (preCommitScripts.includes(heavyBuildScript)) {
      errors.push(
        `.githooks/pre-commit: Must exclude heavy/build-coupled step "${heavyBuildScript}" so local commits stay fast`
      );
    }
  }

  if (/\bupdate\s*:\s*\{\s*\}/.test(seedRaw)) {
    errors.push(
      'scripts/seed.ts: appConfig.upsert must populate update fields rather than using an empty "update: {}" object'
    );
  }

  if (!/node\s+scripts\/a11y-report\.mjs\s+--unit\b/.test(scripts['test:a11y:unit'] ?? '')) {
    errors.push(
      'package.json: "test:a11y:unit" must invoke "node scripts/a11y-report.mjs --unit"'
    );
  }
  if (!/\bplaywright\s+test\b/.test(scripts['test:e2e'] ?? '')) {
    errors.push('package.json: Missing "test:e2e" Playwright runner script');
  }
  if (!/\bplaywright\s+test\b.*--grep\s+@smoke\b/.test(scripts['test:e2e:smoke'] ?? '')) {
    errors.push('package.json: "test:e2e:smoke" must invoke "playwright test --grep @smoke"');
  }

  const runA11ySuiteBody = a11yReportRaw.split('export function runA11ySuite')[1] ?? '';
  const hasCoverageFalseUnitPass =
    a11yReportRaw.includes('\'--coverage=false\'') &&
    a11yReportRaw.includes('\'--runTestsByPath\'');
  const a11yJestIdx = runA11ySuiteBody.indexOf('runA11yUnit(');
  const a11ySeedIdx = runA11ySuiteBody.indexOf('scripts/seed.ts');
  const a11yPlaywrightIdx = runA11ySuiteBody.search(
    /['"]npx['"]\s*,\s*\[\s*['"]playwright['"]\s*,\s*['"]test['"]\s*,\s*['"]--grep['"]\s*,\s*['"]@a11y['"]\s*\]/
  );
  if (
    !hasCoverageFalseUnitPass ||
    a11yJestIdx === -1 ||
    a11ySeedIdx === -1 ||
    a11yPlaywrightIdx === -1 ||
    !(a11yJestIdx < a11ySeedIdx && a11ySeedIdx < a11yPlaywrightIdx)
  ) {
    errors.push(
      'scripts/a11y-report.mjs: runA11ySuite must reseed wedding_test via "scripts/seed.ts" after runA11yUnit and before "npx playwright test --grep @a11y"'
    );
  }

  if (
    /reuseExistingServer\s*:\s*true\b/.test(playwrightConfigRaw) ||
    /reuseExistingServer\s*:\s*!process\.env\.CI\s*[,}]/.test(playwrightConfigRaw) ||
    !playwrightConfigRaw.includes('PLAYWRIGHT_REUSE_SERVER')
  ) {
    errors.push(
      'playwright.config.ts: Must disable automatic server reuse by default and allow reuse only via explicit PLAYWRIGHT_REUSE_SERVER opt-in outside CI'
    );
  }
  if (
    !playwrightConfigRaw.includes('prisma db push') ||
    !playwrightConfigRaw.includes('scripts/seed.ts') ||
    !playwrightConfigRaw.includes('node .next/standalone/server.js') ||
    !playwrightConfigRaw.includes('TEST_CONTAINER')
  ) {
    errors.push(
      'playwright.config.ts: Must initialize and seed wedding_test before npm run dev when CI and TEST_CONTAINER are unset while preserving CI standalone execution'
    );
  }

  const qualityCommands = parseQualityStepCommands(checkQualityRaw);
  const setupGuidesQualityIdx = qualityCommands.findIndex((cmd) =>
    cmd.includes('check:setup-guides') || cmd.includes('verify-setup-guides.ts')
  );
  const docsBuildQualityIdx = qualityCommands.findIndex((cmd) => cmd.includes('docs:build'));
  if (setupGuidesQualityIdx === -1) {
    errors.push('scripts/check-quality.ts: Missing "check:setup-guides" step');
  } else if (docsBuildQualityIdx !== -1 && setupGuidesQualityIdx >= docsBuildQualityIdx) {
    errors.push('scripts/check-quality.ts: "check:setup-guides" must run before "npm run docs:build"');
  }

  // 3. README.md overview & docs/developer-setup.md canonical setup contract checks
  if (/UNDER\s+MAINTAIN(?:AN|EN)CE/i.test(readmeRaw)) {
    errors.push('README.md: Must not contain outdated maintenance banner');
  }
  for (const capability of [
    'invitation codes',
    'event responses',
    'seating charts',
    'moderation',
    'broadcasts',
    '15-model full-site backups',
  ]) {
    if (!new RegExp(capability.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(readmeRaw)) {
      errors.push(`README.md: Must list shipped capability "${capability}"`);
    }
  }
  for (const requiredLink of ['docs/developer-setup.md', 'DEPLOYMENT.md']) {
    if (!readmeRaw.includes(requiredLink)) {
      errors.push(`README.md: Must link directly to canonical guide "${requiredLink}"`);
    }
  }

  const readmeStructurePaths = extractReadmeProjectStructurePaths(readmeRaw);
  if (readmeStructurePaths.length === 0) {
    errors.push('README.md: Missing directory entries under "## Project Structure"');
  }
  for (const relDir of readmeStructurePaths) {
    if (!fs.existsSync(path.join(repoRoot, relDir))) {
      errors.push(`README.md: Project Structure lists nonexistent path "${relDir}"`);
    }
  }

  if (!devSetupRaw.includes(expectedComposeDbPrefix)) {
    errors.push(
      `docs/developer-setup.md: Must document local Docker Compose PostgreSQL URL "${expectedComposeDbPrefix}"`
    );
  }
  for (const requiredVar of [
    'ADMIN_PASSWORD',
    'DATABASE_URL',
    'GUEST_PASSCODE',
    'GUEST_SESSION_SECRET',
    'ALLOWED_HOSTS',
  ]) {
    if (!devSetupRaw.includes(requiredVar)) {
      errors.push(`docs/developer-setup.md: Missing required environment variable "${requiredVar}"`);
    }
  }
  if (!devSetupRaw.includes('scripts/generate-password-hash.mjs')) {
    errors.push('docs/developer-setup.md: Must reference "scripts/generate-password-hash.mjs"');
  }
  for (const stepNum of [1, 2, 3, 4, 5]) {
    if (!new RegExp(`\\bStep\\s+${stepNum}\\b`, 'i').test(devSetupRaw)) {
      errors.push(`docs/developer-setup.md: Must document Step ${stepNum} of SetupWizard`);
    }
  }
  if (!/Sample Data/i.test(devSetupRaw) || !/Guest List Import|CSV/i.test(devSetupRaw)) {
    errors.push(
      'docs/developer-setup.md: Must document SetupWizard sample data selection and guest list CSV import steps'
    );
  }
  if (
    !devSetupRaw.includes('isSiteInitialized') ||
    !devSetupRaw.includes('layout.tsx') ||
    !devSetupRaw.includes('middleware.ts') ||
    !devSetupRaw.includes('/guest/login')
  ) {
    errors.push(
      'docs/developer-setup.md: Must document that seeding AppConfig satisfies isSiteInitialized (src/lib/config.ts), skips SetupWizard (src/app/layout.tsx), and redirects / to /guest/login (src/middleware.ts)'
    );
  }
  for (const crossRef of ['TESTING.md', 'CONTRIBUTING.md']) {
    if (!devSetupRaw.includes(crossRef)) {
      errors.push(`docs/developer-setup.md: Must cross-reference "${crossRef}"`);
    }
  }

  // 4. .github/CONTRIBUTING.md canonical contribution, scaffold, pre-commit & doc-sync checks
  const docTemplateName =
    parseIssueTemplateFrontmatterName(docIssueTemplateRaw) ?? 'Documentation Improvement';
  if (!contributingRaw.includes(docTemplateName)) {
    errors.push(
      `.github/CONTRIBUTING.md: Must cite exact issue template name "${docTemplateName}" from .github/ISSUE_TEMPLATE/documentation.md`
    );
  }
  if (/\bDocs Improvement\b/.test(contributingRaw)) {
    errors.push(
      `.github/CONTRIBUTING.md: Contains stale issue template name "Docs Improvement" instead of "${docTemplateName}"`
    );
  }
  if (contributingRaw.includes('/app/src/')) {
    errors.push(
      '.github/CONTRIBUTING.md: Must use repository-relative "src/utils/" instead of container path "/app/src/..."'
    );
  }
  if (/not super strict/i.test(contributingRaw) || /`npm run lint`\s+might help/i.test(contributingRaw)) {
    errors.push(
      '.github/CONTRIBUTING.md: Must not describe npm run lint as non-strict or optional'
    );
  }
  for (const requiredRuleToken of [
    'eslint.config.mjs',
    'no-restricted-imports',
    'no-require-imports',
    'no-unused-imports',
    'npm run scaffold',
    '.githooks/pre-commit',
    'lint-staged',
    'src/utils/',
    'developer-setup.md',
    'TESTING.md',
  ]) {
    if (!contributingRaw.includes(requiredRuleToken)) {
      errors.push(`.github/CONTRIBUTING.md: Missing required contributor reference "${requiredRuleToken}"`);
    }
  }
  const contributingCommitSection =
    contributingRaw.split('7. **Commit Your Changes:**')[1]?.split('8. **Push to Your Fork:**')[0] ??
    contributingRaw;
  for (const hookScript of preCommitScripts) {
    if (!contributingCommitSection.includes(hookScript)) {
      errors.push(
        `.github/CONTRIBUTING.md: Missing .githooks/pre-commit check script "${hookScript}" in Commit Your Changes section`
      );
    }
  }

  const defaultDocFiles = parseDefaultDocFiles(verifyDocSyncRaw);
  if (defaultDocFiles.length === 0) {
    errors.push('scripts/verify-doc-sync.ts: DEFAULT_DOC_FILES must not be empty');
  }
  const contributingDocSyncLines = extractDocSyncBulletLines(contributingRaw);
  for (const docFile of defaultDocFiles) {
    if (!contributingDocSyncLines.includes(docFile)) {
      errors.push(
        `.github/CONTRIBUTING.md: "npm run check:doc-sync" documentation is missing DEFAULT_DOC_FILES entry "${docFile}"`
      );
    }
  }

  // 5. .github/TESTING.md canonical test, Playwright E2E, a11y, & smoke-test contract checks
  if (
    !testingRaw.includes('PLAYWRIGHT_REUSE_SERVER') ||
    !testingRaw.includes('wedding_test') ||
    !testingRaw.includes('GUEST_SESSION_SECRET')
  ) {
    errors.push(
      '.github/TESTING.md: Must document PLAYWRIGHT_REUSE_SERVER opt-in, wedding_test isolation, and GUEST_SESSION_SECRET alignment for Playwright E2E workflows'
    );
  }
  const testingA11ySection = extractMarkdownSection(
    testingRaw,
    /^-\s+\*\*Accessibility \(A11y\) Audits:\*\*/,
    /^-\s+\*\*/
  );
  if (/\bdb:seed\b[\s\S]*\btest:a11y\b/.test(testingA11ySection)) {
    errors.push(
      '.github/TESTING.md: Accessibility section must not prescribe running "db:seed" before "test:a11y" (integration teardowns wipe AppConfig)'
    );
  }
  if (!testingRaw.includes('scripts/seed.ts') || !testingRaw.includes('SetupWizard')) {
    errors.push(
      '.github/TESTING.md: Accessibility section must document post-Jest reseeding via "scripts/seed.ts" to skip SetupWizard'
    );
  }

  const envTest = parseEnvAssignments(envTestRaw);
  const envTestGuestPasscode = envTest.active.get('GUEST_PASSCODE');
  const envTestSessionSecret = envTest.active.get('GUEST_SESSION_SECRET');

  if (envTestGuestPasscode && !testingRaw.includes(envTestGuestPasscode)) {
    errors.push(
      `.github/TESTING.md: Must report .env.test GUEST_PASSCODE value "${envTestGuestPasscode}"`
    );
  }
  if (envTestSessionSecret && !testingRaw.includes(envTestSessionSecret)) {
    errors.push(
      `.github/TESTING.md: Must report .env.test GUEST_SESSION_SECRET value "${envTestSessionSecret}"`
    );
  }
  if (/\.env\.test[^\n]*wedding2026/i.test(testingRaw)) {
    errors.push('.github/TESTING.md: Stale claim that .env.test sets GUEST_PASSCODE to wedding2026');
  }
  if (
    /\.env\.test[^\n]*align[^\n]*GUEST_PASSCODE\s*\(`playwright-e2e-guest-passcode`\)/i.test(
      testingRaw
    )
  ) {
    errors.push(
      '.github/TESTING.md: Stale claim that .env.test aligns on GUEST_PASSCODE "playwright-e2e-guest-passcode"'
    );
  }
  for (const pretestToken of [
    'jest-a11y-violations.json',
    'generate-portal.ts',
    'npm_lifecycle_event',
  ]) {
    if (!testingRaw.includes(pretestToken)) {
      errors.push(`.github/TESTING.md: Missing scripts/pretest.mjs step reference "${pretestToken}"`);
    }
  }
  if (
    !testingRaw.includes('test-standalone.mjs') ||
    !testingRaw.includes('test-container.mjs') ||
    !/docker compose(?:\s+-f\s+\S+)*\s+down\s+-v/.test(testingRaw) ||
    !testingRaw.includes('npm run build')
  ) {
    errors.push(
      '.github/TESTING.md: Must warn that scripts/test-standalone.mjs requires "npm run build" and joins scripts/test-container.mjs in running "docker compose down -v"'
    );
  }

  // 6. AGENTS.md concise workflow & TypeScript configuration split checks
  const tsconfig = JSON.parse(tsconfigRaw) as { exclude?: string[] };
  const tsconfigExcludes = tsconfig.exclude ?? [];
  const tsconfigBuild = JSON.parse(tsconfigBuildRaw) as { exclude?: string[] };
  const tsconfigBuildExcludes = tsconfigBuild.exclude ?? [];
  const agentsTsSection = extractMarkdownSection(
    agentsRaw,
    /^##\s+3\.\s+TypeScript Configuration Split\b/,
    /^##\s+/
  );
  for (const excludePattern of tsconfigExcludes) {
    if (!agentsTsSection.includes(`\`${excludePattern}\``)) {
      errors.push(
        `AGENTS.md: Missing tsconfig.json exclude entry "${excludePattern}" in TypeScript Configuration Split section`
      );
    }
  }
  for (const excludePattern of tsconfigBuildExcludes) {
    if (!agentsTsSection.includes(`\`${excludePattern}\``)) {
      errors.push(
        `AGENTS.md: Missing tsconfig.build.json exclude entry "${excludePattern}" in TypeScript Configuration Split section`
      );
    }
  }

  const agentsQualitySection = extractMarkdownSection(
    agentsRaw,
    /^##\s+4\.\s+Verification & Quality Gates\b/,
    /^##\s+/
  );
  if (
    !agentsQualitySection.includes('npm run check:static') ||
    !agentsQualitySection.includes('npm run quality') ||
    !agentsQualitySection.includes('scripts/check-quality.ts')
  ) {
    errors.push(
      'AGENTS.md: Verification & Quality Gates section must prescribe "npm run check:static" and "npm run quality" delegating to "scripts/check-quality.ts"'
    );
  }
  for (const agentsCrossRef of [
    'e2e/helpers/auth.ts',
    'docs/developer-setup.md',
    '.github/TESTING.md',
    '.github/CONTRIBUTING.md',
  ]) {
    if (!agentsRaw.includes(agentsCrossRef)) {
      errors.push(`AGENTS.md: Missing canonical cross-reference "${agentsCrossRef}"`);
    }
  }

  return errors;
}

function main(): void {
  const errors = verifySetupGuides(process.cwd());
  if (errors.length > 0) {
    console.error('❌ Setup, contributor, and testing guide contract verification failed:');
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }
  console.log('✅ All setup, contributor, and testing guides match live repository contracts.');
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('verify-setup-guides.ts') ||
    process.argv[1].endsWith('verify-setup-guides.js'));

if (isDirectExecution) {
  main();
}
