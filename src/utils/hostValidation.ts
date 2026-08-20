import { env } from '@/env';

/**
 * Retrieves the parsed list of allowed host rules from environment settings.
 * Rules are normalized to lowercase.
 */
export function getAllowedHosts(): string[] {
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
  if (!hostHeader || typeof hostHeader !== 'string') {
    return false;
  }

  const trimmed = hostHeader.trim().toLowerCase();
  if (!trimmed || trimmed.includes(',') || /\s/.test(trimmed)) {
    return false;
  }

  // Header injection protection: no CRLF characters
  if (/[\r\n]/.test(trimmed)) {
    return false;
  }

  // Remove trailing dot if present (e.g. "example.com.")
  const cleanHost = trimmed.replace(/\.$/, '');

  // Extract hostname and port
  let hostname = cleanHost;
  let port: string | undefined;

  if (cleanHost.startsWith('[')) {
    const bracketEnd = cleanHost.indexOf(']');
    if (bracketEnd !== -1) {
      hostname = cleanHost.substring(0, bracketEnd + 1);
      if (cleanHost.charAt(bracketEnd + 1) === ':') {
        port = cleanHost.substring(bracketEnd + 2);
      }
    }
  } else if (cleanHost.includes(':')) {
    const parts = cleanHost.split(':');
    if (parts.length === 2) {
      hostname = parts[0];
      port = parts[1];
    } else {
      // Multiple colons without brackets -> invalid format
      return false;
    }
  }

  // Port check: if port exists, must be numeric and valid port range
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) > 65535)) {
    return false;
  }

  // Hostname check: must not contain invalid characters like /, @, \, or control chars
  if (/[/@\\]/.test(hostname)) {
    return false;
  }

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
