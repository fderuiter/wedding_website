// Optional: configure or set up a testing framework before each test
// if you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

// Used for __tests__/testing-library.js
// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'
import 'jest-fetch-mock/setupJest';

jest.mock('@vercel/analytics', () => ({
  track: jest.fn(),
}));

jest.mock('@prisma/client', () => {
  const mockPrismaClient = {
    registryItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    contributor: {
      // Mock contributor methods if needed
    },
    $transaction: jest.fn().mockImplementation(async (callback) => {
      const mockTx = {
        registryItem: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
      };
      return await callback(mockTx);
    }),
    $disconnect: jest.fn(),
  };
  return {
    PrismaClient: jest.fn(() => mockPrismaClient),
  };
});
