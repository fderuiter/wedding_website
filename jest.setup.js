// Optional: configure or set up a testing framework before each test
// if you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

import fs from 'node:fs';
import path from 'node:path';

// Strict Test Environment Isolation: Ignore parent shell environment variables during Jest test execution
(() => {
  const rootDir = process.cwd();
  const envPath = path.join(rootDir, '.env.test');
  const parentDbUrl = process.env.DATABASE_URL;
  const parentIsSqlite = parentDbUrl && (parentDbUrl.startsWith('file:') || parentDbUrl.startsWith('sqlite:') || parentDbUrl.includes('.db'));

  // Clear parent shell database variables and other isolated test variables to ensure clean isolation
  const pgVars = ['DATABASE_URL', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGHOST', 'PGPORT', 'PGDATASOURCE', 'ADMIN_PASSWORD'];
  for (const v of pgVars) {
    delete process.env[v];
  }

  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Ignore reading errors
    }
  }

  // Determine the isolated test database URL from dedicated test settings, or use safe fallback
  let testDbUrl = process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';
  const schemaPath = path.join(rootDir, 'prisma/schema.prisma');
  let isSchemaSqlite = false;
  if (fs.existsSync(schemaPath)) {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    isSchemaSqlite = schemaContent.includes('provider = "sqlite"');
  }

  if (isSchemaSqlite) {
    testDbUrl = 'file:./test.db';
  } else if (parentIsSqlite) {
    testDbUrl = parentDbUrl;
  }

  process.env.DATABASE_URL = testDbUrl;
})();

// Provide standard crypto mock in Jest test environments:
const nodeCrypto = require('node:crypto');
if (typeof globalThis !== 'undefined') {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    globalThis.crypto = nodeCrypto.webcrypto;
  }
}
if (typeof global !== 'undefined') {
  if (!global.crypto || !global.crypto.subtle) {
    global.crypto = nodeCrypto.webcrypto;
  }
}
if (typeof window !== 'undefined') {
  if (!window.crypto || !window.crypto.subtle) {
    Object.defineProperty(window, 'crypto', {
      value: nodeCrypto.webcrypto,
      writable: true,
      configurable: true,
    });
  }
}
if (typeof self !== 'undefined') {
  if (!self.crypto || !self.crypto.subtle) {
    Object.defineProperty(self, 'crypto', {
      value: nodeCrypto.webcrypto,
      writable: true,
      configurable: true,
    });
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
      next: jest.fn(() => ({
        status: 200,
        headers: new Headers(),
      })),
      redirect: jest.fn((url, init) => {
        const headers = new Headers();
        headers.set('location', url.toString());
        return {
          status: init?.status || 307,
          headers,
        };
      }),
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
      const urlObj = new URL(input);
      return {
        ...init,
        url: input,
        nextUrl: urlObj,
        headers: {
          get: (key) => {
            if (!init?.headers) {
              if (key.toLowerCase() === 'host') return urlObj.host;
              return null;
            }
            const lKey = key.toLowerCase();
            const foundKey = Object.keys(init.headers).find(k => k.toLowerCase() === lKey);
            if (foundKey) return init.headers[foundKey];
            if (lKey === 'host') return urlObj.host;
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
    $use: jest.fn(),
    $extends: jest.fn().mockImplementation(() => mockPrismaClient),
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

