import { env } from '@/env';

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

interface ParsedHostHeader {
  cleanHost: string;
  hostname: string;
  port: string | undefined;
}

/**
 * Parses and validates the syntax of a single HTTP Host authority value.
 * Rejects empty strings, whitespace, control/CRLF characters, comma-separated
 * host lists, malformed IPv6 brackets, invalid characters, and invalid ports.
 */
function parseHostHeader(hostHeader: string | null | undefined): ParsedHostHeader | null {
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

interface OriginAwareRequest {
  headers: {
    get(_name: string): string | null;
  };
  nextUrl?: {
    hostname: string;
    origin: string;
  };
}

/**
 * Resolves a validated canonical request origin from forwarded and host headers,
 * preserving local loopback origins (`localhost` or `127.0.0.1`) as fallback.
 */
export function resolveRequestOrigin(req: OriginAwareRequest): string {
  const hostHeader =
    req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host');
  const protoHeader = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const safeLocalFallback =
    req.nextUrl?.hostname === 'localhost' || req.nextUrl?.hostname === '127.0.0.1'
      ? req.nextUrl.origin
      : undefined;
  return getValidatedCanonicalUrl(hostHeader, protoHeader, safeLocalFallback);
}
