import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { scanLinksAndCodeInLine, transformNonFencedMarkdownLines } from './check-doc-links';
import { ARCHITECTURAL_DOCS, rewriteMarkdownLinks } from './generate-portal';

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

const IGNORED_ROOT_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.pnp',
  '.yarn',
  'coverage',
  '.next',
  '.next-export',
  '.api-backup-export',
  '.swc',
  '.turbo',
  'out',
  'build',
  'dist',
  'storybook-static',
  'logs',
  '.vscode',
  '.idea',
  '.vercel',
  '.jules',
  '.Jules',
  'test-results',
  'playwright-report',
  '.cache',
  '.eslintcache',
  '.parcel-cache',
  '.tmp',
  'tmp',
]);

interface ReadmeHeadingInfo {
  level: number;
  text: string;
  slug: string;
}

function slugifyGithubHeading(rawHeading: string): string {
  const plain = rawHeading
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .trim();
  return plain
    .toLowerCase()
    .replace(/[\uFE00-\uFE0F\u200D]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}_\- ]/gu, '')
    .replace(/ /g, '-');
}

function extractReadmeHeadings(readmeContent: string): ReadmeHeadingInfo[] {
  const headings: ReadmeHeadingInfo[] = [];
  const slugCounts = new Map<string, number>();
  const lines = readmeContent.split(/\r?\n/);
  let inFrontmatter = false;
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let inHtmlComment = false;

  lines.forEach((rawLine, index) => {
    if (index === 0 && rawLine.trim() === '---') {
      inFrontmatter = true;
      return;
    }
    if (inFrontmatter) {
      if (rawLine.trim() === '---' || rawLine.trim() === '...') {
        inFrontmatter = false;
      }
      return;
    }

    const fenceMatch = rawLine.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const rest = fenceMatch[2];
      const ch = marker[0];
      const len = marker.length;
      if (!inFence) {
        if (!(ch === '`' && rest.includes('`'))) {
          inFence = true;
          fenceChar = ch;
          fenceLen = len;
          return;
        }
      } else if (ch === fenceChar && len >= fenceLen && /^\s*$/.test(rest)) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        return;
      }
    }

    if (inFence) {
      return;
    }

    let line = rawLine;
    if (inHtmlComment) {
      const endIdx = line.indexOf('-->');
      if (endIdx === -1) {
        return;
      }
      line = line.slice(endIdx + 3);
      inHtmlComment = false;
    }
    while (line.includes('<!--')) {
      const startIdx = line.indexOf('<!--');
      const endIdx = line.indexOf('-->', startIdx + 4);
      if (endIdx === -1) {
        line = line.slice(0, startIdx);
        inHtmlComment = true;
        break;
      }
      line = line.slice(0, startIdx) + line.slice(endIdx + 3);
    }

    const match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/);
    if (!match) {
      return;
    }

    const level = match[1].length;
    const text = match[2].trim();
    const baseSlug = slugifyGithubHeading(text);
    const seen = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, seen + 1);
    const slug = seen === 0 ? baseSlug : `${baseSlug}-${seen}`;

    headings.push({ level, text, slug });
  });

  return headings;
}

function extractReadmeTocAnchors(readmeContent: string): string[] {
  const tocSection = extractMarkdownSection(
    readmeContent,
    /^##\s+Table of Contents\b/,
    /^##\s+/
  );
  const anchors: string[] = [];
  const linkRegex = /\[[^\]]+\]\(#([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(tocSection)) !== null) {
    anchors.push(match[1].trim());
  }
  return anchors;
}

function collectGitignoredRootDirs(repoRoot: string): Set<string> {
  const ignored = new Set<string>(IGNORED_ROOT_DIRECTORIES);
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(gitignorePath)) {
    return ignored;
  }

  const lines = fs.readFileSync(gitignorePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }
    const normalized = trimmed.replace(/^\/+/, '').replace(/\/+\*?$/, '');
    if (normalized && !normalized.includes('/') && !normalized.includes('*')) {
      ignored.add(normalized);
    }
  }

  return ignored;
}

function discoverTrackedRootDirectories(repoRoot: string): string[] {
  const ignoredRootDirs = collectGitignoredRootDirs(repoRoot);
  return fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !ignoredRootDirs.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function extractReadmeProjectStructurePaths(readmeContent: string): string[] {
  const section = extractMarkdownSection(readmeContent, /^##\s+Project Structure\b/, /^##\s+/);
  const paths: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    const match = line.match(/^\s*[*-]\s+`([^`]+)`\s*:/);
    if (match) {
      paths.push(match[1].trim().replace(/^\.\/+/, '').replace(/\/+$/, ''));
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

function parseHookScripts(hookContent: string): string[] {
  const scripts: string[] = [];
  const scriptRegex = /\{\s*name:\s*['"][^'"]+['"]\s*,\s*script:\s*['"]([^'"]+)['"]\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(hookContent)) !== null) {
    scripts.push(match[1]);
  }
  return scripts;
}

function findForbiddenHookCommands(hookContent: string): string[] {
  const forbidden: string[] = [];
  if (/\bgit\s+stash\b/.test(hookContent) || /['"]stash['"]/.test(hookContent)) {
    forbidden.push('git stash');
  }
  if (/\bgit\s+reset\b/.test(hookContent) || /['"]reset['"]/.test(hookContent)) {
    forbidden.push('git reset');
  }
  if (
    /\bgit\s+checkout\s+--(?!\w)/.test(hookContent) ||
    /['"]checkout['"]\s*,\s*['"]--['"]/.test(hookContent)
  ) {
    forbidden.push('git checkout -- .');
  }
  return forbidden;
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

function parsePrePushStepDetails(checkQualityContent: string): {
  defined: boolean;
  includesStaticSpread: boolean;
  standaloneUsesStaticOnly: boolean;
  explicitScripts: string[];
  rawBlock: string;
} {
  const prePushMatch = checkQualityContent.match(
    /export\s+const\s+prePushSteps\s*(?::[^=]*)?=\s*\[([\s\S]*?)\n\];/
  );
  if (!prePushMatch) {
    return {
      defined: false,
      includesStaticSpread: false,
      standaloneUsesStaticOnly: false,
      explicitScripts: [],
      rawBlock: '',
    };
  }
  const rawBlock = prePushMatch[1];
  const includesStaticSpread = /\.\.\.staticSteps\b/.test(rawBlock);
  const standaloneUsesStaticOnly =
    /check:standalone[\s\S]*?--static-only/.test(rawBlock) &&
    !/command:\s*['"]npm\s+run\s+check:standalone['"]/.test(rawBlock);
  const scripts = new Set<string>();
  const scriptPropRegex = /\bscript:\s*['"]([a-zA-Z0-9:_-]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = scriptPropRegex.exec(rawBlock)) !== null) {
    scripts.add(match[1]);
  }
  const cmdRegex = /command:\s*['"]npm\s+run\s+([a-zA-Z0-9:_-]+)(?:\s|--|['"])/g;
  while ((match = cmdRegex.exec(rawBlock)) !== null) {
    scripts.add(match[1]);
  }
  return {
    defined: true,
    includesStaticSpread,
    standaloneUsesStaticOnly,
    explicitScripts: Array.from(scripts),
    rawBlock,
  };
}

function hasPortalCrossLink(
  summaryContent: string,
  summaryRelPath: string,
  canonicalRelPath: string,
  repoRoot: string
): boolean {
  const canonicalDoc = ARCHITECTURAL_DOCS.find((doc) => doc.src === canonicalRelPath);
  if (!canonicalDoc) {
    return false;
  }
  const expectedPortalRoute = '/' + canonicalDoc.dest.replace(/\.md$/, '');
  const rewritten = rewriteMarkdownLinks(summaryContent, summaryRelPath, repoRoot);

  let foundRewrittenTarget = false;
  transformNonFencedMarkdownLines(rewritten, (line, lineNumber) => {
    const { links } = scanLinksAndCodeInLine(line, lineNumber);
    for (const link of links) {
      const routePart = link.rawTarget.trim().split(/[?#]/)[0];
      if (routePart === expectedPortalRoute) {
        foundRewrittenTarget = true;
      }
    }
    return line;
  });

  if (!foundRewrittenTarget) {
    return false;
  }

  let hasRelativeSourceLink = false;
  const srcDir = path.dirname(path.join(repoRoot, summaryRelPath));
  transformNonFencedMarkdownLines(summaryContent, (line, lineNumber) => {
    const { links } = scanLinksAndCodeInLine(line, lineNumber);
    for (const link of links) {
      const rawPathPart = link.rawTarget.trim().split(/[?#]/)[0];
      if (!rawPathPart || /^[a-z]+:/i.test(rawPathPart)) {
        continue;
      }
      const resolvedFile = rawPathPart.startsWith('/')
        ? path.resolve(repoRoot, rawPathPart.slice(1))
        : path.resolve(srcDir, rawPathPart);
      const resolvedRel = path.relative(repoRoot, resolvedFile).replace(/\\/g, '/');
      if (resolvedRel === canonicalRelPath) {
        hasRelativeSourceLink = true;
      }
    }
    return line;
  });

  return hasRelativeSourceLink;
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
    'jest.setup.js',
    'scripts/install-git-hooks.js',
    'scripts/check-quality.ts',
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
  const envCiRaw = fs.readFileSync(path.join(repoRoot, '.env.ci'), 'utf8');
  const envTestRaw = fs.readFileSync(path.join(repoRoot, '.env.test'), 'utf8');
  const prismaConfigRaw = fs.readFileSync(path.join(repoRoot, 'prisma.config.ts'), 'utf8');
  const packageJsonRaw = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8');
  const tsconfigRaw = fs.readFileSync(path.join(repoRoot, 'tsconfig.json'), 'utf8');
  const tsconfigBuildRaw = fs.readFileSync(path.join(repoRoot, 'tsconfig.build.json'), 'utf8');
  const composeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8');
  const ciComposeRaw = fs.readFileSync(path.join(repoRoot, 'docker-compose.ci.yml'), 'utf8');
  const buildExportRaw = fs.readFileSync(path.join(repoRoot, 'scripts/build-export.mjs'), 'utf8');
  const testStandaloneRaw = fs.readFileSync(path.join(repoRoot, 'scripts/test-standalone.mjs'), 'utf8');
  const testContainerRaw = fs.readFileSync(path.join(repoRoot, 'scripts/test-container.mjs'), 'utf8');
  const playwrightConfigRaw = fs.readFileSync(path.join(repoRoot, 'playwright.config.ts'), 'utf8');
  const preCommitRaw = fs.readFileSync(path.join(repoRoot, '.githooks/pre-commit'), 'utf8');
  const prePushRaw = fs.readFileSync(path.join(repoRoot, '.githooks/pre-push'), 'utf8');
  const installHooksRaw = fs.readFileSync(
    path.join(repoRoot, 'scripts/install-git-hooks.js'),
    'utf8'
  );
  const checkQualityRaw = fs.readFileSync(path.join(repoRoot, 'scripts/check-quality.ts'), 'utf8');
  const jestSetupRaw = fs.readFileSync(path.join(repoRoot, 'jest.setup.js'), 'utf8');
  const pretestMjsRaw = fs.readFileSync(path.join(repoRoot, 'scripts/pretest.mjs'), 'utf8');
  const a11yReportRaw = fs.readFileSync(path.join(repoRoot, 'scripts/a11y-report.mjs'), 'utf8');
  const seedRaw = fs.readFileSync(path.join(repoRoot, 'scripts/seed.ts'), 'utf8');
  const verifyDocSyncRaw = fs.readFileSync(
    path.join(repoRoot, 'scripts/verify-doc-sync.ts'),
    'utf8'
  );
  const readmeRaw = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const devSetupRaw = fs.readFileSync(path.join(repoRoot, 'docs/developer-setup.md'), 'utf8');
  const runtimeContractRaw = fs.readFileSync(
    path.join(repoRoot, 'docs/runtime-contract.md'),
    'utf8'
  );
  const versioningRaw = fs.readFileSync(path.join(repoRoot, 'docs/versioning.md'), 'utf8');
  const contributingRaw = fs.readFileSync(path.join(repoRoot, '.github/CONTRIBUTING.md'), 'utf8');
  const testingRaw = fs.readFileSync(path.join(repoRoot, '.github/TESTING.md'), 'utf8');
  const agentsRaw = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  const docIssueTemplateRaw = fs.readFileSync(
    path.join(repoRoot, '.github/ISSUE_TEMPLATE/documentation.md'),
    'utf8'
  );
  const deploymentRaw = fs.readFileSync(path.join(repoRoot, 'DEPLOYMENT.md'), 'utf8');
  const vitepressConfigRaw = fs.readFileSync(
    path.join(repoRoot, 'docs-portal/.vitepress/config.mts'),
    'utf8'
  );
  const portalIndexRaw = fs.readFileSync(path.join(repoRoot, 'docs-portal/index.md'), 'utf8');
  const basePathRaw = fs.readFileSync(path.join(repoRoot, 'src/lib/basePath.ts'), 'utf8');
  const demoToolbarRaw = fs.readFileSync(
    path.join(repoRoot, 'src/components/demo/DemoToolbar.tsx'),
    'utf8'
  );
  const projectInfoRaw = fs.readFileSync(
    path.join(repoRoot, 'src/app/project-info/ProjectInfoClient.tsx'),
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
  if (envExample.active.has('NODE_ENV')) {
    errors.push(
      '.env.example: Must omit active NODE_ENV assignment (keep "# NODE_ENV=development" commented) so host processes default to development in src/env.ts'
    );
  }
  if (!envExample.commented.has('NODE_ENV')) {
    errors.push('.env.example: Commented placeholder "# NODE_ENV=development" is missing');
  }
  if (envExample.active.get('DB_PASSWORD') !== composeDb.dbPassword) {
    errors.push(
      `.env.example: Must define active DB_PASSWORD="${composeDb.dbPassword}" so bare "docker compose up -d db" works after copying .env.example to .env`
    );
  }

  const envCi = parseEnvAssignments(envCiRaw);
  for (const requiredCiKey of [
    'DB_PASSWORD',
    'ADMIN_PASSWORD',
    'GUEST_PASSCODE',
    'GUEST_SESSION_SECRET',
    'E2E_TEST',
  ] as const) {
    if (!envCi.active.get(requiredCiKey)) {
      errors.push(`.env.ci: Must define active disposable "${requiredCiKey}" default for clean-checkout Compose runs`);
    }
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
  if (
    (composeRaw.match(/DATABASE_URL:\s*\$\{CONTAINER_DATABASE_URL:-/g) ?? []).length < 2 ||
    /DATABASE_URL:\s*\$\{DATABASE_URL:-/.test(composeRaw)
  ) {
    errors.push(
      'docker-compose.yml: Must scope migration and app DATABASE_URL overrides via ${CONTAINER_DATABASE_URL:-...} so host DATABASE_URL never leaks into containers'
    );
  }
  if (!/^\s*NODE_ENV:\s*production\s*$/m.test(composeRaw)) {
    errors.push('docker-compose.yml: Must pin app container NODE_ENV to production');
  }
  if (!composeRaw.includes('127.0.0.1:${DB_PORT:-5432}:5432')) {
    errors.push('docker-compose.yml: Must bind PostgreSQL strictly to 127.0.0.1:${DB_PORT:-5432}:5432');
  }
  if (!/E2E_TEST:\s*\$\{E2E_TEST:-false\}/.test(composeRaw)) {
    errors.push('docker-compose.yml: Must set E2E_TEST: ${E2E_TEST:-false} by default');
  }
  if (
    !/POSTGRES_PASSWORD:\s*\$\{DB_PASSWORD:-wedding123\}/.test(ciComposeRaw) ||
    !/E2E_TEST:\s*\$\{E2E_TEST:-true\}/.test(ciComposeRaw) ||
    (ciComposeRaw.match(/DATABASE_URL:\s*\$\{CONTAINER_DATABASE_URL:-/g) ?? []).length < 2
  ) {
    errors.push(
      'docker-compose.ci.yml: Must isolate disposable CI database credentials, ${CONTAINER_DATABASE_URL:-...} overrides, and E2E_TEST: ${E2E_TEST:-true}'
    );
  }
  for (const [scriptLabel, scriptRaw] of [
    ['scripts/pretest.mjs', pretestMjsRaw],
    ['scripts/test-standalone.mjs', testStandaloneRaw],
    ['scripts/test-container.mjs', testContainerRaw],
    ['playwright.config.ts', playwrightConfigRaw],
  ] as const) {
    if (!scriptRaw.includes('docker-compose.ci.yml') || !scriptRaw.includes('.env.ci')) {
      errors.push(`${scriptLabel}: Must pass "--env-file .env.ci" with isolated "docker-compose.ci.yml" override manifest`);
    }
  }
  for (const [scriptLabel, scriptRaw, expectedProject] of [
    ['scripts/test-standalone.mjs', testStandaloneRaw, 'wedding-smoke-standalone'],
    ['scripts/test-container.mjs', testContainerRaw, 'wedding-smoke-container'],
  ] as const) {
    if (!scriptRaw.includes("'-p'") || !scriptRaw.includes(expectedProject)) {
      errors.push(
        `${scriptLabel}: Must isolate Docker Compose project via "-p ${expectedProject}"`
      );
    }
  }
  if (/lsof\s+-ti:3000|kill\s+-9/.test(testContainerRaw)) {
    errors.push(
      'scripts/test-container.mjs: Must select a free loopback port instead of killing port 3000 processes'
    );
  }
  if (
    !buildExportRaw.includes('export-stage') ||
    /renameSync\s*\(\s*apiDir\s*,\s*backupDir\s*\)/.test(buildExportRaw)
  ) {
    errors.push(
      'scripts/build-export.mjs: Must stage static exports inside ".next/export-stage" instead of renaming src/app/api in place'
    );
  }
  if (
    !runtimeContractRaw.includes('.next/export-stage') ||
    /moves\s+`src\/app\/api`\s+to\s+`\.api-backup-export`/i.test(runtimeContractRaw)
  ) {
    errors.push(
      'docs/runtime-contract.md: Must document staged static exports inside ".next/export-stage" instead of moving src/app/api to .api-backup-export'
    );
  }
  if (!/NODE_ENV:\s*process\.env\.CI\s*\?\s*'production'\s*:\s*'development'/.test(playwrightConfigRaw)) {
    errors.push(
      'playwright.config.ts: Must set webServer.env.NODE_ENV to "development" locally and "production" in CI'
    );
  }
  for (const [label, rawText] of [
    ['.env.example', envExampleRaw],
    ['.env.ci', envCiRaw],
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
  if (pretestMjsRaw.includes('generate-portal.ts')) {
    errors.push(
      'scripts/pretest.mjs: Must not unconditionally run "scripts/generate-portal.ts" during test preflight'
    );
  }
  if (pretestMjsRaw.includes('npm_lifecycle_event')) {
    errors.push(
      'scripts/pretest.mjs: Must not inspect "npm_lifecycle_event" or fall back to "npm run build"'
    );
  }
  if (!pretestMjsRaw.includes('TEST_DATABASE_URL')) {
    errors.push(
      'scripts/pretest.mjs: Must honor explicit "TEST_DATABASE_URL" overrides before falling back to local Docker defaults'
    );
  }
  if (!pretestMjsRaw.includes('.package-lock.json') || !pretestMjsRaw.includes('node:net')) {
    errors.push(
      'scripts/pretest.mjs: Must enforce CI-aware ".package-lock.json" alignment and TCP readiness probing ("node:net")'
    );
  }
  if (!jestSetupRaw.includes('TEST_DATABASE_URL') || !jestSetupRaw.includes('process.env.CI')) {
    errors.push(
      'jest.setup.js: Must preserve explicit DATABASE_URL when CI=true or TEST_DATABASE_URL is set'
    );
  }
  if (testingRaw.includes('--legacy-peer-deps')) {
    errors.push('.github/TESTING.md: Must not document "--legacy-peer-deps" for pretest/CI bootstrap');
  }
  if (agentsRaw.includes('--legacy-peer-deps')) {
    errors.push('AGENTS.md: Must not document "--legacy-peer-deps" for pretest/CI bootstrap');
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

  const checkPrePushCmd = scripts['check:pre-push'] ?? '';
  if (
    !checkPrePushCmd.includes('scripts/check-quality.ts') ||
    !checkPrePushCmd.includes('--pre-push')
  ) {
    errors.push(
      'package.json: "check:pre-push" must delegate to "scripts/check-quality.ts --pre-push" so .githooks/pre-push shares the unified quality profile'
    );
  }
  const prePushStepDetails = parsePrePushStepDetails(checkQualityRaw);
  if (!prePushStepDetails.defined || !checkQualityRaw.includes("'--pre-push'")) {
    errors.push(
      'scripts/check-quality.ts: Must export "prePushSteps" and support "--pre-push" CLI flag'
    );
  } else {
    if (!prePushStepDetails.standaloneUsesStaticOnly) {
      errors.push(
        'scripts/check-quality.ts: prePushSteps must invoke "check:standalone" with "--static-only" so pre-push runs without a prior .next build'
      );
    }
    const coveredPrePushScripts = new Set<string>([
      ...(prePushStepDetails.includesStaticSpread ? staticStepScripts : []),
      ...prePushStepDetails.explicitScripts,
    ]);
    for (const requiredPrePushScript of [
      ...staticStepScripts,
      'typecheck',
      'lint',
      'lint:unused',
      'check:audit',
    ]) {
      if (!coveredPrePushScripts.has(requiredPrePushScript)) {
        errors.push(
          `scripts/check-quality.ts: prePushSteps must include "${requiredPrePushScript}"`
        );
      }
    }
    for (const heavyScript of [
      'docs:build',
      'build-storybook',
      'build:export',
      'build',
      'test:cov',
    ]) {
      if (prePushStepDetails.explicitScripts.includes(heavyScript)) {
        errors.push(
          `scripts/check-quality.ts: prePushSteps must exclude heavy step "${heavyScript}"`
        );
      }
    }
  }

  const postinstallCmd = scripts['postinstall'] ?? '';
  if (
    !postinstallCmd.includes('scripts/pretest.mjs --record-install-state') &&
    !postinstallCmd.includes('.package-lock-hash')
  ) {
    errors.push(
      'package.json: "postinstall" must record lockfile state via "scripts/pretest.mjs --record-install-state" or ".package-lock-hash"'
    );
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
  if (
    !installHooksRaw.includes('pre-commit') ||
    !installHooksRaw.includes('pre-push') ||
    !installHooksRaw.includes('0o755')
  ) {
    errors.push(
      'scripts/install-git-hooks.js: Must configure executable 0o755 permissions on both .githooks/pre-commit and .githooks/pre-push'
    );
  }

  if (!/\blint-staged\b/.test(preCommitRaw)) {
    errors.push('.githooks/pre-commit: Must run "npx lint-staged" on staged files');
  }
  for (const legacyHelper of ['hasUnstagedChanges', 'pushStash', 'popStash']) {
    if (preCommitRaw.includes(legacyHelper)) {
      errors.push(`.githooks/pre-commit: Must remove legacy stash helper "${legacyHelper}"`);
    }
  }
  const preCommitScripts = parseHookScripts(preCommitRaw);
  if (preCommitScripts.length > 0) {
    errors.push(
      '.githooks/pre-commit: Must run only "npx lint-staged" without sequential workspace checks'
    );
  }

  for (const [hookLabel, hookRaw] of [
    ['.githooks/pre-commit', preCommitRaw],
    ['.githooks/pre-push', prePushRaw],
  ] as const) {
    for (const forbiddenCmd of findForbiddenHookCommands(hookRaw)) {
      errors.push(
        `${hookLabel}: Must not invoke destructive workspace command "${forbiddenCmd}"`
      );
    }
  }

  const prePushExecutableRaw = prePushRaw.replace(/console\.\w+\([\s\S]*?\);/g, '');
  const prePushDelegatesToSharedProfile =
    /\bcheck:pre-push\b/.test(prePushExecutableRaw) ||
    (/scripts\/check-quality\.ts/.test(prePushExecutableRaw) &&
      /--pre-push\b/.test(prePushExecutableRaw));
  if (!prePushDelegatesToSharedProfile) {
    errors.push(
      '.githooks/pre-push: Must delegate to shared quality profile via "npm run check:pre-push" or "scripts/check-quality.ts --pre-push"'
    );
  }
  const prePushScripts = parseHookScripts(prePushRaw);
  for (const heavyCommitScript of [
    'check:standalone',
    'docs:build',
    'build-storybook',
    'build:export',
    'build',
  ]) {
    if (preCommitScripts.includes(heavyCommitScript)) {
      errors.push(
        `.githooks/pre-commit: Must exclude heavy build step "${heavyCommitScript}" so local commits stay fast`
      );
    }
  }
  for (const heavyPushScript of ['docs:build', 'build-storybook', 'build:export', 'build']) {
    if (
      prePushScripts.includes(heavyPushScript) ||
      new RegExp(`['"]${heavyPushScript}['"]`).test(prePushRaw)
    ) {
      errors.push(
        `.githooks/pre-push: Must exclude heavy build step "${heavyPushScript}" so local pushes stay fast`
      );
    }
  }
  if (prePushScripts.length > 0) {
    errors.push(
      '.githooks/pre-push: Must delegate to "npm run check:pre-push" rather than hardcoding inline sequential check objects'
    );
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
  if (!qualityCommands.includes('npm run test:cov')) {
    errors.push('scripts/check-quality.ts: Must run "npm run test:cov" to enforce global coverage thresholds');
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
  if (/DB_PASSWORD=\S+\s+docker\s+compose\s+up\s+-d\s+db/.test(readmeRaw)) {
    errors.push(
      'README.md: Must prescribe bare "docker compose up -d db" without inline DB_PASSWORD prefix'
    );
  }

  const readmeHeadings = extractReadmeHeadings(readmeRaw);
  const readmeH1Headings = readmeHeadings.filter((heading) => heading.level === 1);
  if (readmeH1Headings.length !== 1) {
    errors.push(
      `README.md: Must contain exactly one top-level "#" (h1) heading, found ${readmeH1Headings.length}`
    );
  }

  const readmeTocAnchors = extractReadmeTocAnchors(readmeRaw);
  if (readmeTocAnchors.length === 0) {
    errors.push('README.md: Missing "## Table of Contents" anchor entries');
  } else {
    const tocAnchorSet = new Set(readmeTocAnchors);
    const allHeadingSlugs = new Set(readmeHeadings.map((heading) => heading.slug));
    const expectedTocHeadings = readmeHeadings.filter(
      (heading) =>
        (heading.level === 2 || heading.level === 3) && heading.slug !== 'table-of-contents'
    );
    for (const heading of expectedTocHeadings) {
      if (!tocAnchorSet.has(heading.slug)) {
        errors.push(
          `README.md: Table of Contents is missing entry for "${heading.text}" (#${heading.slug})`
        );
      }
    }
    for (const anchor of readmeTocAnchors) {
      if (!allHeadingSlugs.has(anchor)) {
        errors.push(`README.md: Table of Contents links to nonexistent heading "#${anchor}"`);
      }
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
  const documentedRootDirs = new Set(
    readmeStructurePaths.map((relDir) => relDir.split('/')[0]).filter(Boolean)
  );
  for (const rootDirName of discoverTrackedRootDirectories(repoRoot)) {
    if (!documentedRootDirs.has(rootDirName)) {
      errors.push(`README.md: Project Structure is missing root directory "${rootDirName}"`);
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
    'DB_PASSWORD',
    'GUEST_PASSCODE',
    'GUEST_SESSION_SECRET',
    'ALLOWED_HOSTS',
  ]) {
    if (!devSetupRaw.includes(requiredVar)) {
      errors.push(`docs/developer-setup.md: Missing required environment variable "${requiredVar}"`);
    }
  }
  if (/DB_PASSWORD=\S+\s+docker\s+compose\s+up\s+-d\s+db/.test(devSetupRaw)) {
    errors.push(
      'docs/developer-setup.md: Must prescribe bare "docker compose up -d db" without inline DB_PASSWORD prefix'
    );
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
    '.githooks/pre-push',
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
  if (
    !contributingCommitSection.includes('.githooks/pre-commit') ||
    !contributingCommitSection.includes('lint-staged')
  ) {
    errors.push(
      '.github/CONTRIBUTING.md: Commit Your Changes section must document ".githooks/pre-commit" running "npx lint-staged"'
    );
  }
  if (/\bgit\s+stash\b/i.test(contributingCommitSection)) {
    errors.push(
      '.github/CONTRIBUTING.md: Commit Your Changes section must not prescribe or document "git stash"'
    );
  }
  if (/\bsequential\s+workspace\s+checks\b/i.test(contributingCommitSection)) {
    errors.push(
      '.github/CONTRIBUTING.md: Commit Your Changes section must not claim sequential workspace checks run during pre-commit'
    );
  }

  const contributingPushSection =
    contributingRaw.split('8. **Push to Your Fork:**')[1]?.split('9. **Open a Pull Request (PR):**')[0] ??
    contributingRaw;
  if (!contributingPushSection.includes('.githooks/pre-push')) {
    errors.push(
      '.github/CONTRIBUTING.md: Push to Your Fork section must document ".githooks/pre-push"'
    );
  }
  if (
    !contributingPushSection.includes('check:pre-push') &&
    !contributingPushSection.includes('scripts/check-quality.ts')
  ) {
    errors.push(
      '.github/CONTRIBUTING.md: Push to Your Fork section must reference shared pre-push profile ("npm run check:pre-push" / "scripts/check-quality.ts")'
    );
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

  for (const [docLabel, content] of [
    ['.github/TESTING.md', testingRaw],
    ['AGENTS.md', agentsRaw],
  ] as const) {
    if (!content.includes('.githooks/pre-commit') || !content.includes('.githooks/pre-push')) {
      errors.push(
        `${docLabel}: Must reference both ".githooks/pre-commit" and ".githooks/pre-push"`
      );
    }
    if (
      /(?:delet(?:es|ing)|wip(?:es|ing))\s+local\s+Docker\s+Compose\s+PostgreSQL\s+volumes\s*\(`db_data`\)/i.test(
        content
      )
    ) {
      errors.push(
        `${docLabel}: Stale warning claiming smoke scripts delete/wipe local Docker Compose PostgreSQL volumes ("db_data")`
      );
    }
  }

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
    '.package-lock.json',
    '.package-lock-hash',
    'TEST_DATABASE_URL',
    'test:cov',
  ]) {
    if (!testingRaw.includes(pretestToken)) {
      errors.push(
        `.github/TESTING.md: Missing scripts/pretest.mjs or coverage workflow reference "${pretestToken}"`
      );
    }
  }
  if (
    !testingRaw.includes('test-standalone.mjs') ||
    !testingRaw.includes('test-container.mjs') ||
    !testingRaw.includes('.env.ci') ||
    !testingRaw.includes('wedding-smoke-standalone') ||
    !testingRaw.includes('wedding-smoke-container') ||
    !/docker compose(?:\s+(?:-p|--env-file|-f)\s+\S+)*\s+down\s+-v/.test(testingRaw) ||
    !testingRaw.includes('npm run build')
  ) {
    errors.push(
      '.github/TESTING.md: Must document that scripts/test-standalone.mjs requires "npm run build" and joins scripts/test-container.mjs (.env.ci) in isolating Compose projects (-p wedding-smoke-standalone / -p wedding-smoke-container) before "docker compose ... down -v"'
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

  const testingPretestSection = extractMarkdownSection(
    testingRaw,
    /^###\s+Pretest Lifecycle\b/,
    /^##\s+/
  );
  if (
    testingPretestSection.includes('npx tsx scripts/generate-portal.ts') ||
    testingPretestSection.includes('npm_lifecycle_event')
  ) {
    errors.push(
      '.github/TESTING.md: Pretest Lifecycle section must not claim scripts/pretest.mjs runs "npx tsx scripts/generate-portal.ts" or inspects "npm_lifecycle_event"'
    );
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

  // 8. Showcase navigation, /project-info accuracy, build:export quality summary, & demo runtime guide checks
  verifyShowcasePortalLinks(vitepressConfigRaw, portalIndexRaw, errors);
  verifyShowcaseReturnLinksAndProjectInfo(
    basePathRaw,
    demoToolbarRaw,
    projectInfoRaw,
    pkg,
    deploymentRaw,
    errors
  );
  verifyContributingQualityAndDemoGuides(
    repoRoot,
    checkQualityRaw,
    contributingRaw,
    readmeRaw,
    devSetupRaw,
    agentsRaw,
    errors
  );

  return errors;
}

const REQUIRED_SHOWCASE_ROUTES = ['/', '/api/', '/storybook/'] as const;

const REQUIRED_DEMO_RUNTIME_GUIDE_MODULES = [
  'src/components/layout/RootLayoutClient.tsx',
  'src/lib/demo/demoStore.ts',
  'src/lib/demo/demoApiHandler.ts',
  'src/lib/sampleData/builder.ts',
  'src/features/registry/components/SimulatedCardCheckout.tsx',
  'src/app/admin/setup/page.tsx',
] as const;

function getObjectLiteralStringProps(obj: ts.ObjectLiteralExpression): Map<string, string> {
  const map = new Map<string, string>();
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    let key: string | null = null;
    if (
      ts.isIdentifier(prop.name) ||
      ts.isStringLiteral(prop.name) ||
      ts.isNoSubstitutionTemplateLiteral(prop.name)
    ) {
      key = prop.name.text;
    }
    if (!key) continue;
    if (
      ts.isStringLiteral(prop.initializer) ||
      ts.isNoSubstitutionTemplateLiteral(prop.initializer)
    ) {
      map.set(key, prop.initializer.text);
    }
  }
  return map;
}

function verifyShowcasePortalLinks(
  vitepressConfigRaw: string,
  portalIndexRaw: string,
  errors: string[]
): void {
  if (
    !vitepressConfigRaw.includes('ignoreDeadLinks') ||
    !/\\\/demo/.test(vitepressConfigRaw) ||
    !/\\\/storybook/.test(vitepressConfigRaw)
  ) {
    errors.push(
      'docs-portal/.vitepress/config.mts: Must preserve ignoreDeadLinks rules for /demo and /storybook'
    );
  }

  const configSf = ts.createSourceFile(
    'docs-portal/.vitepress/config.mts',
    vitepressConfigRaw,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const navItems: Array<Map<string, string>> = [];
  function visitConfig(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === 'nav') ||
        (ts.isStringLiteral(node.name) && node.name.text === 'nav')) &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const el of node.initializer.elements) {
        if (ts.isObjectLiteralExpression(el)) {
          navItems.push(getObjectLiteralStringProps(el));
        }
      }
    }
    ts.forEachChild(node, visitConfig);
  }
  visitConfig(configSf);

  const demoNav = navItems.find((item) => item.get('link') === '/demo/');
  if (!demoNav || demoNav.get('target') !== '_self') {
    errors.push(
      'docs-portal/.vitepress/config.mts: Nav link "/demo/" must retain target: \'_self\''
    );
  }

  const storybookNav = navItems.find((item) => item.get('link') === '/storybook/');
  if (
    !storybookNav ||
    storybookNav.get('target') !== '_blank' ||
    !/\bnoopener\b/.test(storybookNav.get('rel') ?? '') ||
    !/\bnoreferrer\b/.test(storybookNav.get('rel') ?? '')
  ) {
    errors.push(
      'docs-portal/.vitepress/config.mts: Nav link "/storybook/" must open in a new tab with target: \'_blank\' and rel: \'noopener noreferrer\''
    );
  }

  const storybookBlocks = portalIndexRaw.match(
    /-\s+(?:theme|title):[\s\S]*?link:\s*\/storybook\/[\s\S]*?(?=\n\s*-\s+(?:theme|title):|\nfeatures:|\n---)/g
  );
  if (!storybookBlocks || storybookBlocks.length < 2) {
    errors.push(
      'docs-portal/index.md: Must define "/storybook/" hero action and feature card entries'
    );
  } else {
    for (const block of storybookBlocks) {
      if (
        !/\btarget:\s*['"]?_blank['"]?\b/.test(block) ||
        !/\brel:\s*['"]?noopener\s+noreferrer['"]?\b/.test(block)
      ) {
        errors.push(
          'docs-portal/index.md: Every "/storybook/" action and feature card must set target: _blank and rel: noopener noreferrer'
        );
        break;
      }
    }
  }

  const demoBlocks = portalIndexRaw.match(
    /-\s+(?:theme|title):[\s\S]*?link:\s*\/demo\/[\s\S]*?(?=\n\s*-\s+(?:theme|title):|\nfeatures:|\n---)/g
  );
  if (!demoBlocks || demoBlocks.some((b) => !/\btarget:\s*['"]?_self['"]?\b/.test(b))) {
    errors.push('docs-portal/index.md: "/demo/" links must retain target: _self');
  }
}

function collectResolvedShowcaseRoutes(sf: ts.SourceFile): Set<string> {
  const routes = new Set<string>();
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'resolveShowcasePath' &&
      node.arguments.length >= 1
    ) {
      const firstArg = node.arguments[0];
      if (ts.isStringLiteral(firstArg) || ts.isNoSubstitutionTemplateLiteral(firstArg)) {
        routes.add(firstArg.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return routes;
}

function isInsideCollapsedGuard(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      ts.isPrefixUnaryExpression(current.left) &&
      current.left.operator === ts.SyntaxKind.ExclamationToken &&
      ts.isIdentifier(current.left.operand) &&
      current.left.operand.text === 'isToolbarCollapsed' &&
      node.pos >= current.right.pos &&
      node.end <= current.right.end
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function verifyShowcaseReturnLinksAndProjectInfo(
  basePathRaw: string,
  demoToolbarRaw: string,
  projectInfoRaw: string,
  pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  },
  deploymentRaw: string,
  errors: string[]
): void {
  if (
    !/export\s+function\s+resolveShowcasePath\b/.test(basePathRaw) ||
    !basePathRaw.includes('NEXT_PUBLIC_BASE_PATH')
  ) {
    errors.push(
      'src/lib/basePath.ts: Must export resolveShowcasePath deriving sibling showcase URLs from NEXT_PUBLIC_BASE_PATH'
    );
  }

  const toolbarSf = ts.createSourceFile(
    'src/components/demo/DemoToolbar.tsx',
    demoToolbarRaw,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  if (!/if\s*\(\s*!demo\?\.isDemoMode\s*\)\s*\{\s*return\s+null;/.test(demoToolbarRaw)) {
    errors.push(
      'src/components/demo/DemoToolbar.tsx: Must gate toolbar rendering on demo?.isDemoMode'
    );
  }

  const toolbarRoutes = collectResolvedShowcaseRoutes(toolbarSf);
  for (const route of REQUIRED_SHOWCASE_ROUTES) {
    if (!toolbarRoutes.has(route)) {
      errors.push(
        `src/components/demo/DemoToolbar.tsx: Must resolve subpath-safe showcase route "${route}" via resolveShowcasePath`
      );
    }
  }

  const persistentTestIds = new Set<string>();
  function visitToolbarJsx(node: ts.Node): void {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      let testId: string | null = null;
      let hasBypass = false;
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !attr.initializer || !ts.isStringLiteral(attr.initializer)) {
          continue;
        }
        const attrName = attr.name.getText(toolbarSf);
        if (attrName === 'data-testid') {
          testId = attr.initializer.text;
        }
        if (attrName === 'data-static-demo-bypass' && attr.initializer.text === 'true') {
          hasBypass = true;
        }
      }
      if (
        testId &&
        ['demo-link-docs', 'demo-link-api', 'demo-link-storybook'].includes(testId) &&
        hasBypass &&
        !isInsideCollapsedGuard(node)
      ) {
        persistentTestIds.add(testId);
      }
    }
    ts.forEachChild(node, visitToolbarJsx);
  }
  visitToolbarJsx(toolbarSf);

  for (const requiredTestId of ['demo-link-docs', 'demo-link-api', 'demo-link-storybook']) {
    if (!persistentTestIds.has(requiredTestId)) {
      errors.push(
        `src/components/demo/DemoToolbar.tsx: Showcase link "${requiredTestId}" must render in both expanded and collapsed states with data-static-demo-bypass="true"`
      );
    }
  }

  // Verify ProjectInfoClient.tsx claims & demo-only showcase links
  const allInstalledPackages = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  if (!allInstalledPackages.has('fuse.js') && /\bfuse\.js\b/i.test(projectInfoRaw)) {
    errors.push(
      'src/app/project-info/ProjectInfoClient.tsx: Must not claim unshipped "Fuse.js" library absent from package.json'
    );
  }
  if (/\bnetlify\b/i.test(projectInfoRaw)) {
    errors.push(
      'src/app/project-info/ProjectInfoClient.tsx: Must not claim unsupported "Netlify" hosting absent from DEPLOYMENT.md Support Tier Matrix'
    );
  }
  const supportMatrixSection = extractMarkdownSection(
    deploymentRaw,
    /^##\s+Support Tier Matrix\b/,
    /^##\s+/
  );
  for (const supportedHost of [
    'Docker / VPS',
    'Google Cloud Run',
    'Vercel',
    'Railway & Render',
  ]) {
    if (supportMatrixSection.includes(supportedHost)) {
      const normalizedProjectInfo = projectInfoRaw.replace(/&amp;/g, '&');
      if (!normalizedProjectInfo.includes(supportedHost)) {
        errors.push(
          `src/app/project-info/ProjectInfoClient.tsx: Must list supported hosting target "${supportedHost}" from DEPLOYMENT.md Support Tier Matrix`
        );
      }
    }
  }
  if (/\bnpm\s+install\b/.test(projectInfoRaw) || !/\bnpm\s+ci\b/.test(projectInfoRaw)) {
    errors.push(
      'src/app/project-info/ProjectInfoClient.tsx: Must prescribe "npm ci" rather than "npm install"'
    );
  }
  if (!projectInfoRaw.includes('.github/CONTRIBUTING.md')) {
    errors.push(
      'src/app/project-info/ProjectInfoClient.tsx: Must link CONTRIBUTING.md to ".github/CONTRIBUTING.md"'
    );
  }

  const projectInfoSf = ts.createSourceFile(
    'src/app/project-info/ProjectInfoClient.tsx',
    projectInfoRaw,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const projectInfoRoutes = collectResolvedShowcaseRoutes(projectInfoSf);
  for (const route of REQUIRED_SHOWCASE_ROUTES) {
    if (!projectInfoRoutes.has(route)) {
      errors.push(
        `src/app/project-info/ProjectInfoClient.tsx: Must resolve subpath-safe showcase route "${route}" via resolveShowcasePath`
      );
    }
  }
  if (
    !projectInfoRaw.includes('useOptionalDemo') ||
    !/isDemoMode\s*&&/.test(projectInfoRaw)
  ) {
    errors.push(
      'src/app/project-info/ProjectInfoClient.tsx: Must gate showcase navigation links on useOptionalDemo()?.isDemoMode'
    );
  }
}

function verifyContributingQualityAndDemoGuides(
  repoRoot: string,
  checkQualityRaw: string,
  contributingRaw: string,
  readmeRaw: string,
  devSetupRaw: string,
  agentsRaw: string,
  errors: string[]
): void {
  if (checkQualityRaw.includes('npm run build:export')) {
    const qualitySectionMatch = contributingRaw.match(
      /-\s+\*\*Run All Quality Checks:\*\*[\s\S]*?(?=\n\s*-\s+\*\*Targeted Quality)/
    );
    const qualitySummary = qualitySectionMatch ? qualitySectionMatch[0] : '';
    if (!qualitySummary.includes('npm run build:export')) {
      errors.push(
        '.github/CONTRIBUTING.md: "Run All Quality Checks" (npm run quality) summary must include "npm run build:export"'
      );
    }
  }

  // Canonical owner for interactive demo setup & runtime guide modules: docs/developer-setup.md
  if (!devSetupRaw.includes('npm run build:export')) {
    errors.push('docs/developer-setup.md: Must document static showcase export command "npm run build:export"');
  }
  if (!devSetupRaw.includes('wedding_showcase_demo_v1')) {
    errors.push(
      'docs/developer-setup.md: Must document persistent demo storage key "wedding_showcase_demo_v1"'
    );
  }
  for (const demoModulePath of REQUIRED_DEMO_RUNTIME_GUIDE_MODULES) {
    if (!devSetupRaw.includes(demoModulePath)) {
      errors.push(
        `docs/developer-setup.md: Missing interactive demo runtime module documentation for "${demoModulePath}"`
      );
    }
  }

  // Summary guides (README.md, AGENTS.md) must cite build:export and cross-link to docs/developer-setup.md
  // via rewriteMarkdownLinks without duplicating the full 6-module demo runtime inventory.
  for (const [docLabel, docText] of [
    ['README.md', readmeRaw],
    ['AGENTS.md', agentsRaw],
  ] as const) {
    if (!docText.includes('npm run build:export')) {
      errors.push(`${docLabel}: Must document static showcase export command "npm run build:export"`);
    }
    if (!hasPortalCrossLink(docText, docLabel, 'docs/developer-setup.md', repoRoot)) {
      errors.push(
        `${docLabel}: Must cross-link to canonical demo setup guide "docs/developer-setup.md" (verified via rewriteMarkdownLinks -> /development/developer-setup)`
      );
    }
    if (REQUIRED_DEMO_RUNTIME_GUIDE_MODULES.every((modPath) => docText.includes(modPath))) {
      errors.push(
        `${docLabel}: Duplicates full interactive demo runtime module inventory owned canonically by "docs/developer-setup.md"; keep a concise summary and cross-link instead`
      );
    }
  }
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
