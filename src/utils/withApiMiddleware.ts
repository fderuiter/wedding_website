import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { rateLimit } from './rateLimit';
import { ApiError } from './ApiError';
import { isProtectedRoute } from '@/lib/routes';
import { logger } from '@/lib/logger';
import { generateSecureUUID } from './uuid';

type RouteHandler = (req: NextRequest, context: any) => Promise<NextResponse | Response> | NextResponse | Response;

export interface ApiMiddlewareOptions {
  translateActiveToLegacy?: (activeData: any) => any;
}

export function withApiMiddleware(handler: RouteHandler, options?: ApiMiddlewareOptions) {
  return async (req: NextRequest, context: any) => {
    try {
      let pathname = '/';
      let method = 'GET';
      if (req) {
        const url = req.nextUrl || (req.url ? new URL(req.url) : { pathname: '/' });
        pathname = url.pathname;
        method = req.method;
      }
      const isLoginPath = pathname === '/api/admin/login' || pathname === '/api/admin/logout' || pathname === '/api/admin/me';
      
      const isAdminPath = isProtectedRoute(pathname, method);

      // 1. Rate Limiting
      // Stricter limits for login, general limits for everything else
      const limit = isLoginPath ? 5 : 100;
      const windowMs = isLoginPath ? 15 * 60 * 1000 : 60 * 1000;
      const rateLimitResponse = (req && req.headers && typeof req.headers.get === 'function') ? await rateLimit(req, limit, windowMs) : null;
      
      if (rateLimitResponse) {
        // If rate limit exceeded, standardise its error response
        const data = await rateLimitResponse.json().catch(() => ({}));
        return NextResponse.json(
          { success: false, error: data.error || 'Rate limit exceeded' },
          { status: 429 }
        );
      }

      // 2. Admin Verification
      if (isAdminPath) {
        const isAdmin = await isAdminRequest(req);
        if (!isAdmin) {
          throw new ApiError(401, 'Unauthorized');
        }
      }

      // 3. Execute Handler
      const response = await handler(req, context);
      
      // Pass-through attachments (e.g. backup files)
      const contentType = response.headers?.get?.('content-type') || 'application/json';
      const isAttachment = response.headers?.get?.('content-disposition')?.includes('attachment');
      
      // We assume it's JSON unless it's explicitly something else, to handle test mocks
      if ((contentType && !contentType.includes('application/json')) || isAttachment) {
        return response;
      }

      let data = await response.json().catch(() => ({}));

      let isLegacy = false;
      if (req && typeof req.headers?.get === 'function') {
        const versionHeader = req.headers.get('x-api-version') || req.headers.get('X-API-Version');
        const url = req.nextUrl || (req.url ? new URL(req.url) : null);
        const versionParam = url?.searchParams?.get?.('version');
        isLegacy = (versionHeader === 'v1' || versionParam === 'v1');
      }

      if (isLegacy && options?.translateActiveToLegacy) {
        data = options.translateActiveToLegacy(data);
      }

      let finalResponse: NextResponse;
      if (response.status >= 400) {
        if (response.status >= 500 && process.env.NODE_ENV === 'production') {
          const referenceId = generateSecureUUID();
          logger.error('Unhandled API Error:', data.error || data.message || 'API Error', { apiVersion: isLegacy ? 'v1' : 'v2', route: pathname, referenceId });
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
              ...(data.details ? { details: data.details } : {})
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

      if (isLegacy) {
        finalResponse.headers.set('x-api-version', 'v1');
      } else {
        finalResponse.headers.set('x-api-version', 'v2');
      }

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

      let apiVersion = 'v2';
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

          // Extract API version from headers or query parameters
          let versionHeader: string | null = null;
          if (req.headers && typeof req.headers.get === 'function') {
            try {
              versionHeader = req.headers.get('x-api-version') || req.headers.get('X-API-Version');
            } catch {
              // Ignore
            }
          }
          
          let versionParam: string | null = null;
          if (url && typeof url.searchParams?.get === 'function') {
            try {
              versionParam = url.searchParams.get('version');
            } catch {
              // Ignore
            }
          }

          const extractedVersion = versionHeader || versionParam;
          if (extractedVersion) {
            apiVersion = extractedVersion;
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
}
