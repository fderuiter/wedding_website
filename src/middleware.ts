import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isAdminRequest } from '@/features/admin/auth.server';

export async function middleware(_request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Protect /admin/dashboard and specific /registry routes
  if (
    pathname.startsWith('/admin/dashboard') ||
    pathname.startsWith('/registry/add-item') ||
    pathname.startsWith('/registry/edit-item')
  ) {
    const isAuth = await isAdminRequest(request);

    if (!isAuth) {
      // 303 See Other ensures the unauthorized URL is not kept in browser history in a way 
      // that breaks navigation, serving as a clean redirect.
      const url = new URL('/admin/login', request.url);
      return NextResponse.redirect(url, { status: 303 });
    }
  }

  return NextResponse.next();
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: [
    '/admin/dashboard/:path*',
    '/registry/add-item/:path*',
    '/registry/edit-item/:path*',
  ],
};
