import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isProtectedRoute } from '@/lib/routes';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method;

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
