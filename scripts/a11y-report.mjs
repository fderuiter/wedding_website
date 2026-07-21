import fs from 'fs';
import path from 'path';

function generateReport() {
  let totalViolations = 0;
  let report = '## Accessibility Health Summary\n\n';
  
  const jestFile = path.join(process.cwd(), 'test-results', 'jest-a11y-violations.json');
  if (fs.existsSync(jestFile)) {
    const jestViolations = JSON.parse(fs.readFileSync(jestFile, 'utf8'));
    report += '### Component Level (Jest)\n';
    if (jestViolations.length === 0) {
      report += '✅ No accessibility violations found in components.\n\n';
    } else {
      totalViolations += jestViolations.length;
      report += `❌ Found ${jestViolations.length} violations in components.\n`;
      jestViolations.forEach(v => {
        report += `- **${v.id}**: ${v.description} (${v.impact})\n`;
      });
      report += '\n';
    }
  }

  const pwFile = path.join(process.cwd(), 'test-results', 'playwright-a11y-violations.json');
  if (fs.existsSync(pwFile)) {
    const pwViolations = JSON.parse(fs.readFileSync(pwFile, 'utf8'));
    report += '### Page Level (Playwright)\n';
    if (pwViolations.length === 0) {
      report += '✅ No accessibility violations found in pages.\n\n';
    } else {
      totalViolations += pwViolations.length;
      report += `❌ Found ${pwViolations.length} violations in pages.\n`;
      pwViolations.forEach(v => {
        report += `- **${v.id}**: ${v.description} (${v.impact})\n`;
      });
      report += '\n';
    }
  }

  report += `**Total Accessibility Violations:** ${totalViolations}\n`;
  const outputPath = path.join(process.cwd(), 'test-results', 'a11y-summary.md');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report);
  console.log('Accessibility summary report generated at test-results/a11y-summary.md');
}

generateReport();
