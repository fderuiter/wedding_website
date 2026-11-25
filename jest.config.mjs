import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

const cliArgs = process.argv.slice(2);

const TARGETED_JEST_FLAGS = new Set([
  '--changedFilesWithAncestor',
  '--changedSince',
  '--findRelatedTests',
  '--ignoreProjects',
  '--lastCommit',
  '--onlyChanged',
  '--onlyFailures',
  '--projects',
  '--runTestsByPath',
  '--selectProjects',
  '--shard',
  '--testMatch',
  '--testNamePattern',
  '--testPathPattern',
  '--testPathPatterns',
  '--testRegex',
  '--watch',
  '--watchAll',
  '-f',
  '-o',
  '-t',
]);

const KNOWN_COVERAGE_REPORTERS = new Set([
  'clover',
  'cobertura',
  'html',
  'html-spa',
  'json',
  'json-summary',
  'lcov',
  'lcovonly',
  'none',
  'teamcity',
  'text',
  'text-lcov',
  'text-summary',
]);

const VALUE_CONSUMING_NON_TARGET_FLAGS = new Set([
  '--cacheDirectory',
  '--collectCoverageFrom',
  '--config',
  '--coverageDirectory',
  '--coveragePathIgnorePatterns',
  '--coverageProvider',
  '--coverageThreshold',
  '--env',
  '--filter',
  '--globalSetup',
  '--globalTeardown',
  '--globals',
  '--haste',
  '--maxConcurrency',
  '--maxWorkers',
  '--moduleDirectories',
  '--moduleFileExtensions',
  '--moduleNameMapper',
  '--modulePathIgnorePatterns',
  '--modulePaths',
  '--notifyMode',
  '--openHandlesTimeout',
  '--outputFile',
  '--preset',
  '--prettierPath',
  '--reporters',
  '--resolver',
  '--rootDir',
  '--roots',
  '--runner',
  '--seed',
  '--setupFiles',
  '--setupFilesAfterEnv',
  '--snapshotSerializers',
  '--testEnvironment',
  '--testEnvironmentOptions',
  '--testFailureExitCode',
  '--testPathIgnorePatterns',
  '--testResultsProcessor',
  '--testRunner',
  '--testSequencer',
  '--testTimeout',
  '--transform',
  '--transformIgnorePatterns',
  '--unmockedModulePathPatterns',
  '--watchPathIgnorePatterns',
  '--workerGracefulExitTimeout',
  '-c',
  '-w',
]);

/**
 * Detects CLI invocations that filter or shard Jest suites rather than running the full suite.
 * @param {readonly string[]} [args]
 * @returns {boolean}
 */
export function isTargetedJestRun(args = cliArgs) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === '--') {
      return args.slice(i + 1).some((restArg) => Boolean(restArg));
    }
    const eqIdx = arg.indexOf('=');
    const flagName = eqIdx === -1 ? arg : arg.slice(0, eqIdx);

    if (TARGETED_JEST_FLAGS.has(flagName)) {
      return true;
    }

    if (eqIdx === -1 && (flagName === '--bail' || flagName === '-b')) {
      const nextArg = args[i + 1];
      if (nextArg && /^\d+$/.test(nextArg)) {
        i += 1;
      }
      continue;
    }

    if (eqIdx === -1 && flagName === '--coverageReporters') {
      while (args[i + 1] && KNOWN_COVERAGE_REPORTERS.has(args[i + 1])) {
        i += 1;
      }
      continue;
    }

    if (eqIdx === -1 && VALUE_CONSUMING_NON_TARGET_FLAGS.has(flagName)) {
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith('-')) {
        i += 1;
      }
      continue;
    }

    if (!arg.startsWith('-')) {
      return true;
    }
  }
  return false;
}

/**
 * Determines whether coverage instrumentation is enabled for a Jest invocation.
 * @param {{ args?: readonly string[]; env?: NodeJS.ProcessEnv }} [options]
 * @returns {boolean}
 */
function resolveIsCoverageRun(options = {}) {
  const args = options.args ?? cliArgs;
  const env = options.env ?? process.env;
  const coverageDisabled = args.some(
    (arg) => arg === '--coverage=false' || arg === '--collectCoverage=false' || arg === '--no-coverage'
  );
  const coverageEnabled = args.some(
    (arg) =>
      arg === '--coverage' ||
      arg === '--collectCoverage' ||
      arg === '--coverage=true' ||
      arg === '--collectCoverage=true'
  );
  const event = env.npm_lifecycle_event || '';
  return (
    !coverageDisabled &&
    (event === 'test:cov' ||
      event === 'test:cov:html' ||
      env.COLLECT_COVERAGE === 'true' ||
      coverageEnabled)
  );
}

/**
 * Determines whether global coverage thresholds apply to a Jest invocation.
 * @param {{ args?: readonly string[]; env?: NodeJS.ProcessEnv }} [options]
 * @returns {boolean}
 */
export function shouldEnforceGlobalCoverageThreshold(options = {}) {
  const args = options.args ?? cliArgs;
  return resolveIsCoverageRun(options) && !isTargetedJestRun(args);
}

const hasCoverageDisableFlag = cliArgs.some(
  (arg) => arg === '--coverage=false' || arg === '--collectCoverage=false' || arg === '--no-coverage'
);
const lifecycleEvent = process.env.npm_lifecycle_event || '';
const isCoverageRun = resolveIsCoverageRun({ args: cliArgs, env: process.env });
const enforceGlobalCoverageThreshold = shouldEnforceGlobalCoverageThreshold({
  args: cliArgs,
  env: process.env,
});
const includeHtmlCoverage =
  lifecycleEvent === 'test:cov:html' ||
  process.env.COVERAGE_HTML === 'true' ||
  cliArgs.some((arg) => arg.includes('coverageReporters') && arg.includes('html'));

const resolvedTestTimeout = isCoverageRun ? 15000 : 10000;

const TRANSFORM_IGNORE_PATTERNS = [
  'node_modules/(?!.*(three|@react-three|@dimforge|archiver|is-stream|zip-stream|compress-commons|async|crc32-stream|readdir-glob|node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill|metascraper|metascraper-title|metascraper-description|metascraper-image|cheerio|ics|nanoid|node-html-parser|entities|msw|@msw|@mswjs|until-promise|until-async|@open-draft|strict-event-emitter|rettime|cookie|yaml|fontkit|linebreak|png-js|@noble/ciphers|@noble/hashes|brotli|dfa|restructure|unicode-properties|unicode-trie|tiny-inflate|clone))',
];

const NON_INTEGRATION_DB_SUITES = [
  'src/app/api/admin/__tests__/invitationCodesCatalogRoute.test.ts',
  'src/app/api/admin/__tests__/invitationCodesRsvpsRoute.test.ts',
  'src/app/api/admin/__tests__/subEventsRsvpSummaryRoute.test.ts',
  'src/features/registry/__tests__/ledgerAndShippingSettings.test.ts',
  'src/lib/sampleData/__tests__/sampleData.test.ts',
];

const JSDOM_TS_TEST_MATCH = [
  '<rootDir>/src/**/hooks/**/__tests__/**/*.ts',
  '<rootDir>/src/**/hooks/**/*.@(test|spec).ts',
  '<rootDir>/src/lib/demo/**/__tests__/**/*.ts',
  '<rootDir>/src/lib/demo/**/*.@(test|spec).ts',
  '<rootDir>/src/__tests__/generate-portal.test.ts',
  '<rootDir>/src/utils/__tests__/exportDownload.test.ts',
];

const toPathIgnoreRegex = (relPath) => `<rootDir>/${relPath}`.replace(/\./g, '\\.');

const DB_SERIAL_IGNORE_PATTERNS = [
  '\\.integration\\.(?:test|spec)\\.[mc]?[jt]sx?$',
  ...NON_INTEGRATION_DB_SUITES.map(toPathIgnoreRegex),
];

const JSDOM_TS_IGNORE_PATTERNS = [
  '<rootDir>/src/(?:.+/)?hooks/',
  '<rootDir>/src/lib/demo/',
  toPathIgnoreRegex('src/__tests__/generate-portal.test.ts'),
  toPathIgnoreRegex('src/utils/__tests__/exportDownload.test.ts'),
];

/** @type {import('jest').Config} */
const sharedProjectInput = {
  setupFiles: ['<rootDir>/jest.polyfills.js'],
  testTimeout: resolvedTestTimeout,
  moduleNameMapper: {
    '^@/components/(.*)$': '<rootDir>/src/components/$1',
    '^@/app/(.*)$': '<rootDir>/src/app/$1',
    '^@/lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@/utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@/features/(.*)$': '<rootDir>/src/features/$1',
    '^@/core/(.*)$': '<rootDir>/src/core/$1',
    '^@/hooks/(.*)$': '<rootDir>/src/hooks/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.next-export/', '<rootDir>/out/'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/.next-export/',
    '<rootDir>/out/',
    '<rootDir>/e2e/',
    '\\.skip\\.tsx$',
  ],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
const jestConfigPromise = (async () => {
  const baseProjectConfig = await createJestConfig(sharedProjectInput)();
  const sharedProjectBase = {
    ...baseProjectConfig,
    transformIgnorePatterns: TRANSFORM_IGNORE_PATTERNS,
  };
  const sharedIgnorePatterns = sharedProjectBase.testPathIgnorePatterns ?? [];

  /** @type {import('jest').Config} */
  const unitNodeProject = {
    ...sharedProjectBase,
    displayName: 'unit-node',
    testEnvironment: 'node',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    testMatch: [
      '<rootDir>/**/__tests__/**/*.?([mc])[jt]s',
      '<rootDir>/**/*.@(test|spec).?([mc])[jt]s',
    ],
    testPathIgnorePatterns: [
      ...sharedIgnorePatterns,
      ...DB_SERIAL_IGNORE_PATTERNS,
      ...JSDOM_TS_IGNORE_PATTERNS,
    ],
  };

  /** @type {import('jest').Config} */
  const unitJsdomProject = {
    ...sharedProjectBase,
    displayName: 'unit-jsdom',
    testEnvironment: '<rootDir>/jsdom-env.cjs',
    testEnvironmentOptions: { url: 'http://localhost/' },
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js', '<rootDir>/jest.setup.jsdom.js'],
    testMatch: [
      '<rootDir>/**/__tests__/**/*.tsx',
      '<rootDir>/**/*.@(test|spec).tsx',
      ...JSDOM_TS_TEST_MATCH,
    ],
    testPathIgnorePatterns: [...sharedIgnorePatterns, ...DB_SERIAL_IGNORE_PATTERNS],
  };

  /** @type {import('jest').Config} */
  const dbSerialProject = {
    ...sharedProjectBase,
    displayName: 'db-serial',
    testEnvironment: 'node',
    runner: '<rootDir>/jest-serial-runner.cjs',
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    testMatch: [
      '<rootDir>/**/*.integration.@(test|spec).?([mc])[jt]s?(x)',
      ...NON_INTEGRATION_DB_SUITES.map((relPath) => `<rootDir>/${relPath}`),
    ],
    testPathIgnorePatterns: sharedIgnorePatterns,
  };

  /** @type {import('jest').Config} */
  return {
    projects: [unitNodeProject, unitJsdomProject, dbSerialProject],
    reporters: ['default', '<rootDir>/jest-a11y-reporter.cjs'],
    testTimeout: resolvedTestTimeout,
    workerIdleMemoryLimit: '1024MB',
    collectCoverage: process.env.COLLECT_COVERAGE === 'true' && !hasCoverageDisableFlag,
    coverageDirectory: 'coverage',
    coverageReporters: includeHtmlCoverage
      ? ['json', 'lcov', 'text', 'clover', 'html']
      : ['text-summary', 'lcovonly'],
    collectCoverageFrom: [
      'src/**/*.{ts,tsx}',
      '!src/**/*.d.ts',
      '!src/**/layout.tsx',
      '!src/types/**/*.ts',
      '!src/**/__tests__/**',
      '!src/**/*.test.{ts,tsx}',
      '!src/**/*.spec.{ts,tsx}',
      '!**/node_modules/**',
      '!<rootDir>/jest.config.mjs',
      '!<rootDir>/jest.setup.js',
      '!<rootDir>/jest.setup.jsdom.js',
      '!<rootDir>/jest-serial-runner.cjs',
      '!<rootDir>/jest-a11y-reporter.cjs',
      '!<rootDir>/jsdom-env.cjs',
      '!<rootDir>/next.config.ts',
      '!<rootDir>/postcss.config.mjs',
      '!<rootDir>/eslint.config.mjs',
    ],
    ...(enforceGlobalCoverageThreshold
      ? {
        coverageThreshold: {
          global: {
            branches: 68,
            functions: 0,
            lines: 80,
            statements: 0,
          },
        },
      }
      : {}),
  };
})();

export default jestConfigPromise;
