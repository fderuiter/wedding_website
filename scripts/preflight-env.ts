import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isValidPostgresUrl } from '../src/lib/postgres-url.js';
import {
  getProductionTrustProxyError,
  isValidTrustProxyInput,
} from '../src/lib/trustProxyPolicy.js';

export type PreflightTarget = 'compose' | 'standalone' | 'host';
export type PreflightMode = 'development' | 'production';

export interface ParsedDotenvEntry {
  key: string;
  value: string;
  rawRhs: string;
  quoteStyle: 'single' | 'double' | 'none';
  line: number;
}

export interface PreflightIssue {
  key: string;
  rule: string;
  message: string;
  remediation: string;
}

export interface PreflightValidationOptions {
  target?: PreflightTarget;
  mode?: PreflightMode;
  composeContent?: string;
}

export interface PreflightResult {
  ok: boolean;
  target: PreflightTarget;
  mode: PreflightMode;
  envFilePath: string;
  checkedKeysCount: number;
  composeRequiredGuards: string[];
  issues: PreflightIssue[];
}

export interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const SCRYPT_SALT_BYTES = 16;
const SCRYPT_KEY_BYTES = 64;
const STRICT_BASE64_REGEX =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const ALLOWED_HOST_ENTRY_REGEX =
  /^((\*\.|\.)?[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*|localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:[0-9]+)?$/;

function isPlaceholderStripeKey(key: string): boolean {
  const prefix = key.slice(0, 3);
  return (prefix === 'sk_' || prefix === 'pk_') && key.slice(3) === 'test_placeholder_mock_key';
}

const DUMMY_DATABASE_URLS = new Set([
  'postgresql://dummy:dummy@localhost:5432/dummy',
  'postgres://dummy:dummy@localhost:5432/dummy',
  'postgresql://dummy:dummy@localhost:5432/dummy_shadow',
  'postgres://dummy:dummy@localhost:5432/dummy_shadow',
]);

const BLOCKED_PROD_ADMIN_HASHES = new Set([
  'scrypt:c2FsdA==:aGFzaA==',
  'scrypt:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
  'scrypt:d2VkZGluZy1lMmUtc2FsdA==:q++ok9TyDBa8bSKUlVR+j/tjiVTGj95CWT5HK8KkpIHzWRnv2t2hAhDz2PkdPUDsMO+ulGpXGCFQAqDKwK7Lxw==',
]);

const BLOCKED_PROD_GUEST_PASSCODES = new Set([
  'wedding2026',
  'your-unique-guest-passcode',
  'replace-with-unique-guest-passcode',
  'playwright-e2e-guest-passcode',
  'build-fallback-guest-passcode',
  'test-standalone-guest-passcode',
]);

const BLOCKED_PROD_SESSION_SECRETS = new Set([
  'default-guest-session-secret',
  'your-dedicated-guest-session-secret',
  'replace-with-random-secret-at-least-32-characters',
  'playwright-e2e-session-secret-32-chars-min',
  'test-guest-session-secret-key-at-least-32-chars',
  'test-standalone-guest-session-secret-32chars',
]);

const BLOCKED_PROD_DB_PASSWORDS = new Set([
  'wedding123',
]);

const S3_REQUIRED_GROUP = [
  'S3_BUCKET',
  'S3_REGION',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
] as const;

function decodeStrictBase64ByteLength(b64: string): number | null {
  if (!b64 || b64.length % 4 !== 0 || !STRICT_BASE64_REGEX.test(b64)) {
    return null;
  }
  try {
    return Buffer.from(b64, 'base64').length;
  } catch {
    return null;
  }
}

export function isValidProductionScryptHash(val: string): boolean {
  const parts = val.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const saltBytes = decodeStrictBase64ByteLength(parts[1]);
  const keyBytes = decodeStrictBase64ByteLength(parts[2]);
  return saltBytes === SCRYPT_SALT_BYTES && keyBytes === SCRYPT_KEY_BYTES;
}

function isCloudflareR2ApiEndpoint(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === 'r2.cloudflarestorage.com' || host.endsWith('.r2.cloudflarestorage.com');
  } catch {
    return /(?:^|\/\/|\.)r2\.cloudflarestorage\.com(?:[:/]|$)/i.test(endpoint);
  }
}

function stripUnquotedInlineComment(rawVal: string): string {
  for (let i = 0; i < rawVal.length; i++) {
    if (rawVal[i] === '#' && (i === 0 || /\s/.test(rawVal[i - 1]))) {
      return rawVal.slice(0, i).trimEnd();
    }
  }
  return rawVal.trimEnd();
}

function unescapeDoubleQuotedValue(inner: string): string {
  let out = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '\\' && i + 1 < inner.length) {
      const next = inner[i + 1];
      if (next === 'n') {
        out += '\n';
      } else if (next === 'r') {
        out += '\r';
      } else if (next === 't') {
        out += '\t';
      } else if (next === '"' || next === '\\') {
        out += next;
      } else {
        out += `\\${next}`;
      }
      i++;
    } else {
      out += inner[i];
    }
  }
  return out;
}

export function parseDotenvContent(content: string): Map<string, ParsedDotenvEntry> {
  const entries = new Map<string, ParsedDotenvEntry>();
  const lines = content.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNum = idx + 1;
    const trimmed = lines[idx].trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const withoutExport = trimmed.startsWith('export ')
      ? trimmed.slice('export '.length).trimStart()
      : trimmed;
    const eqIdx = withoutExport.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }

    const key = withoutExport.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    const rawRhs = withoutExport.slice(eqIdx + 1).trim();
    let value = rawRhs;
    let quoteStyle: 'single' | 'double' | 'none' = 'none';

    if (rawRhs.length >= 2 && rawRhs.startsWith('\'') && rawRhs.endsWith('\'')) {
      quoteStyle = 'single';
      value = rawRhs.slice(1, -1);
    } else if (rawRhs.length >= 2 && rawRhs.startsWith('"') && rawRhs.endsWith('"')) {
      quoteStyle = 'double';
      value = unescapeDoubleQuotedValue(rawRhs.slice(1, -1));
    } else {
      quoteStyle = 'none';
      value = stripUnquotedInlineComment(rawRhs);
    }

    entries.set(key, {
      key,
      value,
      rawRhs,
      quoteStyle,
      line: lineNum,
    });
  }

  return entries;
}

function stripYamlCommentLine(line: string): string {
  let quote: '"' | '\'' | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && quote === '"') {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
      }
    } else if (ch === '"' || ch === '\'') {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

export function extractComposeRequiredGuards(composeContent: string): string[] {
  const guards = new Set<string>();
  const requiredGuardRegex = /\$\{([A-Z0-9_]+):\?[^}]*\}/g;

  for (const rawLine of composeContent.split(/\r?\n/)) {
    if (!rawLine.trim() || /^\s*#/.test(rawLine)) {
      continue;
    }
    const cleanLine = stripYamlCommentLine(rawLine).replace(/\$\$/g, '');
    let match: RegExpExecArray | null;
    requiredGuardRegex.lastIndex = 0;
    while ((match = requiredGuardRegex.exec(cleanLine)) !== null) {
      guards.add(match[1]);
    }
  }

  return Array.from(guards);
}

function hasUnescapedComposeDollar(entry: ParsedDotenvEntry): boolean {
  if (entry.quoteStyle === 'single') {
    return false;
  }
  const strippedEscapedDollars = entry.value.replace(/\$\$/g, '');
  return strippedEscapedDollars.includes('$');
}

function resolveEffectiveValue(
  entry: ParsedDotenvEntry | undefined,
  target: PreflightTarget
): string | undefined {
  if (!entry) {
    return undefined;
  }
  if (target === 'compose' && entry.quoteStyle !== 'single') {
    return entry.value.replace(/\$\$/g, '$');
  }
  return entry.value;
}

function normalizeOptional(val: string | undefined): string | undefined {
  if (!val) {
    return undefined;
  }
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getDotenvCascadeFiles(mode: PreflightMode): string[] {
  return [`.env.${mode}.local`, '.env.local', `.env.${mode}`, '.env'];
}

function resolveInitialPreflightMode(explicitMode?: PreflightMode): PreflightMode {
  if (explicitMode === 'production' || process.env.NODE_ENV?.trim() === 'production') {
    return 'production';
  }
  return explicitMode ?? 'development';
}

export function validateOperatorEnv(
  entries: Map<string, ParsedDotenvEntry>,
  options: PreflightValidationOptions = {}
): { issues: PreflightIssue[]; composeRequiredGuards: string[]; mode: PreflightMode } {
  const target: PreflightTarget = options.target ?? 'compose';
  const composeRequiredGuards =
    target === 'compose' && options.composeContent
      ? extractComposeRequiredGuards(options.composeContent)
      : [];
  const issues: PreflightIssue[] = [];

  const getVal = (key: string): string | undefined => resolveEffectiveValue(entries.get(key), target);

  const nodeEnv = normalizeOptional(getVal('NODE_ENV'));
  const effectiveMode: PreflightMode =
    resolveInitialPreflightMode(options.mode) === 'production' || nodeEnv === 'production'
      ? 'production'
      : 'development';

  // 1. Docker Compose mandatory `:?` secret guards & unescaped `$` interpolation checks
  if (target === 'compose') {
    for (const guardKey of composeRequiredGuards) {
      const val = getVal(guardKey);
      if (!val || val.trim().length === 0) {
        issues.push({
          key: guardKey,
          rule: 'compose-required-guard',
          message: `${guardKey} is required by docker-compose.yml (\`\${${guardKey}:?...}\`) and cannot be unset or empty.`,
          remediation: `Define a strong non-empty ${guardKey} value in your .env file before running docker compose.`,
        });
      }
    }

    for (const entry of entries.values()) {
      if (hasUnescapedComposeDollar(entry)) {
        issues.push({
          key: entry.key,
          rule: 'compose-unescaped-dollar',
          message: `${entry.key} contains an unescaped "$" character that Docker Compose will interpolate.`,
          remediation: `Escape literal "$" characters as "$$" or wrap ${entry.key} in single quotes in your .env file.`,
        });
      }
    }
  }

  // 2. NODE_ENV & E2E_TEST checks
  if (nodeEnv && !['development', 'test', 'production'].includes(nodeEnv)) {
    issues.push({
      key: 'NODE_ENV',
      rule: 'invalid-node-env',
      message: 'NODE_ENV must be one of "development", "test", or "production".',
      remediation: 'Set NODE_ENV=production in your production .env file.',
    });
  }

  const e2eTest = normalizeOptional(getVal('E2E_TEST'))?.toLowerCase();
  if (effectiveMode === 'production' && (e2eTest === 'true' || e2eTest === '1')) {
    issues.push({
      key: 'E2E_TEST',
      rule: 'production-e2e-disabled',
      message: 'E2E_TEST must not be enabled ("true" / "1") in production operator .env files.',
      remediation: 'Set E2E_TEST=false (or remove E2E_TEST) in .env so SetupWizard onboarding and strict secret checks remain active.',
    });
  }

  // 3. DATABASE_URL, CONTAINER_DATABASE_URL, DB_PASSWORD, POSTGRES_URL_NON_POOLING, & CONTAINER_POSTGRES_URL_NON_POOLING
  const databaseUrl = normalizeOptional(getVal('DATABASE_URL'));
  const containerDatabaseUrl = normalizeOptional(getVal('CONTAINER_DATABASE_URL'));

  if (databaseUrl) {
    if (DUMMY_DATABASE_URLS.has(databaseUrl)) {
      issues.push({
        key: 'DATABASE_URL',
        rule: 'blocked-dummy-database-url',
        message: 'DATABASE_URL must not use a build-time dummy placeholder URL.',
        remediation: 'Configure DATABASE_URL with your real PostgreSQL connection URI (postgresql://user:password@host:5432/dbname).',
      });
    } else if (!isValidPostgresUrl(databaseUrl)) {
      issues.push({
        key: 'DATABASE_URL',
        rule: 'invalid-database-url',
        message: 'DATABASE_URL is not a valid PostgreSQL connection URI.',
        remediation: 'Ensure DATABASE_URL starts with postgres:// or postgresql://, specifies a host (or ?host=/socket), includes a database name, and percent-encodes special password characters.',
      });
    }
  }

  if (containerDatabaseUrl) {
    if (DUMMY_DATABASE_URLS.has(containerDatabaseUrl)) {
      issues.push({
        key: 'CONTAINER_DATABASE_URL',
        rule: 'blocked-dummy-database-url',
        message: 'CONTAINER_DATABASE_URL must not use a build-time dummy placeholder URL.',
        remediation: 'Configure CONTAINER_DATABASE_URL with your external PostgreSQL URI or comment it out to use the bundled Docker Compose db service.',
      });
    } else if (!isValidPostgresUrl(containerDatabaseUrl)) {
      issues.push({
        key: 'CONTAINER_DATABASE_URL',
        rule: 'invalid-container-database-url',
        message: 'CONTAINER_DATABASE_URL is not a valid PostgreSQL connection URI.',
        remediation: 'Ensure CONTAINER_DATABASE_URL starts with postgres:// or postgresql://, specifies a reachable container/external host, includes a database name, and percent-encodes special password characters.',
      });
    }
  }

  if (target === 'compose') {
    const dbPassword = normalizeOptional(getVal('DB_PASSWORD'));
    if (dbPassword) {
      if (effectiveMode === 'production' && BLOCKED_PROD_DB_PASSWORDS.has(dbPassword)) {
        issues.push({
          key: 'DB_PASSWORD',
          rule: 'blocked-db-password',
          message: 'DB_PASSWORD must not use the disposable .env.example / .env.ci default password in production.',
          remediation: 'Generate a strong random PostgreSQL password (e.g. `openssl rand -hex 24`) and set DB_PASSWORD in .env.',
        });
      } else if (!containerDatabaseUrl) {
        const dbUser = normalizeOptional(getVal('DB_USER')) ?? 'wedding';
        const dbName = normalizeOptional(getVal('DB_NAME')) ?? 'wedding';
        const synthesizedComposeUrl = `postgres://${dbUser}:${dbPassword}@db:5432/${dbName}?sslmode=disable`;
        if (!isValidPostgresUrl(synthesizedComposeUrl)) {
          issues.push({
            key: 'DB_PASSWORD',
            rule: 'invalid-compose-db-uri',
            message: 'DB_USER / DB_PASSWORD / DB_NAME produces an invalid PostgreSQL URI when interpolated by docker-compose.yml.',
            remediation: 'Use URL-safe alphanumeric/hex characters for DB_PASSWORD (e.g. `openssl rand -hex 24`) or percent-encode reserved URI delimiters.',
          });
        }
      }
    } else if (!containerDatabaseUrl && !databaseUrl && !composeRequiredGuards.includes('DB_PASSWORD')) {
      issues.push({
        key: 'DATABASE_URL',
        rule: 'missing-database-url',
        message: 'Either CONTAINER_DATABASE_URL or DB_PASSWORD is required for Docker Compose PostgreSQL connectivity.',
        remediation: 'Set DB_PASSWORD (co-located Docker Compose db service) or CONTAINER_DATABASE_URL (external PostgreSQL) in .env.',
      });
    }
  } else if (!databaseUrl) {
    issues.push({
      key: 'DATABASE_URL',
      rule: 'missing-database-url',
      message: 'DATABASE_URL is required for standalone container and host Node.js deployments.',
      remediation: 'Set DATABASE_URL="postgresql://<user>:<password>@<host>:5432/<database>?schema=public" in your .env file.',
    });
  }

  const nonPoolingUrl = normalizeOptional(getVal('POSTGRES_URL_NON_POOLING'));
  if (nonPoolingUrl) {
    if (DUMMY_DATABASE_URLS.has(nonPoolingUrl)) {
      issues.push({
        key: 'POSTGRES_URL_NON_POOLING',
        rule: 'blocked-dummy-shadow-url',
        message: 'POSTGRES_URL_NON_POOLING must not use a build-time dummy shadow URL.',
        remediation: 'Comment out POSTGRES_URL_NON_POOLING unless connecting via PgBouncer or an external shadow database.',
      });
    } else if (!isValidPostgresUrl(nonPoolingUrl)) {
      issues.push({
        key: 'POSTGRES_URL_NON_POOLING',
        rule: 'invalid-non-pooling-url',
        message: 'POSTGRES_URL_NON_POOLING must be a valid PostgreSQL connection URI when set.',
        remediation: 'Provide a valid direct PostgreSQL URI or comment out POSTGRES_URL_NON_POOLING in .env.',
      });
    }
  }

  const containerNonPoolingUrl = normalizeOptional(getVal('CONTAINER_POSTGRES_URL_NON_POOLING'));
  if (containerNonPoolingUrl) {
    if (DUMMY_DATABASE_URLS.has(containerNonPoolingUrl)) {
      issues.push({
        key: 'CONTAINER_POSTGRES_URL_NON_POOLING',
        rule: 'blocked-dummy-shadow-url',
        message: 'CONTAINER_POSTGRES_URL_NON_POOLING must not use a build-time dummy shadow URL.',
        remediation: 'Configure CONTAINER_POSTGRES_URL_NON_POOLING with your external direct PostgreSQL URI or comment it out when using the bundled Docker Compose db service.',
      });
    } else if (!isValidPostgresUrl(containerNonPoolingUrl)) {
      issues.push({
        key: 'CONTAINER_POSTGRES_URL_NON_POOLING',
        rule: 'invalid-container-non-pooling-url',
        message: 'CONTAINER_POSTGRES_URL_NON_POOLING must be a valid PostgreSQL connection URI when set.',
        remediation: 'Provide a valid direct PostgreSQL URI reachable from containers or comment out CONTAINER_POSTGRES_URL_NON_POOLING in .env.',
      });
    }
  }

  // 4. ADMIN_PASSWORD (64-byte scrypt format & blocked production hashes)
  const adminPassword = getVal('ADMIN_PASSWORD')?.trim() ?? '';
  if (!adminPassword) {
    issues.push({
      key: 'ADMIN_PASSWORD',
      rule: 'missing-admin-password',
      message: 'ADMIN_PASSWORD is required.',
      remediation: 'Generate a 16-byte salt / 64-byte scrypt hash via: node scripts/generate-password-hash.mjs "<your-strong-password>"',
    });
  } else if (!isValidProductionScryptHash(adminPassword)) {
    issues.push({
      key: 'ADMIN_PASSWORD',
      rule: 'invalid-scrypt-format',
      message: 'ADMIN_PASSWORD must be in scrypt:[16-byte saltBase64]:[64-byte keyBase64] format (plaintext passwords and legacy non-64-byte scrypt hashes are rejected).',
      remediation: 'Regenerate ADMIN_PASSWORD with: node scripts/generate-password-hash.mjs "<your-strong-password>"',
    });
  } else if (effectiveMode === 'production' && BLOCKED_PROD_ADMIN_HASHES.has(adminPassword)) {
    issues.push({
      key: 'ADMIN_PASSWORD',
      rule: 'blocked-admin-hash',
      message: 'ADMIN_PASSWORD must not use a repository placeholder, build fallback, or E2E test hash in production.',
      remediation: 'Generate a unique production hash via: node scripts/generate-password-hash.mjs "<your-strong-password>"',
    });
  }

  // 5. GUEST_PASSCODE (non-empty & non-default/placeholder in production)
  const rawGuestPasscode = getVal('GUEST_PASSCODE') ?? '';
  const trimmedGuestPasscode = rawGuestPasscode.trim();
  if (!trimmedGuestPasscode) {
    if (effectiveMode === 'production') {
      issues.push({
        key: 'GUEST_PASSCODE',
        rule: 'missing-guest-passcode',
        message: 'GUEST_PASSCODE is required in production.',
        remediation: 'Set GUEST_PASSCODE to a unique celebration passcode chosen for your guests.',
      });
    }
  } else if (effectiveMode === 'production' && BLOCKED_PROD_GUEST_PASSCODES.has(trimmedGuestPasscode)) {
    issues.push({
      key: 'GUEST_PASSCODE',
      rule: 'blocked-guest-passcode',
      message: 'GUEST_PASSCODE must not use the default ("wedding2026"), example placeholder, or E2E fallback passcode in production.',
      remediation: 'Replace GUEST_PASSCODE in .env with a unique passcode for your wedding guests.',
    });
  }

  // 6. GUEST_SESSION_SECRET (non-empty, non-blocked, >= 32 chars in production, distinct from GUEST_PASSCODE)
  const guestSessionSecret = getVal('GUEST_SESSION_SECRET') ?? '';
  if (!guestSessionSecret) {
    if (effectiveMode === 'production') {
      issues.push({
        key: 'GUEST_SESSION_SECRET',
        rule: 'missing-guest-session-secret',
        message: 'GUEST_SESSION_SECRET is required in production.',
        remediation: 'Generate a dedicated 32+ character signing secret via: openssl rand -hex 32',
      });
    }
  } else if (effectiveMode === 'production' && BLOCKED_PROD_SESSION_SECRETS.has(guestSessionSecret)) {
    issues.push({
      key: 'GUEST_SESSION_SECRET',
      rule: 'blocked-guest-session-secret',
      message: 'GUEST_SESSION_SECRET must not use the default, example placeholder, or E2E fallback secret in production.',
      remediation: 'Generate a dedicated 32+ character signing secret via: openssl rand -hex 32',
    });
  } else if (effectiveMode === 'production' && guestSessionSecret.length < 32) {
    issues.push({
      key: 'GUEST_SESSION_SECRET',
      rule: 'short-guest-session-secret',
      message: `GUEST_SESSION_SECRET must be at least 32 characters long in production (current length: ${guestSessionSecret.length}).`,
      remediation: 'Generate a 64-character hex signing secret via: openssl rand -hex 32',
    });
  }

  if (
    guestSessionSecret &&
    trimmedGuestPasscode &&
    (guestSessionSecret === rawGuestPasscode || guestSessionSecret === trimmedGuestPasscode)
  ) {
    issues.push({
      key: 'GUEST_SESSION_SECRET',
      rule: 'matching-passcode-and-session-secret',
      message: 'GUEST_SESSION_SECRET must not match GUEST_PASSCODE.',
      remediation: 'Use a separate random HMAC signing secret for GUEST_SESSION_SECRET (e.g. `openssl rand -hex 32`).',
    });
  }

  // 7. ALLOWED_HOSTS, TRUST_PROXY, HISTORY_VERSION_LIMIT
  const rawAllowedHosts = getVal('ALLOWED_HOSTS');
  if (rawAllowedHosts !== undefined) {
    const hosts = rawAllowedHosts.split(',').map((h) => h.trim()).filter(Boolean);
    if (hosts.length === 0 || !hosts.every((h) => ALLOWED_HOST_ENTRY_REGEX.test(h))) {
      issues.push({
        key: 'ALLOWED_HOSTS',
        rule: 'invalid-allowed-hosts',
        message: 'ALLOWED_HOSTS must be a non-empty comma-separated list of valid hostnames, IPs, or wildcard patterns.',
        remediation: 'Set ALLOWED_HOSTS="wedding.yourdomain.com,localhost,127.0.0.1" without protocol schemes (no https://) or paths.',
      });
    }
  }

  const rawTrustProxy = getVal('TRUST_PROXY');
  const trimmedTrustProxy = rawTrustProxy?.trim() ?? '';
  if (trimmedTrustProxy !== '' && !isValidTrustProxyInput(trimmedTrustProxy)) {
    issues.push({
      key: 'TRUST_PROXY',
      rule: 'invalid-trust-proxy',
      message: 'TRUST_PROXY must be a non-negative integer hop count (0, 1, 2, ...) or "false" in local development.',
      remediation: 'Set TRUST_PROXY=1 (single-hop Caddy/Nginx/Vercel/Railway/Render), TRUST_PROXY=2 (Cloud Run/CDN+LB), or TRUST_PROXY=0 (direct/L4 NLB).',
    });
  }

  const productionTrustProxyError = getProductionTrustProxyError({
    isProduction: effectiveMode === 'production',
    isE2ETestMode: getVal('E2E_TEST')?.trim().toLowerCase() === 'true',
    allowedHosts: rawAllowedHosts,
    rawTrustProxy: trimmedTrustProxy,
  });
  if (productionTrustProxyError) {
    issues.push({
      key: 'TRUST_PROXY',
      rule: 'ambiguous-production-trust-proxy',
      message: `${productionTrustProxyError}; omitted or boolean values are rejected.`,
      remediation:
        'Set TRUST_PROXY=1 behind a single reverse proxy (Caddy/Nginx/Vercel/Railway/Render), TRUST_PROXY=2 behind a two-hop load balancer (Cloud Run/CDN+LB), or TRUST_PROXY=0 for direct/L4 connections.',
    });
  }

  const rawHistoryLimit = normalizeOptional(getVal('HISTORY_VERSION_LIMIT'));
  if (rawHistoryLimit !== undefined) {
    const parsedLimit = Number(rawHistoryLimit);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1) {
      issues.push({
        key: 'HISTORY_VERSION_LIMIT',
        rule: 'invalid-history-version-limit',
        message: 'HISTORY_VERSION_LIMIT must be a positive number (>= 1).',
        remediation: 'Set HISTORY_VERSION_LIMIT=50 (or a positive integer >= 1).',
      });
    }
  }

  // 8. S3 all-or-nothing credential group & Cloudflare R2 endpoint/public URL invariants
  const presentS3Keys = S3_REQUIRED_GROUP.filter((key) => Boolean(normalizeOptional(getVal(key))));
  if (presentS3Keys.length > 0 && presentS3Keys.length < S3_REQUIRED_GROUP.length) {
    for (const key of S3_REQUIRED_GROUP) {
      if (!normalizeOptional(getVal(key))) {
        issues.push({
          key,
          rule: 'incomplete-s3-credentials',
          message: `Incomplete S3 credentials: ${key} is required when other S3 storage variables are set.`,
          remediation: 'Provide all four S3 variables (S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) or comment all of them out to use local disk storage.',
        });
      }
    }
  }

  const s3Region = normalizeOptional(getVal('S3_REGION'));
  const s3Endpoint = normalizeOptional(getVal('S3_ENDPOINT'));
  const s3PublicUrl = normalizeOptional(getVal('S3_PUBLIC_URL'));
  if (s3Region?.toLowerCase() === 'auto' && !s3Endpoint) {
    issues.push({
      key: 'S3_ENDPOINT',
      rule: 'missing-r2-s3-endpoint',
      message: 'Cloudflare R2 configurations with S3_REGION=auto must specify S3_ENDPOINT.',
      remediation: 'Set S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com alongside S3_PUBLIC_URL when S3_REGION=auto.',
    });
  }
  if (s3Endpoint && isCloudflareR2ApiEndpoint(s3Endpoint) && !s3PublicUrl) {
    issues.push({
      key: 'S3_PUBLIC_URL',
      rule: 'missing-r2-s3-public-url',
      message: 'Cloudflare R2 private API endpoints (*.r2.cloudflarestorage.com) cannot serve public assets directly; S3_PUBLIC_URL is required.',
      remediation: 'Set S3_PUBLIC_URL to your R2 Custom Domain or public https://pub-<id>.r2.dev URL.',
    });
  }

  // 9. Stripe paired keys, key prefixes, & placeholder rejection
  const stripeSecretKey = normalizeOptional(getVal('STRIPE_SECRET_KEY'));
  const stripePublishableKey = normalizeOptional(getVal('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'));
  const stripeWebhookSecret = normalizeOptional(getVal('STRIPE_WEBHOOK_SECRET'));

  if (stripeSecretKey && !stripePublishableKey) {
    issues.push({
      key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
      rule: 'unpaired-stripe-keys',
      message: 'Incomplete Stripe credentials: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is required when STRIPE_SECRET_KEY is set.',
      remediation: 'Set both STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY together, or comment both out when using peer-to-peer handles only.',
    });
  }
  if (stripePublishableKey && !stripeSecretKey) {
    issues.push({
      key: 'STRIPE_SECRET_KEY',
      rule: 'unpaired-stripe-keys',
      message: 'Incomplete Stripe credentials: STRIPE_SECRET_KEY is required when NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is set.',
      remediation: 'Set both STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY together, or comment both out when using peer-to-peer handles only.',
    });
  }

  if (stripeSecretKey) {
    if (!stripeSecretKey.startsWith('sk_') && !stripeSecretKey.startsWith('rk_')) {
      issues.push({
        key: 'STRIPE_SECRET_KEY',
        rule: 'invalid-stripe-secret-prefix',
        message: 'STRIPE_SECRET_KEY must start with "sk_" or "rk_".',
        remediation: 'Provide a valid Stripe secret or restricted key starting with sk_ or rk_.',
      });
    } else if (isPlaceholderStripeKey(stripeSecretKey)) {
      issues.push({
        key: 'STRIPE_SECRET_KEY',
        rule: 'placeholder-stripe-key',
        message: 'STRIPE_SECRET_KEY must not use a placeholder mock key in non-test environments.',
        remediation: 'Replace STRIPE_SECRET_KEY with a real Stripe key or comment it out.',
      });
    }
  }

  if (stripePublishableKey) {
    if (!stripePublishableKey.startsWith('pk_')) {
      issues.push({
        key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
        rule: 'invalid-stripe-publishable-prefix',
        message: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must start with "pk_".',
        remediation: 'Provide a valid Stripe publishable key starting with pk_.',
      });
    } else if (isPlaceholderStripeKey(stripePublishableKey)) {
      issues.push({
        key: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
        rule: 'placeholder-stripe-key',
        message: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must not use a placeholder mock key in non-test environments.',
        remediation: 'Replace NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY with a real Stripe publishable key or comment it out.',
      });
    }
  }

  if (stripeWebhookSecret && !stripeWebhookSecret.startsWith('whsec_')) {
    issues.push({
      key: 'STRIPE_WEBHOOK_SECRET',
      rule: 'invalid-stripe-webhook-prefix',
      message: 'STRIPE_WEBHOOK_SECRET must start with "whsec_".',
      remediation: 'Copy the signing secret starting with whsec_ from your Stripe Webhook endpoint settings.',
    });
  }

  return { issues, composeRequiredGuards, mode: effectiveMode };
}

export function runEnvPreflightFile(options: {
  cwd?: string;
  envFile?: string;
  composeFile?: string;
  target?: PreflightTarget;
  mode?: PreflightMode;
}): PreflightResult {
  const cwd = options.cwd ?? process.cwd();
  const target: PreflightTarget = options.target ?? 'compose';
  const initialMode: PreflightMode = resolveInitialPreflightMode(options.mode);

  let entries: Map<string, ParsedDotenvEntry>;
  let displayEnvPath: string;

  if (options.envFile !== undefined) {
    const envRelOrAbs = options.envFile;
    const envFilePath = path.isAbsolute(envRelOrAbs) ? envRelOrAbs : path.resolve(cwd, envRelOrAbs);
    displayEnvPath = path.isAbsolute(envRelOrAbs)
      ? envRelOrAbs
      : envRelOrAbs.replace(/\\/g, '/');

    if (!fs.existsSync(envFilePath)) {
      return {
        ok: false,
        target,
        mode: initialMode,
        envFilePath: displayEnvPath,
        checkedKeysCount: 0,
        composeRequiredGuards: [],
        issues: [
          {
            key: 'ENV_FILE',
            rule: 'missing-env-file',
            message: `Target environment file not found at "${displayEnvPath}".`,
            remediation:
              'Copy .env.example to .env or .env.local (`cp .env.example .env`), or pass `--env-file <path>`.',
          },
        ],
      };
    }

    const envContent = fs.readFileSync(envFilePath, 'utf8');
    entries = parseDotenvContent(envContent);
  } else {
    const cascadeRelFiles = getDotenvCascadeFiles(initialMode);
    const existingRelFiles = cascadeRelFiles.filter((relFile) =>
      fs.existsSync(path.resolve(cwd, relFile))
    );

    if (existingRelFiles.length === 0) {
      return {
        ok: false,
        target,
        mode: initialMode,
        envFilePath: cascadeRelFiles.join(', '),
        checkedKeysCount: 0,
        composeRequiredGuards: [],
        issues: [
          {
            key: 'ENV_FILE',
            rule: 'missing-env-file',
            message: `No environment file found in "${cwd}" (checked ${cascadeRelFiles.join(', ')}).`,
            remediation:
              'Copy .env.example to .env or .env.local (`cp .env.example .env`), or pass `--env-file <path>`.',
          },
        ],
      };
    }

    displayEnvPath = existingRelFiles.join(', ');
    entries = new Map<string, ParsedDotenvEntry>();
    for (const relFile of [...existingRelFiles].reverse()) {
      const content = fs.readFileSync(path.resolve(cwd, relFile), 'utf8');
      for (const [key, entry] of parseDotenvContent(content)) {
        entries.set(key, entry);
      }
    }
  }

  let composeContent: string | undefined;
  if (target === 'compose') {
    const composeRelOrAbs = options.composeFile ?? 'docker-compose.yml';
    const composePath = path.isAbsolute(composeRelOrAbs)
      ? composeRelOrAbs
      : path.resolve(cwd, composeRelOrAbs);
    if (!fs.existsSync(composePath)) {
      return {
        ok: false,
        target,
        mode: initialMode,
        envFilePath: displayEnvPath,
        checkedKeysCount: entries.size,
        composeRequiredGuards: [],
        issues: [
          {
            key: 'COMPOSE_FILE',
            rule: 'missing-compose-file',
            message: `Docker Compose manifest not found at "${composeRelOrAbs}".`,
            remediation: 'Run from the repository root containing docker-compose.yml, pass `--compose-file <path>`, or pass `--no-compose` for host/standalone checks.',
          },
        ],
      };
    }
    composeContent = fs.readFileSync(composePath, 'utf8');
  }

  const { issues, composeRequiredGuards, mode: effectiveMode } = validateOperatorEnv(entries, {
    target,
    mode: initialMode,
    composeContent,
  });

  return {
    ok: issues.length === 0,
    target,
    mode: effectiveMode,
    envFilePath: displayEnvPath,
    checkedKeysCount: entries.size,
    composeRequiredGuards,
    issues,
  };
}

function formatUsageText(): string {
  return [
    'Usage: npx tsx scripts/preflight-env.ts [options] [env-file]',
    '',
    'Read-only preflight validator for local and operator .env files against',
    'runtime environment rules (src/env.ts) and Docker Compose ":?" guards (docker-compose.yml).',
    'Raw secret values, connection URLs, and password hashes are never printed to stdout or stderr.',
    '',
    'Options:',
    '  -f, --env-file <path>      Path to .env file to validate (default: dotenv cascade .env.<mode>.local, .env.local, .env.<mode>, .env)',
    '  --compose-file <path>      Path to docker-compose.yml (default: docker-compose.yml)',
    '  --target <mode>            Deployment target: compose | standalone | host (default: compose)',
    '  --mode <mode>              Validation mode: development | production (default: development, or production when NODE_ENV=production)',
    '  --no-compose               Skip docker-compose.yml ":?" secret guard checks (alias for --target host)',
    '  -h, --help                 Show this help message',
  ].join('\n');
}

export function formatPreflightReport(result: PreflightResult): string {
  if (result.ok) {
    const composeNote =
      result.target === 'compose'
        ? ` and ${result.composeRequiredGuards.length} Docker Compose ":?" guard(s) (${result.composeRequiredGuards.join(', ')})`
        : '';
    const rulesLabel =
      result.mode === 'production' ? 'production secret rules' : 'development env rules';
    return `✅ Environment preflight passed for "${result.envFilePath}" [target=${result.target}] [mode=${result.mode}]: ${result.checkedKeysCount} variable(s) verified against ${rulesLabel}${composeNote}.`;
  }

  const lines: string[] = [
    `❌ Environment preflight failed for "${result.envFilePath}" [target=${result.target}] [mode=${result.mode}] (${result.issues.length} issue(s) found; secret values redacted):`,
    '',
  ];

  for (const issue of result.issues) {
    lines.push(`  - [${issue.key}] ${issue.message}`);
    lines.push(`    Remediation: ${issue.remediation}`);
  }

  return lines.join('\n');
}

export function runPreflightCli(
  argv: string[] = process.argv.slice(2),
  cwd: string = process.cwd()
): CliRunResult {
  let envFile: string | undefined;
  let composeFile: string | undefined;
  let target: PreflightTarget = 'compose';
  let mode: PreflightMode | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      return { exitCode: 0, stdout: `${formatUsageText()}\n`, stderr: '' };
    }
    if (arg === '--no-compose') {
      target = 'host';
      continue;
    }
    if (arg === '-f' || arg === '--env-file') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '❌ Missing path argument after --env-file.\n',
        };
      }
      envFile = next;
      i++;
      continue;
    }
    if (arg.startsWith('--env-file=')) {
      envFile = arg.slice('--env-file='.length);
      continue;
    }
    if (arg === '--compose-file') {
      const next = argv[i + 1];
      if (!next || next.startsWith('-')) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '❌ Missing path argument after --compose-file.\n',
        };
      }
      composeFile = next;
      i++;
      continue;
    }
    if (arg.startsWith('--compose-file=')) {
      composeFile = arg.slice('--compose-file='.length);
      continue;
    }
    if (arg === '--target') {
      const next = argv[i + 1];
      if (next !== 'compose' && next !== 'standalone' && next !== 'host') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '❌ Invalid --target value. Expected "compose", "standalone", or "host".\n',
        };
      }
      target = next;
      i++;
      continue;
    }
    if (arg.startsWith('--target=')) {
      const val = arg.slice('--target='.length);
      if (val !== 'compose' && val !== 'standalone' && val !== 'host') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '❌ Invalid --target value. Expected "compose", "standalone", or "host".\n',
        };
      }
      target = val;
      continue;
    }
    if (arg === '--mode') {
      const next = argv[i + 1];
      if (next !== 'development' && next !== 'production') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '❌ Invalid --mode value. Expected "development" or "production".\n',
        };
      }
      mode = next;
      i++;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      const val = arg.slice('--mode='.length);
      if (val !== 'development' && val !== 'production') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: '❌ Invalid --mode value. Expected "development" or "production".\n',
        };
      }
      mode = val;
      continue;
    }
    if (arg.startsWith('-')) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `❌ Unknown option "${arg}". Run with --help for usage.\n`,
      };
    }
    if (!envFile) {
      envFile = arg;
    }
  }

  const result = runEnvPreflightFile({
    cwd,
    envFile,
    composeFile,
    target,
    mode,
  });
  const report = `${formatPreflightReport(result)}\n`;

  if (result.ok) {
    return { exitCode: 0, stdout: report, stderr: '' };
  }
  return { exitCode: 1, stdout: '', stderr: report };
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) ||
    process.argv[1].endsWith('preflight-env.ts') ||
    process.argv[1].endsWith('preflight-env.js'));

if (isDirectExecution) {
  const cliResult = runPreflightCli();
  if (cliResult.stdout) {
    process.stdout.write(cliResult.stdout);
  }
  if (cliResult.stderr) {
    process.stderr.write(cliResult.stderr);
  }
  if (cliResult.exitCode !== 0) {
    process.exit(cliResult.exitCode);
  }
}
