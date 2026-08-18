import fs from 'fs';
import path from 'path';

interface Finding {
  file: string;
  line: number;
  rule: string;
  match: string;
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
  'drift_files.txt'
];

const SECRET_PATTERNS: { rule: string; regex: RegExp }[] = [
  {
    rule: 'AWS Access Key ID',
    regex: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g
  },
  {
    rule: 'AWS Secret Key Assignment',
    regex: /(?:aws|s3)_secret(?:_access)?_key\s*[:=]\s*['"](?![A-Za-z0-9_-]*test[A-Za-z0-9_-]*)(?![A-Za-z0-9_-]*dummy[A-Za-z0-9_-]*)[A-Za-z0-9\/+=]{30,}['"]/gi
  },
  {
    rule: 'Private Key',
    regex: /-----BEGIN (?:RSA|EC|PGP|OPENSSH|DSA|EC)?\s*PRIVATE KEY-----/g
  },
  {
    rule: 'GitHub Token',
    regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}|github_pat_[A-Za-z0-9_]{82}/g
  },
  {
    rule: 'Slack Token',
    regex: /xox[baprs]-[0-9a-zA-Z]{10,48}/g
  },
  {
    rule: 'Stripe Secret Key',
    regex: /sk_live_[0-9a-zA-Z]{24,32}/g
  },
  {
    rule: 'Generic Hardcoded Secret Token',
    regex: /(?:api[_-]?key|secret[_-]?key|app[_-]?secret|client[_-]?secret|auth[_-]?token)\s*[:=]\s*['"](?![A-Za-z0-9_-]*test[A-Za-z0-9_-]*)(?![A-Za-z0-9_-]*example[A-Za-z0-9_-]*)(?![A-Za-z0-9_-]*placeholder[A-Za-z0-9_-]*)[A-Za-z0-9_-]{24,}['"]/gi
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

function scanFile(filePath: string): Finding[] {
  const relativePath = path.relative(process.cwd(), filePath);
  if (isTestFile(relativePath)) {
    return [];
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const findings: Finding[] = [];
  const lines = content.split('\n');

  lines.forEach((lineText, index) => {
    // Skip comment-only lines in env or code
    const trimmed = lineText.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
      return;
    }

    SECRET_PATTERNS.forEach(({ rule, regex }) => {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(lineText)) !== null) {
        const val = match[0];
        // Redact match for security reporting
        const redacted = val.length > 8 ? `${val.slice(0, 4)}...${val.slice(-4)}` : '****';
        findings.push({
          file: relativePath,
          line: index + 1,
          rule,
          match: redacted
        });
      }
    });
  });

  return findings;
}

function scanDirectory(dir: string): Finding[] {
  let findings: Finding[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(process.cwd(), fullPath);

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

export function runSecretScan(rootDir = process.cwd()): Finding[] {
  return scanDirectory(rootDir);
}

if (process.argv[1] && process.argv[1].endsWith('secret-scan.ts')) {
  console.log('🔍 Starting Secret Scanning...');
  const findings = runSecretScan();

  if (findings.length > 0) {
    console.error(`\n❌ Secret Scanning FAILED: Found ${findings.length} secret(s) in codebase:\n`);
    findings.forEach(f => {
      console.error(`  - ${f.file}:${f.line} [${f.rule}] (match: ${f.match})`);
    });
    process.exit(1);
  } else {
    console.log('✅ Secret scanning passed: No hardcoded secrets detected.');
    process.exit(0);
  }
}
