const ADMIN_COOKIE = 'admin_auth';

// For client-side: check admin cookie directly (if accessible)
export function isAdminClient(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some(c => c.trim().startsWith(`${ADMIN_COOKIE}=true`));
}

// Or, call this API route to check admin status
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
