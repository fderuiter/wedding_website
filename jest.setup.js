// Optional: configure or set up a testing framework before each test
// if you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

import fs from 'node:fs';
import path from 'node:path';

// Strict Test Environment Isolation: Ignore parent shell environment variables during Jest test execution
(() => {
  const rootDir = process.cwd();
  const envPath = path.join(rootDir, '.env.test');
  const envTest = {};

  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          let val = match[2].trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          envTest[key] = val;
        }
      }
    } catch {
      // Ignore reading errors
    }
  }

  // Clear parent shell database variables
  const pgVars = ['DATABASE_URL', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGHOST', 'PGPORT', 'PGDATASOURCE'];
  for (const v of pgVars) {
    delete process.env[v];
  }

  // Load other environment variables from .env.test into process.env if they are not already set,
  // or overwrite them to ensure clean isolation
  for (const [key, value] of Object.entries(envTest)) {
    process.env[key] = value;
  }

  // Determine the isolated test database URL from dedicated test settings, or use safe fallback
  const testDbUrl = envTest.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';
  process.env.DATABASE_URL = testDbUrl;
})();

// Provide standard crypto mock in Jest test environments:
if (typeof global.crypto === 'undefined') {
  global.crypto = require('crypto');
}
if (typeof window !== 'undefined') {
  if (!window.crypto) {
    window.crypto = global.crypto;
  } else if (!window.crypto.randomUUID) {
    window.crypto.randomUUID = global.crypto.randomUUID;
  }
}
if (typeof self !== 'undefined') {
  if (!self.crypto) {
    self.crypto = global.crypto;
  } else if (!self.crypto.randomUUID) {
    self.crypto.randomUUID = global.crypto.randomUUID;
  }
}

// Used for __tests__/testing-library.js
// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);
import { server } from './src/mocks/server';

beforeAll(() => {
  if (process.env.LIVE_TESTS !== 'true') {
    server.listen();
  }
});
afterEach(() => {
  if (process.env.LIVE_TESTS !== 'true') {
    server.resetHandlers();
  }
});
afterAll(() => {
  if (process.env.LIVE_TESTS !== 'true') {
    server.close();
  }
});

const originalConsoleError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string') {
    if (
      args[0].includes('is using incorrect casing.') ||
      args[0].includes('is unrecognized in this browser.') ||
      args[0].includes('for a non-boolean attribute') ||
      args[0].includes('is not recognized in this browser')
    ) {
      return;
    }
  }
  originalConsoleError(...args);
};

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

jest.mock('next/server', () => {
  return {
    NextResponse: {
      json: jest.fn((body, init) => {
        const responseCookies = new Map();
        const headers = new Headers();

        const cookies = {
          set: jest.fn((key, value, options) => {
            responseCookies.set(key, { name: key, value });
            let cookieString = `${key}=${value}; Path=/`;
            if (options?.expires) {
              cookieString += `; Expires=${options.expires.toUTCString()}`;
            }
            if (options?.maxAge === 0) {
              cookieString += '; Max-Age=0';
            }
            headers.set('set-cookie', cookieString);
          }),
          get: jest.fn((key) => responseCookies.get(key)),
          delete: jest.fn((key) => responseCookies.delete(key)),
        };

        return {
          status: init?.status || 200,
          headers: headers,
          json: () => Promise.resolve(body),
          cookies: cookies,
        };
      }),
    },
    NextRequest: jest.fn((input, init) => {
      const requestCookies = new Map();
      if (init?.headers?.cookie) {
        init.headers.cookie.split(';').forEach(c => {
          const [key, value] = c.trim().split('=');
          requestCookies.set(key, { name: key, value });
        });
      }
      return {
        ...init,
        url: input,
        headers: {
          get: (key) => {
            if (key === 'cookie' && init?.headers) return init.headers.cookie;
            return null;
          }
        },
        cookies: {
          get: jest.fn((key) => requestCookies.get(key)),
          set: jest.fn(),
        },
        json: () => Promise.resolve(init && init.body ? JSON.parse(init.body) : {}),
      };
    }),
  };
});

jest.mock('@prisma/client', () => {
  const mockPrismaClient = {
    registryItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    contributor: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    media: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
    },
    snapshotVersion: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      upsert: jest.fn(),
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
    Prisma: {
      ModelName: {
        AppConfig: 'AppConfig',
        Media: 'Media',
        WeddingPartyMember: 'WeddingPartyMember',
        Attraction: 'Attraction',
        RegistryItem: 'RegistryItem',
        Contributor: 'Contributor',
        ContentNode: 'ContentNode',
        SnapshotVersion: 'SnapshotVersion'
      }
    }
  };
});

