/** @jest-environment node */

import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { signGuestToken, verifyGuestToken, isGuestRequest, GUEST_COOKIE } from '@/core/auth/guest.server';
import { POST as guestLoginPost } from '@/app/api/guest/login/route';
import { env } from '@/env';

// Mock next/server completely for clean isolated Jest execution
jest.mock('next/server', () => {
  class MockNextRequest {
    url: string;
    method: string;
    nextUrl: URL;
    headers: Headers;
    cookies: any;
    bodyStr: string;

    constructor(url: string, init?: any) {
      this.url = url;
      this.nextUrl = new URL(url);
      this.method = init?.method || 'GET';
      this.headers = new Headers(init?.headers);
      this.bodyStr = init?.body || '';
      
      const cookiesMap = new Map();
      if (init?.cookies) {
        Object.entries(init.cookies).forEach(([k, v]) => cookiesMap.set(k, v));
      }
      this.cookies = {
        get: (name: string) => {
          const val = cookiesMap.get(name);
          return val ? { value: val } : undefined;
        },
        set: (name: string, value: string) => {
          cookiesMap.set(name, value);
        },
      };
    }

    async json() {
      return JSON.parse(this.bodyStr);
    }
  }

  const mockNextRedirect = jest.fn().mockImplementation((url, init) => {
    const headers = new Headers();
    headers.set('location', url.toString());
    return {
      status: init?.status || 302,
      headers,
    };
  });

  const mockNextNext = jest.fn().mockImplementation(() => {
    return {
      status: 200,
      headers: new Headers(),
    };
  });

  const mockNextJson = jest.fn().mockImplementation((body, init) => {
    const cookiesMap = new Map();
    const headers = new Headers();
    headers.set('content-type', 'application/json');
    return {
      status: init?.status || 200,
      headers,
      json: async () => body,
      cookies: {
        set: (name: string, value: string, opts: any) => {
          cookiesMap.set(name, value);
          headers.append('set-cookie', `${name}=${value}`);
        },
        get: (name: string) => cookiesMap.get(name),
      },
    };
  });

  return {
    NextRequest: MockNextRequest,
    NextResponse: {
      next: mockNextNext,
      redirect: mockNextRedirect,
      json: mockNextJson,
    },
  };
});

// Mock the admin auth and routes helpers so middleware functions smoothly
jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/lib/routes', () => ({
  isProtectedRoute: jest.fn().mockReturnValue(false),
}));

import { isAdminRequest } from '@/core/auth/auth.server';

const mockIsAdminRequest = isAdminRequest as jest.Mock;

describe('Edge-enforced Guest Passcode Gate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Guest Auth Utility (guest.server)', () => {
    it('successfully signs and verifies a valid guest token', async () => {
      const iat = Date.now();
      const exp = iat + 1000 * 60 * 60; // 1 hour
      const token = await signGuestToken({ guest: true, iat, exp });
      expect(token).toBeDefined();

      const payload = await verifyGuestToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.guest).toBe(true);
      expect(payload?.exp).toBe(exp);
    });

    it('returns null for tampered/invalid tokens', async () => {
      const iat = Date.now();
      const exp = iat + 1000 * 60 * 60;
      const token = await signGuestToken({ guest: true, iat, exp });
      const tampered = token + 'tamper';

      const payload = await verifyGuestToken(tampered);
      expect(payload).toBeNull();
    });

    it('returns null for expired tokens', async () => {
      const iat = Date.now() - 1000 * 60 * 60 * 2; // 2 hours ago
      const exp = iat + 1000 * 60 * 60; // expired 1 hour ago
      const token = await signGuestToken({ guest: true, iat, exp });

      const verified = await isGuestRequest({
        cookies: {
          get: () => ({ value: token }),
        },
        headers: new Headers(),
      } as any);

      expect(verified).toBe(false);
    });
  });

  describe('Guest Login API Route (POST /api/guest/login)', () => {
    it('returns 400 if passcode is missing', async () => {
      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const res = await guestLoginPost(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Passcode is required');
    });

    it('returns 401 for incorrect passcode', async () => {
      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: 'wrong_code' }),
      });
      const res = await guestLoginPost(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Incorrect passcode.');
    });

    it('returns 200 and sets cookie for correct passcode', async () => {
      const req = new NextRequest('http://localhost/api/guest/login', {
        method: 'POST',
        body: JSON.stringify({ passcode: env.GUEST_PASSCODE }),
      });
      const res = await guestLoginPost(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const cookieHeader = res.headers.get('set-cookie');
      expect(cookieHeader).toContain(GUEST_COOKIE);
    });
  });

  describe('Middleware Access Controls', () => {
    it('bypasses guest passcode check for excluded path /guest/login', async () => {
      const req = new NextRequest('http://localhost/guest/login');
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('bypasses check for robots.txt', async () => {
      const req = new NextRequest('http://localhost/robots.txt');
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('redirects unauthenticated page request from / to /guest/login with 303', async () => {
      const req = new NextRequest('http://localhost/');
      const res = await middleware(req);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toContain('/guest/login');
      expect(res.headers.get('location')).toContain('callbackUrl=%2F');
    });

    it('returns immediate 401 for unauthenticated API requests instead of redirect', async () => {
      const req = new NextRequest('http://localhost/api/weather');
      const res = await middleware(req);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toBe('Unauthorized');
    });

    it('allows access for authenticated guest session', async () => {
      const token = await signGuestToken({ guest: true, exp: Date.now() + 1000 * 60 * 60 });
      const req = new NextRequest('http://localhost/', {
        cookies: {
          [GUEST_COOKIE]: token,
        },
      });

      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });

    it('allows access for authenticated admin session even without guest session', async () => {
      mockIsAdminRequest.mockResolvedValue(true);
      const req = new NextRequest('http://localhost/');
      
      const res = await middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    });
  });
});
