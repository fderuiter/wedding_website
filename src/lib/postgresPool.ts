import fs from 'node:fs';
import net from 'node:net';
import type { ConnectionOptions, TLSSocket } from 'node:tls';
import pg, { type ClientBase, type ClientConfig, type PoolConfig } from 'pg';
import {
  isPooledPostgresUrl,
  parsePostgresUrl,
  quotePostgresIdentifier,
  type ParsedPostgresUrl,
} from './postgres-url.js';

export interface PostgresRuntimeConfig {
  parsed: ParsedPostgresUrl;
  poolConfig: PoolConfig;
  adapterOptions: {
    schema: string;
  };
}

interface InternalPgConnectionConfig {
  stream?: net.Socket;
  ssl?: boolean | ConnectionOptions;
  sslNegotiation?: 'postgres' | 'direct';
  keepAlive?: boolean;
  keepAliveInitialDelayMillis?: number;
  encoding?: string;
}

interface InternalPgConnectionInstance {
  stream: net.Socket | TLSSocket;
  ssl: boolean | ConnectionOptions;
  sslNegotiation: string;
  _keepAlive?: boolean;
  _keepAliveInitialDelayMillis?: number;
  _connecting?: boolean;
  _ending?: boolean;
  connect(_portOrPath: number | string, _host?: string): void;
  upgradeToSSL(
    _host: string | undefined,
    _reportStreamError: (_error: NodeJS.ErrnoException) => void
  ): void;
  attachListeners(_stream: net.Socket | TLSSocket): void;
  requestSsl(): void;
  emit(_event: string, ..._args: unknown[]): boolean;
}

type InternalPgConnectionConstructor = new (
  _config?: InternalPgConnectionConfig
) => InternalPgConnectionInstance;

function loadCertificateFile(filePath: string, paramName: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`Failed to read PostgreSQL TLS file configured via "${paramName}".`);
  }
}

/**
 * Resolves Node `tls.ConnectionOptions | boolean` matching PostgreSQL libpq Table 32.1:
 * - `disable`: returns `false` (plaintext only).
 * - `allow`: returns `{ rejectUnauthorized: false, ... }` for TLS upgrade fallback after
 *   attempting a plaintext startup first via `createAllowTlsClientConstructor`.
 * - `prefer`: tries TLS `{ rejectUnauthorized: false, ... }` first and falls back to plaintext
 *   when the server does not support SSL (`'N'`) or fails SSL negotiation.
 * - `no-verify`: encrypts traffic without CA or hostname verification (`rejectUnauthorized: false`).
 * - `require` (including `ssl=true` / `ssl=1`): encrypts traffic; accepts self-signed certificates
 *   when `sslrootcert` is omitted (`rejectUnauthorized: false`), or verifies CA when `sslrootcert`
 *   is explicitly provided (`rejectUnauthorized: true`, skipping hostname check per libpq Table 32.1).
 * - `verify-ca`: strictly verifies the server certificate against `sslrootcert` (or system CAs)
 *   with `rejectUnauthorized: true`, skipping hostname identity matching (`checkServerIdentity: () => undefined`).
 * - `verify-full`: strictly verifies both the CA certificate chain (`rejectUnauthorized: true`)
 *   and server hostname/SAN identity (Node's default `tls.checkServerIdentity`).
 */
export function resolvePostgresTlsOptions(
  parsed: ParsedPostgresUrl
): false | ConnectionOptions {
  const { tlsMode, sslrootcert, sslcert, sslkey, sslpassword } = parsed;

  if (tlsMode === 'disable') {
    return false;
  }

  const certOptions: ConnectionOptions = {};
  const hasExplicitRootCert = Boolean(sslrootcert && sslrootcert !== 'system');

  if (hasExplicitRootCert && sslrootcert) {
    certOptions.ca = loadCertificateFile(sslrootcert, 'sslrootcert');
  }
  if (sslcert) {
    certOptions.cert = loadCertificateFile(sslcert, 'sslcert');
  }
  if (sslkey) {
    certOptions.key = loadCertificateFile(sslkey, 'sslkey');
  }
  if (sslpassword) {
    certOptions.passphrase = sslpassword;
  }

  if (tlsMode === 'allow' || tlsMode === 'prefer' || tlsMode === 'no-verify') {
    return {
      ...certOptions,
      rejectUnauthorized: false,
    };
  }

  if (tlsMode === 'require') {
    if (hasExplicitRootCert) {
      return {
        ...certOptions,
        rejectUnauthorized: true,
        checkServerIdentity: () => undefined,
      };
    }
    return {
      ...certOptions,
      rejectUnauthorized: false,
    };
  }

  if (tlsMode === 'verify-ca') {
    return {
      ...certOptions,
      rejectUnauthorized: true,
      checkServerIdentity: () => undefined,
    };
  }

  // verify-full (including sslrootcert=system)
  return {
    ...certOptions,
    rejectUnauthorized: true,
  };
}

function connectRawSocket(
  socket: net.Socket,
  portOrPath: number | string,
  host?: string
): void {
  if (host === undefined) {
    socket.connect(String(portOrPath));
  } else {
    socket.connect(Number(portOrPath), host);
  }
}

/**
 * Builds a `pg.Client` constructor for `sslmode=prefer` that negotiates TLS first
 * and transparently falls back to a clean plaintext connection if the server replies `'N'`
 * (`The server does not support SSL connections`) or rejects TLS negotiation prior to startup.
 */
function createPreferTlsClientConstructor(
  tlsOptions: ConnectionOptions
): (new (_config?: ClientConfig) => ClientBase) | undefined {
  const PgModule = pg as unknown as {
    Client?: new (_config?: ClientConfig & { connection?: unknown }) => ClientBase & {
      ssl?: boolean | ConnectionOptions;
      connectionParameters?: {
        ssl?: boolean | ConnectionOptions;
        sslnegotiation?: 'postgres' | 'direct';
        client_encoding?: BufferEncoding;
      };
    };
    Connection?: InternalPgConnectionConstructor;
  };

  const BaseClient = PgModule.Client;
  const BaseConnection = PgModule.Connection;

  if (typeof BaseClient !== 'function' || typeof BaseConnection !== 'function') {
    return undefined;
  }

  class PreferPostgresConnection extends BaseConnection {
    private readonly onPlaintextFallback: () => void;

    constructor(
      config: InternalPgConnectionConfig,
      onPlaintextFallback: () => void
    ) {
      super(config);
      this.onPlaintextFallback = onPlaintextFallback;
    }

    override connect(portOrPath: number | string, host?: string): void {
      if (!this.ssl || typeof this.upgradeToSSL !== 'function') {
        super.connect(portOrPath, host);
        return;
      }

      this._connecting = true;
      const initialSocket = this.stream as net.Socket;
      initialSocket.setNoDelay(true);

      const reportRuntimeStreamError = (error: NodeJS.ErrnoException) => {
        if (this._ending && (error.code === 'ECONNRESET' || error.code === 'EPIPE')) {
          return;
        }
        this.emit('error', error);
      };

      let tcpConnected = false;
      let sslUpgraded = false;
      let fallbackTriggered = false;

      const fallbackToPlaintext = () => {
        if (fallbackTriggered || sslUpgraded || this._ending) {
          return;
        }
        fallbackTriggered = true;

        initialSocket.removeAllListeners();
        initialSocket.on('error', () => {});
        initialSocket.destroy();

        this.ssl = false;
        this.onPlaintextFallback();

        const plainSocket = new net.Socket();
        plainSocket.setNoDelay(true);
        this.stream = plainSocket;

        plainSocket.once('connect', () => {
          if (this._keepAlive) {
            plainSocket.setKeepAlive(true, this._keepAliveInitialDelayMillis ?? 0);
          }
          // pg.Client already received 'connect' and registered its 'sslconnect' startup hook
          this.emit('sslconnect');
        });

        plainSocket.on('error', reportRuntimeStreamError);
        plainSocket.on('close', () => {
          this.emit('end');
        });

        this.attachListeners(plainSocket);
        connectRawSocket(plainSocket, portOrPath, host);
      };

      const onInitialError = (err: NodeJS.ErrnoException) => {
        if (!tcpConnected) {
          // Host/port itself is unreachable over TCP — fail fast without retrying
          reportRuntimeStreamError(err);
          return;
        }
        if (!sslUpgraded) {
          fallbackToPlaintext();
          return;
        }
        reportRuntimeStreamError(err);
      };

      const onInitialClose = () => {
        if (fallbackTriggered) {
          return;
        }
        if (tcpConnected && !sslUpgraded && !this._ending) {
          fallbackToPlaintext();
          return;
        }
        this.emit('end');
      };

      initialSocket.on('error', onInitialError);
      initialSocket.on('close', onInitialClose);

      initialSocket.once('connect', () => {
        tcpConnected = true;
        if (this._keepAlive) {
          initialSocket.setKeepAlive(true, this._keepAliveInitialDelayMillis ?? 0);
        }
        this.emit('connect');
      });

      initialSocket.once('data', (buffer: Buffer) => {
        const responseCode = buffer.toString('utf8');
        if (responseCode !== 'S') {
          // 'N' (SSL unsupported) or non-SSL response -> fall back to plaintext per libpq prefer
          fallbackToPlaintext();
          return;
        }

        sslUpgraded = true;
        initialSocket.removeListener('error', onInitialError);
        initialSocket.removeListener('close', onInitialClose);
        super.upgradeToSSL(host, reportRuntimeStreamError);
        this.stream.on('close', () => {
          this.emit('end');
        });
      });

      connectRawSocket(initialSocket, portOrPath, host);
    }
  }

  class PreferTlsClient extends BaseClient {
    constructor(config: ClientConfig = {}) {
      const holder: { client?: PreferTlsClient } = {};
      const connection = new PreferPostgresConnection(
        {
          ssl: tlsOptions,
          sslNegotiation: config.sslnegotiation ?? 'postgres',
          keepAlive: config.keepAlive ?? false,
          keepAliveInitialDelayMillis: config.keepAliveInitialDelayMillis ?? 0,
          encoding: config.client_encoding ?? 'utf8',
        },
        () => {
          if (holder.client) {
            holder.client.ssl = false;
            if (holder.client.connectionParameters) {
              holder.client.connectionParameters.ssl = false;
            }
          }
        }
      );
      super({
        ...config,
        password: config.password,
        ssl: tlsOptions,
        connection,
      });
      holder.client = this;
    }
  }

  return PreferTlsClient as unknown as new (_config?: ClientConfig) => ClientBase;
}

/**
 * Builds a `pg.Client` constructor for `sslmode=allow` per PostgreSQL libpq Table 32.1:
 * attempts a plaintext startup first without sending `SSLRequest`, and automatically
 * upgrades to TLS (`SSLRequest` -> `'S'` -> `TLSSocket`) if the server rejects
 * unencrypted connections prior to `ReadyForQuery`.
 */
function createAllowTlsClientConstructor(
  tlsOptions: ConnectionOptions
): (new (_config?: ClientConfig) => ClientBase) | undefined {
  const PgModule = pg as unknown as {
    Client?: new (_config?: ClientConfig & { connection?: unknown }) => ClientBase & {
      ssl?: boolean | ConnectionOptions;
      connectionParameters?: {
        ssl?: boolean | ConnectionOptions;
        sslnegotiation?: 'postgres' | 'direct';
        client_encoding?: BufferEncoding;
      };
    };
    Connection?: InternalPgConnectionConstructor;
  };

  const BaseClient = PgModule.Client;
  const BaseConnection = PgModule.Connection;

  if (typeof BaseClient !== 'function' || typeof BaseConnection !== 'function') {
    return undefined;
  }

  class AllowPostgresConnection extends BaseConnection {
    private readonly onTlsUpgrade: () => void;
    private tcpConnected = false;
    private authPromptReceived = false;
    private readyForQueryReceived = false;
    private tlsFallbackTriggered = false;
    private triggerTlsUpgrade: (() => void) | null = null;

    constructor(
      config: InternalPgConnectionConfig,
      onTlsUpgrade: () => void
    ) {
      super(config);
      this.onTlsUpgrade = onTlsUpgrade;
    }

    override emit(event: string, ...args: unknown[]): boolean {
      if (event === 'readyForQuery') {
        this.readyForQueryReceived = true;
      } else if (
        event === 'authenticationCleartextPassword' ||
        event === 'authenticationMD5Password' ||
        event === 'authenticationSASL'
      ) {
        this.authPromptReceived = true;
      } else if (
        event === 'errorMessage' &&
        !this.readyForQueryReceived &&
        !this.tlsFallbackTriggered &&
        this.tcpConnected &&
        !this._ending &&
        this.triggerTlsUpgrade
      ) {
        const msg = args[0] as { code?: string } | undefined;
        // If plaintext was accepted (auth prompt sent) and password itself failed (28P01),
        // surface the credential error directly rather than retrying over TLS.
        if (!(this.authPromptReceived && msg?.code === '28P01')) {
          this.triggerTlsUpgrade();
          return true;
        }
      }
      return super.emit(event, ...args);
    }

    override connect(portOrPath: number | string, host?: string): void {
      if (this.ssl || typeof this.upgradeToSSL !== 'function') {
        super.connect(portOrPath, host);
        return;
      }

      this._connecting = true;
      const plainSocket = this.stream as net.Socket;
      plainSocket.setNoDelay(true);

      const reportRuntimeStreamError = (error: NodeJS.ErrnoException) => {
        if (this._ending && (error.code === 'ECONNRESET' || error.code === 'EPIPE')) {
          return;
        }
        super.emit('error', error);
      };

      const upgradeToTlsConnection = () => {
        if (this.tlsFallbackTriggered || this.readyForQueryReceived || this._ending) {
          return;
        }
        this.tlsFallbackTriggered = true;

        plainSocket.removeAllListeners();
        plainSocket.on('error', () => {});
        plainSocket.destroy();

        this.ssl = tlsOptions;
        this.onTlsUpgrade();

        const tlsRawSocket = new net.Socket();
        tlsRawSocket.setNoDelay(true);
        this.stream = tlsRawSocket;

        let tlsTcpConnected = false;
        let sslUpgraded = false;

        const onTlsRawError = (err: NodeJS.ErrnoException) => {
          reportRuntimeStreamError(err);
        };

        const onTlsRawClose = () => {
          if (!sslUpgraded) {
            if (tlsTcpConnected && !this._ending) {
              super.emit('error', new Error('Connection terminated unexpectedly during SSL upgrade'));
            }
            super.emit('end');
          }
        };

        tlsRawSocket.on('error', onTlsRawError);
        tlsRawSocket.on('close', onTlsRawClose);

        tlsRawSocket.once('connect', () => {
          tlsTcpConnected = true;
          if (this._keepAlive) {
            tlsRawSocket.setKeepAlive(true, this._keepAliveInitialDelayMillis ?? 0);
          }
          if (this.sslNegotiation === 'direct') {
            sslUpgraded = true;
            tlsRawSocket.removeListener('error', onTlsRawError);
            tlsRawSocket.removeListener('close', onTlsRawClose);
            super.upgradeToSSL(host, reportRuntimeStreamError);
            this.stream.on('close', () => {
              super.emit('end');
            });
            return;
          }
          this.requestSsl();
        });

        if (this.sslNegotiation !== 'direct') {
          tlsRawSocket.once('data', (buffer: Buffer) => {
            const responseCode = buffer.toString('utf8');
            if (responseCode !== 'S') {
              tlsRawSocket.end();
              super.emit(
                'error',
                new Error(
                  responseCode === 'N'
                    ? 'The server does not support SSL connections'
                    : 'There was an error establishing an SSL connection'
                )
              );
              return;
            }
            sslUpgraded = true;
            tlsRawSocket.removeListener('error', onTlsRawError);
            tlsRawSocket.removeListener('close', onTlsRawClose);
            super.upgradeToSSL(host, reportRuntimeStreamError);
            this.stream.on('close', () => {
              super.emit('end');
            });
          });
        }

        connectRawSocket(tlsRawSocket, portOrPath, host);
      };

      this.triggerTlsUpgrade = upgradeToTlsConnection;

      plainSocket.on('error', (err: NodeJS.ErrnoException) => {
        if (!this.tcpConnected) {
          reportRuntimeStreamError(err);
          return;
        }
        if (!this.readyForQueryReceived && !this.tlsFallbackTriggered && !this._ending) {
          upgradeToTlsConnection();
          return;
        }
        reportRuntimeStreamError(err);
      });

      plainSocket.on('close', () => {
        if (this.tlsFallbackTriggered) {
          return;
        }
        if (this.tcpConnected && !this.readyForQueryReceived && !this._ending) {
          upgradeToTlsConnection();
          return;
        }
        super.emit('end');
      });

      plainSocket.once('connect', () => {
        this.tcpConnected = true;
        if (this._keepAlive) {
          plainSocket.setKeepAlive(true, this._keepAliveInitialDelayMillis ?? 0);
        }
        super.emit('connect');
      });

      this.attachListeners(plainSocket);
      connectRawSocket(plainSocket, portOrPath, host);
    }
  }

  class AllowTlsClient extends BaseClient {
    constructor(config: ClientConfig = {}) {
      const holder: { client?: AllowTlsClient } = {};
      const connection = new AllowPostgresConnection(
        {
          ssl: false,
          sslNegotiation: config.sslnegotiation ?? 'postgres',
          keepAlive: config.keepAlive ?? false,
          keepAliveInitialDelayMillis: config.keepAliveInitialDelayMillis ?? 0,
          encoding: config.client_encoding ?? 'utf8',
        },
        () => {
          if (holder.client) {
            holder.client.ssl = tlsOptions;
            if (holder.client.connectionParameters) {
              holder.client.connectionParameters.ssl = tlsOptions;
            }
          }
        }
      );
      super({
        ...config,
        password: config.password,
        ssl: false,
        connection,
      });
      holder.client = this;
    }
  }

  return AllowTlsClient as unknown as new (_config?: ClientConfig) => ClientBase;
}

/**
 * Builds the runtime `pg.PoolConfig` and `PrismaPg` adapter options from a raw
 * `DATABASE_URL`, avoiding `connectionString` re-parsing in `pg` so resolved
 * TLS rules, Unix socket paths, schema selection, and pool/timeout caps are preserved.
 */
export function buildPostgresRuntimeConfig(rawUrl: string): PostgresRuntimeConfig {
  const parsed = parsePostgresUrl(rawUrl);
  const ssl = resolvePostgresTlsOptions(parsed);
  const isPooled = isPooledPostgresUrl(rawUrl);
  const searchPathFlag = `-c search_path=${quotePostgresIdentifier(parsed.schema, 'query parameter "schema"')}`;

  const poolConfig: PoolConfig = {
    host: parsed.host,
    port: parsed.port,
    database: parsed.database,
    max: parsed.max,
    connectionTimeoutMillis: parsed.connectionTimeoutMillis,
    ssl: parsed.tlsMode === 'allow' ? false : ssl,
  };

  if (parsed.user !== undefined) {
    poolConfig.user = parsed.user;
  }
  if (parsed.password !== undefined) {
    poolConfig.password = parsed.password;
  }
  if (parsed.queryTimeoutMillis !== undefined) {
    poolConfig.query_timeout = parsed.queryTimeoutMillis;
  }
  if (parsed.statementTimeoutMillis !== undefined) {
    poolConfig.statement_timeout = parsed.statementTimeoutMillis;
  }
  if (parsed.idleInTransactionSessionTimeoutMillis !== undefined) {
    poolConfig.idle_in_transaction_session_timeout = parsed.idleInTransactionSessionTimeoutMillis;
  }
  if (parsed.applicationName !== undefined) {
    poolConfig.application_name = parsed.applicationName;
  }
  if (!isPooled) {
    if (parsed.options !== undefined) {
      poolConfig.options = /\bsearch_path\b/i.test(parsed.options)
        ? parsed.options
        : `${parsed.options} ${searchPathFlag}`;
    } else {
      poolConfig.options = searchPathFlag;
    }
  } else if (parsed.options !== undefined) {
    poolConfig.options = parsed.options;
  }

  if (parsed.tlsMode === 'prefer' && ssl !== false) {
    const PreferClient = createPreferTlsClientConstructor(ssl);
    if (PreferClient) {
      poolConfig.Client = PreferClient as unknown as PoolConfig['Client'];
    }
  } else if (parsed.tlsMode === 'allow' && ssl !== false) {
    const AllowClient = createAllowTlsClientConstructor(ssl);
    if (AllowClient) {
      poolConfig.Client = AllowClient as unknown as PoolConfig['Client'];
    }
  }

  return {
    parsed,
    poolConfig,
    adapterOptions: {
      schema: parsed.schema,
    },
  };
}
