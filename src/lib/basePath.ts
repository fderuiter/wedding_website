/**
 * Normalizes a configured base path string (e.g. `NEXT_PUBLIC_BASE_PATH`).
 * Returns `''` when unset, blank, `'/'`, or composed exclusively of slashes;
 * otherwise returns a single-leading-slash path with no trailing slashes (e.g. `'/wedding_website/demo'`).
 */
export function normalizeBasePath(rawBasePath?: string | null): string {
  const trimmed = rawBasePath?.trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailingSlashes = withLeadingSlash.replace(/\/+$/, '');
  return withoutTrailingSlashes === '' ? '' : withoutTrailingSlashes;
}

/**
 * Reads and normalizes `process.env.NEXT_PUBLIC_BASE_PATH` (or an explicit override),
 * falling back to Storybook `/iframe.html` subpath detection when unset in browser previews.
 */
export function getBasePath(basePathOverride?: string): string {
  if (basePathOverride !== undefined) {
    return normalizeBasePath(basePathOverride);
  }
  const envBase = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  if (envBase) {
    return envBase;
  }
  if (
    typeof window !== 'undefined' &&
    window.location?.pathname?.endsWith('/iframe.html')
  ) {
    return normalizeBasePath(window.location.pathname.slice(0, -'/iframe.html'.length));
  }
  return '';
}

/**
 * Resolves the parent VitePress Documentation & OpenAPI Portal root URL from the demo's base path.
 * Examples:
 * - `'/wedding_website/demo'` -> `'/wedding_website/'`
 * - `'/demo'` -> `'/'`
 * - `''` -> `'/'`
 */
export function getPortalBaseUrl(basePathOverride?: string): string {
  const basePath = getBasePath(basePathOverride);
  if (!basePath) {
    return '/';
  }
  if (basePath.endsWith('/demo')) {
    const parent = basePath.slice(0, -'/demo'.length);
    return parent ? `${parent}/` : '/';
  }
  return `${basePath}/`;
}

function isSafeRootRelativePath(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\');
}

function hasBasePathPrefix(url: string, basePath: string): boolean {
  return (
    url === basePath ||
    url.startsWith(`${basePath}/`) ||
    url.startsWith(`${basePath}?`) ||
    url.startsWith(`${basePath}#`)
  );
}

/**
 * Prefixes a root-relative application URL (`/api/...`, `/images/...`, `/admin/...`)
 * with the active showcase base path without modifying external, inline-data,
 * protocol-relative, or hash-anchor URLs, and without double-prefixing.
 */
export function withBasePath(url: string, basePathOverride?: string): string {
  if (!url) {
    return url;
  }

  const trimmed = url.trim();
  if (!isSafeRootRelativePath(trimmed)) {
    return url;
  }

  const basePath =
    basePathOverride !== undefined
      ? normalizeBasePath(basePathOverride)
      : getBasePath();

  if (!basePath || hasBasePathPrefix(trimmed, basePath)) {
    return url;
  }

  return `${basePath}${trimmed}`;
}

/**
 * Strips an active showcase base path prefix from a pre-prefixed root-relative path
 * so server-side filesystem helpers (`getLocalImageDimensions`) and filename extractors
 * resolve canonical `/...` paths cleanly.
 */
export function stripBasePath(url: string, basePathOverride?: string): string {
  if (!url) {
    return url;
  }

  const trimmed = url.trim();
  if (!isSafeRootRelativePath(trimmed)) {
    return url;
  }

  const basePath =
    basePathOverride !== undefined
      ? normalizeBasePath(basePathOverride)
      : getBasePath();

  if (!basePath || !hasBasePathPrefix(trimmed, basePath)) {
    return url;
  }

  const remainder = trimmed.slice(basePath.length);
  if (!remainder) {
    return '/';
  }
  return remainder.startsWith('/') ? remainder : `/${remainder}`;
}

export type ShowcaseRoute = '/' | '/api/' | '/storybook/';

/**
 * Resolves the parent showcase portal base path from `NEXT_PUBLIC_BASE_PATH`
 * without introducing additional environment variables.
 *
 * Examples:
 * - `''`, `'/'`, or `'/demo'` -> `''`
 * - `'/wedding_website/demo'` -> `'/wedding_website'`
 * - `'/org/preview/demo'` -> `'/org/preview'`
 */
export function getShowcasePortalBasePath(basePathOverride?: string): string {
  const basePath =
    basePathOverride !== undefined
      ? normalizeBasePath(basePathOverride)
      : getBasePath();

  if (!basePath || basePath === '/demo') {
    return '';
  }

  if (basePath.endsWith('/demo')) {
    return basePath.slice(0, -'/demo'.length);
  }

  return basePath;
}

/**
 * Builds a subpath-safe sibling showcase URL (`/`, `/api/`, or `/storybook/`)
 * relative to the active `NEXT_PUBLIC_BASE_PATH` deployment prefix.
 */
export function resolveShowcasePath(
  route: ShowcaseRoute,
  basePathOverride?: string,
): string {
  const portalBase = getShowcasePortalBasePath(basePathOverride);
  return `${portalBase}${route}`;
}

