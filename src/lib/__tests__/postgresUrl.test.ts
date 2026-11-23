/**
 * @jest-environment node
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { Pool } from 'pg';
import {
  DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS,
  DEFAULT_POSTGRES_POOL_MAX,
  DEFAULT_POSTGRES_SCHEMA,
  PostgresUrlValidationError,
  isValidPostgresUrl,
  normalizePostgresUrl,
  parsePostgresUrl,
  redactPostgresUrl,
} from '../postgres-url.js';
import {
  buildPostgresRuntimeConfig,
  resolvePostgresTlsOptions,
} from '../postgresPool';

interface GeneratedCertBundle {
  dir: string;
  selfSignedKeyPath: string;
  selfSignedCertPath: string;
  caKeyPath: string;
  caCertPath: string;
  localhostKeyPath: string;
  localhostCertPath: string;
  otherHostKeyPath: string;
  otherHostCertPath: string;
}

function derLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  const bytes: number[] = [];
  let remaining = len;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derSequence(items: Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(items));
}

function derSet(items: Buffer[]): Buffer {
  return derTlv(0x31, Buffer.concat(items));
}

function derOid(oidBytes: number[]): Buffer {
  return derTlv(0x06, Buffer.from(oidBytes));
}

function derUtf8String(value: string): Buffer {
  return derTlv(0x0c, Buffer.from(value, 'utf8'));
}

function derUtcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yy = pad(date.getUTCFullYear() % 100);
  const mm = pad(date.getUTCMonth() + 1);
  const dd = pad(date.getUTCDate());
  const hh = pad(date.getUTCHours());
  const mi = pad(date.getUTCMinutes());
  const ss = pad(date.getUTCSeconds());
  return derTlv(0x17, Buffer.from(`${yy}${mm}${dd}${hh}${mi}${ss}Z`, 'ascii'));
}

function derNameCn(cn: string): Buffer {
  // OID 2.5.4.3 (commonName) = 55 04 03
  return derSequence([derSet([derSequence([derOid([0x55, 0x04, 0x03]), derUtf8String(cn)])])]);
}

function createX509PemCertificate(params: {
  subjectCn: string;
  issuerCn: string;
  subjectPublicKeySpkiDer: Buffer;
  issuerPrivateKey: crypto.KeyObject;
  serialNumber: number;
  isCa: boolean;
  dnsNames?: string[];
  ipv4Addresses?: string[];
}): string {
  // ecdsa-with-SHA256 OID 1.2.840.10045.4.3.2 = 2a 86 48 ce 3d 04 03 02
  const sigAlg = derSequence([derOid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])]);
  const versionV3 = derTlv(0xa0, derTlv(0x02, Buffer.from([0x02])));
  const serial = derTlv(0x02, Buffer.from([params.serialNumber]));
  const now = new Date(Date.now() - 60_000);
  const expires = new Date(Date.now() + 2 * 24 * 3600_000);
  const validity = derSequence([derUtcTime(now), derUtcTime(expires)]);

  const extItems: Buffer[] = [];
  if (params.isCa) {
    // BasicConstraints (2.5.29.19 = 55 1d 13), critical=true, CA=TRUE
    const basicConstraintsVal = derSequence([derTlv(0x01, Buffer.from([0xff]))]);
    extItems.push(
      derSequence([
        derOid([0x55, 0x1d, 0x13]),
        derTlv(0x01, Buffer.from([0xff])),
        derTlv(0x04, basicConstraintsVal),
      ])
    );
  } else {
    const basicConstraintsVal = derSequence([]);
    extItems.push(
      derSequence([
        derOid([0x55, 0x1d, 0x13]),
        derTlv(0x04, basicConstraintsVal),
      ])
    );
  }

  const sanEntries: Buffer[] = [];
  for (const dns of params.dnsNames ?? []) {
    // GeneralName dNSName [2] IMPLICIT IA5String (0x82)
    sanEntries.push(derTlv(0x82, Buffer.from(dns, 'ascii')));
  }
  for (const ip of params.ipv4Addresses ?? []) {
    // GeneralName iPAddress [7] IMPLICIT OCTET STRING (0x87)
    const octets = ip.split('.').map((part) => Number(part));
    sanEntries.push(derTlv(0x87, Buffer.from(octets)));
  }
  if (sanEntries.length > 0) {
    // subjectAltName OID 2.5.29.17 = 55 1d 11
    extItems.push(
      derSequence([
        derOid([0x55, 0x1d, 0x11]),
        derTlv(0x04, derSequence(sanEntries)),
      ])
    );
  }

  const extensions = derTlv(0xa3, derSequence(extItems));

  const tbsCert = derSequence([
    versionV3,
    serial,
    sigAlg,
    derNameCn(params.issuerCn),
    validity,
    derNameCn(params.subjectCn),
    params.subjectPublicKeySpkiDer,
    extensions,
  ]);

  const signature = crypto.sign('sha256', tbsCert, params.issuerPrivateKey);
  const sigBitString = derTlv(0x03, Buffer.concat([Buffer.from([0x00]), signature]));
  const fullCertDer = derSequence([tbsCert, sigAlg, sigBitString]);
  const b64 = fullCertDer.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

function generateEcKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

function generateTestCertificates(): GeneratedCertBundle {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-tls-certs-'));

  const selfSignedKeys = generateEcKeyPair();
  const selfSignedKeyPath = path.join(dir, 'self-signed.key');
  const selfSignedCertPath = path.join(dir, 'self-signed.crt');
  fs.writeFileSync(
    selfSignedKeyPath,
    selfSignedKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  );
  fs.writeFileSync(
    selfSignedCertPath,
    createX509PemCertificate({
      subjectCn: 'self-signed-pg.local',
      issuerCn: 'self-signed-pg.local',
      subjectPublicKeySpkiDer: selfSignedKeys.publicKey.export({ type: 'spki', format: 'der' }),
      issuerPrivateKey: selfSignedKeys.privateKey,
      serialNumber: 1,
      isCa: false,
      dnsNames: ['self-signed-pg.local'],
    })
  );

  const caKeys = generateEcKeyPair();
  const caKeyPath = path.join(dir, 'ca.key');
  const caCertPath = path.join(dir, 'ca.crt');
  const caCn = 'Test Postgres Root CA';
  fs.writeFileSync(caKeyPath, caKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  fs.writeFileSync(
    caCertPath,
    createX509PemCertificate({
      subjectCn: caCn,
      issuerCn: caCn,
      subjectPublicKeySpkiDer: caKeys.publicKey.export({ type: 'spki', format: 'der' }),
      issuerPrivateKey: caKeys.privateKey,
      serialNumber: 2,
      isCa: true,
    })
  );

  const localhostKeys = generateEcKeyPair();
  const localhostKeyPath = path.join(dir, 'localhost.key');
  const localhostCertPath = path.join(dir, 'localhost.crt');
  fs.writeFileSync(
    localhostKeyPath,
    localhostKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  );
  fs.writeFileSync(
    localhostCertPath,
    createX509PemCertificate({
      subjectCn: 'localhost',
      issuerCn: caCn,
      subjectPublicKeySpkiDer: localhostKeys.publicKey.export({ type: 'spki', format: 'der' }),
      issuerPrivateKey: caKeys.privateKey,
      serialNumber: 3,
      isCa: false,
      dnsNames: ['localhost'],
      ipv4Addresses: ['127.0.0.1'],
    })
  );

  const otherHostKeys = generateEcKeyPair();
  const otherHostKeyPath = path.join(dir, 'other-host.key');
  const otherHostCertPath = path.join(dir, 'other-host.crt');
  fs.writeFileSync(
    otherHostKeyPath,
    otherHostKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })
  );
  fs.writeFileSync(
    otherHostCertPath,
    createX509PemCertificate({
      subjectCn: 'db.internal.example',
      issuerCn: caCn,
      subjectPublicKeySpkiDer: otherHostKeys.publicKey.export({ type: 'spki', format: 'der' }),
      issuerPrivateKey: caKeys.privateKey,
      serialNumber: 4,
      isCa: false,
      dnsNames: ['db.internal.example'],
    })
  );

  return {
    dir,
    selfSignedKeyPath,
    selfSignedCertPath,
    caKeyPath,
    caCertPath,
    localhostKeyPath,
    localhostCertPath,
    otherHostKeyPath,
    otherHostCertPath,
  };
}

function buildPgMessage(typeChar: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(typeChar, 0, 1, 'ascii');
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

function buildAuthCleartextRequest(): Buffer {
  const authPayload = Buffer.alloc(4);
  authPayload.writeInt32BE(3, 0); // AuthenticationCleartextPassword = 3
  return buildPgMessage('R', authPayload);
}

function buildAuthOkAndReady(): Buffer {
  const authPayload = Buffer.alloc(4);
  authPayload.writeInt32BE(0, 0);
  const authOk = buildPgMessage('R', authPayload);
  const ready = buildPgMessage('Z', Buffer.from('I', 'ascii'));
  return Buffer.concat([authOk, ready]);
}

function buildSelectOneResponse(): Buffer {
  // RowDescription ('T'): 1 field named "ok" (int4 = oid 23)
  const fieldName = Buffer.from('ok\0', 'utf8');
  const fieldMeta = Buffer.alloc(18);
  fieldMeta.writeInt32BE(0, 0); // table oid
  fieldMeta.writeInt16BE(0, 4); // attr num
  fieldMeta.writeInt32BE(23, 6); // int4 oid
  fieldMeta.writeInt16BE(4, 10); // size
  fieldMeta.writeInt32BE(-1, 12); // modifier
  fieldMeta.writeInt16BE(0, 16); // text format
  const rowDescCount = Buffer.alloc(2);
  rowDescCount.writeInt16BE(1, 0);
  const rowDesc = buildPgMessage('T', Buffer.concat([rowDescCount, fieldName, fieldMeta]));

  // DataRow ('D'): 1 column with value "1"
  const colVal = Buffer.from('1', 'utf8');
  const dataHeader = Buffer.alloc(6);
  dataHeader.writeInt16BE(1, 0);
  dataHeader.writeInt32BE(colVal.length, 2);
  const dataRow = buildPgMessage('D', Buffer.concat([dataHeader, colVal]));

  // CommandComplete ('C') + ReadyForQuery ('Z')
  const cmdComplete = buildPgMessage('C', Buffer.from('SELECT 1\0', 'utf8'));
  const ready = buildPgMessage('Z', Buffer.from('I', 'ascii'));
  return Buffer.concat([rowDesc, dataRow, cmdComplete, ready]);
}

interface MockPgServerOptions {
  sslSupport: 'none-keep-open' | 'none-close-socket' | 'none-eof' | 'tls';
  tlsKey?: string;
  tlsCert?: string;
  tlsClientCa?: string;
  requireClientCert?: boolean;
  startupDelayMs?: number;
}

interface RunningMockPgServer {
  port: number;
  sslNegotiationsAttempted: () => number;
  tlsConnectionsCompleted: () => number;
  plaintextStartupsCompleted: () => number;
  close: () => Promise<void>;
}

async function startMockPgServer(
  options: MockPgServerOptions
): Promise<RunningMockPgServer> {
  let sslAttempts = 0;
  let tlsCompleted = 0;
  let plainStartups = 0;
  const openSockets = new Set<net.Socket>();

  const attachProtocolSession = (stream: net.Socket | tls.TLSSocket, isTls: boolean) => {
    let startupHandled = false;
    let buffer = Buffer.alloc(0);

    stream.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!startupHandled) {
        if (buffer.length < 8) {
          return;
        }
        const msgLen = buffer.readInt32BE(0);
        const code = buffer.readInt32BE(4);

        // SSLRequest magic code = 80877103 (0x04d2162f)
        if (msgLen === 8 && code === 80877103) {
          buffer = buffer.subarray(8);
          sslAttempts += 1;

          if (options.sslSupport === 'none-close-socket') {
            stream.end(Buffer.from('N', 'ascii'));
            return;
          }

          if (options.sslSupport === 'none-keep-open') {
            stream.write(Buffer.from('N', 'ascii'));
            return;
          }

          if (options.sslSupport === 'none-eof') {
            stream.end();
            return;
          }

          stream.write(Buffer.from('S', 'ascii'));
          const tlsSocket = new tls.TLSSocket(stream, {
            isServer: true,
            key: options.tlsKey,
            cert: options.tlsCert,
            ...(options.requireClientCert
              ? {
                ca: options.tlsClientCa,
                requestCert: true,
                rejectUnauthorized: true,
              }
              : {}),
          });
          openSockets.add(tlsSocket);
          tlsSocket.on('error', () => {});
          stream.removeAllListeners('data');
          tlsCompleted += 1;
          attachProtocolSession(tlsSocket, true);
          return;
        }

        if (buffer.length < msgLen) {
          return;
        }
        buffer = buffer.subarray(msgLen);
        startupHandled = true;
        if (!isTls) {
          plainStartups += 1;
        }

        const sendAuthPrompt = () => {
          if (!stream.destroyed) {
            stream.write(buildAuthCleartextRequest());
          }
        };

        if (options.startupDelayMs && options.startupDelayMs > 0) {
          const timer = setTimeout(sendAuthPrompt, options.startupDelayMs);
          timer.unref?.();
        } else {
          sendAuthPrompt();
        }
      }

      while (startupHandled && buffer.length >= 5) {
        const msgType = String.fromCharCode(buffer[0]);
        const len = buffer.readInt32BE(1);
        if (buffer.length < len + 1) {
          break;
        }
        const payload = buffer.subarray(5, len + 1);
        buffer = buffer.subarray(len + 1);

        if (msgType === 'p') {
          const passwordStr = payload.toString('utf8').replace(/\0$/, '');
          if (!passwordStr) {
            const errFields = Buffer.from('SERROR\0C28P01\0Mmissing password\0\0', 'utf8');
            stream.end(buildPgMessage('E', errFields));
            return;
          }
          stream.write(buildAuthOkAndReady());
        } else if (msgType === 'Q') {
          stream.write(buildSelectOneResponse());
        } else if (msgType === 'X') {
          stream.end();
          return;
        }
      }
    });
  };

  const server = net.createServer((socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
    socket.on('error', () => {});
    attachProtocolSession(socket, false);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as net.AddressInfo;

  return {
    port: address.port,
    sslNegotiationsAttempted: () => sslAttempts,
    tlsConnectionsCompleted: () => tlsCompleted,
    plaintextStartupsCompleted: () => plainStartups,
    close: async () => {
      for (const s of openSockets) {
        s.destroy();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

describe('Shared PostgreSQL URI parser, normalizer, and libpq TLS runtime pool', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  let certs: GeneratedCertBundle;

  beforeAll(() => {
    certs = generateTestCertificates();
  });

  afterAll(() => {
    fs.rmSync(certs.dir, { recursive: true, force: true });
  });

  describe('URI parsing, socket normalization, and validation', () => {
    it('normalizes legacy empty-host Unix socket URIs (@/ and ///) to @localhost', () => {
      const cloudSqlShorthand =
        'postgresql://wedding_user:STRONG_PASSWORD@/wedding_db?host=/cloudsql/my-proj:us-central1:wedding-db';
      const parsed = parsePostgresUrl(cloudSqlShorthand);

      expect(parsed.usedEmptyHostSocketShorthand).toBe(true);
      expect(parsed.isUnixSocket).toBe(true);
      expect(parsed.socketPath).toBe('/cloudsql/my-proj:us-central1:wedding-db');
      expect(parsed.host).toBe('/cloudsql/my-proj:us-central1:wedding-db');
      expect(parsed.authorityHost).toBe('localhost');
      expect(parsed.database).toBe('wedding_db');
      expect(parsed.normalizedUrl).toBe(
        'postgresql://wedding_user:STRONG_PASSWORD@localhost/wedding_db?host=/cloudsql/my-proj:us-central1:wedding-db'
      );

      const percentEncodedTripleSlash =
        'postgres:///wedding_db?host=%2Fvar%2Frun%2Fpostgresql&schema=custom_schema';
      const parsedTriple = parsePostgresUrl(percentEncodedTripleSlash);
      expect(parsedTriple.normalizedUrl).toBe(
        'postgres://localhost/wedding_db?host=%2Fvar%2Frun%2Fpostgresql&schema=custom_schema'
      );
      expect(parsedTriple.isUnixSocket).toBe(true);
      expect(parsedTriple.socketPath).toBe('/var/run/postgresql');
      expect(parsedTriple.schema).toBe('custom_schema');
    });

    it('preserves explicit @localhost Unix socket URIs without marking shorthand normalization', () => {
      const explicitSocketUrl =
        'postgresql://wedding_user:STRONG_PASSWORD@localhost/wedding_db?host=/cloudsql/my-proj:us-central1:wedding-db';
      const parsed = parsePostgresUrl(explicitSocketUrl);

      expect(parsed.usedEmptyHostSocketShorthand).toBe(false);
      expect(parsed.isUnixSocket).toBe(true);
      expect(parsed.host).toBe('/cloudsql/my-proj:us-central1:wedding-db');
      expect(parsed.normalizedUrl).toBe(explicitSocketUrl);
      expect(
        isValidPostgresUrl(explicitSocketUrl, {
          allowEmptyHostSocket: false,
          requireDatabaseName: true,
        })
      ).toBe(true);
      expect(
        isValidPostgresUrl(
          'postgresql://wedding_user:STRONG_PASSWORD@/wedding_db?host=/cloudsql/my-proj:us-central1:wedding-db',
          { allowEmptyHostSocket: false }
        )
      ).toBe(false);
    });

    it('rejects malformed URIs, empty-host TCP URIs, invalid SSL flags, and invalid pool/timeout numbers without leaking secrets', () => {
      const secret = 'ULTRA_SECRET_DB_PASS_991';
      const invalidCases = [
        '',
        'mysql://user:pass@localhost:3306/db',
        'postgres://',
        'postgresql://',
        `postgresql://wedding:${secret}@/wedding_db`,
        `postgresql://wedding:${secret}@:5432/wedding_db`,
        'postgresql:///wedding_db',
        `postgresql://wedding:${secret}@/wedding_db?host=`,
        `postgresql://wedding:${secret}@/wedding_db?host=/`,
        `postgresql://wedding:${secret}@/wedding_db?host=relative/socket`,
        `postgresql://wedding:unencoded@${secret}@localhost:5432/wedding_db`,
        `postgresql://wedding:${secret}#frag@localhost:5432/wedding_db`,
        `postgresql://wedding:${secret}@localhost:0/wedding_db`,
        `postgresql://wedding:${secret}@localhost:70000/wedding_db`,
        `postgresql://wedding:${secret}@localhost:abc/wedding_db`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db/extra`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db?sslmode=bogus`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db?ssl=maybe`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db?connection_limit=0`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db?connection_limit=-2`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db?connect_timeout=abc`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db?pool_timeout=-1`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db?socket_timeout=NaN`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db?schema=`,
        `postgresql://wedding:${secret}@localhost:5432/wedding_db?sslrootcert=system&sslmode=require`,
      ];

      for (const candidate of invalidCases) {
        expect(isValidPostgresUrl(candidate)).toBe(false);
        expect(() => normalizePostgresUrl(candidate)).toThrow(PostgresUrlValidationError);
        try {
          parsePostgresUrl(candidate);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          expect(message).not.toContain(secret);
        }
        expect(redactPostgresUrl(candidate)).not.toContain(secret);
      }
    });

    it('extracts defaults and URI overrides for schema, connection_limit, and timeouts', () => {
      const defaultParsed = parsePostgresUrl('postgresql://u:p@localhost:5432/wedding');
      expect(defaultParsed.schema).toBe(DEFAULT_POSTGRES_SCHEMA);
      expect(defaultParsed.max).toBe(DEFAULT_POSTGRES_POOL_MAX);
      expect(defaultParsed.max).toBe(5);
      expect(defaultParsed.connectionTimeoutMillis).toBe(DEFAULT_POSTGRES_CONNECTION_TIMEOUT_MS);
      expect(defaultParsed.connectionTimeoutMillis).toBe(10_000);

      const customParsed = parsePostgresUrl(
        'postgresql://u:p@localhost:5432/wedding?schema=ceremony&connection_limit=3&connect_timeout=15&socket_timeout=25&statement_timeout=12000'
      );
      const runtime = buildPostgresRuntimeConfig(
        'postgresql://u:p@localhost:5432/wedding?schema=ceremony&connection_limit=3&connect_timeout=15&socket_timeout=25&statement_timeout=12000'
      );
      expect(customParsed.schema).toBe('ceremony');
      expect(runtime.adapterOptions).toEqual({ schema: 'ceremony' });
      expect(runtime.poolConfig.max).toBe(3);
      expect(runtime.poolConfig.connectionTimeoutMillis).toBe(15_000);
      expect(runtime.poolConfig.query_timeout).toBe(25_000);
      expect(runtime.poolConfig.statement_timeout).toBe(12_000);
      expect(runtime.poolConfig.connectionString).toBeUndefined();

      const poolTimeoutOnly = buildPostgresRuntimeConfig(
        'postgresql://u:p@localhost:5432/wedding?pool_timeout=18'
      );
      expect(poolTimeoutOnly.poolConfig.connectionTimeoutMillis).toBe(18_000);
    });

    it('passes both @localhost and @/ Cloud SQL socket URIs in src/env.ts (native Node ESM) and prisma.config.ts', () => {
      const validAdminHash =
        'scrypt:c2FsdHNhbHRzYWx0c2FsdA==:aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaA==';
      const legacySocket =
        'postgresql://wedding_user:STRONG_PASSWORD@/wedding_db?host=/cloudsql/proj:us-central1:wedding-db';
      const expectedNormalized =
        'postgresql://wedding_user:STRONG_PASSWORD@localhost/wedding_db?host=/cloudsql/proj:us-central1:wedding-db';

      const nodeEnvCheck = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
            const { env } = await import('./src/env.ts');
            const prismaCfg = (await import('./prisma.config.ts')).default;
            process.stdout.write(JSON.stringify({
              envUrl: env.DATABASE_URL,
              prismaUrl: prismaCfg.datasource?.url,
            }));
          `,
        ],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'development',
            DATABASE_URL: legacySocket,
            ADMIN_PASSWORD: validAdminHash,
            ALLOWED_HOSTS: 'localhost',
            GUEST_PASSCODE: 'custom-dev-passcode',
            GUEST_SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
          },
        }
      );

      expect(nodeEnvCheck.status).toBe(0);
      expect(JSON.parse(nodeEnvCheck.stdout)).toEqual({
        envUrl: expectedNormalized,
        prismaUrl: expectedNormalized,
      });

      const rejectedEmptyTcp = spawnSync(
        process.execPath,
        ['--input-type=module', '-e', "await import('./src/env.ts');"],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'development',
            DATABASE_URL: 'postgresql://wedding_user:STRONG_PASSWORD@/wedding_db',
            ADMIN_PASSWORD: validAdminHash,
            ALLOWED_HOSTS: 'localhost',
          },
        }
      );
      expect(rejectedEmptyTcp.status).not.toBe(0);
    });
  });

  describe('libpq TLS mode resolution, sslmode=prefer fallback, and cold-wake tolerance', () => {
    it('falls back to plaintext under sslmode=prefer when a non-TLS PostgreSQL server replies N (keep-open and close-socket)', async () => {
      for (const sslSupport of ['none-keep-open', 'none-close-socket'] as const) {
        const server = await startMockPgServer({ sslSupport });
        const { poolConfig } = buildPostgresRuntimeConfig(
          `postgresql://wedding:pass@127.0.0.1:${server.port}/wedding?sslmode=prefer`
        );
        const pool = new Pool(poolConfig);
        try {
          const result = await pool.query<{ ok: number }>('SELECT 1');
          expect(result.rows).toEqual([{ ok: 1 }]);
          expect(server.sslNegotiationsAttempted()).toBeGreaterThanOrEqual(1);
          expect(server.tlsConnectionsCompleted()).toBe(0);
          expect(server.plaintextStartupsCompleted()).toBe(1);
        } finally {
          await pool.end();
          await server.close();
        }
      }
    });

    it('upgrades to TLS under sslmode=prefer, sslmode=require, and ssl=true against self-signed TLS servers, and rejects non-TLS under require', async () => {
      const tlsKey = fs.readFileSync(certs.selfSignedKeyPath, 'utf8');
      const tlsCert = fs.readFileSync(certs.selfSignedCertPath, 'utf8');
      const tlsServer = await startMockPgServer({
        sslSupport: 'tls',
        tlsKey,
        tlsCert,
      });

      try {
        for (const querySuffix of ['sslmode=prefer', 'sslmode=require', 'ssl=true']) {
          const { poolConfig } = buildPostgresRuntimeConfig(
            `postgresql://wedding:pass@127.0.0.1:${tlsServer.port}/wedding?${querySuffix}`
          );
          const pool = new Pool(poolConfig);
          try {
            const res = await pool.query<{ ok: number }>('SELECT 1');
            expect(res.rows).toEqual([{ ok: 1 }]);
          } finally {
            await pool.end();
          }
        }
        expect(tlsServer.tlsConnectionsCompleted()).toBe(3);
        expect(tlsServer.plaintextStartupsCompleted()).toBe(0);
      } finally {
        await tlsServer.close();
      }

      const plainServer = await startMockPgServer({ sslSupport: 'none-keep-open' });
      const { poolConfig: requirePoolConfig } = buildPostgresRuntimeConfig(
        `postgresql://wedding:pass@127.0.0.1:${plainServer.port}/wedding?sslmode=require`
      );
      const requirePool = new Pool(requirePoolConfig);
      try {
        await expect(requirePool.query('SELECT 1')).rejects.toThrow(
          /does not support SSL/i
        );
      } finally {
        await requirePool.end();
        await plainServer.close();
      }
    });

    it('falls back to plaintext when server closes SSLRequest with EOF under sslmode=prefer and preserves client sslkey across pooled connections', async () => {
      const eofOnSslServer = await startMockPgServer({
        sslSupport: 'none-eof',
      });
      const { poolConfig: fallbackPoolConfig } = buildPostgresRuntimeConfig(
        `postgresql://wedding:pass@127.0.0.1:${eofOnSslServer.port}/wedding?sslmode=prefer`
      );
      const fallbackPool = new Pool(fallbackPoolConfig);
      try {
        const res = await fallbackPool.query<{ ok: number }>('SELECT 1');
        expect(res.rows).toEqual([{ ok: 1 }]);
        expect(eofOnSslServer.sslNegotiationsAttempted()).toBe(1);
        expect(eofOnSslServer.plaintextStartupsCompleted()).toBe(1);
      } finally {
        await fallbackPool.end();
        await eofOnSslServer.close();
      }

      const mtlsServer = await startMockPgServer({
        sslSupport: 'tls',
        tlsKey: fs.readFileSync(certs.localhostKeyPath, 'utf8'),
        tlsCert: fs.readFileSync(certs.localhostCertPath, 'utf8'),
        tlsClientCa: fs.readFileSync(certs.caCertPath, 'utf8'),
        requireClientCert: true,
      });
      const encodedCert = encodeURIComponent(certs.localhostCertPath);
      const encodedKey = encodeURIComponent(certs.localhostKeyPath);
      const { poolConfig: mtlsPoolConfig } = buildPostgresRuntimeConfig(
        `postgresql://wedding:pass@localhost:${mtlsServer.port}/wedding?sslmode=prefer&sslcert=${encodedCert}&sslkey=${encodedKey}`
      );
      const mtlsPool = new Pool(mtlsPoolConfig);
      try {
        const [c1, c2] = await Promise.all([mtlsPool.connect(), mtlsPool.connect()]);
        try {
          const [r1, r2] = await Promise.all([
            c1.query<{ ok: number }>('SELECT 1'),
            c2.query<{ ok: number }>('SELECT 1'),
          ]);
          expect(r1.rows).toEqual([{ ok: 1 }]);
          expect(r2.rows).toEqual([{ ok: 1 }]);
        } finally {
          c1.release();
          c2.release();
        }
        expect(mtlsServer.tlsConnectionsCompleted()).toBe(2);
        expect(mtlsServer.plaintextStartupsCompleted()).toBe(0);
      } finally {
        await mtlsPool.end();
        await mtlsServer.close();
      }
    });

    it('enforces CA verification for sslmode=verify-ca with sslrootcert and both CA + hostname verification for sslmode=verify-full', async () => {
      const untrustedServer = await startMockPgServer({
        sslSupport: 'tls',
        tlsKey: fs.readFileSync(certs.selfSignedKeyPath, 'utf8'),
        tlsCert: fs.readFileSync(certs.selfSignedCertPath, 'utf8'),
      });
      const mismatchedHostCaServer = await startMockPgServer({
        sslSupport: 'tls',
        tlsKey: fs.readFileSync(certs.otherHostKeyPath, 'utf8'),
        tlsCert: fs.readFileSync(certs.otherHostCertPath, 'utf8'),
      });
      const matchingLocalhostCaServer = await startMockPgServer({
        sslSupport: 'tls',
        tlsKey: fs.readFileSync(certs.localhostKeyPath, 'utf8'),
        tlsCert: fs.readFileSync(certs.localhostCertPath, 'utf8'),
      });

      const encodedCa = encodeURIComponent(certs.caCertPath);

      try {
        // 1. verify-ca with sslrootcert rejects untrusted self-signed cert
        const verifyCaUntrusted = new Pool(
          buildPostgresRuntimeConfig(
            `postgresql://wedding:pass@localhost:${untrustedServer.port}/wedding?sslmode=verify-ca&sslrootcert=${encodedCa}`
          ).poolConfig
        );
        await expect(verifyCaUntrusted.query('SELECT 1')).rejects.toThrow();
        await verifyCaUntrusted.end();

        // 2. verify-ca with sslrootcert accepts CA-signed cert even when hostname differs
        const verifyCaTrustedOtherHost = new Pool(
          buildPostgresRuntimeConfig(
            `postgresql://wedding:pass@localhost:${mismatchedHostCaServer.port}/wedding?sslmode=verify-ca&sslrootcert=${encodedCa}`
          ).poolConfig
        );
        const caRes = await verifyCaTrustedOtherHost.query<{ ok: number }>('SELECT 1');
        expect(caRes.rows).toEqual([{ ok: 1 }]);
        await verifyCaTrustedOtherHost.end();

        // 3. verify-full with sslrootcert rejects CA-signed cert when hostname mismatches
        const verifyFullMismatch = new Pool(
          buildPostgresRuntimeConfig(
            `postgresql://wedding:pass@localhost:${mismatchedHostCaServer.port}/wedding?sslmode=verify-full&sslrootcert=${encodedCa}`
          ).poolConfig
        );
        await expect(verifyFullMismatch.query('SELECT 1')).rejects.toThrow(
          /Hostname\/IP does not match certificate/i
        );
        await verifyFullMismatch.end();

        // 4. verify-full without sslrootcert rejects self-signed cert
        const verifyFullSelfSigned = new Pool(
          buildPostgresRuntimeConfig(
            `postgresql://wedding:pass@localhost:${untrustedServer.port}/wedding?sslmode=verify-full`
          ).poolConfig
        );
        await expect(verifyFullSelfSigned.query('SELECT 1')).rejects.toThrow();
        await verifyFullSelfSigned.end();

        // 5. verify-full with sslrootcert succeeds when CA and localhost SAN both match
        const verifyFullValid = new Pool(
          buildPostgresRuntimeConfig(
            `postgresql://wedding:pass@localhost:${matchingLocalhostCaServer.port}/wedding?sslmode=verify-full&sslrootcert=${encodedCa}`
          ).poolConfig
        );
        const fullRes = await verifyFullValid.query<{ ok: number }>('SELECT 1');
        expect(fullRes.rows).toEqual([{ ok: 1 }]);
        await verifyFullValid.end();

        // Verify resolvePostgresTlsOptions structure for disable
        expect(
          resolvePostgresTlsOptions(
            parsePostgresUrl('postgresql://u:p@localhost:5432/db?sslmode=disable')
          )
        ).toBe(false);
      } finally {
        await untrustedServer.close();
        await mismatchedHostCaServer.close();
        await matchingLocalhostCaServer.close();
      }
    });

    it('waits through a 5-second serverless cold wake by default (10000ms) and honors connect_timeout overrides', async () => {
      const coldWakeServer = await startMockPgServer({
        sslSupport: 'none-keep-open',
        startupDelayMs: 5_100,
      });

      try {
        const fastTimeoutPool = new Pool(
          buildPostgresRuntimeConfig(
            `postgresql://wedding:pass@127.0.0.1:${coldWakeServer.port}/wedding?connect_timeout=1`
          ).poolConfig
        );
        await expect(fastTimeoutPool.query('SELECT 1')).rejects.toThrow(/timeout/i);
        await fastTimeoutPool.end();

        const defaultColdWakePool = new Pool(
          buildPostgresRuntimeConfig(
            `postgresql://wedding:pass@127.0.0.1:${coldWakeServer.port}/wedding`
          ).poolConfig
        );
        const res = await defaultColdWakePool.query<{ ok: number }>('SELECT 1');
        expect(res.rows).toEqual([{ ok: 1 }]);
        await defaultColdWakePool.end();
      } finally {
        await coldWakeServer.close();
      }
    }, 20_000);
  });
});
