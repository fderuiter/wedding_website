import nextJest from 'next/jest.js';

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const config = {
  // Add more setup options before each test is run
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: './jsdom-env.cjs',
  testEnvironmentOptions: { url: 'http://localhost/' },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coveragePathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/e2e/'],
  coverageReporters: ['json', 'lcov', 'text', 'clover', 'html', 'json-summary'], // Added 'json-summary' for CI parsing
  collectCoverageFrom: [
    '<rootDir>/src/**/*.{ts,tsx}', // Collect coverage from all ts/tsx files in src
    '!<rootDir>/src/**/*.d.ts', // Exclude type definition files
    '!<rootDir>/src/**/layout.tsx', // Often layout files have minimal logic
    '!<rootDir>/src/types/**/*.ts', // Exclude type definitions
    '!<rootDir>/src/styles/**/*.ts', // Exclude style definitions
    '!**/node_modules/**',
    '!<rootDir>/jest.config.mjs',
    '!<rootDir>/jest.setup.js',
    '!<rootDir>/next.config.ts',
    '!<rootDir>/postcss.config.mjs',
    '!<rootDir>/eslint.config.mjs',
  ],
  coverageThreshold: {
    global: {
      branches: 45,
      functions: 45,
      lines: 55,
      statements: 55,
    },
    './src/': {
      branches: 60,
      functions: 60,
      lines: 72,
      statements: 72,
    },
    './src/core/': {
      branches: 60,
      functions: 60,
      lines: 70,
      statements: 70,
    },
    './src/features/': {
      branches: 60,
      functions: 60,
      lines: 70,
      statements: 70,
    },
    './src/app/api/admin/': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
    './src/components/ui/': {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
    './src/utils/': {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
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
    '^@/core/(.*)$': '<rootDir>/src/core/$1',
    '^@/hooks/(.*)$': '<rootDir>/src/hooks/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/', '<rootDir>/e2e/', '.skip.tsx$'],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default (async () => {
  const jestConfig = await createJestConfig(config)();
  return {
    ...jestConfig,
    transformIgnorePatterns: [
      '/node_modules/(?!(node-fetch|data-uri-to-buffer|fetch-blob|formdata-polyfill|metascraper|metascraper-title|metascraper-description|metascraper-image|cheerio|ics|nanoid|node-html-parser|entities)/.*)',
    ],
  };
})();
