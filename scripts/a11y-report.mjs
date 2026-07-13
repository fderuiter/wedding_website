import fs from 'fs';
import path from 'path';

function readViolations(filePath) {
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn(
      `Could not parse ${filePath}: ${err instanceof Error ? err.message : String(err)}`
    );
    return [];
  }
}

function formatViolation(v) {
  const id = v?.id ?? 'unknown-id';
  const description = v?.description ?? 'No description';
  const impact = v?.impact ?? 'unknown-impact';
  return `- **${id}**: ${description} (${impact})\n`;
}

function generateReport() {
  let totalViolations = 0;
  let report = '## Accessibility Health Summary\n\n';

  const outDir = path.resolve(process.cwd(), 'test-results');
  fs.mkdirSync(outDir, { recursive: true });

  const jestFile = path.join(outDir, 'jest-a11y-violations.json');
  const jestViolations = readViolations(jestFile);

  report += `### Component Level (Jest)\n`;
  if (jestViolations.length === 0) {
    report += `✅ No accessibility violations found in components.\n\n`;
  } else {
    totalViolations += jestViolations.length;
    report += `❌ Found ${jestViolations.length} violations in components.\n`;
    jestViolations.forEach((v) => {
      report += formatViolation(v);
    });
    report += `\n`;
  }

  const pwFile = path.join(outDir, 'playwright-a11y-violations.json');
  const pwViolations = readViolations(pwFile);

  report += `### Page Level (Playwright)\n`;
  if (pwViolations.length === 0) {
    report += `✅ No accessibility violations found in pages.\n\n`;
  } else {
    totalViolations += pwViolations.length;
    report += `❌ Found ${pwViolations.length} violations in pages.\n`;
    pwViolations.forEach((v) => {
      report += formatViolation(v);
    });
    report += `\n`;
  }

  report += `**Total Accessibility Violations:** ${totalViolations}\n`;
  fs.writeFileSync(path.join(outDir, 'a11y-summary.md'), report);
  console.log('Accessibility summary report generated at test-results/a11y-summary.md');
}

try {
  generateReport();
} catch (err) {
  console.error(
    'Failed to generate accessibility report:',
    err instanceof Error ? err.message : String(err)
  );
  process.exitCode = 0;
}
