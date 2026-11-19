import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { isProtectedRoute } from '@/lib/routes';
import { isHostAllowed } from '@/utils/hostValidation';
import { timingSafeEqualJS } from '@/utils/crypto';

function isValidCronAuthorization(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return false;
  }

  const cronSecret = process.env.CRON_SECRET?.trim();
  if (cronSecret) {
    const encoder = new TextEncoder();
    const tokenBytes = encoder.encode(token);
    const secretBytes = encoder.encode(cronSecret);
    return timingSafeEqualJS(tokenBytes, secretBytes);
  }

  // In non-production environments without CRON_SECRET configured, allow bearer authorization
  return process.env.NODE_ENV !== 'production';
}

export async function middleware(request: NextRequest) {
  // Validate Host header at perimeter before executing any route logic
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
  const host = forwardedHost || request.headers.get('host') || request.nextUrl?.host;

  if (!isHostAllowed(host)) {
    return NextResponse.json(
      { error: 'Invalid Host header' },
      { status: 400 }
    );
  }

  const { pathname } = request.nextUrl;
  const method = request.method;
  const normalizedPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  // Background cron execution routes support Bearer token authorization bypass
  const isCronRoute = normalizedPath === '/api/cron' || normalizedPath.startsWith('/api/cron/');
  if (isCronRoute) {
    if (isValidCronAuthorization(request)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isApiRoute = normalizedPath === '/api' || normalizedPath.startsWith('/api/');

  const isExcluded = 
    normalizedPath === '/guest' ||
    normalizedPath === '/guest/login' ||
    normalizedPath === '/guest/collect' ||
    normalizedPath === '/api/guest/login' ||
    normalizedPath === '/api/guest/address' ||
    normalizedPath === '/api/guest/address/public' ||
    normalizedPath === '/api/registry/validate-code' ||
    normalizedPath === '/admin/login' ||
    normalizedPath === '/api/admin/login' ||
    normalizedPath === '/api/admin/setup' ||
    normalizedPath === '/api/health' ||
    normalizedPath === '/api/ready' ||
    normalizedPath === '/robots.txt' ||
    normalizedPath === '/favicon.ico' ||
    normalizedPath.startsWith('/_next/') ||
    (!isApiRoute && /\.(svg|png|jpg|jpeg|gif|webp)$/i.test(normalizedPath));

  if (isProtectedRoute(normalizedPath, method)) {
    const isAuth = await isAdminRequest(request);

    if (!isAuth) {
      if (normalizedPath.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // 303 See Other ensures the unauthorized URL is not kept in browser history in a way 
      // that breaks navigation, serving as a clean redirect.
      const url = new URL('/admin/login', request.url);
      return NextResponse.redirect(url, { status: 303 });
    }
  }

  if (!isExcluded) {
    const isGuest = (await isGuestRequest(request)) || Boolean(await getGuestInviteSession(request));
    const isAdmin = await isAdminRequest(request);

    if (!isGuest && !isAdmin) {
      if (normalizedPath.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const loginUrl = new URL('/guest/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname + request.nextUrl.search);
      return NextResponse.redirect(loginUrl, { status: 303 });
    }
  }

  return NextResponse.next();
}

// Run middleware on all API routes and all non-static page requests
export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
