import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Prohibited personal or template domain/names in runtime code
const PROHIBITED_IDENTIFIERS = [
  'abbifred.com',
  'abbifred',
  'photos.app.goo.gl',
  'lh3.googleusercontent.com/pw/',
];

// Explicitly allowlisted file paths (relative to repo root) or directory prefixes
const ALLOWLIST_PATHS = new Set([
  'PROJECT_HISTORY.md',
  '.env.example',
  '.env.test',
  'README.md',
  'scripts/check-personal-identifiers.ts',
  'package-lock.json',
]);

export const ALLOWLIST_PREFIXES = [
  '.git/',
  'node_modules/',
  '.next/',
  '.next-export/',
  'out/',
  '.api-backup-export/',
  'storybook-static/',
  'coverage/',
  'test-results/',
  'build/',
  'dist/',
  'docs-portal/.vitepress/dist/',
  'docs-portal/.vitepress/cache/',
  'docs-portal/.vitepress/.temp/',
  'docs-portal/architecture/',
  'docs-portal/deployment/',
  'docs-portal/development/',
  'docs-portal/features/',
  'docs-portal/security/',
  'docs-portal/guides/',
];

// Focus directories for scanning (or scan all files not excluded)
const ROOT_DIR = process.cwd();

interface MatchResult {
  filePath: string;
  line: number;
  matchedText: string;
  lineContent: string;
}

export function isAllowlisted(relPath: string, isDir = false): boolean {
  const normalized = relPath.replace(/\\/g, '/');
  const pathToCheck = isDir && !normalized.endsWith('/') ? `${normalized}/` : normalized;
  if (ALLOWLIST_PATHS.has(normalized)) {
    return true;
  }
  for (const prefix of ALLOWLIST_PREFIXES) {
    if (pathToCheck.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

function scanDirectory(dirPath: string, matches: MatchResult[]) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');
    const isDir = entry.isDirectory();

    if (isAllowlisted(relPath, isDir)) {
      continue;
    }

    if (isDir) {
      scanDirectory(fullPath, matches);
    } else if (entry.isFile()) {
      scanFile(fullPath, relPath, matches);
    }
  }
}

function scanFile(fullPath: string, relPath: string, matches: MatchResult[]) {
  // Skip binary/large media files
  const ext = path.extname(fullPath).toLowerCase();
  const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.sqlite', '.db'];
  if (binaryExts.includes(ext)) {
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(fullPath, 'utf8');
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);

  lines.forEach((lineText, index) => {
    const lowerLine = lineText.toLowerCase();
    for (const identifier of PROHIBITED_IDENTIFIERS) {
      if (lowerLine.includes(identifier.toLowerCase())) {
        matches.push({
          filePath: relPath,
          line: index + 1,
          matchedText: identifier,
          lineContent: lineText.trim(),
        });
      }
    }
  });
}

function main() {
  const matches: MatchResult[] = [];
  scanDirectory(ROOT_DIR, matches);

  if (matches.length > 0) {
    console.error('\n❌ Prohibited personal/template identifier(s) detected in runtime or codebase files:\n');
    matches.forEach((m, idx) => {
      console.error(`  [${idx + 1}] ${m.filePath}:${m.line} -> Matched "${m.matchedText}"`);
      console.error(`      Line: "${m.lineContent}"`);
    });

    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. Core runtime code must remain generic, domain-neutral, and portable.
2. Replace hard-coded personal domains or tenant names with environment variables
   (e.g., process.env.ALLOWED_HOSTS, process.env.NEXT_PUBLIC_BASE_URL) or
   generic domain placeholders (e.g., example.com, localhost).
3. If this file is explicitly intended as a historical archive or test fixture,
   add its path or directory prefix to ALLOWLIST_PATHS in
   scripts/check-personal-identifiers.ts.
================================================================================
`);
    process.exit(1);
  } else {
    console.log('✅ Personal/template identifier check passed! Core runtime code is domain-neutral.');
    process.exit(0);
  }
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('check-personal-identifiers.ts') ||
    process.argv[1].endsWith('check-personal-identifiers.js'));

if (isDirectExecution) {
  main();
}
