const ADMIN_COOKIE = 'admin_auth';

/**
 * Checks for the admin authentication cookie on the client-side.
 * @deprecated This function is unreliable because the admin cookie is HttpOnly and cannot be accessed by client-side JavaScript.
 * Use `checkAdminClient` instead, which calls the server-side API.
 * @returns {boolean} Always false (in production with HttpOnly cookies).
 */
export function isAdminClient(): boolean {
  if (typeof document === 'undefined') return false;
  // Previously checked for 'admin_auth=true'. Since the cookie is HttpOnly, this will typically return false.
  // We keep the check for consistency if non-HttpOnly cookies are used in dev, but generally this should not be relied upon.
  return document.cookie.split(';').some(c => c.trim().startsWith(`${ADMIN_COOKIE}=`));
}

/**
 * Checks the admin status by calling the `/api/admin/me` endpoint.
 * This is the secure way to check for admin status on the client-side,
 * as it relies on the HttpOnly cookie being sent to the server.
 * @returns {Promise<boolean>} A promise that resolves to true if the user is an admin, false otherwise.
 */
export async function checkAdminClient(): Promise<boolean> {
  try {
    const res = await fetch('/api/admin/me');
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.isAdmin;
  } catch {
    return false;
  }
}
