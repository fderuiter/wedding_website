import fs from 'fs';
import path from 'path';

export interface SASTFinding {
  file: string;
  line: number;
  rule: string;
  description: string;
  codeSnippet: string;
}

const IGNORED_DIRS = [
  '.git',
  'node_modules',
  '.next',
  'coverage',
  'test-results',
  'dist',
  'build',
  'public'
];

const IGNORED_FILES = [
  'package-lock.json',
  '.env.example',
  '.env.test',
  'raw_drift.txt',
  'drift_files.txt',
  'sast-scan.ts',
  'secret-scan.ts'
];

const TARGET_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

interface SASTRule {
  id: string;
  name: string;
  description: string;
  check: (lineText: string, fullContent: string, lineNumber: number, filePath: string) => boolean;
}

const SAST_RULES: SASTRule[] = [
  {
    id: 'SAST-001',
    name: 'Code Injection (eval / new Function)',
    description: 'Use of eval() or new Function() allows arbitrary code execution.',
    check: (lineText) => {
      const trimmed = lineText.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      return /\beval\s*\(/.test(lineText) || /\bnew\s+Function\s*\(/.test(lineText);
    }
  },
  {
    id: 'SAST-002',
    name: 'Unsafe Raw SQL Query',
    description: 'Use of $queryRawUnsafe or $executeRawUnsafe with dynamic interpolation can lead to SQL injection.',
    check: (lineText) => {
      const trimmed = lineText.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      return (
        (/\$queryRawUnsafe\s*\(\s*`[^`]*\${/.test(lineText) ||
          /\$executeRawUnsafe\s*\(\s*`[^`]*\${/.test(lineText) ||
          /\$queryRawUnsafe\s*\([^)]*\+/.test(lineText))
      );
    }
  },
  {
    id: 'SAST-003',
    name: 'Command Injection (child_process)',
    description: 'Executing shell commands with dynamic string concatenation can lead to command injection.',
    check: (lineText) => {
      const trimmed = lineText.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      if (/\b(exec|execSync)\s*\(\s*`[^`]*\${/.test(lineText)) return true;
      if (/\b(exec|execSync)\s*\(\s*[a-zA-Z0-9_]+\s*\+/.test(lineText)) return true;
      return false;
    }
  },
  {
    id: 'SAST-004',
    name: 'DOM XSS via document.write',
    description: 'Use of document.write or document.writeln is insecure and enables DOM XSS.',
    check: (lineText) => {
      const trimmed = lineText.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      return /\bdocument\.(write|writeln)\s*\(/.test(lineText);
    }
  },
  {
    id: 'SAST-005',
    name: 'Prototype Pollution',
    description: 'Direct assignment to __proto__ or constructor.prototype can pollute Object prototype.',
    check: (lineText) => {
      const trimmed = lineText.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      return /__proto__|constructor\.prototype/.test(lineText) && /=/.test(lineText);
    }
  },
  {
    id: 'SAST-006',
    name: 'Insecure Direct InnerHTML Assignment',
    description: 'Assignment to innerHTML or dangerouslySetInnerHTML with unescaped dynamic expression.',
    check: (lineText) => {
      const trimmed = lineText.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
      if (/dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html\s*:\s*(?!DOMPurify|sanitize|['"])/.test(lineText)) {
        if (!lineText.includes('/* safe */') && !lineText.includes('// safe')) {
          return true;
        }
      }
      return false;
    }
  }
];

function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return (
    normalized.includes('__tests__') ||
    normalized.includes('/tests/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.test.tsx') ||
    normalized.endsWith('.test.js') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.spec.tsx') ||
    normalized.endsWith('.spec.js')
  );
}

function scanFile(filePath: string): SASTFinding[] {
  const relativePath = path.relative(process.cwd(), filePath);
  if (isTestFile(relativePath)) {
    return [];
  }

  const ext = path.extname(filePath);
  if (!TARGET_EXTENSIONS.includes(ext)) {
    return [];
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const findings: SASTFinding[] = [];
  const lines = content.split('\n');

  lines.forEach((lineText, index) => {
    SAST_RULES.forEach((rule) => {
      if (rule.check(lineText, content, index + 1, filePath)) {
        findings.push({
          file: relativePath,
          line: index + 1,
          rule: `${rule.id}: ${rule.name}`,
          description: rule.description,
          codeSnippet: lineText.trim()
        });
      }
    });
  });

  return findings;
}

function scanDirectory(dir: string): SASTFinding[] {
  let findings: SASTFinding[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.includes(entry.name)) {
        findings = findings.concat(scanDirectory(fullPath));
      }
    } else if (entry.isFile()) {
      if (!IGNORED_FILES.includes(entry.name)) {
        findings = findings.concat(scanFile(fullPath));
      }
    }
  }

  return findings;
}

export function runSASTScan(rootDir = process.cwd()): SASTFinding[] {
  return scanDirectory(rootDir);
}

if (process.argv[1] && process.argv[1].endsWith('sast-scan.ts')) {
  console.log('🛡️ Starting Static Application Security Testing (SAST)...');
  const findings = runSASTScan();

  if (findings.length > 0) {
    console.error(`\n❌ SAST Scan FAILED: Found ${findings.length} high-severity vulnerability issue(s):\n`);
    findings.forEach(f => {
      console.error(`  - ${f.file}:${f.line} [${f.rule}]`);
      console.error(`    Description: ${f.description}`);
      console.error(`    Code: ${f.codeSnippet}\n`);
    });
    process.exit(1);
  } else {
    console.log('✅ SAST scan passed: No high-severity code vulnerabilities detected.');
    process.exit(0);
  }
}
