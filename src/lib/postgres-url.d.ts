export declare const DEFAULT_POSTGRES_POOL_MAX = 5;
export declare const DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS = 10000;
export declare const DEFAULT_POSTGRES_SCHEMA = 'public';

export type PostgresTlsMode =
  | 'disable'
  | 'allow'
  | 'prefer'
  | 'require'
  | 'no-verify'
  | 'verify-ca'
  | 'verify-full';

export interface ParsePostgresUrlOptions {
  allowEmptyHostSocket?: boolean;
  requireDatabaseName?: boolean;
}

export interface ParsedPostgresUrl {
  scheme: 'postgres' | 'postgresql';
  normalizedUrl: string;
  usedEmptyHostSocketShorthand: boolean;
  isUnixSocket: boolean;
  socketPath: string | null;
  host: string;
  authorityHost: string;
  port: number;
  user: string | undefined;
  password: string | undefined;
  database: string;
  schema: string;
  tlsMode: PostgresTlsMode;
  sslmode:
    | 'disable'
    | 'allow'
    | 'prefer'
    | 'require'
    | 'verify-ca'
    | 'verify-full'
    | 'no-verify'
    | undefined;
  sslFlag: 'true' | 'false' | '1' | '0' | 'no-verify' | undefined;
  sslrootcert: string | undefined;
  sslcert: string | undefined;
  sslkey: string | undefined;
  sslpassword: string | undefined;
  max: number;
  connectionLimit: number | undefined;
  connectTimeoutSeconds: number | undefined;
  poolTimeoutSeconds: number | undefined;
  socketTimeoutSeconds: number | undefined;
  connectionTimeoutMillis: number;
  queryTimeoutMillis: number | undefined;
  statementTimeoutMillis: number | undefined;
  idleInTransactionSessionTimeoutMillis: number | undefined;
  applicationName: string | undefined;
  options: string | undefined;
}

export declare class PostgresUrlValidationError extends Error {
  constructor(_message: string);
}

export declare function redactPostgresUrl(_raw: unknown): string;

export declare function isLoopbackPostgresHost(_host: unknown): boolean;

export declare function parsePostgresUrl(
  _rawUrl: string,
  _options?: ParsePostgresUrlOptions
): ParsedPostgresUrl;

export declare function normalizePostgresUrl(
  _rawUrl: string,
  _options?: ParsePostgresUrlOptions
): string;

export declare function isValidPostgresUrl(
  _rawUrl: string,
  _options?: ParsePostgresUrlOptions
): boolean;

export declare function validatePostgresIdentifier(
  _identifier: string,
  _label?: string
): string;

export declare function quotePostgresIdentifier(
  _identifier: string,
  _label?: string
): string;

export declare function resolvePostgresSchema(_rawUrl?: string): string;

export declare function qualifyPostgresTable(
  _tableName: string,
  _rawUrl?: string
): string;

export declare function isPooledPostgresUrl(_rawUrl?: string): boolean;

export declare function resolveDirectMigrationPostgresUrl(
  _databaseUrl?: string,
  _nonPoolingUrl?: string
): string;

export interface VerifyPostgresTlsHandshakeOptions {
  timeoutMs?: number;
}

export interface VerifyPostgresTlsHandshakeResult {
  ok: true;
  tlsMode: PostgresTlsMode;
  upgraded: boolean;
}

export declare function verifyPostgresTlsHandshake(
  _rawUrl: string,
  _options?: VerifyPostgresTlsHandshakeOptions
): Promise<VerifyPostgresTlsHandshakeResult>;

