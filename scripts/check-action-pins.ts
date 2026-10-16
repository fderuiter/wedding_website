import fs from 'fs';
import path from 'path';

interface Violation {
  filePath: string;
  lineNumber: number;
  lineContent: string;
  actionRef: string;
  reason: string;
}

const WORKFLOWS_DIR = path.join(process.cwd(), '.github', 'workflows');
const COMMIT_SHA_REGEX = /^[a-fA-F0-9]{40}$/;

function checkWorkflowFile(filePath: string, violations: Violation[]) {
  const relPath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

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

function main() {
  console.log('🔍 Checking GitHub Actions workflow action pins...');

  if (!fs.existsSync(WORKFLOWS_DIR)) {
    console.error(`❌ Workflows directory not found at: ${WORKFLOWS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(WORKFLOWS_DIR);
  const workflowFiles = files.filter(
    (f) => f.endsWith('.yml') || f.endsWith('.yaml')
  );

  const violations: Violation[] = [];

  for (const file of workflowFiles) {
    checkWorkflowFile(path.join(WORKFLOWS_DIR, file), violations);
  }

  if (violations.length > 0) {
    console.error(
      `\n❌ Found ${violations.length} unpinned third-party action directive(s):\n`
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
1. All third-party GitHub Actions must be pinned to full 40-character commit SHAs.
2. Include an inline version comment indicating the release version, e.g.:
   uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
3. Local workflow references (starting with ./ or ./.github/) do not require commit SHAs.
================================================================================
`);
    process.exit(1);
  }

  console.log(
    `✅ Action pin validation passed! All third-party actions in ${workflowFiles.length} workflow file(s) are pinned to 40-character commit SHAs.`
  );
  process.exit(0);
}

main();
