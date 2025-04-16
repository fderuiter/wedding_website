import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const ADMIN_COOKIE = 'admin_auth';

// For server components or API routes
export async function isAdminRequest(req?: NextRequest): Promise<boolean> {
  if (req) {
    // API Route (Edge or Node)
    const cookie = req.cookies?.get?.(ADMIN_COOKIE)?.value || req.headers.get('cookie')?.split(';').find(c => c.trim().startsWith(`${ADMIN_COOKIE}=`))?.split('=')[1];
    return cookie === 'true';
  } else {
    // Server Component (App Router)
    const cookieStore = await cookies();
    const cookie = cookieStore.get(ADMIN_COOKIE)?.value;
    return cookie === 'true';
  }
}
