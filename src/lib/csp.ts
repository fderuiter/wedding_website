import { env } from '@/env';

export const CSP_NONCE_HEADER = 'x-nonce';

const VALID_CSP_NONCE_REGEX = /^[A-Za-z0-9+/_-]+={0,2}$/;

export interface BuildContentSecurityPolicyOptions {
  nonce?: string | null;
  isDev?: boolean;
  s3PublicUrl?: string | null;
}

export function isValidCspNonce(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && VALID_CSP_NONCE_REGEX.test(value);
}

export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  if (typeof btoa === 'function') {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
}

function resolveConfiguredOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Builds the application Content-Security-Policy header value for non-upload routes.
 * Replaces static production 'unsafe-inline' and 'unsafe-eval' rules with per-request
 * script nonces, 'wasm-unsafe-eval' + blob: workers for Rapier 3D physics, and strict
 * outbound connect-src origins (allowing 'unsafe-eval' only in development).
 */
export function buildContentSecurityPolicy(
  options?: BuildContentSecurityPolicyOptions | string
): string {
  const resolvedOptions: BuildContentSecurityPolicyOptions =
    typeof options === 'string' ? { nonce: options } : (options ?? {});

  const nonce = isValidCspNonce(resolvedOptions.nonce) ? resolvedOptions.nonce : null;
  const isDev =
    resolvedOptions.isDev !== undefined
      ? resolvedOptions.isDev
      : env.NODE_ENV === 'development';
  const rawS3PublicUrl =
    resolvedOptions.s3PublicUrl !== undefined
      ? resolvedOptions.s3PublicUrl
      : env.S3_PUBLIC_URL;
  const s3Origin = resolveConfiguredOrigin(rawS3PublicUrl);

  const scriptSources = [
    "'self'",
    ...(nonce ? [`'nonce-${nonce}'`] : []),
    "'wasm-unsafe-eval'",
    ...(isDev ? ["'unsafe-eval'"] : []),
    'blob:',
    'https://js.stripe.com',
  ];

  const connectSources = [
    "'self'",
    'https://api.stripe.com',
    'https://js.stripe.com',
    'https://hooks.stripe.com',
    'https://*.basemaps.cartocdn.com',
    ...(s3Origin ? [s3Origin] : []),
  ];
  const uniqueConnectSources = Array.from(new Set(connectSources));

  const imgSources = [
    "'self'",
    'data:',
    'blob:',
    'https:',
    ...(s3Origin && s3Origin.startsWith('http://') ? [s3Origin] : []),
  ];

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(' ')}`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSources.join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${uniqueConnectSources.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ];

  return `${directives.join('; ')};`;
}
