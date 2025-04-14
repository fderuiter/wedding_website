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
  preset: 'ts-jest', // Use ts-jest preset
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
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
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
  },
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
