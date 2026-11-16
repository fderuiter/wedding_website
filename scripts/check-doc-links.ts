import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = process.cwd();

const EXCLUDE_DIRS = [
  'node_modules',
  '.git',
  '.next',
  'coverage',
  'test-results',
  'docs-portal',
];

export interface LinkError {
  sourceFile: string;
  line: number;
  linkText: string;
  targetPath: string;
  resolvedPath: string;
}

export function findMarkdownFiles(dir: string, fileList: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(ROOT_DIR, fullPath).replace(/\\/g, '/');

    if (EXCLUDE_DIRS.some(ex => relPath.startsWith(ex))) {
      continue;
    }

    if (entry.isDirectory()) {
      findMarkdownFiles(fullPath, fileList);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

export function checkLinksInFile(filePath: string, errors: LinkError[]) {
  const relSource = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return;
  }

  const lines = content.split(/\r?\n/);
  const fileDir = path.dirname(filePath);

  // Markdown link regex: [text](target)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

  lines.forEach((lineText, index) => {
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(lineText)) !== null) {
      const linkText = match[1];
      const rawTarget = match[2].trim();

      // Skip external links, mailto, tel, or internal anchor links
      if (
        rawTarget.startsWith('http://') ||
        rawTarget.startsWith('https://') ||
        rawTarget.startsWith('mailto:') ||
        rawTarget.startsWith('tel:') ||
        rawTarget.startsWith('#')
      ) {
        continue;
      }

      // Remove anchor query or section (#...)
      const cleanTarget = rawTarget.split('#')[0].split('?')[0];
      if (!cleanTarget) {
        continue; // e.g. target was "#some-heading"
      }

      // Resolve path relative to current markdown file
      const resolvedPath = path.resolve(fileDir, cleanTarget);

      if (!fs.existsSync(resolvedPath)) {
        errors.push({
          sourceFile: relSource,
          line: index + 1,
          linkText,
          targetPath: rawTarget,
          resolvedPath: path.relative(ROOT_DIR, resolvedPath).replace(/\\/g, '/'),
        });
      }
    }
  });
}

export function checkDocLinks(): { passed: boolean; errors: LinkError[]; count: number } {
  const mdFiles = findMarkdownFiles(ROOT_DIR);
  const errors: LinkError[] = [];

  for (const file of mdFiles) {
    checkLinksInFile(file, errors);
  }

  return { passed: errors.length === 0, errors, count: mdFiles.length };
}

function main() {
  const { passed, errors, count } = checkDocLinks();

  if (!passed) {
    console.error('\n❌ Dead documentation link(s) detected:\n');
    errors.forEach((err, idx) => {
      console.error(`  [${idx + 1}] ${err.sourceFile}:${err.line}`);
      console.error(`      Link text: "${err.linkText}"`);
      console.error(`      Target: "${err.targetPath}" (Resolved: "${err.resolvedPath}")`);
    });

    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. Fix or remove broken relative file links in repository Markdown documents.
2. Ensure target file paths exist relative to the directory of the Markdown file
   containing the link.
================================================================================
`);
    process.exit(1);
  } else {
    console.log(`✅ Documentation link check passed! Verified ${count} Markdown file(s).`);
    process.exit(0);
  }
}

const isMain = typeof process.argv[1] === 'string' &&
               path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}
