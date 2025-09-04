import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';

const ADMIN_COOKIE = 'admin_auth';

/**
 * Checks for the admin authentication cookie on the server-side.
 * This function is designed to work in different Next.js contexts:
 * - In API Routes (Edge or Node), it checks the `req.cookies`.
 * - In Server Components (App Router), it uses the `cookies()` function from `next/headers`.
 *
 * @param {NextRequest} [req] - The optional Next.js request object. If provided, the function assumes it's running in an API route context.
 * @returns {Promise<boolean>} A promise that resolves to true if the user is an admin, false otherwise.
 */
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
