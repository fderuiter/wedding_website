import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { getSignedGuestInviteSession } from '@/core/auth/guestInviteToken';
import {
  GUEST_PHOTO_COOKIE,
  GUEST_PHOTO_SESSION_MAX_AGE_SECONDS,
  PHOTO_QR_QUERY_PARAM,
  getSignedPhotoUploadSession,
  isPhotoScopedRoute,
  signPhotoUploadSessionToken,
  verifyPhotoQrLinkToken,
} from '@/core/auth/photoUploadToken';
import { isProtectedRoute } from '@/lib/routes';
import { isHostAllowed } from '@/utils/hostValidation';
import { timingSafeEqualJS } from '@/utils/crypto';

function setPhotoSessionCookieOnResponse(response: NextResponse, sessionToken: string): void {
  const isProd = process.env.NODE_ENV === 'production';
  if (response.cookies && typeof response.cookies.set === 'function') {
    response.cookies.set(GUEST_PHOTO_COOKIE, sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/',
      maxAge: GUEST_PHOTO_SESSION_MAX_AGE_SECONDS,
    });
    return;
  }
  const cookieParts = [
    `${GUEST_PHOTO_COOKIE}=${sessionToken}`,
    'Path=/',
    `Max-Age=${GUEST_PHOTO_SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(isProd ? ['Secure'] : []),
  ];
  response.headers.append('set-cookie', cookieParts.join('; '));
}

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
  const method = (request.method || 'GET').toUpperCase();
  const normalizedPath = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

  // Background cron execution routes support Bearer token authorization bypass
  const isCronRoute = normalizedPath === '/api/cron' || normalizedPath.startsWith('/api/cron/');
  if (isCronRoute) {
    if (isValidCronAuthorization(request)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Exchange signed QR photo upload links for an HttpOnly photo-scoped cookie and strip the token via 303 redirect
  if (
    normalizedPath === '/photos' &&
    (method === 'GET' || method === 'HEAD') &&
    request.nextUrl.searchParams.has(PHOTO_QR_QUERY_PARAM)
  ) {
    const rawQrToken = request.nextUrl.searchParams.get(PHOTO_QR_QUERY_PARAM);
    const verifiedQr = await verifyPhotoQrLinkToken(rawQrToken);
    const cleanTargetUrl = new URL('/photos', request.url);
    const remainingParams = new URLSearchParams(request.nextUrl.search);
    remainingParams.delete(PHOTO_QR_QUERY_PARAM);
    if (!remainingParams.has('tab')) {
      remainingParams.set('tab', 'guest');
    }
    cleanTargetUrl.search = remainingParams.toString();

    if (verifiedQr) {
      const sessionToken = await signPhotoUploadSessionToken({ v: verifiedQr.v });
      const redirectResponse = NextResponse.redirect(cleanTargetUrl, { status: 303 });
      setPhotoSessionCookieOnResponse(redirectResponse, sessionToken);
      return redirectResponse;
    }

    const hasExistingFullAuth =
      (await isGuestRequest(request)) ||
      Boolean(await getSignedGuestInviteSession(request)) ||
      (await isAdminRequest(request));
    if (hasExistingFullAuth) {
      return NextResponse.redirect(cleanTargetUrl, { status: 303 });
    }

    const loginUrl = new URL('/guest/login', request.url);
    loginUrl.searchParams.set(
      'callbackUrl',
      `${cleanTargetUrl.pathname}${cleanTargetUrl.search}`
    );
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const isApiRoute = normalizedPath === '/api' || normalizedPath.startsWith('/api/');

  const isExcluded = 
    normalizedPath === '/guest' ||
    normalizedPath === '/guest/login' ||
    normalizedPath === '/guest/collect' ||
    normalizedPath === '/guest/claim' ||
    normalizedPath === '/api/guest/login' ||
    normalizedPath === '/api/guest/address' ||
    normalizedPath === '/api/guest/address/public' ||
    normalizedPath === '/api/registry/claim' ||
    normalizedPath === '/api/registry/validate-code' ||
    (normalizedPath === '/api/registry/webhook/stripe' && method === 'POST') ||
    normalizedPath === '/api/uploads' ||
    normalizedPath.startsWith('/api/uploads/') ||
    normalizedPath === '/uploads' ||
    normalizedPath.startsWith('/uploads/') ||
    normalizedPath === '/admin/login' ||
    normalizedPath === '/api/admin/login' ||
    normalizedPath === '/api/admin/setup' ||
    normalizedPath === '/api/health' ||
    normalizedPath === '/api/live' ||
    normalizedPath === '/api/ready' ||
    normalizedPath === '/robots.txt' ||
    normalizedPath === '/favicon.ico' ||
    normalizedPath.startsWith('/_next/') ||
    (!isApiRoute && /\.(svg|png|jpg|jpeg|gif|webp)$/i.test(normalizedPath));

  const isProtected = isProtectedRoute(normalizedPath, method);
  if (isProtected) {
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
    const isGuest = (await isGuestRequest(request)) || Boolean(await getSignedGuestInviteSession(request));
    const isAdmin = await isAdminRequest(request);
    const hasPhotoAccess =
      isPhotoScopedRoute(normalizedPath, method) &&
      Boolean(await getSignedPhotoUploadSession(request));

    if (!isGuest && !isAdmin && !hasPhotoAccess) {
      if (normalizedPath.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const loginUrl = new URL('/guest/login', request.url);
      const incomingParams = new URLSearchParams(request.nextUrl.search);
      const incomingCode = incomingParams.get('code')?.trim();
      if (incomingParams.has('code')) {
        incomingParams.delete('code');
      }
      if (incomingParams.has(PHOTO_QR_QUERY_PARAM)) {
        incomingParams.delete(PHOTO_QR_QUERY_PARAM);
      }
      const cleanSearch = incomingParams.toString();
      loginUrl.searchParams.set(
        'callbackUrl',
        cleanSearch ? `${pathname}?${cleanSearch}` : pathname
      );
      if (incomingCode) {
        loginUrl.searchParams.set('code', incomingCode);
      }
      return NextResponse.redirect(loginUrl, { status: 303 });
    }
  } else if (normalizedPath === '/guest' && !request.nextUrl.searchParams.has('code')) {
    const signedPhoto = await getSignedPhotoUploadSession(request);
    if (signedPhoto) {
      const isGuest =
        (await isGuestRequest(request)) || Boolean(await getSignedGuestInviteSession(request));
      const isAdmin = await isAdminRequest(request);
      if (!isGuest && !isAdmin) {
        const loginUrl = new URL('/guest/login', request.url);
        const cleanSearch = request.nextUrl.search;
        loginUrl.searchParams.set(
          'callbackUrl',
          cleanSearch ? `${pathname}${cleanSearch}` : pathname
        );
        return NextResponse.redirect(loginUrl, { status: 303 });
      }
    }
  }

  const requestHeaders = new Headers();
  if (request.headers && typeof request.headers.forEach === 'function') {
    request.headers.forEach((value: string, key: string) => {
      if (typeof value === 'string') {
        requestHeaders.set(key, value);
      }
    });
  }
  requestHeaders.set('x-guest-gated-page', !isExcluded && !isApiRoute && !isProtected ? '1' : '0');
  requestHeaders.set('x-guest-callback-url', pathname + request.nextUrl.search);

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

// Run middleware on all API routes and all non-static page requests
export const config = {
  matcher: [
    '/api/:path*',
    '/uploads/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
