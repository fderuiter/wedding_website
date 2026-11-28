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

function isPlainViolationRecord(item) {
  return Boolean(item) && typeof item === 'object' && !Array.isArray(item);
}

function normalizeSingleLineField(value) {
  return String(value ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function escapeViolationMarkdown(value) {
  return normalizeSingleLineField(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/([`[\]()!*_~])/g, '\\$1');
}

function escapeViolationRoute(value) {
  return normalizeSingleLineField(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/`/g, '&#96;')
    .replace(/!\[/g, '\\!\\[')
    .replace(/\]\[/g, '\\]\\[')
    .replace(/\](?=\()/g, '\\]')
    .replace(/([()])/g, '\\$1');
}

function parseJestViolations(rawData) {
  if (!Array.isArray(rawData) || !rawData.every(isPlainViolationRecord)) {
    throw new TypeError('Expected JSON array of Jest accessibility violation objects');
  }
  return { violations: rawData, scanCount: 0 };
}

function parseRouteOrArrayViolations(rawData, label) {
  if (!rawData || typeof rawData !== 'object') {
    throw new TypeError(`Expected JSON object or array of ${label} accessibility violations`);
  }
  if (Array.isArray(rawData)) {
    if (!rawData.every(isPlainViolationRecord)) {
      throw new TypeError(`Expected JSON array of ${label} accessibility violation objects`);
    }
    return { violations: normalizePlaywrightViolations(rawData), scanCount: 0 };
  }
  const entries = Object.values(rawData);
  if (
    !entries.every(
      (routeItems) => Array.isArray(routeItems) && routeItems.every(isPlainViolationRecord)
    )
  ) {
    throw new TypeError(`Expected route-keyed arrays of ${label} accessibility violation objects`);
  }
  return {
    violations: normalizePlaywrightViolations(rawData),
    scanCount: Object.keys(rawData).length,
  };
}

const SUITE_ARTIFACT_SPECS = [
  {
    id: 'jest',
    heading: '### Component Level (Jest)\n',
    relativePath: 'test-results/jest-a11y-violations.json',
    label: 'Jest',
    includeRouteLabel: false,
    shouldInclude: ({ exists, onlyStatic, onlyStorybook }) =>
      (!onlyStatic && !onlyStorybook) || exists,
    parse: (rawData) => parseJestViolations(rawData),
    formatClean: () => '✅ No accessibility violations found in components.\n\n',
    formatViolationHeader: (count) => `❌ Found ${count} violations in components.\n`,
  },
  {
    id: 'playwright',
    heading: '### Page Level (Playwright)\n',
    relativePath: 'test-results/playwright-a11y-violations.json',
    label: 'Playwright',
    includeRouteLabel: true,
    shouldInclude: ({ exists, onlyStatic, onlyStorybook }) =>
      (!onlyStatic && !onlyStorybook) || exists,
    parse: (rawData) => parseRouteOrArrayViolations(rawData, 'Playwright'),
    formatClean: () => '✅ No accessibility violations found in pages.\n\n',
    formatViolationHeader: (count) => `❌ Found ${count} violations in pages.\n`,
  },
  {
    id: 'static-showcase',
    heading: '### Static Showcase (Playwright Light & Dark)\n',
    relativePath: 'test-results/static-a11y-violations.json',
    label: 'Static showcase',
    includeRouteLabel: true,
    shouldInclude: ({ exists, requireStatic, onlyStorybook }) =>
      (!onlyStorybook && exists) || requireStatic,
    parse: (rawData) => parseRouteOrArrayViolations(rawData, 'static showcase'),
    formatClean: (scanCount) =>
      scanCount > 0
        ? `✅ No accessibility violations found across ${scanCount} static showcase route/theme scans.\n\n`
        : '✅ No accessibility violations found in static showcase.\n\n',
    formatViolationHeader: (count) => `❌ Found ${count} violations in static showcase.\n`,
  },
  {
    id: 'storybook-showcase',
    heading: '### Storybook Showcase (Playwright Light & Dark)\n',
    relativePath: 'test-results/storybook-a11y-violations.json',
    label: 'Storybook showcase',
    includeRouteLabel: true,
    shouldInclude: ({ exists, requireStorybook, onlyStatic }) =>
      (!onlyStatic && exists) || requireStorybook,
    parse: (rawData) => parseRouteOrArrayViolations(rawData, 'Storybook showcase'),
    formatClean: (scanCount) =>
      scanCount > 0
        ? `✅ No accessibility violations found across ${scanCount} Storybook story/theme scans.\n\n`
        : '✅ No accessibility violations found in Storybook showcase.\n\n',
    formatViolationHeader: (count) => `❌ Found ${count} violations in storybook showcase.\n`,
  },
];

export function generateReport(options = {}) {
  const cwd = options.cwd || process.cwd();
  const onlyStatic = Boolean(options.onlyStatic);
  const onlyStorybook = Boolean(options.onlyStorybook);
  const requireStatic = Boolean(options.requireStatic || onlyStatic);
  const requireStorybook = Boolean(options.requireStorybook || onlyStorybook);
  const requireComplete = Boolean(options.requireComplete);
  let totalViolations = 0;
  const incompleteSuites = [];
  const parseErrors = [];
  let report = '## Accessibility Health Summary\n\n';

  for (const spec of SUITE_ARTIFACT_SPECS) {
    const artifactPath = path.join(cwd, ...spec.relativePath.split('/'));
    const exists = fs.existsSync(artifactPath);
    if (
      !spec.shouldInclude({
        exists,
        onlyStatic,
        requireStatic,
        onlyStorybook,
        requireStorybook,
      })
    ) {
      continue;
    }

    report += spec.heading;
    if (!exists) {
      incompleteSuites.push(spec.id);
      report += `⚠️ Incomplete: ${spec.label} accessibility artifact (\`${spec.relativePath}\`) was not found.\n\n`;
      continue;
    }

    try {
      const rawJson = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
      const { violations, scanCount } = spec.parse(rawJson);
      if (violations.length === 0) {
        report += spec.formatClean(scanCount);
      } else {
        totalViolations += violations.length;
        report += spec.formatViolationHeader(violations.length);
        for (const v of violations) {
          const safeId = escapeViolationMarkdown(v.id);
          const safeDescription = escapeViolationMarkdown(v.description);
          const safeImpact = escapeViolationMarkdown(v.impact);
          const routeLabel =
            spec.includeRouteLabel && v.route ? ` (\`${escapeViolationRoute(v.route)}\`)` : '';
          report += `- **${safeId}**${routeLabel}: ${safeDescription} (${safeImpact})\n`;
        }
        report += '\n';
      }
    } catch {
      incompleteSuites.push(spec.id);
      parseErrors.push(spec.id);
      report += `⚠️ Incomplete: ${spec.label} accessibility artifact (\`${spec.relativePath}\`) could not be parsed.\n\n`;
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
    try {
      const recorded = JSON.parse(fs.readFileSync(jestFile, 'utf8'));
      if (!Array.isArray(recorded) || recorded.length > 0) {
        return 1;
      }
    } catch {
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
  const { totalViolations, parseErrors } = generateReport({
    cwd,
    onlyStatic: true,
    requireStatic: true,
  });

  if (playwrightStatus !== 0) {
    return playwrightStatus;
  }
  if (totalViolations > 0 || parseErrors.length > 0) {
    return 1;
  }
  return 0;
}

export function runA11yStorybook(options = {}) {
  const cwd = options.cwd || process.cwd();
  const runStep = options.runStep || defaultRunStep;
  const basePath =
    options.basePath || process.env.NEXT_PUBLIC_BASE_PATH || '/wedding_website/storybook';

  const storybookIndex = path.join(cwd, 'storybook-static', 'index.html');
  if (!fs.existsSync(storybookIndex) || options.forceBuildStorybook) {
    const buildStatus = runStep('npm', ['run', 'build-storybook'], cwd, {
      NEXT_PUBLIC_BASE_PATH: basePath,
    });
    if (buildStatus !== 0) {
      return buildStatus;
    }
  }

  const resultsDir = path.join(cwd, 'test-results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const storybookFile = path.join(resultsDir, 'storybook-a11y-violations.json');
  fs.rmSync(storybookFile, { force: true });
  for (const entry of fs.readdirSync(resultsDir)) {
    if (entry.startsWith('.storybook-a11y-shard-')) {
      fs.rmSync(path.join(resultsDir, entry), { force: true });
    }
  }

  const playwrightStatus = runStep(
    'npx',
    ['playwright', 'test', '-c', 'playwright.storybook.config.ts'],
    cwd,
    {
      NEXT_PUBLIC_BASE_PATH: basePath,
    }
  );
  if (fs.existsSync(resultsDir)) {
    for (const entry of fs.readdirSync(resultsDir)) {
      if (entry.startsWith('.storybook-a11y-shard-')) {
        fs.rmSync(path.join(resultsDir, entry), { force: true });
      }
    }
  }
  const { totalViolations, parseErrors } = generateReport({
    cwd,
    onlyStorybook: true,
    requireStorybook: true,
  });

  if (playwrightStatus !== 0) {
    return playwrightStatus;
  }
  if (totalViolations > 0 || parseErrors.length > 0) {
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
  const { totalViolations, parseErrors } = generateReport({ cwd });

  if (jestStatus !== 0) {
    return jestStatus;
  }
  if (seedStatus !== 0) {
    return seedStatus;
  }
  if (playwrightStatus !== 0) {
    return playwrightStatus;
  }
  if (totalViolations > 0 || parseErrors.length > 0) {
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

  if (argv.includes('--storybook')) {
    const exitCode = runA11yStorybook(options);
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
    ...(argv.includes('--include-storybook') ? { requireStorybook: true } : {}),
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
