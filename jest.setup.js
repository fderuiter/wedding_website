// Optional: configure or set up a testing framework before each test
// if you delete this file, remove `setupFilesAfterEnv` from `jest.config.js`

import fs from 'node:fs';
import path from 'node:path';
import moduleModule from 'node:module';
import { pathToFileURL } from 'node:url';
import nodeCrypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { MessagePort } from 'node:worker_threads';

if (typeof globalThis.MessagePort === 'undefined') {
  globalThis.MessagePort = MessagePort;
}

// Polyfill Promise.withResolvers for MSW interceptors in Jest VM
if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function () {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

// Patch module.createRequire to prevent JSDOM import.meta.url ('http://localhost/...') from crashing Node's createRequire
const origCreateRequire = moduleModule.createRequire;
moduleModule.createRequire = function (filename) {
  const href =
    filename instanceof URL
      ? filename.href
      : typeof filename === 'string'
        ? filename
        : null;
  if (href && (href.startsWith('http:') || href.startsWith('https:'))) {
    const parsed = new URL(href);
    if (parsed.pathname === '/pdfkit.js' || parsed.pathname.endsWith('/pdfkit.js')) {
      filename = pathToFileURL(path.join(process.cwd(), 'node_modules', 'pdfkit', 'js', 'pdfkit.js')).href;
    } else {
      const relPath = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
      const resolvedPath =
        !relPath || relPath.endsWith('/')
          ? path.resolve(process.cwd(), relPath, 'index.js')
          : path.resolve(process.cwd(), relPath);
      filename = pathToFileURL(resolvedPath).href;
    }
  }
  return origCreateRequire.call(this, filename);
};

// Strict Test Environment Isolation: Ignore parent shell environment variables during Jest test execution
(() => {
  const rootDir = process.cwd();
  const envPath = path.join(rootDir, '.env.test');

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
  const testDbUrl = process.env.DATABASE_URL || 'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';

  process.env.DATABASE_URL = testDbUrl;
})();

// Provide standard crypto mock in Jest test environments:
const testRequestStore = new AsyncLocalStorage();
const globalFallbackStore = new Map();
globalThis.globalFallbackStore = globalFallbackStore;

function createCacheNode() {
  return { o: new WeakMap(), p: new Map(), v: undefined, h: false };
}

jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    cache: (fn) => {
      return function (...args) {
        const store = testRequestStore.getStore() || globalFallbackStore;
        let fnMap = store.get(fn);
        if (!fnMap) {
          fnMap = createCacheNode();
          store.set(fn, fnMap);
        }
        let node = fnMap;
        for (const arg of args) {
          const isObj = (typeof arg === 'object' && arg !== null) || typeof arg === 'function';
          const map = isObj ? node.o : node.p;
          let next = map.get(arg);
          if (!next) {
            next = createCacheNode();
            map.set(arg, next);
          }
          node = next;
        }
        if (node.h) return node.v;
        const res = fn.apply(this, args);
        node.v = res;
        node.h = true;
        return res;
      };
    },
  };
});
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

jest.mock('msw', () => {
  const actual = jest.requireActual('msw');
  const createCtx = () => ({
    status: (code) => ({ type: 'status', value: code }),
    json: (body) => ({ type: 'json', value: body }),
    body: (text) => ({ type: 'body', value: text }),
    set: (name, val) => ({ type: 'header', name, value: val }),
  });
  const buildRes = (...args) => {
    let status = 200;
    let body = null;
    const headers = new Headers();
    for (const arg of args) {
      if (!arg) continue;
      if (arg.type === 'status') status = arg.value;
      else if (arg.type === 'json') {
        body = JSON.stringify(arg.value);
        headers.set('Content-Type', 'application/json');
      } else if (arg.type === 'body') {
        body = arg.value;
      } else if (arg.type === 'header') {
        headers.set(arg.name, arg.value);
      }
    }
    return new actual.HttpResponse(body, { status, headers });
  };
  buildRes.networkError = () => actual.HttpResponse.error();

  const makeHandler = (method) => (url, resolver) => {
    return actual.http[method](url, async (info) => {
      const ctx = createCtx();
      return resolver(info.request, buildRes, ctx);
    });
  };

  return {
    ...actual,
    rest: {
      get: makeHandler('get'),
      post: makeHandler('post'),
      put: makeHandler('put'),
      delete: makeHandler('delete'),
      patch: makeHandler('patch'),
    },
  };
});

jest.mock('jest-axe', () => {
  const actual = jest.requireActual('jest-axe');
  const nodeFs = jest.requireActual('node:fs');
  const nodePath = jest.requireActual('node:path');

  const appendJestViolations = (violations) => {
    if (!Array.isArray(violations) || violations.length === 0) {
      return;
    }
    const reportFile =
      process.env.JEST_A11Y_REPORT_PATH ||
      nodePath.join(process.cwd(), 'test-results', 'jest-a11y-violations.json');
    try {
      nodeFs.mkdirSync(nodePath.dirname(reportFile), { recursive: true });
      let existing = [];
      if (nodeFs.existsSync(reportFile)) {
        const raw = nodeFs.readFileSync(reportFile, 'utf8').trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            existing = parsed;
          }
        }
      }
      nodeFs.writeFileSync(
        reportFile,
        JSON.stringify([...existing, ...violations], null, 2),
        'utf8'
      );
    } catch {
      // Preserve matcher behavior even if filesystem write fails
    }
  };

  const wrappedToHaveNoViolations = {
    toHaveNoViolations(results) {
      const outcome = actual.toHaveNoViolations.toHaveNoViolations.call(this, results);
      if (!this?.isNot && Array.isArray(outcome?.actual) && outcome.actual.length > 0) {
        appendJestViolations(outcome.actual);
      }
      return outcome;
    },
  };

  return {
    ...actual,
    toHaveNoViolations: wrappedToHaveNoViolations,
  };
});

// Used for __tests__/testing-library.js
// Learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);
import { server } from './src/mocks/server';

beforeAll(() => {
  if (process.env.LIVE_TESTS !== 'true') {
    server.listen();
    if (typeof globalThis.fetch === 'function') {
      const mswFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        if (init && typeof init === 'object' && 'dispatcher' in init) {
          const { dispatcher: _dispatcher, ...restInit } = init;
          return mswFetch(input, restInit);
        }
        return mswFetch(input, init);
      };
    }
  }
});
let cachedRateLimitModule = null;
afterEach(async () => {
  globalFallbackStore.clear();
  if (process.env.LIVE_TESTS !== 'true') {
    server.resetHandlers();
  }
  if (typeof cachedRateLimitModule?.resetRateLimitsForTesting === 'function') {
    cachedRateLimitModule.resetRateLimitsForTesting();
  }
  try {
    const rateLimitModule = await import('@/utils/rateLimit');
    if (!cachedRateLimitModule) {
      cachedRateLimitModule = rateLimitModule;
    }
    if (
      rateLimitModule !== cachedRateLimitModule &&
      typeof rateLimitModule?.resetRateLimitsForTesting === 'function'
    ) {
      rateLimitModule.resetRateLimitsForTesting();
    }
  } catch {
    // Ignore when @/utils/rateLimit is unavailable in isolated module registries
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

// Mock HTMLCanvasElement getContext for JSDOM
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = jest.fn().mockReturnValue({
    fillRect: jest.fn(),
    clearRect: jest.fn(),
    getImageData: jest.fn(() => ({ data: new Array(4) })),
    putImageData: jest.fn(),
    createImageData: jest.fn(() => []),
    setTransform: jest.fn(),
    drawImage: jest.fn(),
    save: jest.fn(),
    fillText: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    clip: jest.fn(),
    arc: jest.fn(),
    stroke: jest.fn(),
    fill: jest.fn(),
    measureText: jest.fn(() => ({ width: 0 })),
    transform: jest.fn(),
    rect: jest.fn(),
    scale: jest.fn(),
  });
}

jest.mock('next/server', () => {
  class MockNextResponse {
    static next = jest.fn(() => ({
      status: 200,
      headers: new Headers(),
    }));
    static redirect = jest.fn((url, init) => {
      const headers = new Headers();
      headers.set('location', url.toString());
      return {
        status: init?.status || 307,
        headers,
      };
    });
    static json = jest.fn((body, init) => {
      const responseCookies = new Map();
      const headers = new Headers();
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => headers.set(k, v));
        } else if (typeof init.headers === 'object') {
          Object.entries(init.headers).forEach(([k, v]) => {
            headers.set(k, v);
          });
        }
      }

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
          headers.append('set-cookie', cookieString);
        }),
        get: jest.fn((key) => responseCookies.get(key)),
        getAll: jest.fn(() => Array.from(responseCookies.values())),
        delete: jest.fn((key) => responseCookies.delete(key)),
      };

      return {
        status: init?.status || 200,
        headers: headers,
        json: () => Promise.resolve(body),
        cookies: cookies,
      };
    });

    constructor(body, init) {
      this.bodyContent = body;
      this.status = init?.status || 200;
      this.headers = new Headers();
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => this.headers.set(k, v));
        } else if (typeof init.headers === 'object') {
          Object.entries(init.headers).forEach(([k, v]) => {
            this.headers.set(k, v);
          });
        }
      }
    }

    json() {
      return Promise.resolve(typeof this.bodyContent === 'string' ? JSON.parse(this.bodyContent) : this.bodyContent);
    }

    async text() {
      if (this.bodyContent === null || this.bodyContent === undefined) {
        return '';
      }
      if (this.bodyContent && typeof this.bodyContent.getReader === 'function') {
        const ab = await this.arrayBuffer();
        return Buffer.from(ab).toString('utf-8');
      }
      if (Buffer.isBuffer(this.bodyContent) || this.bodyContent instanceof Uint8Array) {
        return Buffer.from(this.bodyContent).toString('utf-8');
      }
      return typeof this.bodyContent === 'string' ? this.bodyContent : JSON.stringify(this.bodyContent);
    }

    async arrayBuffer() {
      if (this.bodyContent === null || this.bodyContent === undefined) {
        return new ArrayBuffer(0);
      }
      if (this.bodyContent && typeof this.bodyContent.getReader === 'function') {
        const reader = this.bodyContent.getReader();
        const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(Buffer.from(value));
        }
        const combined = Buffer.concat(chunks);
        return combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength);
      }
      if (Buffer.isBuffer(this.bodyContent) || this.bodyContent instanceof Uint8Array) {
        const buf = Buffer.from(this.bodyContent);
        return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      }
      const buf = Buffer.from(typeof this.bodyContent === 'string' ? this.bodyContent : JSON.stringify(this.bodyContent));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  }

  const buildMockNextRequest = (input, init, clonedState) => {
    const isRequestLike =
      typeof input === 'object' &&
      input !== null &&
      !(input instanceof URL) &&
      typeof input.url === 'string';
    const rawUrl =
      input instanceof URL
        ? input.toString()
        : isRequestLike
          ? input.url
          : String(input);
    const urlObj = new URL(rawUrl, 'http://localhost');
    const resolvedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : urlObj.toString();
    const method = String(
      init?.method || (isRequestLike && input.method ? input.method : 'GET')
    ).toUpperCase();

    const headers = new Headers();
    const invalidHeaders = new Map(clonedState?.invalidHeaders || []);
    const setHeaderSafe = (key, value, append = false) => {
      if (value === undefined || value === null) return;
      const strKey = String(key);
      const strVal = String(value);
      try {
        if (append) {
          headers.append(strKey, strVal);
        } else {
          headers.set(strKey, strVal);
        }
      } catch {
        invalidHeaders.set(strKey.toLowerCase(), strVal);
      }
    };

    const sourceHeaders = init?.headers ?? (isRequestLike ? input.headers : undefined);
    if (Array.isArray(sourceHeaders)) {
      sourceHeaders.forEach((tuple) => {
        if (Array.isArray(tuple) && tuple.length >= 2) {
          setHeaderSafe(tuple[0], tuple[1], true);
        }
      });
    } else if (sourceHeaders && typeof sourceHeaders.forEach === 'function') {
      sourceHeaders.forEach((value, key) => {
        setHeaderSafe(key, value, true);
      });
    } else if (sourceHeaders && typeof sourceHeaders === 'object') {
      Object.entries(sourceHeaders).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach((v) => setHeaderSafe(key, v, true));
        } else {
          setHeaderSafe(key, value, false);
        }
      });
    }

    if (!headers.has('host') && !invalidHeaders.has('host') && urlObj.host) {
      setHeaderSafe('host', urlObj.host, false);
    }

    if (invalidHeaders.size > 0) {
      const origGet = headers.get.bind(headers);
      const origHas = headers.has.bind(headers);
      headers.get = (key) => {
        const lKey = String(key).toLowerCase();
        if (invalidHeaders.has(lKey)) {
          return invalidHeaders.get(lKey);
        }
        return origGet(key);
      };
      headers.has = (key) => {
        const lKey = String(key).toLowerCase();
        return invalidHeaders.has(lKey) || origHas(key);
      };
    }

    const requestCookies = new Map();
    const cookieHeader = headers.get('cookie');
    if (cookieHeader) {
      cookieHeader.split(';').forEach((entry) => {
        const trimmed = entry.trim();
        if (!trimmed) return;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) return;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1);
        if (key) {
          requestCookies.set(key, { name: key, value });
        }
      });
    }

    const syncCookieHeader = () => {
      if (requestCookies.size === 0) {
        headers.delete('cookie');
      } else {
        const serialized = Array.from(requestCookies.values())
          .map((c) => `${c.name}=${c.value}`)
          .join('; ');
        headers.set('cookie', serialized);
      }
    };

    const rawBody = init?.body;
    const hasBody = clonedState
      ? clonedState.hasBody
      : rawBody !== undefined && rawBody !== null;
    const isFormDataBody =
      typeof rawBody === 'object' &&
      rawBody !== null &&
      typeof rawBody.append === 'function' &&
      typeof rawBody.entries === 'function' &&
      Object.prototype.toString.call(rawBody) === '[object FormData]';

    let baseRequest = clonedState?.baseRequest || null;
    let fallbackFormData = clonedState?.fallbackFormData || null;
    if (!baseRequest) {
      const requestMethod =
        hasBody && (method === 'GET' || method === 'HEAD') ? 'POST' : method;
      const cleanHeaders = new Headers();
      headers.forEach((value, key) => {
        cleanHeaders.append(key, value);
      });
      baseRequest = new Request(
        resolvedUrl,
        hasBody
          ? {
            method: requestMethod,
            headers: cleanHeaders,
            body: rawBody,
            duplex: 'half',
          }
          : {
            method: requestMethod,
            headers: cleanHeaders,
          }
      );
      if (
        isFormDataBody &&
        !(baseRequest.headers.get('content-type') || '').includes('multipart/form-data')
      ) {
        fallbackFormData = rawBody;
      }
    }

    const cloneFallbackFormData = (fd) => {
      if (!fd || typeof fd.constructor !== 'function') return fd;
      try {
        const copy = new fd.constructor();
        for (const [k, v] of fd.entries()) {
          copy.append(k, v);
        }
        return copy;
      } catch {
        return fd;
      }
    };

    return {
      ...init,
      method,
      url: resolvedUrl,
      nextUrl: urlObj,
      headers,
      cookies: {
        get: jest.fn((key) => requestCookies.get(key)),
        getAll: jest.fn((key) =>
          key !== undefined
            ? requestCookies.has(key)
              ? [requestCookies.get(key)]
              : []
            : Array.from(requestCookies.values())
        ),
        has: jest.fn((key) => requestCookies.has(key)),
        set: jest.fn((keyOrCookie, value) => {
          if (typeof keyOrCookie === 'object' && keyOrCookie !== null) {
            requestCookies.set(String(keyOrCookie.name), {
              name: String(keyOrCookie.name),
              value: String(keyOrCookie.value ?? ''),
            });
          } else {
            requestCookies.set(String(keyOrCookie), {
              name: String(keyOrCookie),
              value: String(value ?? ''),
            });
          }
          syncCookieHeader();
        }),
        delete: jest.fn((keys) => {
          if (Array.isArray(keys)) {
            const deleted = keys.map((k) => requestCookies.delete(k));
            syncCookieHeader();
            return deleted;
          }
          const deleted = requestCookies.delete(keys);
          syncCookieHeader();
          return deleted;
        }),
      },
      json: () => (hasBody ? baseRequest.json() : Promise.resolve({})),
      text: () => baseRequest.text(),
      formData: () =>
        fallbackFormData
          ? Promise.resolve(cloneFallbackFormData(fallbackFormData))
          : baseRequest.formData(),
      arrayBuffer: () => baseRequest.arrayBuffer(),
      clone: () =>
        buildMockNextRequest(
          resolvedUrl,
          {
            ...init,
            method,
            headers,
          },
          {
            baseRequest: baseRequest.clone(),
            hasBody,
            invalidHeaders: new Map(invalidHeaders),
            fallbackFormData: fallbackFormData
              ? cloneFallbackFormData(fallbackFormData)
              : null,
          }
        ),
    };
  };

  return {
    NextResponse: MockNextResponse,
    NextRequest: jest.fn((input, init) => buildMockNextRequest(input, init)),
  };
});

jest.mock('@prisma/client', () => {
  const actual = jest.requireActual('@prisma/client');
  const testPath =
    (typeof expect !== 'undefined' && typeof expect.getState === 'function'
      ? expect.getState()?.testPath
      : '') || '';

  if (
    /\.integration\.test\.[jt]sx?$/.test(testPath) ||
    /(?:^|[\\/])sampleData\.test\.[jt]sx?$/.test(testPath)
  ) {
    return actual;
  }

  const createModelDelegate = (delegateKey) => ({
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    createMany: jest.fn(),
    createManyAndReturn: jest.fn(),
    update: jest.fn(),
    updateMany:
      delegateKey === 'contributor'
        ? jest.fn().mockResolvedValue({ count: 1 })
        : jest.fn(),
    updateManyAndReturn: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  });

  const modelNames = Object.values(actual.Prisma?.ModelName ?? {});
  const modelDelegates = {};
  for (const modelName of modelNames) {
    const delegateKey = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    modelDelegates[delegateKey] = createModelDelegate(delegateKey);
  }

  const rawQueryStubs = {
    $queryRaw: jest.fn(),
    $queryRawUnsafe: jest.fn(),
    $executeRaw: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  };

  const mockPrismaClient = {
    ...modelDelegates,
    ...rawQueryStubs,
    $transaction: jest.fn().mockImplementation(async (arg) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg);
      }
      const mockTx = {
        ...modelDelegates,
        ...rawQueryStubs,
      };
      return await arg(mockTx);
    }),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $on: jest.fn(),
    $use: jest.fn(),
    $extends: jest.fn().mockImplementation(() => mockPrismaClient),
  };

  return {
    ...actual,
    PrismaClient: jest.fn(() => mockPrismaClient),
    Prisma: {
      ...actual.Prisma,
      ModelName: {
        ...actual.Prisma?.ModelName,
      },
    },
  };
});

jest.mock('@stripe/stripe-js', () => ({
  loadStripe: jest.fn().mockResolvedValue({
    elements: jest.fn(),
    confirmPayment: jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_mock_123', status: 'succeeded' },
    }),
    confirmCardPayment: jest.fn().mockResolvedValue({
      paymentIntent: { id: 'pi_mock_123', status: 'succeeded' },
    }),
  }),
}));

jest.mock('@stripe/react-stripe-js', () => {
  const React = jest.requireActual('react');
  return {
    Elements: ({ children }) => React.createElement('div', { 'data-testid': 'stripe-elements-container' }, children),
    PaymentElement: (props) =>
      React.createElement(
        'div',
        { 'data-testid': 'stripe-payment-element', ...props },
        React.createElement('div', { 'data-testid': 'embedded-stripe-elements' }, 'Stripe Payment Element (Cards, Apple Pay, Google Pay)')
      ),
    CardElement: (props) => React.createElement('div', { 'data-testid': 'stripe-card-element', ...props }),
    useStripe: () => ({
      confirmPayment: jest.fn().mockResolvedValue({
        paymentIntent: { id: 'pi_test_mock_intent', status: 'succeeded' },
      }),
    }),
    useElements: () => ({
      submit: jest.fn().mockResolvedValue({}),
      getElement: jest.fn(),
    }),
  };
});


