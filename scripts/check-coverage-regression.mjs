import fs from 'node:fs';
import path from 'node:path';

const prSummaryPath = process.argv[2] || path.resolve('coverage/coverage-summary.json');
const baselineSummaryPath = process.argv[3] || path.resolve('coverage-main/coverage-summary.json');

console.log(`Checking PR coverage summary: ${prSummaryPath}`);
console.log(`Checking Baseline coverage summary: ${baselineSummaryPath}`);

if (!fs.existsSync(prSummaryPath)) {
  console.error(`❌ PR coverage summary not found at: ${prSummaryPath}`);
  process.exit(1);
}

const prSummary = JSON.parse(fs.readFileSync(prSummaryPath, 'utf8'));

if (!fs.existsSync(baselineSummaryPath)) {
  console.log(`⚠️ Baseline coverage summary not found at: ${baselineSummaryPath}`);
  console.log(`Skipping regression comparison (treating build as baseline).`);
  process.exit(0);
}

const baselineSummary = JSON.parse(fs.readFileSync(baselineSummaryPath, 'utf8'));

function extractDomainMetrics(summaryData) {
  const scopes = [
    { name: 'Global', key: 'total' },
    { name: 'src/core/', filter: (f) => f.includes('/src/core/') || f.includes('src/core/') },
    { name: 'src/features/', filter: (f) => f.includes('/src/features/') || f.includes('src/features/') },
  ];

  const results = {};

  for (const scope of scopes) {
    if (scope.key === 'total') {
      const totalObj = summaryData.total || {};
      results[scope.name] = {
        statements: totalObj.statements?.pct ?? 0,
        branches: totalObj.branches?.pct ?? 0,
        functions: totalObj.functions?.pct ?? 0,
        lines: totalObj.lines?.pct ?? 0,
      };
      continue;
    }

    let stmtsTotal = 0, stmtsCovered = 0;
    let branchTotal = 0, branchCovered = 0;
    let funcTotal = 0, funcCovered = 0;
    let lineTotal = 0, lineCovered = 0;

    for (const [filePath, fileData] of Object.entries(summaryData)) {
      if (filePath === 'total') continue;
      if (scope.filter(filePath)) {
        stmtsTotal += fileData.statements?.total || 0;
        stmtsCovered += fileData.statements?.covered || 0;
        branchTotal += fileData.branches?.total || 0;
        branchCovered += fileData.branches?.covered || 0;
        funcTotal += fileData.functions?.total || 0;
        funcCovered += fileData.functions?.covered || 0;
        lineTotal += fileData.lines?.total || 0;
        lineCovered += fileData.lines?.covered || 0;
      }
    }

    results[scope.name] = {
      statements: stmtsTotal > 0 ? (stmtsCovered / stmtsTotal) * 100 : 100,
      branches: branchTotal > 0 ? (branchCovered / branchTotal) * 100 : 100,
      functions: funcTotal > 0 ? (funcCovered / funcTotal) * 100 : 100,
      lines: lineTotal > 0 ? (lineCovered / lineTotal) * 100 : 100,
    };
  }

  return results;
}

const baselineMetrics = extractDomainMetrics(baselineSummary);
const prMetrics = extractDomainMetrics(prSummary);

const metricsList = ['statements', 'branches', 'functions', 'lines'];
const domainList = ['Global', 'src/core/', 'src/features/'];

let hasRegression = false;
const tableRows = [];

for (const domain of domainList) {
  for (const metric of metricsList) {
    const baselineVal = baselineMetrics[domain]?.[metric] ?? 0;
    const prVal = prMetrics[domain]?.[metric] ?? 0;
    const diff = prVal - baselineVal;

    // Use epsilon to prevent false positives from floating point rounding
    const regressed = diff < -0.005;
    if (regressed) {
      hasRegression = true;
    }

    const diffStr = (diff >= 0 ? '+' : '') + diff.toFixed(2) + '%';
    const status = regressed ? '❌ Regressed' : '✅ Passed';

    tableRows.push({
      domain,
      metric: metric.charAt(0).toUpperCase() + metric.slice(1),
      baseline: baselineVal.toFixed(2) + '%',
      pr: prVal.toFixed(2) + '%',
      diff: diffStr,
      status,
    });
  }
}

// Format Markdown report
let markdown = `## 📊 Test Coverage Comparison Report\n\n`;
markdown += `| Scope / Domain | Metric | Baseline | PR Build | Diff | Status |\n`;
markdown += `| --- | --- | --- | --- | --- | --- |\n`;

for (const row of tableRows) {
  markdown += `| \`${row.domain}\` | ${row.metric} | ${row.baseline} | ${row.pr} | ${row.diff} | ${row.status} |\n`;
}

markdown += `\n`;

if (hasRegression) {
  markdown += `❌ **Coverage Regression Detected**: One or more coverage metrics dropped relative to the \`main\` branch baseline.\n`;
} else {
  markdown += `✅ **Coverage Checks Passed**: All coverage metrics met or exceeded the \`main\` branch baseline.\n`;
}

console.log(markdown);

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
    console.log(`Successfully wrote coverage report to $GITHUB_STEP_SUMMARY`);
  } catch (err) {
    console.error(`Failed to write to $GITHUB_STEP_SUMMARY:`, err);
  }
}

if (hasRegression) {
  console.error(`❌ Build failed due to test coverage regression.`);
  process.exit(1);
} else {
  console.log(`✅ Test coverage regression check passed successfully.`);
  process.exit(0);
}
