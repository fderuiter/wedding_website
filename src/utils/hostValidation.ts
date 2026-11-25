import { env } from '@/env';
import { isLocalOrInternalHostname } from '@/lib/trustProxyPolicy';

/**
 * Retrieves the parsed list of allowed host rules from environment settings.
 * Rules are normalized to lowercase.
 */
function getAllowedHosts(): string[] {
  let allowedEnv: string | undefined;
  try {
    allowedEnv = env.ALLOWED_HOSTS;
  } catch {
    allowedEnv = process.env.ALLOWED_HOSTS;
  }

  if (!allowedEnv) {
    return [];
  }

  return allowedEnv
    .split(',')
    .map(h => h.trim().toLowerCase())
    .filter(Boolean);
}

export interface ParsedHostHeader {
  cleanHost: string;
  hostname: string;
  port: string | undefined;
}

/**
 * Parses and validates the syntax of a single HTTP Host authority value.
 * Rejects empty strings, whitespace, control/CRLF characters, comma-separated
 * host lists, malformed IPv6 brackets, invalid characters, and invalid ports.
 */
export function parseHostHeader(hostHeader: string | null | undefined): ParsedHostHeader | null {
  if (!hostHeader || typeof hostHeader !== 'string') {
    return null;
  }

  // Reject control/CRLF characters, any whitespace, or multiple comma-separated hosts
  if (
    /[\r\n\x00-\x1f\x7f]/.test(hostHeader) ||
    /\s/.test(hostHeader) ||
    hostHeader.includes(',')
  ) {
    return null;
  }

  const normalized = hostHeader.toLowerCase();

  // Remove single trailing DNS root dot if present (e.g. "example.com.")
  const cleanHost = normalized.replace(/\.$/, '');
  if (!cleanHost) {
    return null;
  }

  let hostname = cleanHost;
  let port: string | undefined;

  if (cleanHost.startsWith('[')) {
    const bracketEnd = cleanHost.indexOf(']');
    if (bracketEnd <= 1) {
      return null;
    }
    hostname = cleanHost.substring(0, bracketEnd + 1);
    const remainder = cleanHost.substring(bracketEnd + 1);
    if (remainder.length > 0) {
      if (!remainder.startsWith(':')) {
        return null;
      }
      port = remainder.substring(1);
    }
  } else if (cleanHost.includes(':')) {
    const parts = cleanHost.split(':');
    if (parts.length !== 2 || !parts[0]) {
      return null;
    }
    hostname = parts[0].replace(/\.$/, '');
    port = parts[1];
  }

  // Port check: if port delimiter is present, must be numeric in valid TCP port range 1..65535
  if (port !== undefined) {
    if (!/^\d+$/.test(port)) {
      return null;
    }
    const portNumber = Number(port);
    if (portNumber < 1 || portNumber > 65535) {
      return null;
    }
  }

  // Hostname check: must not be empty or contain path, userinfo, query, fragment, or empty labels
  if (
    !hostname ||
    /[/@\\?#]/.test(hostname) ||
    (!hostname.startsWith('[') && (hostname.startsWith('.') || hostname.includes('..')))
  ) {
    return null;
  }

  if (hostname.startsWith('[')) {
    const ipv6Body = hostname.slice(1, -1);
    if (!ipv6Body || !/^[0-9a-f:.]+$/.test(ipv6Body) || !ipv6Body.includes(':')) {
      return null;
    }
  } else if (hostname.includes('[') || hostname.includes(']')) {
    return null;
  }

  return { cleanHost, hostname, port };
}

/**
 * Validates that a Host header is syntactically well-formed without checking ALLOWED_HOSTS.
 * Used by stateless read-only health probes so orchestrator/internal probe hosts succeed
 * while header-injection and malformed Host headers are still rejected at the perimeter.
 *
 * @param hostHeader - The raw Host or resolved X-Forwarded-Host authority value
 * @returns true if the host header has valid single-authority syntax; false otherwise.
 */
export function isHostSyntaxValid(hostHeader: string | null | undefined): boolean {
  return parseHostHeader(hostHeader) !== null;
}

/**
 * Evaluates an incoming Host or X-Forwarded-Host header against the configured allowed host rules.
 *
 * @param hostHeader - The raw host header value from the HTTP request (e.g., "sub.example.com:3000")
 * @param customAllowedHosts - Optional override list of allowed hosts (useful for testing)
 * @returns true if the host header is valid and permitted; false otherwise.
 */
export function isHostAllowed(
  hostHeader: string | null | undefined,
  customAllowedHosts?: string[]
): boolean {
  const parsed = parseHostHeader(hostHeader);
  if (!parsed) {
    return false;
  }

  const { cleanHost, hostname, port } = parsed;

  const rules = customAllowedHosts ?? getAllowedHosts();
  if (rules.length === 0) {
    return false;
  }

  for (const rule of rules) {
    const cleanRule = rule.trim().toLowerCase();
    if (!cleanRule) continue;

    let ruleHost = cleanRule;
    let rulePort: string | undefined;
    if (cleanRule.includes(':') && !cleanRule.startsWith('[')) {
      const rParts = cleanRule.split(':');
      if (rParts.length === 2) {
        ruleHost = rParts[0];
        rulePort = rParts[1];
      }
    }

    if (rulePort !== undefined && port !== rulePort) {
      continue;
    }

    // Exact match on full host header, cleanHost, or hostname
    if (cleanRule === cleanHost || ruleHost === cleanHost || ruleHost === hostname) {
      return true;
    }

    // Wildcard matching: e.g. *.example.com or .example.com
    if (ruleHost.startsWith('*.') || ruleHost.startsWith('.')) {
      const baseDomain = ruleHost.startsWith('*.')
        ? ruleHost.slice(2)
        : ruleHost.slice(1);

      if (hostname === baseDomain || hostname.endsWith(`.${baseDomain}`)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Validates and constructs a canonical URL using verified host header.
 * If host is invalid or not allowed, falls back to fallbackBaseUrl.
 *
 * @param hostHeader - The raw host header from the request
 * @param protoHeader - Optional x-forwarded-proto header
 * @param fallbackBaseUrl - Fallback URL to return if host is unapproved
 */
export function getValidatedCanonicalUrl(
  hostHeader: string | null | undefined,
  protoHeader?: string | null,
  fallbackBaseUrl: string = 'http://localhost:3000'
): string {
  if (isHostAllowed(hostHeader)) {
    const cleanHost = hostHeader!.trim().toLowerCase();
    const cleanHostNoPort = cleanHost.split(':')[0];
    const isLocal =
      cleanHostNoPort === 'localhost' ||
      cleanHostNoPort === '127.0.0.1' ||
      cleanHostNoPort.endsWith('.localhost');

    const proto = protoHeader?.trim().toLowerCase();
    const protocol =
      proto === 'https' || proto === 'http'
        ? proto
        : isLocal
          ? 'http'
          : 'https';

    return `${protocol}://${cleanHost}`;
  }

  return fallbackBaseUrl;
}

export interface HeadersLookup {
  get(_name: string): string | null | undefined;
}

/**
 * Selects the trusted hop from a comma-separated forwarded header value (`X-Forwarded-Host`,
 * `X-Forwarded-Proto`) when `TRUST_PROXY` is enabled, matching `src/utils/rateLimit.ts`.
 * Returns `null` when `TRUST_PROXY` is disabled or when the header contains control characters.
 */
function resolveTrustedForwardedValue(
  rawHeader: string | null | undefined,
  trustProxy: boolean | number = env.TRUST_PROXY
): string | null {
  if (!trustProxy || !rawHeader || typeof rawHeader !== 'string') {
    return null;
  }

  if (/[\r\n\x00-\x1f\x7f]/.test(rawHeader)) {
    return null;
  }

  const hops = typeof trustProxy === 'number' ? Math.max(1, Math.trunc(trustProxy)) : 1;
  const parts = rawHeader
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return null;
  }

  return parts[Math.max(0, parts.length - hops)] ?? null;
}

/**
 * Resolves the effective request `Host` authority, reading `X-Forwarded-Host` only when
 * `env.TRUST_PROXY` is enabled and the selected forwarded hop matches `ALLOWED_HOSTS`,
 * falling back to `Host` (or `fallbackHost`).
 */
export function resolveRequestHost(
  headers: HeadersLookup | null | undefined,
  fallbackHost?: string | null
): string | null {
  const forwardedHost = headers
    ? resolveTrustedForwardedValue(headers.get('x-forwarded-host'))
    : null;
  if (forwardedHost && isHostAllowed(forwardedHost)) {
    return forwardedHost;
  }

  const directHost = headers?.get('host')?.trim();
  if (directHost) {
    return directHost;
  }

  const normalizedFallback = fallbackHost?.trim();
  return normalizedFallback || null;
}

/**
 * Normalizes or strips `x-forwarded-host` on downstream middleware request headers so
 * untrusted or unapproved client-supplied `x-forwarded-host` values never reach SSR or API layers.
 */
export function sanitizeForwardedHostHeader(
  requestHeaders: Headers,
  resolvedHost: string | null,
  rawForwardedHost?: string | null
): void {
  if (!env.TRUST_PROXY) {
    requestHeaders.delete('x-forwarded-host');
    return;
  }
  if (rawForwardedHost !== null && rawForwardedHost !== undefined) {
    if (resolvedHost && isHostAllowed(resolvedHost)) {
      requestHeaders.set('x-forwarded-host', resolvedHost);
    } else {
      requestHeaders.delete('x-forwarded-host');
    }
  }
}

/**
 * Resolves the effective request protocol (`http` or `https`), reading `X-Forwarded-Proto`
 * only when `env.TRUST_PROXY` is enabled and falling back to `fallbackProto` when valid.
 */
export function resolveRequestProtocol(
  headers: HeadersLookup | null | undefined,
  fallbackProto?: string | null
): 'http' | 'https' | null {
  const forwardedProto = headers
    ? resolveTrustedForwardedValue(headers.get('x-forwarded-proto'))?.toLowerCase()
    : null;
  if (forwardedProto === 'https' || forwardedProto === 'http') {
    return forwardedProto;
  }

  const normalizedFallback = fallbackProto?.trim().replace(/:$/, '').toLowerCase();
  if (normalizedFallback === 'https' || normalizedFallback === 'http') {
    return normalizedFallback;
  }

  return null;
}

/**
 * Normalizes a tenant subdomain identifier to lowercase, treating empty values and `www`
 * as the root/global site (`null`).
 */
export function normalizeTenantSubdomain(subdomain: string | null | undefined): string | null {
  if (!subdomain || typeof subdomain !== 'string') {
    return null;
  }
  const normalized = subdomain.trim().toLowerCase();
  if (!normalized || normalized === 'www') {
    return null;
  }
  return normalized;
}

/**
 * Extracts the normalized tenant subdomain from a single `Host` authority after verifying
 * `ALLOWED_HOSTS` membership. Returns `null` for loopback hosts, `www`, apex domains, or
 * disallowed hosts.
 */
function extractSubdomainFromHost(
  hostHeader: string | null | undefined,
  customAllowedHosts?: string[]
): string | null {
  if (!hostHeader || !isHostAllowed(hostHeader, customAllowedHosts)) {
    return null;
  }

  const parsed = parseHostHeader(hostHeader);
  if (!parsed) {
    return null;
  }

  const { hostname } = parsed;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('[')) {
    return null;
  }

  const parts = hostname.split('.');
  if (hostname.endsWith('.localhost')) {
    return normalizeTenantSubdomain(parts[0]);
  }

  if (parts.length >= 3) {
    return normalizeTenantSubdomain(parts[0]);
  }

  return null;
}

/**
 * Resolves the normalized tenant subdomain from request headers using `TRUST_PROXY`-gated
 * host resolution and `ALLOWED_HOSTS` validation.
 */
export function resolveRequestSubdomain(
  headers: HeadersLookup | null | undefined,
  fallbackHost?: string | null
): string | null {
  const host = resolveRequestHost(headers, fallbackHost);
  return extractSubdomainFromHost(host);
}

interface OriginAwareRequest {
  headers: HeadersLookup;
  nextUrl?: {
    hostname?: string;
    host?: string;
    protocol?: string;
    origin?: string;
  };
}

/**
 * Resolves a validated canonical request origin from `TRUST_PROXY`-gated forwarded and host headers,
 * preserving local loopback origins (`localhost` or `127.0.0.1`) as fallback.
 */
export function resolveRequestOrigin(req: OriginAwareRequest): string {
  const hostHeader = resolveRequestHost(req.headers, req.nextUrl?.host);
  const protoHeader = resolveRequestProtocol(req.headers, req.nextUrl?.protocol);
  const safeLocalFallback =
    (req.nextUrl?.hostname === 'localhost' || req.nextUrl?.hostname === '127.0.0.1') &&
    req.nextUrl?.origin
      ? req.nextUrl.origin
      : undefined;
  return getValidatedCanonicalUrl(hostHeader, protoHeader, safeLocalFallback).replace(/\/+$/, '');
}

const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isMutatingMethod(method?: string | null): boolean {
  if (!method) return false;
  return MUTATING_HTTP_METHODS.has(method.trim().toUpperCase());
}

/**
 * Exempts machine-authenticated endpoints (`POST /api/registry/webhook/stripe` using Stripe
 * webhook HMAC signatures and `/api/cron/*` using `CRON_SECRET` Bearer tokens) from browser
 * Fetch Metadata and Origin/Referer checks.
 */
function isOriginCheckExemptApiPath(
  pathname: string,
  method?: string | null
): boolean {
  const normalizedPath =
    pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname || '/';
  if (normalizedPath === '/api/cron' || normalizedPath.startsWith('/api/cron/')) {
    return true;
  }
  const upperMethod = (method || 'GET').trim().toUpperCase();
  if (normalizedPath === '/api/registry/webhook/stripe' && upperMethod === 'POST') {
    return true;
  }
  return false;
}

export interface MutationOriginCheckRequest {
  method?: string;
  url?: string;
  headers: {
    get(_name: string): string | null;
  };
  nextUrl?: {
    pathname?: string;
    hostname: string;
    host?: string;
    origin: string;
    protocol?: string;
  };
}

function normalizeOriginUrl(rawUrl: string): string {
  if (!rawUrl) return '';
  try {
    return new URL(rawUrl).origin.toLowerCase();
  } catch {
    return '';
  }
}

function resolveStrictExpectedOrigin(req: MutationOriginCheckRequest): string {
  let parsedReqUrl: URL | null = null;
  if (!req.nextUrl && typeof req.url === 'string' && req.url) {
    try {
      parsedReqUrl = new URL(req.url, 'http://localhost');
    } catch {
      parsedReqUrl = null;
    }
  }

  const rawHost = req.headers.get('host')?.trim();
  const fallbackUrlHost = req.nextUrl?.host || parsedReqUrl?.host || req.nextUrl?.hostname || '';
  const effectiveHost = resolveRequestHost(req.headers, fallbackUrlHost) || '';
  const hasApprovedForwardedHost = Boolean(
    effectiveHost && effectiveHost !== rawHost && effectiveHost !== fallbackUrlHost
  );

  const forwardedProto = resolveTrustedForwardedValue(
    req.headers.get('x-forwarded-proto')
  )?.toLowerCase();
  const rawUrlProto = (req.nextUrl?.protocol || parsedReqUrl?.protocol || '')
    .replace(/:$/, '')
    .toLowerCase();

  let effectiveProto: string | undefined;
  if (forwardedProto === 'https' || forwardedProto === 'http') {
    effectiveProto = forwardedProto;
  } else if (rawUrlProto === 'https') {
    effectiveProto = 'https';
  } else if (rawUrlProto === 'http') {
    const parsedHost = parseHostHeader(effectiveHost);
    const hostname = parsedHost?.hostname ?? '';
    const isLocal = Boolean(hostname && isLocalOrInternalHostname(hostname));
    const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
    effectiveProto = isLocal || !isProduction ? 'http' : 'https';
  }

  const fallbackHostname = req.nextUrl?.hostname || parsedReqUrl?.hostname || '';
  const fallbackOrigin = req.nextUrl?.origin || parsedReqUrl?.origin || '';
  const safeLocalFallback =
    !hasApprovedForwardedHost &&
    !rawHost &&
    (fallbackHostname === 'localhost' || fallbackHostname === '127.0.0.1')
      ? fallbackOrigin
      : '';

  const canonical = getValidatedCanonicalUrl(effectiveHost, effectiveProto, safeLocalFallback);
  return normalizeOriginUrl(canonical);
}

/**
 * Validates Fetch Metadata (`Sec-Fetch-Site`) and `Origin` / `Referer` headers on mutating
 * HTTP requests (`POST`, `PUT`, `PATCH`, `DELETE`).
 *
 * @returns An error message string if the request must be rejected with HTTP 403, or `null` if permitted.
 */
export function validateMutatingRequestOrigin(
  req: MutationOriginCheckRequest | null | undefined
): string | null {
  if (!req || typeof req.headers?.get !== 'function') {
    return null;
  }

  const method = (req.method || 'GET').trim().toUpperCase();
  if (!isMutatingMethod(method)) {
    return null;
  }

  let pathname = req.nextUrl?.pathname || '';
  if (!pathname && typeof req.url === 'string' && req.url) {
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }
  }

  if (isOriginCheckExemptApiPath(pathname || '/', method)) {
    return null;
  }

  const secFetchSite = req.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return 'Cross-origin request blocked by Fetch Metadata policy.';
  }

  const originHeader = req.headers.get('origin')?.trim() || '';
  const refererHeader = req.headers.get('referer')?.trim() || '';
  if (!originHeader && !refererHeader) {
    return null;
  }

  const expectedOrigin = resolveStrictExpectedOrigin(req);
  if (!expectedOrigin) {
    return 'Cross-origin request blocked.';
  }

  if (originHeader) {
    const parsedOrigin = normalizeOriginUrl(originHeader);
    if (!parsedOrigin || parsedOrigin !== expectedOrigin) {
      return 'Cross-origin request blocked.';
    }
  }

  if (refererHeader) {
    const parsedRefererOrigin = normalizeOriginUrl(refererHeader);
    if (!parsedRefererOrigin || parsedRefererOrigin !== expectedOrigin) {
      return 'Cross-origin request blocked.';
    }
  }

  return null;
}
