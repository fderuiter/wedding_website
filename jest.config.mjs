import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
})

// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const config = {
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['json', 'lcov', 'text', 'clover', 'html'], // Added 'html' for detailed report
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}', // Collect coverage from all ts/tsx files in src
    '!src/**/*.d.ts', // Exclude type definition files
    '!src/**/layout.tsx', // Often layout files have minimal logic
    '!src/**/route.ts', // API routes might need different testing strategies (integration)
    '!src/types/**/*.ts', // Exclude type definitions
    '!src/styles/**/*.ts', // Exclude style definitions
    '!**/node_modules/**',
    '!<rootDir>/jest.config.mjs',
    '!<rootDir>/jest.setup.js',
    '!<rootDir>/next.config.ts',
    '!<rootDir>/postcss.config.mjs',
    '!<rootDir>/eslint.config.mjs',
  ],
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0,
    },
  },
  moduleNameMapper: {
    // Handle module aliases (if you have them in tsconfig.json)
    '^@/components/(.*)$': '<rootDir>/src/components/$1',
    '^@/pages/(.*)$': '<rootDir>/src/pages/$1',
    '^@/styles/(.*)$': '<rootDir>/src/styles/$1',
    '^@/types/(.*)$': '<rootDir>/src/types/$1',
    '^@/data/(.*)$': '<rootDir>/src/data/$1',
    '^@/app/(.*)$': '<rootDir>/src/app/$1',
    '^@/lib/(.*)$': '<rootDir>/src/lib/$1',
    '^@/utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@/features/(.*)$': '<rootDir>/src/features/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/e2e/', '.skip.tsx$'],
  transformIgnorePatterns: [
    '/node_modules/(?!(node-fetch|cheerio|metascraper|metascraper-description|metascraper-image|metascraper-title|@vercel/analytics)/.*)',
  ],
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default (async () => {
  const jestConfig = await createJestConfig(config)();
  // Add the packages that need to be transformed here
  jestConfig.transformIgnorePatterns = [
    '/node_modules/(?!(node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill|metascraper|metascraper-title|metascraper-description|metascraper-image|cheerio|@vercel/analytics)/.*)',
  ];
  return jestConfig;
})();
