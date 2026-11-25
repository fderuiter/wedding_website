import fs from 'fs';
import path from 'path';
import childProcess from 'child_process';
import { fileURLToPath } from 'url';

const SCRIPT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function normalizePlaywrightViolations(rawData) {
  if (Array.isArray(rawData)) {
    return rawData;
  }
  if (rawData && typeof rawData === 'object') {
    const flattened = [];
    for (const [route, routeViolations] of Object.entries(rawData)) {
      if (Array.isArray(routeViolations)) {
        for (const violation of routeViolations) {
          flattened.push({
            ...violation,
            route: violation.route || route,
          });
        }
      }
    }
    return flattened;
  }
  return [];
}

export function generateReport(options = {}) {
  const cwd = options.cwd || process.cwd();
  const onlyStatic = Boolean(options.onlyStatic);
  const requireStatic = Boolean(options.requireStatic || onlyStatic);
  const requireComplete = Boolean(options.requireComplete);
  let totalViolations = 0;
  const incompleteSuites = [];
  const parseErrors = [];
  let report = '## Accessibility Health Summary\n\n';

  const jestFile = path.join(cwd, 'test-results', 'jest-a11y-violations.json');
  if (!onlyStatic || fs.existsSync(jestFile)) {
    report += '### Component Level (Jest)\n';
    if (fs.existsSync(jestFile)) {
      try {
        const jestViolations = JSON.parse(fs.readFileSync(jestFile, 'utf8'));
        if (!Array.isArray(jestViolations)) {
          throw new TypeError('Expected JSON array of Jest accessibility violations');
        }
        if (jestViolations.length === 0) {
          report += '✅ No accessibility violations found in components.\n\n';
        } else {
          totalViolations += jestViolations.length;
          report += `❌ Found ${jestViolations.length} violations in components.\n`;
          jestViolations.forEach((v) => {
            report += `- **${v.id}**: ${v.description} (${v.impact})\n`;
          });
          report += '\n';
        }
      } catch {
        incompleteSuites.push('jest');
        parseErrors.push('jest');
        report +=
          '⚠️ Incomplete: Jest accessibility artifact (`test-results/jest-a11y-violations.json`) could not be parsed.\n\n';
      }
    } else {
      incompleteSuites.push('jest');
      report +=
        '⚠️ Incomplete: Jest accessibility artifact (`test-results/jest-a11y-violations.json`) was not found.\n\n';
    }
  }

  const pwFile = path.join(cwd, 'test-results', 'playwright-a11y-violations.json');
  if (!onlyStatic || fs.existsSync(pwFile)) {
    report += '### Page Level (Playwright)\n';
    if (fs.existsSync(pwFile)) {
      try {
        const parsedPw = JSON.parse(fs.readFileSync(pwFile, 'utf8'));
        if (!parsedPw || typeof parsedPw !== 'object') {
          throw new TypeError('Expected JSON object or array of Playwright accessibility violations');
        }
        const pwViolations = normalizePlaywrightViolations(parsedPw);
        if (pwViolations.length === 0) {
          report += '✅ No accessibility violations found in pages.\n\n';
        } else {
          totalViolations += pwViolations.length;
          report += `❌ Found ${pwViolations.length} violations in pages.\n`;
          pwViolations.forEach((v) => {
            const routeLabel = v.route ? ` (\`${v.route}\`)` : '';
            report += `- **${v.id}**${routeLabel}: ${v.description} (${v.impact})\n`;
          });
          report += '\n';
        }
      } catch {
        incompleteSuites.push('playwright');
        parseErrors.push('playwright');
        report +=
          '⚠️ Incomplete: Playwright accessibility artifact (`test-results/playwright-a11y-violations.json`) could not be parsed.\n\n';
      }
    } else {
      incompleteSuites.push('playwright');
      report +=
        '⚠️ Incomplete: Playwright accessibility artifact (`test-results/playwright-a11y-violations.json`) was not found.\n\n';
    }
  }

  const staticFile = path.join(cwd, 'test-results', 'static-a11y-violations.json');
  if (fs.existsSync(staticFile) || requireStatic) {
    report += '### Static Showcase (Playwright Light & Dark)\n';
    if (fs.existsSync(staticFile)) {
      try {
        const parsedStatic = JSON.parse(fs.readFileSync(staticFile, 'utf8'));
        if (!parsedStatic || typeof parsedStatic !== 'object') {
          throw new TypeError('Expected JSON object or array of static showcase accessibility violations');
        }
        const scanCount = !Array.isArray(parsedStatic) ? Object.keys(parsedStatic).length : 0;
        const staticViolations = normalizePlaywrightViolations(parsedStatic);
        if (staticViolations.length === 0) {
          report +=
            scanCount > 0
              ? `✅ No accessibility violations found across ${scanCount} static showcase route/theme scans.\n\n`
              : '✅ No accessibility violations found in static showcase.\n\n';
        } else {
          totalViolations += staticViolations.length;
          report += `❌ Found ${staticViolations.length} violations in static showcase.\n`;
          staticViolations.forEach((v) => {
            const routeLabel = v.route ? ` (\`${v.route}\`)` : '';
            report += `- **${v.id}**${routeLabel}: ${v.description} (${v.impact})\n`;
          });
          report += '\n';
        }
      } catch {
        incompleteSuites.push('static-showcase');
        parseErrors.push('static-showcase');
        report +=
          '⚠️ Incomplete: Static showcase accessibility artifact (`test-results/static-a11y-violations.json`) could not be parsed.\n\n';
      }
    } else {
      incompleteSuites.push('static-showcase');
      report +=
        '⚠️ Incomplete: Static showcase accessibility artifact (`test-results/static-a11y-violations.json`) was not found.\n\n';
    }
  }

  if (incompleteSuites.length > 0) {
    report += `**Status:** Incomplete (${incompleteSuites.join(', ')} results missing)\n`;
  }
  report += `**Total Accessibility Violations:** ${totalViolations}\n`;
  const outputPath = path.join(cwd, 'test-results', 'a11y-summary.md');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report);
  console.log('Accessibility summary report generated at test-results/a11y-summary.md');

  return {
    report,
    totalViolations,
    incompleteSuites,
    parseErrors,
    requireComplete,
    outputPath,
  };
}

const DEFAULT_TEST_DATABASE_URL =
  'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';
const DEFAULT_TEST_ADMIN_PASSWORD =
  'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==';

function defaultRunStep(command, args, cwd, envOverrides) {
  const result = childProcess.spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
  });
  if (result.error) {
    return 1;
  }
  return typeof result.status === 'number' ? result.status : 1;
}

export function findJestAxeSuites(cwd = process.cwd()) {
  const candidateSrc = path.join(cwd, 'src');
  const searchRoot = fs.existsSync(candidateSrc) ? cwd : SCRIPT_REPO_ROOT;
  const srcDir = path.join(searchRoot, 'src');
  if (!fs.existsSync(srcDir)) {
    return [];
  }

  const suites = [];
  function walk(dir) {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (
        entry.isFile() &&
        /\.(?:test|spec)\.[jt]sx?$/.test(entry.name) &&
        !entry.name.endsWith('.skip.tsx')
      ) {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('jest-axe')) {
          suites.push(path.relative(searchRoot, fullPath).split(path.sep).join('/'));
        }
      }
    }
  }

  walk(srcDir);
  return suites.sort();
}

export function runA11yUnit(options = {}) {
  const cwd = options.cwd || process.cwd();
  const runStep = options.runStep || defaultRunStep;
  const suites = findJestAxeSuites(cwd);
  if (suites.length === 0) {
    return 1;
  }

  const resultsDir = path.join(cwd, 'test-results');
  fs.mkdirSync(resultsDir, { recursive: true });
  for (const entry of fs.readdirSync(resultsDir)) {
    if (entry.startsWith('.jest-a11y-violations.shard-')) {
      fs.rmSync(path.join(resultsDir, entry), { force: true });
    }
  }
  const jestFile = path.join(resultsDir, 'jest-a11y-violations.json');
  fs.writeFileSync(jestFile, '[]\n', 'utf8');

  const jestStatus = runStep(
    'npx',
    ['jest', '--runInBand', '--coverage=false', '--runTestsByPath', ...suites],
    cwd
  );
  if (fs.existsSync(resultsDir)) {
    for (const entry of fs.readdirSync(resultsDir)) {
      if (entry.startsWith('.jest-a11y-violations.shard-')) {
        fs.rmSync(path.join(resultsDir, entry), { force: true });
      }
    }
  }
  if (jestStatus !== 0) {
    return jestStatus;
  }

  if (fs.existsSync(jestFile)) {
    const recorded = JSON.parse(fs.readFileSync(jestFile, 'utf8'));
    if (Array.isArray(recorded) && recorded.length > 0) {
      return 1;
    }
  }

  return 0;
}

export function runA11yStatic(options = {}) {
  const cwd = options.cwd || process.cwd();
  const runStep = options.runStep || defaultRunStep;
  const basePath =
    options.basePath || process.env.NEXT_PUBLIC_BASE_PATH || '/wedding_website/demo';

  const outIndex = path.join(cwd, 'out', 'index.html');
  if (!fs.existsSync(outIndex) || options.forceBuildExport) {
    const buildStatus = runStep('npm', ['run', 'build:export'], cwd, {
      NEXT_PUBLIC_BASE_PATH: basePath,
    });
    if (buildStatus !== 0) {
      return buildStatus;
    }
  }

  const resultsDir = path.join(cwd, 'test-results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const staticFile = path.join(resultsDir, 'static-a11y-violations.json');
  fs.rmSync(staticFile, { force: true });
  for (const entry of fs.readdirSync(resultsDir)) {
    if (entry.startsWith('.static-a11y-shard-')) {
      fs.rmSync(path.join(resultsDir, entry), { force: true });
    }
  }

  const playwrightStatus = runStep(
    'npx',
    ['playwright', 'test', '-c', 'playwright.static.config.ts'],
    cwd,
    {
      NEXT_PUBLIC_BASE_PATH: basePath,
    }
  );
  if (fs.existsSync(resultsDir)) {
    for (const entry of fs.readdirSync(resultsDir)) {
      if (entry.startsWith('.static-a11y-shard-')) {
        fs.rmSync(path.join(resultsDir, entry), { force: true });
      }
    }
  }
  const { totalViolations } = generateReport({
    cwd,
    onlyStatic: true,
    requireStatic: true,
  });

  if (playwrightStatus !== 0) {
    return playwrightStatus;
  }
  if (totalViolations > 0) {
    return 1;
  }
  return 0;
}

export function runA11ySuite(options = {}) {
  const cwd = options.cwd || process.cwd();
  const runStep = options.runStep || defaultRunStep;

  fs.rmSync(path.join(cwd, 'test-results'), { recursive: true, force: true });

  const jestStatus = runA11yUnit({ cwd, runStep });
  const seedStatus = runStep('npx', ['tsx', 'scripts/seed.ts'], cwd, {
    DATABASE_URL: process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || DEFAULT_TEST_ADMIN_PASSWORD,
  });
  const playwrightStatus = runStep('npx', ['playwright', 'test', '--grep', '@a11y'], cwd);
  const { totalViolations } = generateReport({ cwd });

  if (jestStatus !== 0) {
    return jestStatus;
  }
  if (seedStatus !== 0) {
    return seedStatus;
  }
  if (playwrightStatus !== 0) {
    return playwrightStatus;
  }
  if (totalViolations > 0) {
    return 1;
  }
  return 0;
}

export function main(argv = process.argv.slice(2), options = {}) {
  if (argv.includes('--unit')) {
    const exitCode = runA11yUnit(options);
    process.exit(exitCode);
    return;
  }

  if (argv.includes('--static')) {
    const exitCode = runA11yStatic(options);
    process.exit(exitCode);
    return;
  }

  if (argv.includes('--run')) {
    const exitCode = runA11ySuite(options);
    process.exit(exitCode);
    return;
  }

  const requireComplete =
    Boolean(options.requireComplete) || argv.includes('--require-complete');
  const reportOptions = {
    ...options,
    ...(argv.includes('--include-static') ? { requireStatic: true } : {}),
    ...(requireComplete ? { requireComplete: true } : {}),
  };
  const { totalViolations, incompleteSuites, parseErrors } = generateReport(reportOptions);
  if (
    totalViolations > 0 ||
    parseErrors.length > 0 ||
    (requireComplete && incompleteSuites.length > 0)
  ) {
    process.exit(1);
    return;
  }
}

const isDirectCall =
  typeof process.argv[1] === 'string' &&
  process.argv[1].endsWith('a11y-report.mjs');

if (isDirectCall) {
  main();
}
