import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

const cliArgs = process.argv.slice(2);
const hasCoverageDisableFlag = cliArgs.some(
  (arg) => arg === '--coverage=false' || arg === '--collectCoverage=false' || arg === '--no-coverage'
);
const hasCoverageEnableFlag = cliArgs.some(
  (arg) =>
    arg === '--coverage' ||
    arg === '--collectCoverage' ||
    arg === '--coverage=true' ||
    arg === '--collectCoverage=true'
);
const lifecycleEvent = process.env.npm_lifecycle_event || '';
const isCoverageRun =
  !hasCoverageDisableFlag &&
  (lifecycleEvent === 'test:cov' ||
    lifecycleEvent === 'test:cov:html' ||
    process.env.COLLECT_COVERAGE === 'true' ||
    hasCoverageEnableFlag);
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
export default (async () => {
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
    ...(isCoverageRun
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
