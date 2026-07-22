import { apiClient } from '@/features/admin/apiClient';

/**
 * Checks the admin status by calling the `/api/admin/me` endpoint.
 * This is the secure way to check for admin status on the client-side,
 * as it relies on the HttpOnly cookie being sent to the server.
 * @returns {Promise<boolean>} A promise that resolves to true if the user is an admin, false otherwise.
 */
export async function checkAdminClient(): Promise<boolean> {
  try {
    const data = await apiClient.get<{ isAdmin: boolean }>('/api/admin/me');
    return !!data.isAdmin;
  } catch {
    return false;
  }
}
