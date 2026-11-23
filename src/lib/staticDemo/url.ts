import type { NormalizedDemoRequest } from './types';

function normalizeBasePath(rawBasePath?: string | null): string {
  if (!rawBasePath) return '';
  const trimmed = rawBasePath.trim();
  if (!trimmed || trimmed === '/') return '';
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
}

function getConfiguredBasePath(explicitBasePath?: string): string {
  if (explicitBasePath !== undefined) {
    return normalizeBasePath(explicitBasePath);
  }
  return normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
}

/**
 * Strips any configured `NEXT_PUBLIC_BASE_PATH` (or leading repository subpath segment
 * preceding `/api/`) so both root (`/api/...`) and hosted subpath (`/wedding_website/demo/api/...`)
 * requests resolve to the canonical `/api/...` route pathname.
 */
export function resolveCanonicalApiPathname(
  rawPathname: string,
  explicitBasePath?: string,
): string | null {
  if (!rawPathname) return null;

  let cleaned = rawPathname.trim();
  if (!cleaned.startsWith('/')) {
    cleaned = `/${cleaned}`;
  }

  const basePath = getConfiguredBasePath(explicitBasePath);
  if (basePath && (cleaned === basePath || cleaned.startsWith(`${basePath}/`))) {
    cleaned = cleaned.slice(basePath.length) || '/';
  }

  if (cleaned === '/api' || cleaned.startsWith('/api/')) {
    return cleaned.length > 1 ? cleaned.replace(/\/+$/, '') : cleaned;
  }

  // Also support auto-detected hosted subpath prefixes when window.location is mounted under a subpath
  const apiMarkerIndex = cleaned.indexOf('/api/');
  if (apiMarkerIndex > 0) {
    const candidate = cleaned.slice(apiMarkerIndex);
    return candidate.length > 1 ? candidate.replace(/\/+$/, '') : candidate;
  }
  if (cleaned.endsWith('/api')) {
    return '/api';
  }

  return null;
}

/**
 * Normalizes a fetch `RequestInfo | URL` + `RequestInit` or `Request` into a canonical
 * `NormalizedDemoRequest` if it targets a same-origin (or relative) `/api/*` endpoint.
 * External third-party origins (e.g. `https://amazon.com/...`) return `null` so they pass through.
 */
export function normalizeDemoRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { basePath?: string; currentOrigin?: string; mode?: 'browser' | 'msw' },
): NormalizedDemoRequest | null {
  const defaultOrigin =
    options?.currentOrigin ||
    (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null'
      ? window.location.origin
      : 'http://localhost:3000');

  let request: Request;
  let parsedUrl: URL;

  try {
    if (input instanceof Request) {
      request = init ? new Request(input, init) : input;
      parsedUrl = new URL(request.url, defaultOrigin);
    } else if (input instanceof URL) {
      parsedUrl = input;
      request = new Request(parsedUrl.toString(), init);
    } else {
      const rawUrl = String(input);
      parsedUrl = new URL(rawUrl, defaultOrigin);
      request = new Request(parsedUrl.toString(), init);
    }
  } catch {
    return null;
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return null;
  }

  const isStandardMockPort =
    parsedUrl.port === '' ||
    parsedUrl.port === '80' ||
    parsedUrl.port === '443' ||
    parsedUrl.port === '3000' ||
    parsedUrl.port === '6006';

  const isLocalTestHost =
    parsedUrl.origin === defaultOrigin ||
    ((parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1') &&
      (options?.mode !== 'msw' || isStandardMockPort));

  if (!isLocalTestHost) {
    return null;
  }

  const canonicalPathname = resolveCanonicalApiPathname(parsedUrl.pathname, options?.basePath);
  if (!canonicalPathname || (canonicalPathname !== '/api' && !canonicalPathname.startsWith('/api/'))) {
    return null;
  }

  return {
    request,
    method: (request.method || 'GET').toUpperCase(),
    pathname: canonicalPathname,
    searchParams: parsedUrl.searchParams,
    origin: parsedUrl.origin,
  };
}
