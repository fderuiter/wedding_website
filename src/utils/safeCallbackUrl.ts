const SAFE_CALLBACK_ORIGIN = 'https://local.invalid';
const ASCII_CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

function isGuestLoginPathname(pathname: string): boolean {
  const normalized = pathname.toLowerCase();
  return normalized === '/guest/login' || normalized.startsWith('/guest/login/');
}

/**
 * Validates and normalizes a candidate callback path to a strict same-origin relative path.
 * Returns `null` when the input is empty, cross-origin, protocol-relative, contains backslashes
 * or ASCII control characters, or points to `/guest/login` (preventing redirect loops).
 */
export function normalizeSafeCallbackPath(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  if (
    !url.startsWith('/') ||
    url.startsWith('//') ||
    url.includes('\\') ||
    ASCII_CONTROL_CHAR_RE.test(url)
  ) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url, SAFE_CALLBACK_ORIGIN);
  } catch {
    return null;
  }

  if (
    parsed.origin !== SAFE_CALLBACK_ORIGIN ||
    parsed.pathname.startsWith('//') ||
    isGuestLoginPathname(parsed.pathname)
  ) {
    return null;
  }

  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }

  if (
    decodedPathname.startsWith('//') ||
    decodedPathname.includes('\\') ||
    ASCII_CONTROL_CHAR_RE.test(decodedPathname) ||
    isGuestLoginPathname(decodedPathname)
  ) {
    return null;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/**
 * Returns a normalized same-origin relative path, falling back to `/` when validation fails.
 */
export function getSafeCallbackUrl(url: string | null | undefined): string {
  return normalizeSafeCallbackPath(url) ?? '/';
}
