/**
 * Shared, runtime-agnostic policy helpers for `TRUST_PROXY` hop-count parsing,
 * production public-host validation, and local/internal hostname classification.
 *
 * Kept free of Node-only or framework-specific dependencies so `src/env.ts`,
 * Edge Middleware, cookie security helpers, and CLI preflight scripts enforce
 * identical rules without duplicating host or hop-count logic.
 */

export const PRODUCTION_PUBLIC_TRUST_PROXY_ERROR =
  'TRUST_PROXY must be set to an explicit non-negative integer hop count (e.g., 0, 1, or 2) in production when ALLOWED_HOSTS includes non-local domains';

/**
 * @param {string} val
 * @returns {string}
 */
function stripSurroundingQuotes(val) {
  const trimmed = val.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Returns `true` when `hostname` (without port) refers to a local loopback interface,
 * `*.localhost` subdomain, or single-label internal container/service name (e.g. `app`, `db`).
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLocalOrInternalHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') {
    return false;
  }
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) {
    return false;
  }
  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '[::1]' ||
    normalized === '::1' ||
    normalized === '0.0.0.0' ||
    normalized.endsWith('.localhost')
  ) {
    return true;
  }
  return !normalized.startsWith('[') && !normalized.includes('.');
}

/**
 * Returns `true` when a comma-separated `ALLOWED_HOSTS` value includes at least one
 * non-local domain or public IP literal (requiring an explicit `TRUST_PROXY` hop count
 * in production).
 *
 * @param {string | undefined} allowedHostsRaw
 * @returns {boolean}
 */
export function hasNonLocalAllowedHosts(allowedHostsRaw) {
  if (!allowedHostsRaw) {
    return false;
  }
  const entries = stripSurroundingQuotes(allowedHostsRaw)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries.some((entry) => {
    const withoutPort = entry.startsWith('[')
      ? entry.replace(/\]:\d+$/, ']')
      : entry.replace(/:\d+$/, '');
    const normalized = withoutPort.replace(/^(\*\.|\.)/, '').toLowerCase().replace(/\.$/, '');
    if (!normalized) {
      return false;
    }
    return !isLocalOrInternalHostname(normalized);
  });
}

/**
 * Returns `true` only when `val` is an explicit non-negative integer hop count (`0`, `1`, `2`, ...),
 * rejecting omitted, blank, or boolean (`true`/`false`) inputs.
 *
 * @param {unknown} val
 * @returns {boolean}
 */
export function isExplicitTrustProxyHopCount(val) {
  if (typeof val === 'number') {
    return Number.isInteger(val) && val >= 0;
  }
  if (typeof val === 'string') {
    const trimmed = stripSurroundingQuotes(val);
    return /^\d+$/.test(trimmed);
  }
  return false;
}

/**
 * Validates raw `TRUST_PROXY` syntax (`true`, `false`, empty, or non-negative integer hop count).
 *
 * @param {unknown} val
 * @returns {boolean}
 */
export function isValidTrustProxyInput(val) {
  if (val === undefined || val === null) {
    return true;
  }
  if (typeof val === 'boolean') {
    return true;
  }
  if (typeof val === 'number') {
    return Number.isInteger(val) && val >= 0;
  }
  if (typeof val === 'string') {
    const trimmed = stripSurroundingQuotes(val).toLowerCase();
    return trimmed === '' || trimmed === 'true' || trimmed === 'false' || /^\d+$/.test(trimmed);
  }
  return false;
}

/**
 * Parses `TRUST_PROXY` while preserving numeric `0` (`typeof === 'number'`, falsy for `Boolean(0)`)
 * so explicit direct-ingress configuration (`TRUST_PROXY=0`) remains distinguishable from omitted
 * or boolean (`false` / `true`) values.
 *
 * @param {unknown} val
 * @returns {boolean | number}
 */
export function parseTrustProxyValue(val) {
  if (val === undefined || val === null || val === '') {
    return false;
  }
  if (typeof val === 'boolean') {
    return val;
  }
  if (typeof val === 'number') {
    if (!Number.isInteger(val) || val < 0) {
      return false;
    }
    return val;
  }
  if (typeof val === 'string') {
    const trimmed = stripSurroundingQuotes(val).toLowerCase();
    if (trimmed === '' || trimmed === 'false') {
      return false;
    }
    if (trimmed === 'true') {
      return true;
    }
    if (/^\d+$/.test(trimmed)) {
      return parseInt(trimmed, 10);
    }
  }
  return false;
}

/**
 * Enforces explicit non-negative integer `TRUST_PROXY` hop counts when running in production
 * with non-local `ALLOWED_HOSTS` (outside build/export and `E2E_TEST=true` test harnesses).
 *
 * @param {{
 *   isProduction: boolean;
 *   isBuildTime?: boolean;
 *   isE2ETestMode?: boolean;
 *   allowedHosts: string | undefined;
 *   rawTrustProxy?: unknown;
 *   parsedTrustProxy?: boolean | number;
 * }} input
 * @returns {string | null}
 */
export function getProductionTrustProxyError(input) {
  if (!input.isProduction || input.isBuildTime || input.isE2ETestMode) {
    return null;
  }
  if (!hasNonLocalAllowedHosts(input.allowedHosts)) {
    return null;
  }
  const hasExplicitHopCount =
    input.parsedTrustProxy !== undefined
      ? typeof input.parsedTrustProxy === 'number' &&
        Number.isInteger(input.parsedTrustProxy) &&
        input.parsedTrustProxy >= 0
      : isExplicitTrustProxyHopCount(input.rawTrustProxy);

  return hasExplicitHopCount ? null : PRODUCTION_PUBLIC_TRUST_PROXY_ERROR;
}
