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
const POSTGRES_IDENTIFIER_REGEX = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const MAX_POSTGRES_IDENTIFIER_BYTES = 63;
const POOLER_HOST_REGEX =
  /(?:^|[.-])(?:pooler|pgbouncer)(?:[.-]|$)|\.proxy-[a-z0-9-]+\.[a-z0-9-]+\.rds\.amazonaws\.com$/i;
const POOLER_PORTS = new Set([6432, 6543]);
const POSTGRES_SSL_REQUEST_PACKET = new Uint8Array([
  0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f,
]);
const identifierEncoder = new TextEncoder();

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
 * Validates a PostgreSQL identifier (such as `?schema=` or table names) against
 * unquoted identifier rules (1-63 UTF-8 bytes matching `/^[A-Za-z_][A-Za-z0-9_$]*$/`).
 *
 * @param {string} identifier
 * @param {string} [label]
 * @returns {string}
 */
export function validatePostgresIdentifier(identifier, label = 'identifier') {
  if (
    typeof identifier !== 'string' ||
    identifier.length === 0 ||
    !POSTGRES_IDENTIFIER_REGEX.test(identifier) ||
    identifierEncoder.encode(identifier).byteLength > MAX_POSTGRES_IDENTIFIER_BYTES
  ) {
    throw new PostgresUrlValidationError(
      `PostgreSQL URL ${label} must be a valid PostgreSQL identifier (1-63 bytes matching /^[A-Za-z_][A-Za-z0-9_$]*$/).`
    );
  }
  return identifier;
}

/**
 * Validates a PostgreSQL identifier and returns it safely double-quoted (`"identifier"`).
 *
 * @param {string} identifier
 * @param {string} [label]
 * @returns {string}
 */
export function quotePostgresIdentifier(identifier, label = 'identifier') {
  const validated = validatePostgresIdentifier(identifier, label);
  return `"${validated.replace(/"/g, '""')}"`;
}

/**
 * Resolves the validated PostgreSQL schema name from an explicit `rawUrl` or
 * `process.env.DATABASE_URL` (defaulting to `'public'` when unset).
 *
 * @param {string} [rawUrl]
 * @returns {string}
 */
export function resolvePostgresSchema(rawUrl) {
  if (rawUrl !== undefined) {
    return parsePostgresUrl(rawUrl).schema;
  }
  const envUrl =
    typeof process !== 'undefined' && typeof process.env?.DATABASE_URL === 'string'
      ? process.env.DATABASE_URL.trim()
      : '';
  if (!envUrl || !/^(postgres|postgresql):\/\//.test(envUrl)) {
    return DEFAULT_POSTGRES_SCHEMA;
  }
  return parsePostgresUrl(envUrl).schema;
}

/**
 * Returns a double-quoted `"schema"."table"` SQL identifier expression bound to
 * the configured PostgreSQL schema.
 *
 * @param {string} tableName
 * @param {string} [rawUrl]
 * @returns {string}
 */
export function qualifyPostgresTable(tableName, rawUrl) {
  const schema = resolvePostgresSchema(rawUrl);
  return `${quotePostgresIdentifier(schema, 'query parameter "schema"')}.${quotePostgresIdentifier(tableName, 'table identifier')}`;
}
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
    schema = validatePostgresIdentifier(rawSchema, 'query parameter "schema"');
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

/**
 * Detects whether a PostgreSQL connection URL targets a connection pooler
 * (e.g. `?pgbouncer=true`, PgBouncer/Supabase/Neon pooler hostnames, RDS Proxy,
 * or standard pooler ports 6432/6543) where startup `options` / advisory locks
 * are unsupported.
 *
 * @param {string} [rawUrl]
 * @returns {boolean}
 */
export function isPooledPostgresUrl(rawUrl) {
  if (!rawUrl || !isValidPostgresUrl(rawUrl)) {
    return false;
  }
  const parsed = parsePostgresUrl(rawUrl);
  const qIdx = parsed.normalizedUrl.indexOf('?');
  if (qIdx !== -1) {
    const params = new URLSearchParams(parsed.normalizedUrl.slice(qIdx + 1));
    const pgbouncer = (params.get('pgbouncer') ?? '').toLowerCase();
    if (pgbouncer === 'true' || pgbouncer === '1') {
      return true;
    }
  }
  if (!parsed.isUnixSocket) {
    if (POOLER_HOST_REGEX.test(parsed.host)) {
      return true;
    }
    if (parsed.port !== undefined && POOLER_PORTS.has(parsed.port)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {string} urlA
 * @param {string} urlB
 * @returns {boolean}
 */
function hasSamePostgresDatabaseAndSchema(urlA, urlB) {
  if (!isValidPostgresUrl(urlA) || !isValidPostgresUrl(urlB)) {
    return false;
  }
  const parsedA = parsePostgresUrl(urlA);
  const parsedB = parsePostgresUrl(urlB);
  return (
    Boolean(parsedA.database) &&
    parsedA.database === parsedB.database &&
    (parsedA.schema ?? DEFAULT_POSTGRES_SCHEMA) ===
      (parsedB.schema ?? DEFAULT_POSTGRES_SCHEMA)
  );
}

/**
 * Resolves the effective PostgreSQL connection URL used by direct Prisma migration
 * commands (`migrate deploy`, `migrate status`, `migrate resolve`). When `databaseUrl`
 * routes through a connection pooler (`isPooledPostgresUrl`) and `nonPoolingUrl` is a
 * valid, unpooled PostgreSQL URI targeting the same database and schema, promotes the
 * normalized `nonPoolingUrl`; otherwise returns normalized `databaseUrl`.
 *
 * @param {string} [databaseUrl]
 * @param {string} [nonPoolingUrl]
 * @returns {string}
 */
export function resolveDirectMigrationPostgresUrl(databaseUrl, nonPoolingUrl) {
  const trimmedDb = typeof databaseUrl === 'string' ? databaseUrl.trim() : '';
  if (!trimmedDb) {
    return '';
  }
  const normalizedDb = isValidPostgresUrl(trimmedDb)
    ? normalizePostgresUrl(trimmedDb)
    : trimmedDb;
  const trimmedDirect = typeof nonPoolingUrl === 'string' ? nonPoolingUrl.trim() : '';
  if (!trimmedDirect) {
    return normalizedDb;
  }
  const normalizedDirect = isValidPostgresUrl(trimmedDirect)
    ? normalizePostgresUrl(trimmedDirect)
    : trimmedDirect;

  if (
    isValidPostgresUrl(normalizedDb) &&
    isPooledPostgresUrl(normalizedDb) &&
    isValidPostgresUrl(normalizedDirect) &&
    !isPooledPostgresUrl(normalizedDirect) &&
    hasSamePostgresDatabaseAndSchema(normalizedDb, normalizedDirect)
  ) {
    return normalizedDirect;
  }

  return normalizedDb;
}

/**
 * @param {string} message
 * @param {string} rawUrl
 * @param {ReturnType<typeof parsePostgresUrl>} parsed
 * @returns {string}
 */
function sanitizeProbeErrorMessage(message, rawUrl, parsed) {
  const redacted = redactPostgresUrl(rawUrl);
  let clean = message;
  if (rawUrl) {
    clean = clean.split(rawUrl).join(redacted);
  }
  if (parsed.normalizedUrl) {
    clean = clean.split(parsed.normalizedUrl).join(redacted);
  }
  if (parsed.password) {
    clean = clean.split(parsed.password).join('[REDACTED]');
  }
  if (parsed.sslpassword) {
    clean = clean.split(parsed.sslpassword).join('[REDACTED]');
  }
  clean = clean.replace(/postgres(?:ql)?:\/\/[^\s"'`<>)\]]*/gi, (match) => redactPostgresUrl(match));
  return clean;
}

/**
 * Verifies the PostgreSQL `SSLRequest` negotiation and TLS certificate/hostname
 * handshake using zero external dependencies (`node:net`, `node:tls`, `node:fs`)
 * with identical libpq Table 32.1 rules as the runtime `pg.Pool`.
 *
 * @param {string} rawUrl
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true; tlsMode: 'disable' | 'allow' | 'prefer' | 'require' | 'no-verify' | 'verify-ca' | 'verify-full'; upgraded: boolean }>}
 */
export async function verifyPostgresTlsHandshake(rawUrl, options = {}) {
  const parsed = parsePostgresUrl(rawUrl);
  if (parsed.tlsMode === 'disable') {
    return { ok: true, tlsMode: 'disable', upgraded: false };
  }

  const getBuiltin = /** @type {((id: string) => unknown) | undefined} */ (
    Reflect.get(process, 'getBuiltinModule')
  );
  if (typeof getBuiltin !== 'function') {
    throw new Error('Node.js runtime built-in modules are unavailable for PostgreSQL TLS probe.');
  }

  const netMod = /** @type {typeof import('node:net')} */ (getBuiltin('node:net'));
  const tlsMod = /** @type {typeof import('node:tls')} */ (getBuiltin('node:tls'));
  const fsMod = /** @type {typeof import('node:fs')} */ (getBuiltin('node:fs'));

  /**
   * @param {string} filePath
   * @param {string} paramName
   * @returns {string}
   */
  const readTlsFile = (filePath, paramName) => {
    try {
      return fsMod.readFileSync(filePath, 'utf8');
    } catch {
      throw new Error(`Failed to read PostgreSQL TLS file configured via "${paramName}".`);
    }
  };

  const hasExplicitRootCert = Boolean(parsed.sslrootcert && parsed.sslrootcert !== 'system');
  /** @type {import('node:tls').ConnectionOptions} */
  const tlsConnectOptions = {};

  if (hasExplicitRootCert && parsed.sslrootcert) {
    tlsConnectOptions.ca = readTlsFile(parsed.sslrootcert, 'sslrootcert');
  }
  if (parsed.sslcert) {
    tlsConnectOptions.cert = readTlsFile(parsed.sslcert, 'sslcert');
  }
  if (parsed.sslkey) {
    tlsConnectOptions.key = readTlsFile(parsed.sslkey, 'sslkey');
  }
  if (parsed.sslpassword) {
    tlsConnectOptions.passphrase = parsed.sslpassword;
  }

  if (!parsed.isUnixSocket) {
    tlsConnectOptions.host = parsed.host;
    if (netMod.isIP(parsed.host) === 0) {
      tlsConnectOptions.servername = parsed.host;
    }
  }

  if (
    parsed.tlsMode === 'allow' ||
    parsed.tlsMode === 'prefer' ||
    parsed.tlsMode === 'no-verify'
  ) {
    tlsConnectOptions.rejectUnauthorized = false;
  } else if (parsed.tlsMode === 'require') {
    if (hasExplicitRootCert) {
      tlsConnectOptions.rejectUnauthorized = true;
      tlsConnectOptions.checkServerIdentity = () => undefined;
    } else {
      tlsConnectOptions.rejectUnauthorized = false;
    }
  } else if (parsed.tlsMode === 'verify-ca') {
    tlsConnectOptions.rejectUnauthorized = true;
    tlsConnectOptions.checkServerIdentity = () => undefined;
  } else {
    // verify-full (including sslrootcert=system)
    tlsConnectOptions.rejectUnauthorized = true;
  }

  const timeoutMs =
    options.timeoutMs ?? parsed.connectionTimeoutMillis ?? DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS;
  const redactedTarget = redactPostgresUrl(rawUrl);

  const resolvedUnixSocketFile =
    parsed.isUnixSocket && parsed.socketPath
      ? parsed.socketPath.includes('.s.PGSQL.')
        ? parsed.socketPath
        : `${parsed.socketPath.replace(/\/+$/, '')}/.s.PGSQL.${parsed.port}`
      : null;

  /**
   * Executes a raw TCP/Unix socket dial outside test-time `@mswjs/interceptors`
   * HTTP socket emulation when present so binary PostgreSQL wire probes always
   * perform real OS socket and OpenSSL handshakes.
   *
   * @template T
   * @param {() => T} fn
   * @returns {T}
   */
  const runNativeSocketConnect = (fn) => {
    const mswInternalCtx = /** @type {{ run?: <R>(_cb: () => R) => R } | undefined} */ (
      Reflect.get(globalThis, '__MSW_INTERNAL_CONNECTION_CONTEXT')
    );
    if (mswInternalCtx && typeof mswInternalCtx.run === 'function') {
      return mswInternalCtx.run(fn);
    }
    return fn();
  };

  /**
   * Opens a plain TCP/Unix socket to verify plaintext fallback reachability.
   * @param {number} budgetMs
   * @returns {Promise<void>}
   */
  const verifyPlainTcpFallback = (budgetMs) =>
    new Promise((resolve, reject) => {
      const fallbackSocket = new netMod.Socket();
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        fallbackSocket.destroy();
        reject(new Error(`PostgreSQL connection timed out after ${timeoutMs}ms (${redactedTarget}).`));
      }, Math.max(50, budgetMs));
      timer.unref?.();

      fallbackSocket.once('connect', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fallbackSocket.destroy();
        resolve();
      });

      fallbackSocket.once('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fallbackSocket.destroy();
        reject(err);
      });

      runNativeSocketConnect(() => {
        if (resolvedUnixSocketFile) {
          fallbackSocket.connect(resolvedUnixSocketFile);
        } else {
          fallbackSocket.connect(parsed.port, parsed.host);
        }
      });
    });

  const startedAt = Date.now();

  try {
    return await new Promise((resolve, reject) => {
      const socket = new netMod.Socket();
      /** @type {import('node:tls').TLSSocket | null} */
      let tlsSocket = null;
      let settled = false;
      let tcpConnected = false;
      let responseHandled = false;

      const finishResolve = (/** @type {boolean} */ upgraded) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (tlsSocket && !tlsSocket.destroyed) {
          tlsSocket.destroy();
        }
        if (!socket.destroyed) {
          socket.destroy();
        }
        resolve({ ok: true, tlsMode: parsed.tlsMode, upgraded });
      };

      const finishReject = (/** @type {unknown} */ err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (tlsSocket && !tlsSocket.destroyed) {
          tlsSocket.destroy();
        }
        if (!socket.destroyed) {
          socket.destroy();
        }
        const rawMsg = err instanceof Error ? err.message : String(err);
        reject(new Error(sanitizeProbeErrorMessage(rawMsg, rawUrl, parsed)));
      };

      const handleNonSslFallbackOrReject = () => {
        if (settled) return;
        if (parsed.tlsMode === 'allow' || parsed.tlsMode === 'prefer') {
          if (!socket.destroyed) {
            socket.destroy();
          }
          const remainingMs = timeoutMs - (Date.now() - startedAt);
          verifyPlainTcpFallback(remainingMs).then(
            () => finishResolve(false),
            (fallbackErr) => finishReject(fallbackErr)
          );
          return;
        }
        finishReject(
          new Error(
            `PostgreSQL server does not support SSL connections (tlsMode=${parsed.tlsMode}, target=${redactedTarget}).`
          )
        );
      };

      const timer = setTimeout(() => {
        finishReject(
          new Error(`PostgreSQL TLS handshake timed out after ${timeoutMs}ms (${redactedTarget}).`)
        );
      }, timeoutMs);
      timer.unref?.();

      socket.setNoDelay(true);

      const onRawError = (/** @type {NodeJS.ErrnoException} */ err) => {
        if (!tcpConnected) {
          finishReject(err);
          return;
        }
        if (!responseHandled) {
          responseHandled = true;
          handleNonSslFallbackOrReject();
          return;
        }
        finishReject(err);
      };

      const onRawClose = () => {
        if (settled || responseHandled) {
          return;
        }
        if (tcpConnected) {
          responseHandled = true;
          handleNonSslFallbackOrReject();
          return;
        }
        finishReject(
          new Error(`PostgreSQL connection closed before handshake completed (${redactedTarget}).`)
        );
      };

      socket.on('error', onRawError);
      socket.on('close', onRawClose);

      socket.once('connect', () => {
        tcpConnected = true;
        socket.write(POSTGRES_SSL_REQUEST_PACKET);
      });

      socket.once('data', (chunk) => {
        if (settled || responseHandled) {
          return;
        }
        responseHandled = true;
        const firstByte = chunk[0];

        if (firstByte !== 0x53) {
          // 'N' (0x4e) or non-'S' response to SSLRequest
          handleNonSslFallbackOrReject();
          return;
        }

        socket.removeListener('error', onRawError);
        socket.removeListener('close', onRawClose);

        try {
          tlsSocket = runNativeSocketConnect(() =>
            tlsMod.connect({
              ...tlsConnectOptions,
              socket,
            })
          );
        } catch (tlsInitErr) {
          finishReject(tlsInitErr);
          return;
        }

        tlsSocket.once('secureConnect', () => {
          if (tlsConnectOptions.rejectUnauthorized !== false && tlsSocket && !tlsSocket.authorized) {
            finishReject(
              tlsSocket.authorizationError ||
                new Error(`PostgreSQL TLS certificate verification failed (${redactedTarget}).`)
            );
            return;
          }
          finishResolve(true);
        });

        tlsSocket.once('error', (tlsErr) => {
          if (parsed.tlsMode === 'allow' || parsed.tlsMode === 'prefer') {
            tlsSocket?.destroy();
            const remainingMs = timeoutMs - (Date.now() - startedAt);
            verifyPlainTcpFallback(remainingMs).then(
              () => finishResolve(false),
              (fallbackErr) => finishReject(fallbackErr)
            );
            return;
          }
          finishReject(tlsErr);
        });

        tlsSocket.once('close', () => {
          if (!settled) {
            finishReject(
              new Error(`PostgreSQL TLS handshake closed unexpectedly (${redactedTarget}).`)
            );
          }
        });
      });

      runNativeSocketConnect(() => {
        if (resolvedUnixSocketFile) {
          socket.connect(resolvedUnixSocketFile);
        } else {
          socket.connect(parsed.port, parsed.host);
        }
      });
    });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    throw new Error(sanitizeProbeErrorMessage(rawMsg, rawUrl, parsed));
  }
}
