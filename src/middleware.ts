import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import {
  GUEST_CALLBACK_URL_HEADER,
  GUEST_GATED_PAGE_HEADER,
  GUEST_HEADER_SIGNATURE_HEADER,
  signGuestInternalHeaders,
  stripClientGuestHeaders,
} from '@/core/auth/guestHeaderSignature';
import { getSignedGuestInviteSession } from '@/core/auth/guestInviteToken';
import { isGuestRequest } from '@/core/auth/guest.server';
import {
  GUEST_PHOTO_COOKIE,
  GUEST_PHOTO_SESSION_MAX_AGE_SECONDS,
  PHOTO_QR_QUERY_PARAM,
  getSignedPhotoUploadSession,
  isPhotoScopedRoute,
  signPhotoUploadSessionToken,
  verifyPhotoQrLinkToken,
} from '@/core/auth/photoUploadToken';
import {
  resolveEdgeRequestSubdomain,
  verifyEdgeTenantClaims,
} from '@/core/auth/tenantClaims';
import {
  getSessionCookieOptions,
  resolveSessionCookieName,
} from '@/core/auth/tokenCookieHelpers';
import { env } from '@/env';
import {
  buildContentSecurityPolicy,
  CSP_NONCE_HEADER,
  generateCspNonce,
} from '@/lib/csp';
import { isProtectedRoute } from '@/lib/routes';
import { timingSafeEqualJS } from '@/utils/crypto';
import {
  isHostAllowed,
  isHostSyntaxValid,
  resolveRequestHost,
  validateMutatingRequestOrigin,
} from '@/utils/hostValidation';
import { getSafeCallbackUrl } from '@/utils/safeCallbackUrl';

function setPhotoSessionCookieOnResponse(
  response: NextResponse,
  sessionToken: string,
  req: NextRequest
): void {
  const cookieName = resolveSessionCookieName(GUEST_PHOTO_COOKIE, req);
  const options = getSessionCookieOptions(GUEST_PHOTO_SESSION_MAX_AGE_SECONDS, req);
  if (response.cookies && typeof response.cookies.set === 'function') {
    response.cookies.set(cookieName, sessionToken, options);
    return;
  }
  const cookieParts = [
    `${cookieName}=${sessionToken}`,
    'Path=/',
    `Max-Age=${GUEST_PHOTO_SESSION_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(options.secure ? ['Secure'] : []),
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
  const { pathname } = request.nextUrl;
  const method = (request.method || 'GET').toUpperCase();
  const normalizedPath =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const isReadOnlyProbeRequest =
    (method === 'GET' || method === 'HEAD') &&
    (normalizedPath === '/api/live' ||
      normalizedPath === '/api/health' ||
      normalizedPath === '/api/ready');

  // Validate Host header at perimeter before executing any route logic
  const trustProxy = Boolean(env.TRUST_PROXY);
  const rawForwardedHost = request.headers.get('x-forwarded-host');
  const rawHost = request.headers.get('host');
  const hasMalformedForwardedHost =
    rawForwardedHost !== null &&
    (/[\r\n\x00-\x1f\x7f]/.test(rawForwardedHost) ||
      (trustProxy && !rawForwardedHost.trim()));
  const hasInvalidRawHost = rawHost !== null && !isHostSyntaxValid(rawHost);
  const host = resolveRequestHost(request.headers, request.nextUrl?.host);

  if (
    hasMalformedForwardedHost ||
    hasInvalidRawHost ||
    (isReadOnlyProbeRequest ? !isHostSyntaxValid(host) : !isHostAllowed(host))
  ) {
    return NextResponse.json(
      { error: 'Invalid Host header' },
      { status: 400 }
    );
  }

  // Background cron execution routes support Bearer token authorization bypass
  const isCronRoute = normalizedPath === '/api/cron' || normalizedPath.startsWith('/api/cron/');
  if (isCronRoute) {
    if (isValidCronAuthorization(request)) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const originViolation = validateMutatingRequestOrigin(request);
  if (originViolation) {
    return NextResponse.json(
      { success: false, error: originViolation },
      { status: 403 }
    );
  }

  // Exchange signed QR photo upload links for an HttpOnly photo-scoped cookie and strip the token via 303 redirect
  if (
    normalizedPath === '/photos' &&
    (method === 'GET' || method === 'HEAD') &&
    request.nextUrl.searchParams.has(PHOTO_QR_QUERY_PARAM)
  ) {
    const rawQrToken = request.nextUrl.searchParams.get(PHOTO_QR_QUERY_PARAM);
    const verifiedQr = await verifyPhotoQrLinkToken(rawQrToken);
    const requestSubdomain = verifiedQr ? await resolveEdgeRequestSubdomain(request) : null;
    const isQrValidForTenant =
      Boolean(verifiedQr) && verifyEdgeTenantClaims(verifiedQr!, requestSubdomain);
    const cleanTargetUrl = new URL('/photos', request.url);
    const remainingParams = new URLSearchParams(request.nextUrl.search);
    remainingParams.delete(PHOTO_QR_QUERY_PARAM);
    if (!remainingParams.has('tab')) {
      remainingParams.set('tab', 'guest');
    }
    cleanTargetUrl.search = remainingParams.toString();

    if (isQrValidForTenant && verifiedQr) {
      const sessionToken = await signPhotoUploadSessionToken({
        v: verifiedQr.v,
        ...(verifiedQr.siteId !== undefined ? { siteId: verifiedQr.siteId } : {}),
        ...('subdomain' in verifiedQr && verifiedQr.subdomain !== undefined
          ? { subdomain: verifiedQr.subdomain }
          : {}),
      });
      const redirectResponse = NextResponse.redirect(cleanTargetUrl, { status: 303 });
      setPhotoSessionCookieOnResponse(redirectResponse, sessionToken, request);
      return redirectResponse;
    }

    const hasExistingFullAuth =
      (await isGuestRequest(request, { edgeOnly: true })) ||
      Boolean(await getSignedGuestInviteSession(request)) ||
      (await isAdminRequest(request, { edgeOnly: true }));
    if (hasExistingFullAuth) {
      return NextResponse.redirect(cleanTargetUrl, { status: 303 });
    }

    const loginUrl = new URL('/guest/login', request.url);
    loginUrl.searchParams.set(
      'callbackUrl',
      getSafeCallbackUrl(`${cleanTargetUrl.pathname}${cleanTargetUrl.search}`)
    );
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const isApiRoute = normalizedPath === '/api' || normalizedPath.startsWith('/api/');
  const isUploadsRoute = normalizedPath === '/uploads' || normalizedPath.startsWith('/uploads/');
  const isUploadAssetRoute =
    isUploadsRoute ||
    normalizedPath === '/api/uploads' ||
    normalizedPath.startsWith('/api/uploads/');
  const isPhotoUploadAssetRoute =
    normalizedPath === '/uploads/photos' ||
    normalizedPath.startsWith('/uploads/photos/') ||
    normalizedPath === '/api/uploads/photos' ||
    normalizedPath.startsWith('/api/uploads/photos/');
  const isNonPhotoUploadAssetRoute = !isPhotoUploadAssetRoute && isUploadAssetRoute;

  const isExcluded =
    normalizedPath === '/guest' ||
    normalizedPath === '/guest/login' ||
    normalizedPath === '/guest/collect' ||
    normalizedPath === '/guest/claim' ||
    normalizedPath === '/api/guest/login' ||
    normalizedPath === '/api/guest/recover' ||
    normalizedPath === '/api/guest/session' ||
    normalizedPath === '/api/guest/address' ||
    normalizedPath === '/api/guest/address/public' ||
    normalizedPath === '/api/registry/claim' ||
    normalizedPath === '/api/registry/validate-code' ||
    (normalizedPath === '/api/registry/webhook/stripe' && method === 'POST') ||
    isNonPhotoUploadAssetRoute ||
    normalizedPath === '/admin/login' ||
    normalizedPath === '/api/admin/login' ||
    (normalizedPath === '/api/admin/logout' && method === 'POST') ||
    (normalizedPath === '/api/admin/me' && method === 'GET') ||
    normalizedPath === '/api/admin/setup' ||
    (normalizedPath === '/api/og' && method === 'GET') ||
    normalizedPath === '/api/health' ||
    normalizedPath === '/api/live' ||
    normalizedPath === '/api/ready' ||
    normalizedPath === '/robots.txt' ||
    normalizedPath === '/favicon.ico' ||
    normalizedPath === '/images' ||
    normalizedPath.startsWith('/images/') ||
    normalizedPath === '/assets' ||
    normalizedPath.startsWith('/assets/') ||
    normalizedPath === '/fonts' ||
    normalizedPath.startsWith('/fonts/') ||
    normalizedPath === '/_next/static' ||
    normalizedPath.startsWith('/_next/static/') ||
    normalizedPath === '/_next/image' ||
    normalizedPath.startsWith('/_next/image/');

  const isProtected = isProtectedRoute(normalizedPath, method);
  if (isProtected) {
    const isAuth = await isAdminRequest(request, { edgeOnly: true });

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
    const isGuest =
      (await isGuestRequest(request, { edgeOnly: true })) ||
      Boolean(await getSignedGuestInviteSession(request));
    const isAdmin = await isAdminRequest(request, { edgeOnly: true });
    const hasPhotoAccess =
      isPhotoScopedRoute(normalizedPath, method) &&
      Boolean(await getSignedPhotoUploadSession(request));

    if (!isGuest && !isAdmin && !hasPhotoAccess) {
      if (isPhotoUploadAssetRoute) {
        const authHeaders = {
          'Content-Security-Policy': "default-src 'none'; sandbox",
          'Cross-Origin-Resource-Policy': 'same-origin',
          'X-Content-Type-Options': 'nosniff',
          Vary: 'Cookie',
        };
        if (method === 'HEAD') {
          return new NextResponse(null, { status: 401, headers: authHeaders });
        }
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: authHeaders });
      }
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
      const candidateCallbackUrl = cleanSearch ? `${pathname}?${cleanSearch}` : pathname;
      loginUrl.searchParams.set('callbackUrl', getSafeCallbackUrl(candidateCallbackUrl));
      if (incomingCode) {
        loginUrl.searchParams.set('code', incomingCode);
      }
      return NextResponse.redirect(loginUrl, { status: 303 });
    }
  } else if (normalizedPath === '/guest' && !request.nextUrl.searchParams.has('code')) {
    const signedPhoto = await getSignedPhotoUploadSession(request);
    if (signedPhoto) {
      const isGuest =
        (await isGuestRequest(request, { edgeOnly: true })) ||
        Boolean(await getSignedGuestInviteSession(request));
      const isAdmin = await isAdminRequest(request, { edgeOnly: true });
      if (!isGuest && !isAdmin) {
        const loginUrl = new URL('/guest/login', request.url);
        const cleanSearch = request.nextUrl.search;
        loginUrl.searchParams.set(
          'callbackUrl',
          getSafeCallbackUrl(cleanSearch ? `${pathname}${cleanSearch}` : pathname)
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
  stripClientGuestHeaders(requestHeaders);
  requestHeaders.delete(CSP_NONCE_HEADER);

  const gatedPageValue: '0' | '1' =
    !isExcluded && !isApiRoute && !isUploadAssetRoute && !isProtected ? '1' : '0';
  const callbackUrlValue = pathname + request.nextUrl.search;
  requestHeaders.set(GUEST_GATED_PAGE_HEADER, gatedPageValue);
  requestHeaders.set(GUEST_CALLBACK_URL_HEADER, callbackUrlValue);

  const headerSignature = await signGuestInternalHeaders(gatedPageValue, callbackUrlValue);
  if (headerSignature) {
    requestHeaders.set(GUEST_HEADER_SIGNATURE_HEADER, headerSignature);
  }

  let nonce: string | null = null;
  let cspHeaderValue: string | null = null;
  if (!isUploadAssetRoute) {
    nonce = generateCspNonce();
    cspHeaderValue = buildContentSecurityPolicy({ nonce });
    requestHeaders.set(CSP_NONCE_HEADER, nonce);
    requestHeaders.set('Content-Security-Policy', cspHeaderValue);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (nonce && cspHeaderValue) {
    response.headers.set(CSP_NONCE_HEADER, nonce);
    response.headers.set('Content-Security-Policy', cspHeaderValue);
  }

  return response;
}

// Run middleware on all API routes, uploads, and non-static page requests
export const config = {
  matcher: [
    '/api/:path*',
    '/uploads/:path*',
    '/((?!_next/static(?:/|$)|_next/image(?:/|$)|images/|assets/|fonts/|favicon\\.ico$|robots\\.txt$).*)',
  ],
};
