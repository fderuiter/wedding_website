// Optional: configure or set up a testing framework before each test
// if you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

// Used for __tests__/testing-library.js
// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom'
import 'jest-fetch-mock/setupJest';

jest.mock('@vercel/analytics', () => ({
  track: jest.fn(),
}));

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
              cookieString += `; Max-Age=0`;
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
      }
    }),
  }
});

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
