import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDocument } from 'yaml';

interface Violation {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  actionRef: string;
  reason: string;
}

const WORKFLOWS_DIR = path.join(process.cwd(), '.github', 'workflows');
const COMMIT_SHA_REGEX = /^[a-fA-F0-9]{40}$/;

function checkWorkflowFile(
  filePath: string,
  violations: Violation[],
  baseDir: string = process.cwd()
): void {
  const relPath = path.relative(baseDir, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  const doc = parseDocument(content, { version: '1.2', strict: true });
  for (const err of doc.errors) {
    const lineNumber = err.linePos?.[0]?.line ?? 1;
    const summary = err.message.split(/\r?\n/)[0].trim();
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent: (lines[lineNumber - 1] ?? '').trim(),
      actionRef: err.code,
      reason: `YAML 1.2 parse error (${err.code}): ${summary}`,
    });
  }

  for (const warn of doc.warnings) {
    const lineNumber = warn.linePos?.[0]?.line ?? 1;
    const summary = warn.message.split(/\r?\n/)[0].trim();
    violations.push({
      filePath: relPath,
      lineNumber,
      lineContent: (lines[lineNumber - 1] ?? '').trim(),
      actionRef: warn.code,
      reason: `YAML 1.2 warning (${warn.code}): ${summary}`,
    });
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      return; // Skip full-line comments
    }

    // Match lines containing a `uses:` directive
    const usesMatch = line.match(/(?:^|\s|-)\s*uses:\s*([^\r\n]+)/);
    if (!usesMatch) {
      return;
    }

    const rawValue = usesMatch[1].trim();
    // Separate inline comments starting with '#'
    const actionTarget = rawValue.split('#')[0].trim().replace(/^['"]|['"]$/g, '');

    // Skip local path references (e.g., ./.github/workflows/publish-artifact.yml)
    if (actionTarget.startsWith('.')) {
      return;
    }

    const lastAtIdx = actionTarget.lastIndexOf('@');
    if (lastAtIdx === -1) {
      violations.push({
        filePath: relPath,
        lineNumber: index + 1,
        lineContent: line.trim(),
        actionRef: actionTarget,
        reason: 'Missing "@<commit-sha>" reference specifier.',
      });
      return;
    }

    const ref = actionTarget.substring(lastAtIdx + 1);
    if (!COMMIT_SHA_REGEX.test(ref)) {
      violations.push({
        filePath: relPath,
        lineNumber: index + 1,
        lineContent: line.trim(),
        actionRef: actionTarget,
        reason: `Action tag "${ref}" is not a 40-character commit SHA.`,
      });
    }
  });
}

export function checkActionPins(workflowsDir: string = WORKFLOWS_DIR): {
  workflowFiles: string[];
  violations: Violation[];
} {
  const files = fs.readdirSync(workflowsDir).sort();
  const workflowFiles = files.filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml')
  );

  const baseDir = path.resolve(workflowsDir, '..', '..');
  const violations: Violation[] = [];

  for (const file of workflowFiles) {
    checkWorkflowFile(path.join(workflowsDir, file), violations, baseDir);
  }

  return { workflowFiles, violations };
}

function main(): void {
  console.log('🔍 Checking GitHub Actions workflow YAML 1.2 syntax and action pins...');

  if (!fs.existsSync(WORKFLOWS_DIR)) {
    console.error(`❌ Workflows directory not found at: ${WORKFLOWS_DIR}`);
    process.exit(1);
  }

  const { workflowFiles, violations } = checkActionPins(WORKFLOWS_DIR);

  if (violations.length > 0) {
    console.error(
      `\n❌ Found ${violations.length} workflow YAML or action pin violation(s):\n`
    );
    violations.forEach((v, idx) => {
      console.error(
        `  [${idx + 1}] ${v.filePath}:${v.lineNumber}`
      );
      console.error(`      Line: "${v.lineContent}"`);
      console.error(`      Reason: ${v.reason}\n`);
    });

    console.error(`
================================================================================
ACTIONABLE REMEDIATION:
--------------------------------------------------------------------------------
1. All workflow files in .github/workflows/ must be valid YAML 1.2 with zero
   parser errors or unresolved tag warnings (quote conditionals starting with "!").
2. All third-party GitHub Actions must be pinned to full 40-character commit SHAs.
3. Include an inline version comment indicating the release version, e.g.:
   uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
4. Local workflow references (starting with ./ or ./.github/) do not require commit SHAs.
================================================================================
`);
    process.exit(1);
  }

  console.log(
    `✅ Workflow YAML 1.2 and action pin validation passed! All ${workflowFiles.length} workflow file(s) parse cleanly and pin third-party actions to 40-character commit SHAs.`
  );
  process.exit(0);
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('check-action-pins.ts') ||
    process.argv[1].endsWith('check-action-pins.js'));

if (isDirectExecution) {
  main();
}
