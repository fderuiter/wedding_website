/**
 * Stateless URL base-path helpers for Next.js static export subpath deployments
 * (configured via `NEXT_PUBLIC_BASE_PATH`, e.g. `/wedding_website/demo`).
 */

/**
 * Returns the normalized Next.js base path without trailing slash (e.g. `''` or `'/wedding_website/demo'`).
 */
export function getBasePath(overrideBasePath?: string): string {
  let raw = (overrideBasePath ?? process.env.NEXT_PUBLIC_BASE_PATH ?? '').trim();
  if (
    overrideBasePath === undefined &&
    !raw &&
    typeof window !== 'undefined' &&
    window.location?.pathname?.endsWith('/iframe.html')
  ) {
    raw = window.location.pathname.slice(0, -'/iframe.html'.length);
  }
  if (!raw || raw === '/') {
    return '';
  }
  const normalized = raw.replace(/\/+/g, '/').replace(/\/+$/, '');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * Prefixes a root-relative path (e.g. `'/images/sample.jpg'` or `'/admin/dashboard'`)
 * with `NEXT_PUBLIC_BASE_PATH` idempotently. External URLs (`http:`, `https:`, `data:`, `blob:`)
 * and already-prefixed paths are returned unchanged.
 */
export function withBasePath(targetPath: string, overrideBasePath?: string): string {
  if (!targetPath || typeof targetPath !== 'string') {
    return targetPath;
  }
  const trimmed = targetPath.trim();
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/\\')
  ) {
    return targetPath;
  }

  const basePath = getBasePath(overrideBasePath);
  if (!basePath) {
    return trimmed;
  }

  if (trimmed === basePath || trimmed.startsWith(`${basePath}/`) || trimmed.startsWith(`${basePath}?`) || trimmed.startsWith(`${basePath}#`)) {
    return trimmed;
  }

  return trimmed === '/' ? `${basePath}/` : `${basePath}${trimmed}`;
}

/**
 * Strips `NEXT_PUBLIC_BASE_PATH` from a pathname so route and `/api/*` matchers
 * operate on canonical application paths (e.g. `'/wedding_website/demo/api/rsvp'` -> `'/api/rsvp'`).
 */
export function stripBasePath(pathname: string, overrideBasePath?: string): string {
  if (!pathname) {
    return '/';
  }
  const basePath = getBasePath(overrideBasePath);
  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    const rest = pathname.slice(basePath.length);
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return pathname;
}

/**
 * Resolves the parent VitePress Documentation & OpenAPI Portal root URL from the demo's base path.
 * Examples:
 * - basePath `'/wedding_website/demo'` -> `'/wedding_website/'`
 * - basePath `'/demo'` -> `'/'`
 * - basePath `''` -> `'/'`
 */
export function getPortalBaseUrl(overrideBasePath?: string): string {
  const basePath = getBasePath(overrideBasePath);
  if (!basePath) {
    return '/';
  }
  if (basePath.endsWith('/demo')) {
    const parent = basePath.slice(0, -'/demo'.length);
    return parent ? `${parent}/` : '/';
  }
  return `${basePath}/`;
}
