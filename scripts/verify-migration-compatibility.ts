import fs from 'fs';
import path from 'path';

export interface MigrationViolation {
  file: string;
  line: number;
  keyword: string;
  snippet: string;
}

export interface VerificationResult {
  valid: boolean;
  totalFiles: number;
  violations: MigrationViolation[];
  errors: string[];
}

const DESTRUCTIVE_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'DROP TABLE', regex: /\bDROP\s+TABLE\b/i },
  { name: 'DROP COLUMN', regex: /\bDROP\s+COLUMN\b/i },
  { name: 'RENAME COLUMN', regex: /\bRENAME\s+COLUMN\b/i },
  { name: 'DROP CONSTRAINT', regex: /\bDROP\s+CONSTRAINT\b/i },
];

const BYPASS_ANNOTATION_REGEX = /--\s*allow-destructive(?::\s*(.*))?/i;

/**
 * Verifies a single SQL string content for destructive operations.
 */
export function verifyMigrationContent(content: string, filePath: string = 'migration.sql'): MigrationViolation[] {
  const violations: MigrationViolation[] = [];

  // Check if file contains a global bypass annotation
  const hasGlobalBypass = BYPASS_ANNOTATION_REGEX.test(content);
  if (hasGlobalBypass) {
    return [];
  }

  // Replace block comments /* ... */ with newlines to keep line numbers intact
  const contentNoBlockComments = content.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const newlineCount = (match.match(/\n/g) || []).length;
    return '\n'.repeat(newlineCount);
  });

  const lines = contentNoBlockComments.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const originalLine = lines[i];

    // Check if preceding line or current line has inline allow-destructive annotation
    if (BYPASS_ANNOTATION_REGEX.test(originalLine)) {
      continue;
    }

    // Strip single-line comments (-- ...)
    const lineNoComment = originalLine.replace(/--.*$/, '');

    // Strip single-quoted string literals ('...')
    const lineNoStrings = lineNoComment.replace(/'(?:''|[^'])*'/g, "''");

    // Check against destructive DDL patterns
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.regex.test(lineNoStrings)) {
        // Check if previous line had a bypass annotation
        const prevLine = i > 0 ? lines[i - 1] : '';
        if (BYPASS_ANNOTATION_REGEX.test(prevLine)) {
          break;
        }

        violations.push({
          file: filePath,
          line: i + 1,
          keyword: pattern.name,
          snippet: originalLine.trim(),
        });
        break;
      }
    }
  }

  return violations;
}

/**
 * Finds all SQL files in a directory recursively.
 */
export function findSqlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSqlFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.sql')) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

/**
 * Verifies all SQL migration files in the given directory.
 */
export function verifyMigrations(targetDir?: string): VerificationResult {
  const migrationsDir = targetDir || path.join(process.cwd(), 'prisma/migrations');
  const sqlFiles = findSqlFiles(migrationsDir);

  const allViolations: MigrationViolation[] = [];
  const errors: string[] = [];

  for (const file of sqlFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(process.cwd(), file);
      const violations = verifyMigrationContent(content, relativePath);
      allViolations.push(...violations);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to read or parse file ${file}: ${errorMessage}`);
    }
  }

  for (const violation of allViolations) {
    errors.push(
      `Destructive DDL [${violation.keyword}] in ${violation.file}:${violation.line}: "${violation.snippet}"`
    );
  }

  return {
    valid: errors.length === 0,
    totalFiles: sqlFiles.length,
    violations: allViolations,
    errors,
  };
}

// CLI Execution Entry Point
export function main(): void {
  const targetDir = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : undefined;
  const result = verifyMigrations(targetDir);

  if (!result.valid) {
    console.error('\n❌ Migration Compatibility Check Failed!');
    console.error(`Found ${result.violations.length} destructive DDL operation(s) without bypass annotations:\n`);

    for (const v of result.violations) {
      console.error(`  - ${v.file}:${v.line} -> [${v.keyword}] ${v.snippet}`);
    }

    console.error('\n💡 Destructive changes break zero-downtime deployments. Follow the expand-and-contract strategy.');
    console.error('If this breaking change is intentional, add \'-- allow-destructive: <reason>\' above or on the statement.\n');

    process.exit(1);
  } else {
    console.log(`\n✅ Migration compatibility check passed. (${result.totalFiles} SQL files scanned)\n`);
    process.exit(0);
  }
}

// Run main if invoked directly
const isDirectCall =
  process.argv[1] &&
  (process.argv[1].endsWith('verify-migration-compatibility.ts') ||
    process.argv[1].endsWith('verify-migration-compatibility.js'));

if (isDirectCall) {
  main();
}
