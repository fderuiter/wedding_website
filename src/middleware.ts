import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { isProtectedRoute } from '@/lib/routes';
import { isHostAllowed } from '@/utils/hostValidation';

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

  const isExcluded = 
    pathname === '/guest/login' ||
    pathname === '/api/guest/login' ||
    pathname === '/robots.txt' ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/_next/') ||
    /\.(svg|png|jpg|jpeg|gif|webp)$/i.test(pathname);

  if (!isExcluded) {
    const isGuest = await isGuestRequest(request);
    const isAdmin = await isAdminRequest(request);

    if (!isGuest && !isAdmin) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      const loginUrl = new URL('/guest/login', request.url);
      loginUrl.searchParams.set('callbackUrl', pathname + request.nextUrl.search);
      return NextResponse.redirect(loginUrl, { status: 303 });
    }
  }

  if (isProtectedRoute(pathname, method)) {
    const isAuth = await isAdminRequest(request);

    if (!isAuth) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      // 303 See Other ensures the unauthorized URL is not kept in browser history in a way 
      // that breaks navigation, serving as a clean redirect.
      const url = new URL('/admin/login', request.url);
      return NextResponse.redirect(url, { status: 303 });
    }
  }

  return NextResponse.next();
}

// Run middleware on all requests except static files and images
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
