#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Define target coverage threshold
const COVERAGE_THRESHOLD = 80;

// Filter criteria:
// - File must start with src/
// - File must end with .ts or .tsx
// - File must NOT end with .d.ts
// - File must NOT end with layout.tsx or route.ts
// - File must NOT start with src/types/ or src/styles/
// - File must NOT be a test file (i.e. contains .test. or .spec., or is in __tests__/)
export function shouldCheckFile(filePath) {
  if (!filePath.startsWith('src/')) return false;
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return false;
  if (filePath.endsWith('.d.ts')) return false;
  if (filePath.endsWith('layout.tsx') || filePath.endsWith('route.ts')) return false;
  if (filePath.startsWith('src/types/') || filePath.startsWith('src/styles/')) return false;
  if (filePath.includes('.test.') || filePath.includes('.spec.') || filePath.includes('__tests__/')) return false;
  return true;
}

// 1. Get Base Branch and Diff
export function getGitDiff(baseBranch) {
  try {
    console.log(`Fetching origin/${baseBranch} to get latest commits...`);
    execSync(`git fetch origin ${baseBranch}`, { stdio: 'ignore' });
  } catch (err) {
    console.warn(`Warning: failed to fetch origin/${baseBranch}: ${err.message}`);
  }

  let diffOutput = '';
  // Try diff with origin/${baseBranch}...HEAD (three dots represents diff from merge-base)
  try {
    diffOutput = execSync(`git diff -U0 origin/${baseBranch}...HEAD`, { encoding: 'utf8' });
  } catch (err) {
    console.warn(`Warning: failed diff origin/${baseBranch}...HEAD: ${err.message}. Trying origin/${baseBranch}...`);
    try {
      diffOutput = execSync(`git diff -U0 origin/${baseBranch}`, { encoding: 'utf8' });
    } catch (err2) {
      console.warn(`Warning: failed diff origin/${baseBranch}: ${err2.message}. Trying HEAD~1...`);
      try {
        diffOutput = execSync(`git diff -U0 HEAD~1`, { encoding: 'utf8' });
      } catch (err3) {
        console.error(`Error: failed to get git diff: ${err3.message}`);
        return '';
      }
    }
  }
  return diffOutput;
}

// 2. Parse Unified Diff (-U0) to track added/modified lines in new file
export function parseDiff(diffOutput) {
  const lines = diffOutput.split('\n');
  const changedFiles = {}; // filePath -> Set of line numbers

  let currentFile = null;
  let currentNewLine = null;

  for (const line of lines) {
    if (line.startsWith('diff --git a/')) {
      const match = line.match(/ b\/(.+)$/);
      if (match) {
        currentFile = match[1];
        changedFiles[currentFile] = new Set();
      } else {
        currentFile = null;
      }
      currentNewLine = null;
    } else if (line.startsWith('@@ ')) {
      // @@ -oldStart[,oldLength] +newStart[,newLength] @@
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        currentNewLine = parseInt(match[1], 10);
      } else {
        currentNewLine = null;
      }
    } else if (currentFile && currentNewLine !== null) {
      if (line.startsWith('+')) {
        if (!line.startsWith('+++ ')) {
          changedFiles[currentFile].add(currentNewLine);
          currentNewLine++;
        }
      } else if (line.startsWith('-')) {
        // Line starting with '-' is a deletion, so it does not exist in the new file.
        // We do not increment the line counter for the new file.
      } else if (line.startsWith(' ')) {
        currentNewLine++;
      }
    }
  }

  return changedFiles;
}

// 3. Parse LCOV File
export function parseLcov(lcovPath) {
  if (!fs.existsSync(lcovPath)) {
    console.error(`Error: LCOV coverage report not found at ${lcovPath}`);
    return null;
  }

  const content = fs.readFileSync(lcovPath, 'utf8');
  const files = {}; // filePath -> { lineNum: hits }
  
  let currentFile = null;
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('SF:')) {
      const sfPath = trimmed.substring(3).trim();
      let relPath = sfPath;
      if (path.isAbsolute(sfPath)) {
        relPath = path.relative(process.cwd(), sfPath);
      }
      currentFile = relPath;
      files[currentFile] = {};
    } else if (trimmed.startsWith('DA:')) {
      if (currentFile) {
        const parts = trimmed.substring(3).split(',');
        const lineNum = parseInt(parts[0], 10);
        const hits = parseInt(parts[1], 10);
        files[currentFile][lineNum] = hits;
      }
    } else if (trimmed === 'end_of_record') {
      currentFile = null;
    }
  }
  
  return files;
}

export function main() {
  const baseBranch = process.env.GITHUB_BASE_REF || 'main';
  console.log(`Analyzing changes against base branch: ${baseBranch}`);

  const diffOutput = getGitDiff(baseBranch);
  const changedFilesMap = parseDiff(diffOutput);
  const lcovFiles = parseLcov('coverage/lcov.info') || {};

  const filteredChangedFiles = [];
  
  // Filter and process changed files
  for (const [filePath, changedLines] of Object.entries(changedFilesMap)) {
    if (!shouldCheckFile(filePath)) {
      continue;
    }
    // Skip if the file was deleted (does not exist on disk)
    if (!fs.existsSync(filePath)) {
      continue;
    }
    if (changedLines.size === 0) {
      continue;
    }
    filteredChangedFiles.push({ filePath, changedLines });
  }

  console.log(`Found ${filteredChangedFiles.length} file(s) with added or modified lines requiring coverage.`);

  const results = [];
  let allPassed = true;

  for (const { filePath, changedLines } of filteredChangedFiles) {
    let executableLines = 0;
    let coveredLines = 0;
    let missingFromLcov = false;

    // Check if file is parsed in LCOV
    if (lcovFiles[filePath]) {
      const fileCoverage = lcovFiles[filePath];
      for (const lineNum of changedLines) {
        if (lineNum in fileCoverage) {
          executableLines++;
          if (fileCoverage[lineNum] > 0) {
            coveredLines++;
          }
        }
      }
    } else {
      // If a file has changes but is completely missing from lcov.info, treat its coverage as 0% if any added/modified lines are present.
      missingFromLcov = true;
      executableLines = changedLines.size;
      coveredLines = 0;
    }

    let coveragePercentage = 100;
    let status = 'pass';

    if (executableLines > 0) {
      coveragePercentage = (coveredLines / executableLines) * 100;
      if (coveragePercentage < COVERAGE_THRESHOLD) {
        status = 'fail';
        allPassed = false;
      }
    }

    results.push({
      filePath,
      executableLines,
      coveredLines,
      coveragePercentage,
      status,
      missingFromLcov
    });
  }

  // 4. Generate Markdown Comment
  let md = `<!-- diff-coverage-guard-comment -->\n`;
  md += `### 🛡️ Differential Code Coverage Guard\n\n`;

  if (results.length === 0) {
    md += `✅ No executable files were added or modified in this pull request that require coverage checks.\n\n`;
    md += `**Overall Status**: ✅ **PASS**\n`;
  } else {
    md += `We measured code coverage strictly on the lines added or modified in this pull request. Files must achieve at least **${COVERAGE_THRESHOLD}%** line coverage to pass.\n\n`;
    md += `| File | Executable Changed Lines | Covered Lines | Coverage % | Status |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: |\n`;

    for (const res of results) {
      const coverageText = res.executableLines === 0 ? 'N/A' : `${res.coveragePercentage.toFixed(2)}%`;
      const statusIcon = res.status === 'pass' ? '✅ PASS' : '❌ FAIL';
      const fileText = res.missingFromLcov ? `\`${res.filePath}\` (Not traced in tests)` : `\`${res.filePath}\``;
      md += `| ${fileText} | ${res.executableLines} | ${res.coveredLines} | ${coverageText} | ${statusIcon} |\n`;
    }

    md += `\n`;
    if (allPassed) {
      md += `**Overall Status**: ✅ **PASS**\n`;
    } else {
      md += `**Overall Status**: ❌ **FAIL** (One or more files have less than ${COVERAGE_THRESHOLD}% differential coverage. Please write additional tests for your changes.)\n`;
    }
  }

  // Write markdown and status files for CI steps to consume
  fs.writeFileSync('coverage-summary.md', md, 'utf8');
  fs.writeFileSync('coverage-status.txt', allPassed ? (results.length === 0 ? 'none' : 'pass') : 'fail', 'utf8');

  // Print summary to stdout for GitHub Action log output
  console.log('--- Coverage Guard Summary ---');
  console.log(md);
  console.log('------------------------------');
}

// Executed directly
const currentFilePath = fileURLToPath(import.meta.url);
const isDirectRun = process.argv[1] && (
  fs.realpathSync(process.argv[1]) === currentFilePath ||
  process.argv[1].endsWith('differential-coverage.mjs')
);

if (isDirectRun) {
  main();
}
