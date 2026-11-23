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

// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const config = {
  // Add more setup options before each test is run
  setupFiles: ['<rootDir>/jest.polyfills.js'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: './jsdom-env.cjs',
  testEnvironmentOptions: { url: 'http://localhost/' },
  testTimeout: isCoverageRun ? 15000 : 10000,
  workerIdleMemoryLimit: '1024MB',
  collectCoverage: process.env.COLLECT_COVERAGE === 'true' && !hasCoverageDisableFlag,
  coverageDirectory: 'coverage',
  coverageReporters: includeHtmlCoverage
    ? ['json', 'lcov', 'text', 'clover', 'html']
    : ['text-summary', 'lcovonly'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}', // Collect coverage from all ts/tsx files in src
    '!src/**/*.d.ts', // Exclude type definition files
    '!src/**/layout.tsx', // Often layout files have minimal logic
    '!src/types/**/*.ts', // Exclude type definitions
    '!**/node_modules/**',
    '!<rootDir>/jest.config.mjs',
    '!<rootDir>/jest.setup.js',
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
  moduleNameMapper: {
    // Handle module aliases (if you have them in tsconfig.json)
    '^@/components/(.*)$': '<rootDir>/src/components/$1',
    '^@/app/(.*)$': '<rootDir>/src/app/$1',
    '^@/lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@/utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@/features/(.*)$': '<rootDir>/src/features/$1',
    '^@/core/(.*)$': '<rootDir>/src/core/$1',
    '^@/hooks/(.*)$': '<rootDir>/src/hooks/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/e2e/', '.skip.tsx$'],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default (async () => {
  const jestConfig = await createJestConfig(config)();
  return {
    ...jestConfig,
    transformIgnorePatterns: [
      'node_modules/(?!.*(three|@react-three|@dimforge|archiver|is-stream|zip-stream|compress-commons|async|crc32-stream|readdir-glob|node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill|metascraper|metascraper-title|metascraper-description|metascraper-image|cheerio|ics|nanoid|node-html-parser|entities|msw|@msw|@mswjs|until-promise|until-async|@open-draft|strict-event-emitter|rettime|cookie|yaml))',
    ],
  };
})();
