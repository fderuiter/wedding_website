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

function parseCheckStaticSubscripts(checkStaticCommand: string): string[] {
  const subscripts: string[] = [];
  const regex = /\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(checkStaticCommand)) !== null) {
    subscripts.push(match[1]);
  }
  return subscripts;
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

const NUMBER_WORDS: Record<number, string> = {
  1: 'one',
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
  13: 'thirteen',
  14: 'fourteen',
  15: 'fifteen',
};

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

function qualityCommandSearchToken(command: string): string {
  const scriptPathMatch = command.match(/scripts\/[a-zA-Z0-9._-]+/);
  if (scriptPathMatch) {
    return scriptPathMatch[0];
  }
  const npmRunMatch = command.match(/^npm\s+run\s+([a-zA-Z0-9:_-]+)$/);
  if (npmRunMatch) {
    return npmRunMatch[1];
  }
  return command;
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
    '.env.example',
    '.env.test',
    'prisma.config.ts',
    'package.json',
    'tsconfig.json',
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

  const envExampleRaw = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
  const envTestRaw = fs.readFileSync(path.join(repoRoot, '.env.test'), 'utf8');
  const prismaConfigRaw = fs.readFileSync(path.join(repoRoot, 'prisma.config.ts'), 'utf8');
  const packageJsonRaw = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8');
  const tsconfigRaw = fs.readFileSync(path.join(repoRoot, 'tsconfig.json'), 'utf8');
  const composeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const ciComposeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.ci.yml'), 'utf8');
  const testStandaloneRaw = fs.readFileSync(path.join(repoRoot, 'scripts/test-standalone.mjs'), 'utf8');
  const testContainerRaw = fs.readFileSync(path.join(repoRoot, 'scripts/test-container.mjs'), 'utf8');
  const playwrightConfigRaw = fs.readFileSync(path.join(repoRoot, 'playwright.config.ts'), 'utf8');
  const preCommitRaw = fs.readFileSync(path.join(repoRoot, '.githooks/pre-commit'), 'utf8');
  const checkQualityRaw = fs.readFileSync(path.join(repoRoot, 'scripts/check-quality.ts'), 'utf8');
  const a11yReportRaw = fs.readFileSync(path.join(repoRoot, 'scripts/a11y-report.mjs'), 'utf8');
  const seedRaw = fs.readFileSync(path.join(repoRoot, 'scripts/seed.ts'), 'utf8');
  const verifyDocSyncRaw = fs.readFileSync(
    path.join(repoRoot, 'scripts/verify-doc-sync.ts'),
    'utf8'
  );
  const readmeRaw = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const devSetupRaw = fs.readFileSync(path.join(repoRoot, 'docs/developer-setup.md'), 'utf8');
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

  const pkg = JSON.parse(packageJsonRaw) as { scripts?: Record<string, string> };
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
  const checkStaticSubscripts = parseCheckStaticSubscripts(checkStaticCmd);
  if (!checkStaticSubscripts.includes('check:setup-guides')) {
    errors.push('package.json: "check:static" must include "npm run check:setup-guides"');
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

  // 2. Hook, check:static parity, E2E runner, & check-quality.ts registration checks
  const preCommitScripts = parsePreCommitScripts(preCommitRaw);
  if (!preCommitScripts.includes('check:setup-guides')) {
    errors.push('.githooks/pre-commit: Must run "check:setup-guides"');
  }
  for (const staticSubscript of checkStaticSubscripts) {
    if (!preCommitScripts.includes(staticSubscript)) {
      errors.push(
        `.githooks/pre-commit: Must enforce check:static sub-script "${staticSubscript}"`
      );
    }
  }
  for (const heavyBuildScript of ['docs:build', 'build-storybook', 'build']) {
    if (preCommitScripts.includes(heavyBuildScript)) {
      errors.push(
        `.githooks/pre-commit: Must exclude heavy build step "${heavyBuildScript}" so local commits stay fast`
      );
    }
  }

  if (/\bupdate\s*:\s*\{\s*\}/.test(seedRaw)) {
    errors.push(
      'scripts/seed.ts: appConfig.upsert must populate update fields rather than using an empty "update: {}" object'
    );
  }

  const a11yJestIdx = a11yReportRaw.search(/['"]npm['"]\s*,\s*\[\s*['"]test['"]\s*\]/);
  const a11ySeedIdx = a11yReportRaw.indexOf('scripts/seed.ts');
  const a11yPlaywrightIdx = a11yReportRaw.search(
    /['"]npx['"]\s*,\s*\[\s*['"]playwright['"]\s*,\s*['"]test['"]\s*\]/
  );
  if (
    a11yJestIdx === -1 ||
    a11ySeedIdx === -1 ||
    a11yPlaywrightIdx === -1 ||
    !(a11yJestIdx < a11ySeedIdx && a11ySeedIdx < a11yPlaywrightIdx)
  ) {
    errors.push(
      'scripts/a11y-report.mjs: runA11ySuite must reseed wedding_test via "scripts/seed.ts" after "npm test" and before "npx playwright test"'
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

  // 3. README.md & docs/developer-setup.md onboarding contract checks
  const readmeStructurePaths = extractReadmeProjectStructurePaths(readmeRaw);
  if (readmeStructurePaths.length === 0) {
    errors.push('README.md: Missing directory entries under "## Project Structure"');
  }
  for (const relDir of readmeStructurePaths) {
    if (!fs.existsSync(path.join(repoRoot, relDir))) {
      errors.push(`README.md: Project Structure lists nonexistent path "${relDir}"`);
    }
  }

  for (const [docLabel, content] of [
    ['README.md', readmeRaw],
    ['docs/developer-setup.md', devSetupRaw],
  ] as const) {
    if (!content.includes(expectedComposeDbPrefix)) {
      errors.push(
        `${docLabel}: Must document local Docker Compose PostgreSQL URL "${expectedComposeDbPrefix}"`
      );
    }
    for (const requiredVar of [
      'ADMIN_PASSWORD',
      'DATABASE_URL',
      'GUEST_PASSCODE',
      'GUEST_SESSION_SECRET',
      'ALLOWED_HOSTS',
    ]) {
      if (!content.includes(requiredVar)) {
        errors.push(`${docLabel}: Missing required environment variable "${requiredVar}"`);
      }
    }
    if (!content.includes('scripts/generate-password-hash.mjs')) {
      errors.push(`${docLabel}: Must reference "scripts/generate-password-hash.mjs"`);
    }
    for (const stepNum of [1, 2, 3, 4, 5]) {
      if (!new RegExp(`\\bStep\\s+${stepNum}\\b`, 'i').test(content)) {
        errors.push(`${docLabel}: Must document Step ${stepNum} of SetupWizard`);
      }
    }
    if (!/Sample Data/i.test(content) || !/Guest List Import|CSV/i.test(content)) {
      errors.push(
        `${docLabel}: Must document SetupWizard sample data selection and guest list CSV import steps`
      );
    }
    if (
      !content.includes('isSiteInitialized') ||
      !content.includes('layout.tsx') ||
      !content.includes('middleware.ts') ||
      !content.includes('/guest/login')
    ) {
      errors.push(
        `${docLabel}: Must document that seeding AppConfig satisfies isSiteInitialized (src/lib/config.ts), skips SetupWizard (src/app/layout.tsx), and redirects / to /guest/login (src/middleware.ts)`
      );
    }
  }

  // 4. .github/CONTRIBUTING.md contract checks
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
  const countMatch = contributingCommitSection.match(
    /\bruns\s+([a-z0-9]+)\s+sequential\s+workspace\s+checks\b/i
  );
  const expectedCountWord = NUMBER_WORDS[preCommitScripts.length];
  const expectedCountNum = String(preCommitScripts.length);
  if (
    countMatch &&
    countMatch[1].toLowerCase() !== expectedCountWord &&
    countMatch[1] !== expectedCountNum
  ) {
    errors.push(
      `.github/CONTRIBUTING.md: Commit Your Changes claims "${countMatch[1]}" sequential workspace checks, expected "${expectedCountWord ?? expectedCountNum}" (${preCommitScripts.length})`
    );
  }

  const defaultDocFiles = parseDefaultDocFiles(verifyDocSyncRaw);
  if (defaultDocFiles.length === 0) {
    errors.push('scripts/verify-doc-sync.ts: DEFAULT_DOC_FILES must not be empty');
  }
  for (const [docLabel, content] of [
    ['.github/CONTRIBUTING.md', contributingRaw],
    ['.github/TESTING.md', testingRaw],
    ['AGENTS.md', agentsRaw],
  ] as const) {
    const docSyncLines = extractDocSyncBulletLines(content);
    for (const docFile of defaultDocFiles) {
      if (!docSyncLines.includes(docFile)) {
        errors.push(
          `${docLabel}: "npm run check:doc-sync" documentation is missing DEFAULT_DOC_FILES entry "${docFile}"`
        );
      }
    }
    for (const subscript of checkStaticSubscripts) {
      if (!content.includes(subscript)) {
        errors.push(`${docLabel}: Missing check:static sub-script "${subscript}"`);
      }
    }
    if (
      !content.includes('PLAYWRIGHT_REUSE_SERVER') ||
      !content.includes('wedding_test') ||
      !content.includes('GUEST_SESSION_SECRET')
    ) {
      errors.push(
        `${docLabel}: Must document PLAYWRIGHT_REUSE_SERVER opt-in, wedding_test isolation, and GUEST_SESSION_SECRET alignment for Playwright E2E workflows`
      );
    }
  }

  const agentsA11ySection = extractMarkdownSection(
    agentsRaw,
    /^###\s+Accessibility Quality Gate\b/,
    /^###\s+/
  );
  if (/\bdb:seed\b[\s\S]*\btest:a11y\b/.test(agentsA11ySection)) {
    errors.push(
      'AGENTS.md: Accessibility Quality Gate must not prescribe running "db:seed" before "test:a11y" (integration teardowns wipe AppConfig)'
    );
  }
  if (!agentsA11ySection.includes('scripts/seed.ts') || !agentsA11ySection.includes('SetupWizard')) {
    errors.push(
      'AGENTS.md: Accessibility Quality Gate must document post-Jest reseeding via "scripts/seed.ts" to skip SetupWizard'
    );
  }

  // 5. .github/TESTING.md & AGENTS.md contract checks
  const envTest = parseEnvAssignments(envTestRaw);
  const envTestGuestPasscode = envTest.active.get('GUEST_PASSCODE');
  const envTestSessionSecret = envTest.active.get('GUEST_SESSION_SECRET');

  for (const [docLabel, content] of [
    ['.github/TESTING.md', testingRaw],
    ['AGENTS.md', agentsRaw],
  ] as const) {
    if (envTestGuestPasscode && !content.includes(envTestGuestPasscode)) {
      errors.push(
        `${docLabel}: Must report .env.test GUEST_PASSCODE value "${envTestGuestPasscode}"`
      );
    }
    if (envTestSessionSecret && !content.includes(envTestSessionSecret)) {
      errors.push(
        `${docLabel}: Must report .env.test GUEST_SESSION_SECRET value "${envTestSessionSecret}"`
      );
    }
    if (/\.env\.test[^\n]*wedding2026/i.test(content)) {
      errors.push(`${docLabel}: Stale claim that .env.test sets GUEST_PASSCODE to wedding2026`);
    }
    if (
      /\.env\.test[^\n]*align[^\n]*GUEST_PASSCODE\s*\(`playwright-e2e-guest-passcode`\)/i.test(
        content
      )
    ) {
      errors.push(
        `${docLabel}: Stale claim that .env.test aligns on GUEST_PASSCODE "playwright-e2e-guest-passcode"`
      );
    }

    for (const pretestToken of [
      'jest-a11y-violations.json',
      'generate-portal.ts',
      'npm_lifecycle_event',
    ]) {
      if (!content.includes(pretestToken)) {
        errors.push(`${docLabel}: Missing scripts/pretest.mjs step reference "${pretestToken}"`);
      }
    }

    if (
      !content.includes('test-standalone.mjs') ||
      !content.includes('test-container.mjs') ||
      !/docker compose(?:\s+-f\s+\S+)*\s+down\s+-v/.test(content) ||
      !content.includes('npm run build')
    ) {
      errors.push(
        `${docLabel}: Must warn that scripts/test-standalone.mjs requires "npm run build" and joins scripts/test-container.mjs in running "docker compose down -v"`
      );
    }
  }

  // 6. AGENTS.md tsconfig.json exclude list & check-quality.ts step order
  const tsconfig = JSON.parse(tsconfigRaw) as { exclude?: string[] };
  const tsconfigExcludes = tsconfig.exclude ?? [];
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

  const agentsQualitySection = extractMarkdownSection(
    agentsRaw,
    /^###\s+Full Local Quality Gate\b/,
    /^###\s+/
  );
  let previousMatchPos = -1;
  for (const cmd of qualityCommands) {
    const token = qualityCommandSearchToken(cmd);
    const pos = agentsQualitySection.indexOf(token, previousMatchPos + 1);
    if (pos === -1) {
      const anyPos = agentsQualitySection.indexOf(token);
      if (anyPos === -1) {
        errors.push(
          `AGENTS.md: Full Local Quality Gate section is missing check-quality.ts step "${cmd}"`
        );
      } else {
        errors.push(
          `AGENTS.md: Full Local Quality Gate section misorders check-quality.ts step "${cmd}"`
        );
      }
    } else {
      previousMatchPos = pos;
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
