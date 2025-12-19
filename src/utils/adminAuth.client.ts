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
