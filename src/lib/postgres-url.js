export const DEFAULT_POSTGRES_POOL_MAX = 5;
export const DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS = 10_000;
export const DEFAULT_POSTGRES_SCHEMA = 'public';

const VALID_SSL_MODES = new Set([
  'disable',
  'allow',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
  'no-verify',
]);

const VALID_SSL_FLAGS = new Set(['true', 'false', '1', '0', 'no-verify']);
const VALID_BOOLEAN_FLAGS = new Set(['true', 'false', '1', '0']);

export class PostgresUrlValidationError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'PostgresUrlValidationError';
  }
}

/**
 * Redacts credentials and secret parameters from a candidate PostgreSQL URL
 * so logs and thrown errors never leak raw secrets.
 *
 * @param {unknown} raw
 * @returns {string}
 */
export function redactPostgresUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0) {
    return '[EMPTY_POSTGRES_URL]';
  }
  const schemeMatch = raw.match(/^(postgres(?:ql)?:\/\/)/);
  if (!schemeMatch) {
    return '[REDACTED_INVALID_POSTGRES_URL]';
  }
  const prefix = schemeMatch[1];
  const rest = raw.slice(prefix.length);
  const boundaryIdx = rest.search(/[/?\s]/);
  const authority = boundaryIdx === -1 ? rest : rest.slice(0, boundaryIdx);
  const tail = boundaryIdx === -1 ? '' : rest.slice(boundaryIdx);
  const lastAtIdx = authority.lastIndexOf('@');
  const redactedAuthority =
    lastAtIdx === -1 ? authority : `[REDACTED]@${authority.slice(lastAtIdx + 1)}`;

  let sanitized = `${prefix}${redactedAuthority}${tail}`;
  sanitized = sanitized.replace(
    /([?&](?:password|sslpassword|sslkey)=)[^&#\s]*/gi,
    '$1[REDACTED]'
  );
  return sanitized;
}

/**
 * @param {string} value
 * @param {string} label
 * @returns {string}
 */
function decodeComponentOrThrow(value, label) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new PostgresUrlValidationError(
      `PostgreSQL URL contains malformed percent-encoding in ${label}.`
    );
  }
  if (decoded.includes('\0')) {
    throw new PostgresUrlValidationError(
      `PostgreSQL URL contains an invalid null byte in ${label}.`
    );
  }
  return decoded;
}

/**
 * @param {string} rawQuery
 * @returns {URLSearchParams}
 */
function parseAndValidateQuery(rawQuery) {
  if (rawQuery.length === 0) {
    return new URLSearchParams();
  }
  const pairs = rawQuery.split('&');
  for (const pair of pairs) {
    if (pair.length === 0) {
      continue;
    }
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
    decodeComponentOrThrow(rawKey.replace(/\+/g, '%20'), 'query parameter key');
    decodeComponentOrThrow(rawVal.replace(/\+/g, '%20'), 'query parameter value');
  }
  return new URLSearchParams(rawQuery);
}

/**
 * @param {string} rawPort
 * @param {string} sourceLabel
 * @returns {number}
 */
function parsePortOrThrow(rawPort, sourceLabel) {
  if (!/^[1-9]\d{0,4}$/.test(rawPort)) {
    throw new PostgresUrlValidationError(
      `PostgreSQL URL has an invalid ${sourceLabel} (must be an integer between 1 and 65535).`
    );
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new PostgresUrlValidationError(
      `PostgreSQL URL has an out-of-range ${sourceLabel} (must be between 1 and 65535).`
    );
  }
  return port;
}

/**
 * @param {URLSearchParams} searchParams
 * @param {string} key
 * @param {boolean} allowZero
 * @returns {number | undefined}
 */
function parseIntegerQueryParam(searchParams, key, allowZero) {
  if (!searchParams.has(key)) {
    return undefined;
  }
  const raw = searchParams.get(key) ?? '';
  const pattern = allowZero ? /^\d+$/ : /^[1-9]\d*$/;
  if (!pattern.test(raw)) {
    throw new PostgresUrlValidationError(
      `PostgreSQL URL query parameter "${key}" must be a ${allowZero ? 'non-negative' : 'positive'} integer.`
    );
  }
  const num = Number(raw);
  if (!Number.isSafeInteger(num)) {
    throw new PostgresUrlValidationError(
      `PostgreSQL URL query parameter "${key}" exceeds safe integer bounds.`
    );
  }
  return num;
}

/**
 * @param {string | null} candidate
 * @returns {boolean}
 */
function isValidUnixSocketPath(candidate) {
  if (typeof candidate !== 'string' || candidate.length < 2) {
    return false;
  }
  if (!candidate.startsWith('/') || /^\/+$/.test(candidate)) {
    return false;
  }
  if (/[\x00-\x1f\x7f]/.test(candidate)) {
    return false;
  }
  return true;
}

/**
 * Parses, validates, and normalizes a PostgreSQL connection URI across
 * runtime pooling, Prisma CLI configuration, startup gates, and runbook checks.
 *
 * @param {string} rawUrl
 * @param {{ allowEmptyHostSocket?: boolean; requireDatabaseName?: boolean }} [options]
 */
export function parsePostgresUrl(rawUrl, options = {}) {
  const allowEmptyHostSocket = options.allowEmptyHostSocket !== false;
  const requireDatabaseName = options.requireDatabaseName === true;

  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new PostgresUrlValidationError('PostgreSQL URL must be a non-empty string.');
  }

  if (/[\x00-\x20\x7f]/.test(rawUrl)) {
    throw new PostgresUrlValidationError(
      'PostgreSQL URL must not contain whitespace or control characters.'
    );
  }

  if (rawUrl.includes('#')) {
    throw new PostgresUrlValidationError(
      'PostgreSQL URL must not contain unescaped "#" fragment characters.'
    );
  }

  const schemeMatch = rawUrl.match(/^(postgres|postgresql):\/\//);
  if (!schemeMatch) {
    throw new PostgresUrlValidationError(
      'PostgreSQL URL must start with postgres:// or postgresql://.'
    );
  }

  const scheme = /** @type {'postgres' | 'postgresql'} */ (schemeMatch[1]);
  const afterScheme = rawUrl.slice(scheme.length + 3);

  const queryStart = afterScheme.indexOf('?');
  const beforeQuery = queryStart === -1 ? afterScheme : afterScheme.slice(0, queryStart);
  const rawQuery = queryStart === -1 ? '' : afterScheme.slice(queryStart + 1);

  const slashStart = beforeQuery.indexOf('/');
  const authority = slashStart === -1 ? beforeQuery : beforeQuery.slice(0, slashStart);
  const rawPath = slashStart === -1 ? '' : beforeQuery.slice(slashStart);

  if (authority.indexOf('@') !== authority.lastIndexOf('@')) {
    throw new PostgresUrlValidationError(
      'PostgreSQL URL contains unescaped "@" in credentials.'
    );
  }

  const atIdx = authority.indexOf('@');
  const rawUserinfo = atIdx === -1 ? null : authority.slice(0, atIdx);
  const hostPort = atIdx === -1 ? authority : authority.slice(atIdx + 1);

  /** @type {string | undefined} */
  let user;
  /** @type {string | undefined} */
  let password;

  if (rawUserinfo !== null) {
    if (rawUserinfo.indexOf(':') !== rawUserinfo.lastIndexOf(':')) {
      throw new PostgresUrlValidationError(
        'PostgreSQL URL contains unescaped ":" in user credentials.'
      );
    }
    const colonIdx = rawUserinfo.indexOf(':');
    const rawUser = colonIdx === -1 ? rawUserinfo : rawUserinfo.slice(0, colonIdx);
    const rawPass = colonIdx === -1 ? null : rawUserinfo.slice(colonIdx + 1);

    if (rawUser.length > 0) {
      user = decodeComponentOrThrow(rawUser, 'username');
    }
    if (rawPass !== null) {
      password = decodeComponentOrThrow(rawPass, 'password');
    }
  }

  /** @type {string} */
  let authorityHost;
  /** @type {string | null} */
  let authorityPortRaw = null;

  if (hostPort.startsWith('[')) {
    const ipv6Match = hostPort.match(/^\[([^\]]+)\](?::(.*))?$/);
    if (!ipv6Match || ipv6Match[1].length === 0) {
      throw new PostgresUrlValidationError('PostgreSQL URL has a malformed IPv6 host.');
    }
    authorityHost = `[${ipv6Match[1]}]`;
    if (ipv6Match[2] !== undefined) {
      authorityPortRaw = ipv6Match[2];
    }
  } else {
    if (hostPort.includes('[') || hostPort.includes(']')) {
      throw new PostgresUrlValidationError('PostgreSQL URL has invalid bracket characters in host.');
    }
    if (hostPort.indexOf(':') !== hostPort.lastIndexOf(':')) {
      throw new PostgresUrlValidationError('PostgreSQL URL has multiple colons in host:port.');
    }
    const portColonIdx = hostPort.indexOf(':');
    if (portColonIdx === -1) {
      authorityHost = hostPort;
    } else {
      authorityHost = hostPort.slice(0, portColonIdx);
      authorityPortRaw = hostPort.slice(portColonIdx + 1);
    }
  }

  const authorityPort =
    authorityPortRaw !== null ? parsePortOrThrow(authorityPortRaw, 'port') : undefined;

  const searchParams = parseAndValidateQuery(rawQuery);

  const hasQueryHost = searchParams.has('host');
  const queryHost = hasQueryHost ? (searchParams.get('host') ?? '') : null;

  if (hasQueryHost) {
    if (!queryHost || queryHost.trim() !== queryHost || /[\x00-\x20\x7f]/.test(queryHost)) {
      throw new PostgresUrlValidationError(
        'PostgreSQL URL query parameter "host" must be a non-empty host or Unix socket path.'
      );
    }
    if (/^\/+$/.test(queryHost)) {
      throw new PostgresUrlValidationError(
        'PostgreSQL URL query parameter "host" cannot be the root directory "/".'
      );
    }
  }

  const hasValidSocketQuery = isValidUnixSocketPath(queryHost);
  let normalizedUrl = rawUrl;
  let usedEmptyHostSocketShorthand = false;

  if (authorityHost.length === 0) {
    if (!hasValidSocketQuery) {
      throw new PostgresUrlValidationError(
        'PostgreSQL URL has an empty host without a valid Unix socket path (?host=/...).'
      );
    }
    if (!allowEmptyHostSocket) {
      throw new PostgresUrlValidationError(
        'PostgreSQL Unix socket URLs in runbooks must specify @localhost as the authority host.'
      );
    }
    const rebuiltAuthority =
      `${rawUserinfo !== null ? `${rawUserinfo}@` : ''}localhost` +
      `${authorityPortRaw !== null ? `:${authorityPortRaw}` : ''}`;
    normalizedUrl =
      `${scheme}://${rebuiltAuthority}${rawPath}` +
      `${queryStart === -1 ? '' : `?${rawQuery}`}`;
    usedEmptyHostSocketShorthand = true;
  } else if (
    authorityHost === '.' ||
    authorityHost.includes('..') ||
    /[<>"{}|\\^`]/.test(authorityHost)
  ) {
    throw new PostgresUrlValidationError('PostgreSQL URL contains an invalid authority hostname.');
  }

  /** @type {URL} */
  let parsedWhatwg;
  try {
    parsedWhatwg = new URL(normalizedUrl);
  } catch {
    throw new PostgresUrlValidationError('PostgreSQL URL could not be parsed as a valid URI.');
  }

  if (!parsedWhatwg.hostname) {
    throw new PostgresUrlValidationError('PostgreSQL URL is missing a valid hostname.');
  }

  const rawDbSegment = rawPath.startsWith('/') ? rawPath.slice(1) : rawPath;
  if (rawDbSegment.includes('/')) {
    throw new PostgresUrlValidationError(
      'PostgreSQL URL database path must not contain unescaped "/" segments.'
    );
  }

  const decodedPathDb =
    rawDbSegment.length > 0 ? decodeComponentOrThrow(rawDbSegment, 'database name') : '';
  const queryDb = searchParams.get('dbname') ?? searchParams.get('database') ?? '';

  if ((requireDatabaseName || usedEmptyHostSocketShorthand) && !decodedPathDb && !queryDb) {
    throw new PostgresUrlValidationError('PostgreSQL URL must include a database name.');
  }

  const database = decodedPathDb || queryDb || user || 'postgres';

  const queryPortRaw = searchParams.has('port') ? (searchParams.get('port') ?? '') : null;
  const queryPort = queryPortRaw !== null ? parsePortOrThrow(queryPortRaw, 'query port') : undefined;
  const port = authorityPort ?? queryPort ?? 5432;

  const cleanAuthorityHost =
    parsedWhatwg.hostname.startsWith('[') && parsedWhatwg.hostname.endsWith(']')
      ? parsedWhatwg.hostname.slice(1, -1)
      : decodeComponentOrThrow(parsedWhatwg.hostname, 'hostname');

  const isUnixSocket = hasValidSocketQuery;
  const socketPath = isUnixSocket ? /** @type {string} */ (queryHost) : null;
  const host = queryHost ?? cleanAuthorityHost;

  let schema = DEFAULT_POSTGRES_SCHEMA;
  if (searchParams.has('schema')) {
    const rawSchema = searchParams.get('schema') ?? '';
    if (rawSchema.length === 0 || rawSchema.trim() !== rawSchema || /[\x00-\x1f\x7f]/.test(rawSchema)) {
      throw new PostgresUrlValidationError(
        'PostgreSQL URL query parameter "schema" must be a non-empty identifier.'
      );
    }
    schema = rawSchema;
  }

  /** @type {'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full' | 'no-verify' | undefined} */
  let sslmode;
  if (searchParams.has('sslmode')) {
    const rawSslMode = searchParams.get('sslmode') ?? '';
    if (!VALID_SSL_MODES.has(rawSslMode)) {
      throw new PostgresUrlValidationError(
        'PostgreSQL URL query parameter "sslmode" must be one of: disable, allow, prefer, require, verify-ca, verify-full, no-verify.'
      );
    }
    sslmode = /** @type {typeof sslmode} */ (rawSslMode);
  }

  /** @type {'true' | 'false' | '1' | '0' | 'no-verify' | undefined} */
  let sslFlag;
  if (searchParams.has('ssl')) {
    const rawSsl = searchParams.get('ssl') ?? '';
    if (!VALID_SSL_FLAGS.has(rawSsl)) {
      throw new PostgresUrlValidationError(
        'PostgreSQL URL query parameter "ssl" must be one of: true, false, 1, 0, no-verify.'
      );
    }
    sslFlag = /** @type {typeof sslFlag} */ (rawSsl);
  }

  for (const boolKey of ['uselibpqcompat', 'pgbouncer']) {
    if (searchParams.has(boolKey)) {
      const val = searchParams.get(boolKey) ?? '';
      if (!VALID_BOOLEAN_FLAGS.has(val)) {
        throw new PostgresUrlValidationError(
          `PostgreSQL URL query parameter "${boolKey}" must be true, false, 1, or 0.`
        );
      }
    }
  }

  /** @type {Record<string, string | undefined>} */
  const certParams = {};
  for (const certKey of ['sslrootcert', 'sslcert', 'sslkey', 'sslpassword']) {
    if (searchParams.has(certKey)) {
      const val = searchParams.get(certKey) ?? '';
      if (val.length === 0 || val.includes('\0')) {
        throw new PostgresUrlValidationError(
          `PostgreSQL URL query parameter "${certKey}" must not be empty.`
        );
      }
      certParams[certKey] = val;
    }
  }

  if (certParams.sslrootcert === 'system' && sslmode && sslmode !== 'verify-full') {
    throw new PostgresUrlValidationError(
      'PostgreSQL URL with sslrootcert=system requires sslmode=verify-full (or omitted sslmode).'
    );
  }

  const connectionLimit = parseIntegerQueryParam(searchParams, 'connection_limit', false);
  const connectTimeoutSeconds = parseIntegerQueryParam(searchParams, 'connect_timeout', true);
  const poolTimeoutSeconds = parseIntegerQueryParam(searchParams, 'pool_timeout', true);
  const socketTimeoutSeconds = parseIntegerQueryParam(searchParams, 'socket_timeout', true);
  const statementTimeoutMillis = parseIntegerQueryParam(searchParams, 'statement_timeout', true);
  const idleInTransactionSessionTimeoutMillis = parseIntegerQueryParam(
    searchParams,
    'idle_in_transaction_session_timeout',
    true
  );

  const max = connectionLimit ?? DEFAULT_POSTGRES_POOL_MAX;
  const connectionTimeoutMillis =
    connectTimeoutSeconds !== undefined
      ? connectTimeoutSeconds * 1000
      : poolTimeoutSeconds !== undefined
        ? poolTimeoutSeconds * 1000
        : DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS;
  const queryTimeoutMillis =
    socketTimeoutSeconds !== undefined && socketTimeoutSeconds > 0
      ? socketTimeoutSeconds * 1000
      : undefined;

  const applicationName = searchParams.get('application_name') || undefined;
  const pgOptions = searchParams.get('options') || undefined;

  /** @type {'disable' | 'allow' | 'prefer' | 'require' | 'no-verify' | 'verify-ca' | 'verify-full'} */
  let tlsMode = 'disable';
  if (certParams.sslrootcert === 'system') {
    tlsMode = 'verify-full';
  } else if (sslmode !== undefined) {
    tlsMode = sslmode;
  } else if (sslFlag !== undefined) {
    if (sslFlag === 'no-verify') {
      tlsMode = 'no-verify';
    } else if (sslFlag === 'true' || sslFlag === '1') {
      tlsMode = 'require';
    } else {
      tlsMode = 'disable';
    }
  }

  return {
    scheme,
    normalizedUrl,
    usedEmptyHostSocketShorthand,
    isUnixSocket,
    socketPath,
    host,
    authorityHost: usedEmptyHostSocketShorthand ? 'localhost' : cleanAuthorityHost,
    port,
    user,
    password,
    database,
    schema,
    tlsMode,
    sslmode,
    sslFlag,
    sslrootcert: certParams.sslrootcert,
    sslcert: certParams.sslcert,
    sslkey: certParams.sslkey,
    sslpassword: certParams.sslpassword,
    max,
    connectionLimit,
    connectTimeoutSeconds,
    poolTimeoutSeconds,
    socketTimeoutSeconds,
    connectionTimeoutMillis,
    queryTimeoutMillis,
    statementTimeoutMillis,
    idleInTransactionSessionTimeoutMillis,
    applicationName,
    options: pgOptions,
  };
}

/**
 * Validates and returns the normalized PostgreSQL URL (inserting `@localhost`
 * for legacy empty-host Unix socket URIs).
 *
 * @param {string} rawUrl
 * @param {{ allowEmptyHostSocket?: boolean; requireDatabaseName?: boolean }} [options]
 * @returns {string}
 */
export function normalizePostgresUrl(rawUrl, options = {}) {
  return parsePostgresUrl(rawUrl, options).normalizedUrl;
}

/**
 * Boolean predicate checking whether a string is a valid PostgreSQL URL.
 *
 * @param {string} rawUrl
 * @param {{ allowEmptyHostSocket?: boolean; requireDatabaseName?: boolean }} [options]
 * @returns {boolean}
 */
export function isValidPostgresUrl(rawUrl, options = {}) {
  try {
    parsePostgresUrl(rawUrl, options);
    return true;
  } catch {
    return false;
  }
}
