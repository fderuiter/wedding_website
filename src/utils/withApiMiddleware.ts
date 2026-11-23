import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { getGuestInviteSession, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { getSignedGuestInviteSession } from '@/core/auth/guestInviteToken';
import {
  rateLimit,
  checkAuthLockout,
  recordAuthFailure,
  type AuthLockoutInstance,
  type RateLimitBucket,
} from './rateLimit';
import { ApiError } from './ApiError';
import { isProtectedRoute } from '@/lib/routes';
import { logger } from '@/lib/logger';
import { runWithRequestContext } from '@/lib/requestContext';
import { generateSecureUUID } from './uuid';

type RouteHandler = (req: NextRequest, context: any) => Promise<NextResponse | Response> | NextResponse | Response;
type OptionalReqRouteHandler = (req?: NextRequest) => Promise<NextResponse | Response> | NextResponse | Response;

export interface ApiMiddlewareOptions {
  limit?: number;
  windowMs?: number;
  keyPrefix?: string;
  bucket?: RateLimitBucket;
  authInstance?: AuthLockoutInstance;
}

function isAuthLockoutRoute(pathname: string, method: string): boolean {
  const upperMethod = method.toUpperCase();
  return (
    pathname === '/api/admin/login' ||
    pathname === '/api/guest/login' ||
    pathname === '/api/guest/lookup' ||
    (pathname === '/api/admin/setup' && upperMethod === 'POST') ||
    pathname === '/api/registry/validate-code'
  );
}

function isAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

function isInviteRevocationExcludedApiPath(normalizedPathname: string): boolean {
  return (
    normalizedPathname === '/api/cron' ||
    normalizedPathname.startsWith('/api/cron/') ||
    normalizedPathname === '/api/guest/login' ||
    normalizedPathname === '/api/guest/address' ||
    normalizedPathname === '/api/guest/address/public' ||
    normalizedPathname === '/api/registry/claim' ||
    normalizedPathname === '/api/registry/validate-code' ||
    normalizedPathname === '/api/registry/session' ||
    normalizedPathname === '/api/registry/webhook/stripe' ||
    normalizedPathname === '/api/admin/login' ||
    normalizedPathname === '/api/admin/logout' ||
    normalizedPathname === '/api/admin/me' ||
    normalizedPathname === '/api/admin/setup' ||
    normalizedPathname === '/api/health' ||
    normalizedPathname === '/api/live' ||
    normalizedPathname === '/api/ready'
  );
}

export function withApiMiddleware(
  handler: OptionalReqRouteHandler,
  options?: ApiMiddlewareOptions
): (req?: NextRequest, context?: any) => Promise<NextResponse>;
export function withApiMiddleware(
  handler: RouteHandler,
  options?: ApiMiddlewareOptions
): (req: NextRequest, context?: any) => Promise<NextResponse>;
export function withApiMiddleware(
  handler: RouteHandler | OptionalReqRouteHandler,
  options?: ApiMiddlewareOptions
) {
  const executeWithMiddleware = async (req?: NextRequest, context?: any): Promise<NextResponse> => {
    let isHealthPath = false;
    let shouldTrackAuthFailures = false;
    let resolvedBucket: RateLimitBucket = 'general';
    let authLimit = 5;
    let authWindowMs = 15 * 60 * 1000;
    let prechecksCompleted = false;

    try {
      let pathname = '/';
      let method = 'GET';
      if (req) {
        let url: any = null;
        try {
          url = req.nextUrl || (req.url ? new URL(req.url, 'http://localhost') : null);
        } catch {
          url = null;
        }
        pathname = url?.pathname || '/';
        method = req.method || 'GET';
      }
      const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
      isHealthPath = normalizedPathname === '/api/health' || normalizedPathname === '/api/live';
      const isLoginPath = isAuthLockoutRoute(normalizedPathname, method);
      resolvedBucket = options?.bucket ?? (isLoginPath ? 'auth' : 'general');
      authLimit = options?.limit ?? 5;
      authWindowMs = options?.windowMs ?? 15 * 60 * 1000;
      
      const isAdminPath = isProtectedRoute(pathname, method);

      // 1. Rate Limiting
      // Check active authStore lockouts before handlers run, cap bursts at 100 req/min in generalStore,
      // and increment authStore only on failed attempts (status >= 400); probe endpoints (/api/health, /api/live) are exempt.
      if (!isHealthPath) {
        const hasReadableHeaders = Boolean(req && req.headers && typeof req.headers.get === 'function');
        shouldTrackAuthFailures = resolvedBucket === 'auth' && hasReadableHeaders;
        let rateLimitResponse: NextResponse | null = null;

        if (hasReadableHeaders && req) {
          if (resolvedBucket === 'auth') {
            rateLimitResponse = await checkAuthLockout(
              req,
              authLimit,
              authWindowMs,
              options?.keyPrefix,
              options?.authInstance
            );

            if (!rateLimitResponse) {
              rateLimitResponse = await rateLimit(
                req,
                100,
                60 * 1000,
                options?.keyPrefix,
                'general'
              );
            }
          } else {
            const limit = options?.limit ?? 100;
            const windowMs = options?.windowMs ?? 60 * 1000;
            rateLimitResponse = await rateLimit(req, limit, windowMs, options?.keyPrefix, 'general');
          }
        }
        
        if (rateLimitResponse) {
          // If rate limit exceeded, standardise its error response
          const data = await rateLimitResponse.json().catch(() => ({}));
          return NextResponse.json(
            { success: false, error: data.error || 'Rate limit exceeded' },
            { status: 429 }
          );
        }
      }

      prechecksCompleted = true;

      // 2. Admin & Active Guest Invite Verification
      if (isAdminPath) {
        const isAdmin = req ? await isAdminRequest(req) : false;
        if (!isAdmin) {
          throw new ApiError(401, 'Unauthorized');
        }
      } else if (req && !isInviteRevocationExcludedApiPath(normalizedPathname)) {
        const signedInvite = await getSignedGuestInviteSession(req);
        if (signedInvite) {
          const hasFallbackAuth = (await isAdminRequest(req)) || (await isGuestRequest(req));
          if (!hasFallbackAuth) {
            const activeInvite = await getGuestInviteSession(req);
            if (!activeInvite) {
              const unauthorizedResponse = NextResponse.json(
                { success: false, error: 'Unauthorized' },
                { status: 401 }
              );
              unauthorizedResponse.headers.set('x-api-version', 'v2');
              unauthorizedResponse.cookies.set(GUEST_INVITE_COOKIE, '', {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 0,
              });
              return unauthorizedResponse;
            }
          }
        }
      }

      // 3. Execute Handler
      const response = await handler(req as NextRequest, context);

      if (
        shouldTrackAuthFailures &&
        !isHealthPath &&
        prechecksCompleted &&
        req &&
        isAuthFailureStatus(response.status)
      ) {
        await recordAuthFailure(req, authWindowMs, options?.keyPrefix, options?.authInstance);
      }
      
      // Pass-through attachments (e.g. backup files)
      const contentType = response.headers?.get?.('content-type') || 'application/json';
      const isAttachment = response.headers?.get?.('content-disposition')?.includes('attachment');
      
      // We assume it's JSON unless it's explicitly something else, to handle test mocks
      if ((contentType && !contentType.includes('application/json')) || isAttachment) {
        return response as NextResponse;
      }

      const data = await response.json().catch(() => ({}));

      let finalResponse: NextResponse;
      if (response.status >= 400) {
        if (response.status >= 500 && process.env.NODE_ENV === 'production') {
          const referenceId = generateSecureUUID();
          logger.error('Unhandled API Error:', data.error || data.message || 'API Error', { apiVersion: 'v2', route: pathname, referenceId });
          finalResponse = NextResponse.json(
            { 
              success: false, 
              error: 'An unexpected error occurred. Please try again later.',
              referenceId,
            },
            { status: response.status, headers: response.headers }
          );
        } else {
          finalResponse = NextResponse.json(
            { 
              success: false, 
              error: data.error || data.message || 'API Error',
              ...(data.details ? { details: data.details } : {}),
              ...(data.helpPrompt ? { helpPrompt: data.helpPrompt } : {})
            },
            { status: response.status, headers: response.headers }
          );
        }
      } else if (data && typeof data === 'object' && 'success' in data) {
        // Already structured similarly to standard format, don't nest it
        finalResponse = NextResponse.json(data, { status: response.status, headers: response.headers });
      } else {
        finalResponse = NextResponse.json(
          { success: true, data },
          { status: response.status, headers: response.headers }
        );
      }

      response.headers.forEach((value, key) => {
        finalResponse.headers.set(key, value);
      });

      finalResponse.headers.set('x-api-version', 'v2');

      // Copy cookies from original response if it was a NextResponse
      if ('cookies' in response) {
        const nextRes = response as any;
        if (typeof nextRes.cookies.getAll === 'function') {
          nextRes.cookies.getAll().forEach((cookie: any) => {
            finalResponse.cookies.set(cookie);
          });
        }
      }
      
      const allHeaders = Array.from(response.headers.entries());
      const setCookieHeaders = allHeaders.filter(([k]) => k.toLowerCase() === 'set-cookie').map(([,v]) => v);
      
      setCookieHeaders.forEach(c => {
        // Some test environments don't sync headers to .cookies automatically
        // We do a basic parse of the Set-Cookie string to ensure .cookies is populated
        const parts = c.split(';');
        const [nameValue] = parts;
        if (nameValue) {
          const eqIndex = nameValue.indexOf('=');
          if (eqIndex !== -1) {
            const name = nameValue.substring(0, eqIndex).trim();
            const value = nameValue.substring(eqIndex + 1);
            finalResponse.cookies.set(name, value);
          }
        }
        // Also ensure it is in the headers exactly as requested
        finalResponse.headers.append('set-cookie', c);
      });
      
      // Also copy set-cookie headers manually if they exist and cookies.getAll wasn't sufficient
      if (typeof response.headers.getSetCookie === 'function') {
        const setCookies = response.headers.getSetCookie();
        setCookies.forEach(c => {
          finalResponse.headers.append('set-cookie', c);
        });
      }
      
      return finalResponse;
      
    } catch (error: any) {
      const errorStatus = error instanceof ApiError ? error.statusCode : 500;
      if (
        shouldTrackAuthFailures &&
        !isHealthPath &&
        prechecksCompleted &&
        req &&
        isAuthFailureStatus(errorStatus)
      ) {
        try {
          await recordAuthFailure(req, authWindowMs, options?.keyPrefix, options?.authInstance);
        } catch {
          // Preserve original error response if lockout recording fails
        }
      }

      if (error instanceof ApiError && error.statusCode < 500) {
        return NextResponse.json(
          { 
            success: false, 
            error: error.message,
            ...(error.data ? { details: error.data } : {})
          },
          { status: error.statusCode }
        );
      }

      const apiVersion = 'v2';
      let route = 'unknown';

      try {
        if (req) {
          // Extract route/pathname
          let url: any = null;
          try {
            url = req.nextUrl || (req.url ? new URL(req.url) : null);
          } catch {
            // Safe fallback if URL parsing fails
          }
          if (url?.pathname) {
            route = url.pathname;
          } else if (req.url && typeof req.url === 'string' && !req.url.startsWith('http')) {
            route = req.url;
          }
        }
      } catch {
        // Safe fallback to prevent crashing the error-logging block itself
      }

      const isProduction = process.env.NODE_ENV === 'production';

      if (isProduction) {
        const referenceId = generateSecureUUID();
        logger.error('Unhandled API Error:', error, { apiVersion, route, referenceId });

        return NextResponse.json(
          { 
            success: false, 
            error: 'An unexpected error occurred. Please try again later.',
            referenceId 
          },
          { status: 500 }
        );
      }

      logger.error('Unhandled API Error:', error, { apiVersion, route });
      
      const errorMessage = error instanceof Error ? error.message : 'Internal Server Error';
      
      return NextResponse.json(
        { success: false, error: errorMessage },
        { status: 500 }
      );
    }
  };

  return async (req?: NextRequest, context?: any): Promise<NextResponse> =>
    runWithRequestContext(req, () => executeWithMiddleware(req, context));
}
