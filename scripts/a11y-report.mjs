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
  let totalViolations = 0;
  const incompleteSuites = [];
  let report = '## Accessibility Health Summary\n\n';

  const jestFile = path.join(cwd, 'test-results', 'jest-a11y-violations.json');
  report += '### Component Level (Jest)\n';
  if (fs.existsSync(jestFile)) {
    const jestViolations = JSON.parse(fs.readFileSync(jestFile, 'utf8'));
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
  } else {
    incompleteSuites.push('jest');
    report +=
      '⚠️ Incomplete: Jest accessibility artifact (`test-results/jest-a11y-violations.json`) was not found.\n\n';
  }

  const pwFile = path.join(cwd, 'test-results', 'playwright-a11y-violations.json');
  report += '### Page Level (Playwright)\n';
  if (fs.existsSync(pwFile)) {
    const parsedPw = JSON.parse(fs.readFileSync(pwFile, 'utf8'));
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
  } else {
    incompleteSuites.push('playwright');
    report +=
      '⚠️ Incomplete: Playwright accessibility artifact (`test-results/playwright-a11y-violations.json`) was not found.\n\n';
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
  const jestFile = path.join(resultsDir, 'jest-a11y-violations.json');
  fs.writeFileSync(jestFile, '[]\n', 'utf8');

  const jestStatus = runStep(
    'npx',
    ['jest', '--runInBand', '--coverage=false', '--runTestsByPath', ...suites],
    cwd
  );
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

export function runA11ySuite(options = {}) {
  const cwd = options.cwd || process.cwd();
  const runStep = options.runStep || defaultRunStep;
  const dbEnv = {
    DATABASE_URL: process.env.DATABASE_URL || DEFAULT_TEST_DATABASE_URL,
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || DEFAULT_TEST_ADMIN_PASSWORD,
  };

  fs.rmSync(path.join(cwd, 'test-results'), { recursive: true, force: true });

  const jestStatus = runA11yUnit({ cwd, runStep });
  const composeStatus = runStep(
    'docker',
    [
      'compose',
      '--env-file',
      '.env.ci',
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.ci.yml',
      'up',
      '-d',
      '--wait',
      'db',
    ],
    cwd
  );
  const dbPushStatus = runStep(
    'npx',
    ['prisma', 'db', 'push', '--accept-data-loss'],
    cwd,
    dbEnv
  );
  const seedStatus = runStep('npx', ['tsx', 'scripts/seed.ts'], cwd, dbEnv);
  const playwrightStatus = runStep('npx', ['playwright', 'test', '--grep', '@a11y'], cwd);
  const { totalViolations } = generateReport({ cwd });

  if (jestStatus !== 0) {
    return jestStatus;
  }
  if (composeStatus !== 0) {
    return composeStatus;
  }
  if (dbPushStatus !== 0) {
    return dbPushStatus;
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

  if (argv.includes('--run')) {
    const exitCode = runA11ySuite(options);
    process.exit(exitCode);
    return;
  }

  const { totalViolations } = generateReport(options);
  if (totalViolations > 0) {
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
