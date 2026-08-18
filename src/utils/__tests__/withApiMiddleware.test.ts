import { withApiMiddleware } from '../withApiMiddleware';
import { NextRequest } from 'next/server';
import { logger } from '@/lib/logger';

describe('withApiMiddleware - Targeted Catch-Block Logging', () => {
  let loggerSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerSpy = jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    loggerSpy.mockRestore();
  });

  test('withApiMiddleware exports a function', () => {
    expect(typeof withApiMiddleware).toBe('function');
  });

  test('extracts API version from x-api-version header and logs alongside error and route', async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error('Database crash');
    });

    const middleware = withApiMiddleware(handler);
    const req = new NextRequest('http://localhost/api/registry/items');
    req.headers.get = jest.fn((key: string) => {
      if (key === 'x-api-version') return 'v1';
      return null;
    });

    const res = await middleware(req, {});
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'Database crash',
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      'Unhandled API Error:',
      expect.any(Error),
      {
        apiVersion: 'v1',
        route: '/api/registry/items',
      }
    );
  });

  test('extracts API version from X-API-Version (capitalized) header and logs alongside error and route', async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error('Database crash');
    });

    const middleware = withApiMiddleware(handler);
    const req = new NextRequest('http://localhost/api/registry/items');
    req.headers.get = jest.fn((key: string) => {
      if (key === 'X-API-Version') return 'v1';
      return null;
    });

    const res = await middleware(req, {});
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'Database crash',
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      'Unhandled API Error:',
      expect.any(Error),
      {
        apiVersion: 'v1',
        route: '/api/registry/items',
      }
    );
  });

  test('extracts API version from query parameters if headers are not present', async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error('JSON parsing failed');
    });

    const middleware = withApiMiddleware(handler);
    const req = new NextRequest('http://localhost/api/weather?version=v1');

    const res = await middleware(req, {});
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'JSON parsing failed',
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      'Unhandled API Error:',
      expect.any(Error),
      {
        apiVersion: 'v1',
        route: '/api/weather',
      }
    );
  });

  test('defaults API version to v2 when version metadata is absent', async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error('Network failure');
    });

    const middleware = withApiMiddleware(handler);
    const req = new NextRequest('http://localhost/api/attractions');

    const res = await middleware(req, {});
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'Network failure',
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      'Unhandled API Error:',
      expect.any(Error),
      {
        apiVersion: 'v2',
        route: '/api/attractions',
      }
    );
  });

  test('request failures due to missing or malformed headers do not crash the error-logging block', async () => {
    const handler = jest.fn().mockImplementation(() => {
      throw new Error('Fatal service error');
    });

    const middleware = withApiMiddleware(handler);

    // Mock a request that throws on headers.get
    const req = {
      url: 'http://localhost/api/malformed',
      headers: {
        get: () => {
          throw new Error('Malformed header stream');
        },
      },
    } as unknown as NextRequest;

    const res = await middleware(req, {});
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: 'Malformed header stream',
    });

    // Logging should still have occurred successfully without crashing
    expect(loggerSpy).toHaveBeenCalledWith(
      'Unhandled API Error:',
      expect.any(Error),
      {
        apiVersion: 'v2',
        route: '/api/malformed',
      }
    );
  });

  describe('Production Environment Sanitization & Request Tracing', () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    test('masks uncaught exceptions in production and attaches referenceId in payload and logs', async () => {
      const internalError = new Error('Database password leak: secret123 at postgres://user:pass@host/db');
      const handler = jest.fn().mockImplementation(() => {
        throw internalError;
      });

      const middleware = withApiMiddleware(handler);
      const req = new NextRequest('http://localhost/api/registry/items');

      const res = await middleware(req, {});
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('An unexpected error occurred. Please try again later.');
      expect(typeof body.referenceId).toBe('string');
      expect(body.referenceId.length).toBeGreaterThan(0);
      expect(body.error).not.toContain('Database password leak');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Unhandled API Error:',
        internalError,
        {
          apiVersion: 'v2',
          route: '/api/registry/items',
          referenceId: body.referenceId,
        }
      );
    });

    test('sanitizes 500 response returned from route handler in production', async () => {
      const handler = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'Internal query failure details' }), { status: 500, headers: { 'content-type': 'application/json' } })
      );

      const middleware = withApiMiddleware(handler);
      const req = new NextRequest('http://localhost/api/weather');

      const res = await middleware(req, {});
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('An unexpected error occurred. Please try again later.');
      expect(typeof body.referenceId).toBe('string');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Unhandled API Error:',
        'Internal query failure details',
        {
          apiVersion: 'v2',
          route: '/api/weather',
          referenceId: body.referenceId,
        }
      );
    });

    test('preserves 4xx operational errors (ApiError) without masking or adding referenceId in production', async () => {
      const { ApiError } = require('../ApiError');
      const handler = jest.fn().mockImplementation(() => {
        throw new ApiError(400, 'Invalid payload: email is required', { field: 'email' });
      });

      const middleware = withApiMiddleware(handler);
      const req = new NextRequest('http://localhost/api/registry/items');

      const res = await middleware(req, {});
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body).toEqual({
        success: false,
        error: 'Invalid payload: email is required',
        details: { field: 'email' },
      });
      expect(body.referenceId).toBeUndefined();
      expect(loggerSpy).not.toHaveBeenCalled();
    });
  });
});
