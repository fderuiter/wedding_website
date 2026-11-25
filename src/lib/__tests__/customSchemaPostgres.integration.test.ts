/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { env } from '@/env';
import { prisma as defaultPrisma, getPgPool as getDefaultPgPool } from '@/lib/prisma';
import { parsePostgresUrl, verifyPostgresTlsHandshake } from '@/lib/postgres-url.js';
import { buildPostgresRuntimeConfig } from '@/lib/postgresPool';
import { runPreflightCheck } from '../../../scripts/preflight-migration-summary';

const CUSTOM_DB_NAME = 'wedding_custom_schema_it';
const CUSTOM_SCHEMA_NAME = 'custom_tenant';

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
  const sigAlg = derSequence([derOid([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])]);
  const versionV3 = derTlv(0xa0, derTlv(0x02, Buffer.from([0x02])));
  const serial = derTlv(0x02, Buffer.from([params.serialNumber]));
  const now = new Date(Date.now() - 60_000);
  const expires = new Date(Date.now() + 2 * 24 * 3600_000);
  const validity = derSequence([derUtcTime(now), derUtcTime(expires)]);

  const extItems: Buffer[] = [];
  if (params.isCa) {
    const basicConstraintsVal = derSequence([derTlv(0x01, Buffer.from([0xff]))]);
    extItems.push(
      derSequence([
        derOid([0x55, 0x1d, 0x13]),
        derTlv(0x01, Buffer.from([0xff])),
        derTlv(0x04, basicConstraintsVal),
      ])
    );
  } else {
    extItems.push(derSequence([derOid([0x55, 0x1d, 0x13]), derTlv(0x04, derSequence([]))]));
  }

  const sanEntries = [
    ...(params.dnsNames ?? []).map((dns) => derTlv(0x82, Buffer.from(dns, 'ascii'))),
    ...(params.ipv4Addresses ?? []).map((ip) =>
      derTlv(0x87, Buffer.from(ip.split('.').map(Number)))
    ),
  ];
  if (sanEntries.length > 0) {
    extItems.push(
      derSequence([
        derOid([0x55, 0x1d, 0x11]),
        derTlv(0x04, derSequence(sanEntries)),
      ])
    );
  }

  const tbsCert = derSequence([
    versionV3,
    serial,
    sigAlg,
    derNameCn(params.issuerCn),
    validity,
    derNameCn(params.subjectCn),
    params.subjectPublicKeySpkiDer,
    derTlv(0xa3, derSequence(extItems)),
  ]);

  const signature = crypto.sign('sha256', tbsCert, params.issuerPrivateKey);
  const sigBitString = derTlv(0x03, Buffer.concat([Buffer.from([0x00]), signature]));
  const fullCertDer = derSequence([tbsCert, sigAlg, sigBitString]);
  const b64 = fullCertDer.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

interface TlsPgProxyHandle {
  port: number;
  close: () => Promise<void>;
}

/**
 * Spawns a background Worker TCP proxy that accepts PostgreSQL SSLRequest frames,
 * negotiates TLS with the provided server key/cert, and tunnels decrypted Postgres
 * wire traffic to the live PostgreSQL instance so both synchronous `execFileSync`
 * Prisma CLI commands and async runtime `pg.Pool` probes can run concurrently.
 */
async function startTlsPostgresProxy(params: {
  backendHost: string;
  backendPort: number;
  tlsKeyPem: string;
  tlsCertPem: string;
}): Promise<TlsPgProxyHandle> {
  const workerScript = `
    const net = require('node:net');
    const tls = require('node:tls');
    const { parentPort, workerData } = require('node:worker_threads');

    const sockets = new Set();
    const server = net.createServer((clientSocket) => {
      sockets.add(clientSocket);
      clientSocket.once('close', () => sockets.delete(clientSocket));
      clientSocket.on('error', () => {});

      let initialBuf = Buffer.alloc(0);
      const onInitialData = (chunk) => {
        initialBuf = Buffer.concat([initialBuf, chunk]);
        if (initialBuf.length < 8) {
          return;
        }
        clientSocket.removeListener('data', onInitialData);
        const len = initialBuf.readInt32BE(0);
        const code = initialBuf.readInt32BE(4);
        if (len === 8 && code === 80877103) {
          clientSocket.write('S');
          const tlsSocket = new tls.TLSSocket(clientSocket, {
            isServer: true,
            key: workerData.tlsKeyPem,
            cert: workerData.tlsCertPem,
          });
          sockets.add(tlsSocket);
          tlsSocket.once('close', () => sockets.delete(tlsSocket));
          tlsSocket.on('error', () => {
            clientSocket.destroy();
          });
          tlsSocket.once('secure', () => {
            const backend = net.connect({
              host: workerData.backendHost,
              port: workerData.backendPort,
            });
            sockets.add(backend);
            backend.once('close', () => sockets.delete(backend));
            backend.on('error', () => tlsSocket.destroy());
            tlsSocket.pipe(backend);
            backend.pipe(tlsSocket);
          });
        } else {
          clientSocket.destroy();
        }
      };
      clientSocket.on('data', onInitialData);
    });

    server.listen(0, '127.0.0.1', () => {
      parentPort.postMessage({ type: 'listening', port: server.address().port });
    });

    parentPort.on('message', (msg) => {
      if (msg && msg.type === 'close') {
        for (const s of sockets) {
          s.destroy();
        }
        server.close(() => {
          parentPort.postMessage({ type: 'closed' });
        });
      }
    });
  `;

  const worker = new Worker(workerScript, {
    eval: true,
    workerData: params,
  });

  const port = await new Promise<number>((resolve, reject) => {
    worker.once('error', reject);
    worker.once('message', (msg: { type?: string; port?: number }) => {
      if (msg?.type === 'listening' && typeof msg.port === 'number') {
        resolve(msg.port);
      } else {
        reject(new Error('Unexpected worker startup message'));
      }
    });
  });

  return {
    port,
    close: async () => {
      await new Promise<void>((resolve) => {
        worker.once('message', () => resolve());
        worker.postMessage({ type: 'close' });
      });
      await worker.terminate();
    },
  };
}

async function runWithIsolatedDatabaseUrl<T>(
  databaseUrl: string,
  fn: () => Promise<T>
): Promise<T> {
  const prevDbUrl = process.env.DATABASE_URL;
  const globalRef = globalThis as {
    prisma?: { $disconnect?: () => Promise<void> };
    pgPool?: { end?: () => Promise<void> };
    prismaShutdownPromise?: Promise<void> | null;
  };
  const savedPrisma = globalRef.prisma;
  const savedPool = globalRef.pgPool;
  const savedShutdown = globalRef.prismaShutdownPromise;

  globalRef.prisma = undefined;
  globalRef.pgPool = undefined;
  globalRef.prismaShutdownPromise = null;
  process.env.DATABASE_URL = databaseUrl;

  let isolatedPrisma: { $disconnect?: () => Promise<void> } | undefined;
  let isolatedPool: { end?: () => Promise<void> } | undefined;

  try {
    let result!: T;
    await jest.isolateModulesAsync(async () => {
      result = await fn();
      isolatedPrisma = globalRef.prisma;
      isolatedPool = globalRef.pgPool;
    });
    return result;
  } finally {
    if (isolatedPrisma?.$disconnect) {
      await isolatedPrisma.$disconnect().catch(() => undefined);
    }
    if (isolatedPool?.end) {
      await isolatedPool.end().catch(() => undefined);
    }
    globalRef.prisma = savedPrisma;
    globalRef.pgPool = savedPool;
    globalRef.prismaShutdownPromise = savedShutdown;
    if (prevDbUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = prevDbUrl;
    }
  }
}

describe('Custom PostgreSQL schema & TLS migration/runtime parity integration', () => {
  const repoRoot = process.cwd();
  const baseParsed = parsePostgresUrl(env.DATABASE_URL);
  const pgHost = baseParsed.host || '127.0.0.1';
  const pgPort = baseParsed.port ?? 5432;
  const authPart = baseParsed.user
    ? `${encodeURIComponent(baseParsed.user)}${
      baseParsed.password ? `:${encodeURIComponent(baseParsed.password)}` : ''
    }@`
    : '';
  const customDbBaseUrl = `postgresql://${authPart}${pgHost}:${pgPort}/${CUSTOM_DB_NAME}`;
  const customSchemaDirectUrl = `${customDbBaseUrl}?schema=${CUSTOM_SCHEMA_NAME}&sslmode=prefer`;
  const customSchemaPooledUrl = `${customDbBaseUrl}?schema=${CUSTOM_SCHEMA_NAME}&sslmode=prefer&pgbouncer=true`;

  let adminPool: Pool;
  let certDir: string;
  let untrustedKeyPem: string;
  let untrustedCertPem: string;
  let caCertPath: string;
  let mismatchedHostKeyPem: string;
  let mismatchedHostCertPem: string;
  let matchingHostKeyPem: string;
  let matchingHostCertPem: string;

  beforeAll(async () => {
    jest.setTimeout(60_000);

    const { poolConfig } = buildPostgresRuntimeConfig(env.DATABASE_URL);
    adminPool = new Pool({ ...poolConfig, database: 'postgres' });

    await adminPool.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [CUSTOM_DB_NAME]
    );
    await adminPool.query(`DROP DATABASE IF EXISTS "${CUSTOM_DB_NAME}"`);
    await adminPool.query(`CREATE DATABASE "${CUSTOM_DB_NAME}"`);

    certDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-custom-schema-tls-'));

    const selfSignedKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    untrustedKeyPem = selfSignedKeys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    untrustedCertPem = createX509PemCertificate({
      subjectCn: 'untrusted-pg.example.invalid',
      issuerCn: 'untrusted-pg.example.invalid',
      subjectPublicKeySpkiDer: selfSignedKeys.publicKey.export({ type: 'spki', format: 'der' }),
      issuerPrivateKey: selfSignedKeys.privateKey,
      serialNumber: 10,
      isCa: false,
      dnsNames: ['untrusted-pg.example.invalid'],
    });

    const caKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const caCn = 'Integration Postgres Root CA';
    caCertPath = path.join(certDir, 'root-ca.crt');
    fs.writeFileSync(
      caCertPath,
      createX509PemCertificate({
        subjectCn: caCn,
        issuerCn: caCn,
        subjectPublicKeySpkiDer: caKeys.publicKey.export({ type: 'spki', format: 'der' }),
        issuerPrivateKey: caKeys.privateKey,
        serialNumber: 11,
        isCa: true,
      })
    );

    const leafKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    mismatchedHostKeyPem = leafKeys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    mismatchedHostCertPem = createX509PemCertificate({
      subjectCn: 'db-internal.example.invalid',
      issuerCn: caCn,
      subjectPublicKeySpkiDer: leafKeys.publicKey.export({ type: 'spki', format: 'der' }),
      issuerPrivateKey: caKeys.privateKey,
      serialNumber: 12,
      isCa: false,
      dnsNames: ['db-internal.example.invalid'],
    });

    const matchingLeafKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    matchingHostKeyPem = matchingLeafKeys.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString();
    matchingHostCertPem = createX509PemCertificate({
      subjectCn: 'localhost',
      issuerCn: caCn,
      subjectPublicKeySpkiDer: matchingLeafKeys.publicKey.export({ type: 'spki', format: 'der' }),
      issuerPrivateKey: caKeys.privateKey,
      serialNumber: 13,
      isCa: false,
      dnsNames: ['localhost'],
      ipv4Addresses: ['127.0.0.1'],
    });
  }, 60_000);

  afterAll(async () => {
    if (certDir && fs.existsSync(certDir)) {
      fs.rmSync(certDir, { recursive: true, force: true });
    }
    if (adminPool) {
      await adminPool
        .query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [CUSTOM_DB_NAME]
        )
        .catch(() => undefined);
      await adminPool.query(`DROP DATABASE IF EXISTS "${CUSTOM_DB_NAME}"`).catch(() => undefined);
      await adminPool.end();
    }
    await defaultPrisma.$disconnect().catch(() => undefined);
    const defaultPool = getDefaultPgPool();
    if (defaultPool) {
      await defaultPool.end().catch(() => undefined);
    }
  });

  it('applies prisma migrate deploy into ?schema=custom_tenant&sslmode=prefer with 0 tables in public and returns HTTP 200 on GET /api/ready across direct and pooled URLs', async () => {
    const migrateResult = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: customSchemaDirectUrl,
        POSTGRES_URL_NON_POOLING: '',
      },
    });
    expect(migrateResult.status).toBe(0);

    // Direct pool sets -c search_path="custom_tenant"
    const directConfig = buildPostgresRuntimeConfig(customSchemaDirectUrl);
    expect(directConfig.poolConfig.options).toBe(`-c search_path="${CUSTOM_SCHEMA_NAME}"`);
    const directPool = new Pool(directConfig.poolConfig);
    try {
      const schemaRes = await directPool.query<{ currentSchema: string }>(
        'SELECT current_schema() AS "currentSchema"'
      );
      expect(schemaRes.rows[0]?.currentSchema).toBe(CUSTOM_SCHEMA_NAME);

      const publicTables = await directPool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema = \'public\' AND table_type = \'BASE TABLE\''
      );
      expect(publicTables.rows[0]?.cnt).toBe(0);

      const customTables = await directPool.query<{ cnt: number }>(
        'SELECT COUNT(*)::int AS cnt FROM information_schema.tables WHERE table_schema = $1 AND table_type = \'BASE TABLE\'',
        [CUSTOM_SCHEMA_NAME]
      );
      expect(customTables.rows[0]?.cnt ?? 0).toBeGreaterThanOrEqual(10);
    } finally {
      await directPool.end();
    }

    // Direct URL GET /api/ready -> HTTP 200
    await runWithIsolatedDatabaseUrl(customSchemaDirectUrl, async () => {
      const { GET } = await import('@/app/api/ready/route');
      const res = await GET();
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        status: 'ready',
        database: 'connected',
        timestamp: expect.any(String),
      });
    });

    // Pooled URL (pgbouncer=true, no startup search_path) GET /api/ready -> HTTP 200
    await runWithIsolatedDatabaseUrl(customSchemaPooledUrl, async () => {
      const { getPgPool } = await import('@/lib/prisma');
      const pool = getPgPool()!;
      const schemaRes = await pool.query<{ currentSchema: string }>(
        'SELECT current_schema() AS "currentSchema"'
      );
      expect(schemaRes.rows[0]?.currentSchema).toBe('public');

      const { GET } = await import('@/app/api/ready/route');
      const res = await GET();
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({
        status: 'ready',
        database: 'connected',
        timestamp: expect.any(String),
      });
    });
  }, 60_000);

  it('executes AuthLockout and all 12 $queryRaw/$executeRaw call sites under ?schema=custom_tenant without 42P01 errors when current_schema() stays public', async () => {
    await runWithIsolatedDatabaseUrl(customSchemaPooledUrl, async () => {
      const { prisma, getPgPool } = await import('@/lib/prisma');
      const pool = getPgPool()!;

      // Confirm pooled connection leaves current_schema() on empty 'public'
      const currentSchemaRes = await pool.query<{ currentSchema: string }>(
        'SELECT current_schema() AS "currentSchema"'
      );
      expect(currentSchemaRes.rows[0]?.currentSchema).toBe('public');

      const recordedQueryErrors: Array<{ code?: string; message: string }> = [];
      const originalQuery = pool.query.bind(pool);
      const querySpy = jest.spyOn(pool, 'query').mockImplementation(((...args: unknown[]) => {
        const result = (originalQuery as (...a: unknown[]) => unknown)(...args);
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          return (result as Promise<unknown>).catch((err: unknown) => {
            const errObj = err as { code?: string; message?: string };
            recordedQueryErrors.push({
              code: errObj?.code,
              message: errObj?.message ?? String(err),
            });
            throw err;
          });
        }
        return result;
      }) as typeof pool.query);

      try {
        // 0. AuthLockout (src/utils/rateLimit.ts:L718-L793 + resetRateLimitsForTesting)
        const { createAuthLockoutInstance, resetRateLimitsForTesting } = await import(
          '@/utils/rateLimit'
        );
        const lockout = createAuthLockoutInstance({ pool });
        const authReq = new NextRequest('http://localhost:3000/api/admin/login', {
          headers: { 'x-forwarded-for': '203.0.113.42' },
        });
        await lockout.recordFailure(authReq, 60_000, 'auth-it', 2);
        const lockoutCountRes = await pool.query<{ cnt: number }>(
          `SELECT COUNT(*)::int AS cnt FROM "${CUSTOM_SCHEMA_NAME}"."AuthLockout"`
        );
        expect(lockoutCountRes.rows[0]?.cnt).toBe(1);
        const notLockedYet = await lockout.checkLockout(authReq, 2, 60_000, 'auth-it');
        expect(notLockedYet).toBeNull();
        await lockout.recordFailure(authReq, 60_000, 'auth-it', 2);
        const lockedResponse = await lockout.checkLockout(authReq, 2, 60_000, 'auth-it');
        expect(lockedResponse?.status).toBe(429);
        resetRateLimitsForTesting();

        // Prepare domain services from public barrels
        const {
          registryRepository,
          ThankYouService,
          InvitationCodeAdminService,
        } = await import('@/features/registry');
        const { SubEventService } = await import('@/features/sub-events');
        const { SeatingTableAdminService } = await import('@/features/seating');
        const { pruneSnapshotsBulk } = await import('@/lib/audit');

        const media = await prisma.media.create({
          data: {
            url: '/images/test-item.png',
            altText: 'Test Gift',
            isDecorative: false,
          },
        });

        const groupFund = await prisma.registryItem.create({
          data: {
            name: 'Travel Experience Fund',
            price: 500,
            quantity: 1,
            itemType: 'CASH_FUND',
            isGroupGift: true,
            category: 'Experiences',
            description: 'Custom schema integration fund',
            imageId: media.id,
          },
        });

        const physicalItem = await prisma.registryItem.create({
          data: {
            name: 'Espresso Machine',
            price: 200,
            quantity: 1,
            itemType: 'PHYSICAL',
            isGroupGift: false,
            category: 'Kitchen',
            description: 'Custom schema physical item',
            imageId: media.id,
          },
        });

        // Raw SQL #1: RegistryRepository.contributeToItem (FOR UPDATE on RegistryItem)
        const afterReserved = await registryRepository.contributeToItem(groupFund.id, {
          name: 'Guest Alpha',
          email: 'alpha@example.com',
          amount: 50,
        });
        const reservedContributorId = afterReserved.contributors?.[0]?.id;
        expect(reservedContributorId).toBeDefined();

        const afterStripe = await registryRepository.contributeToItem(groupFund.id, {
          name: 'Guest Beta',
          email: 'beta@example.com',
          amount: 100,
          stripePaymentIntentId: 'pi_custom_schema_it_1',
          stripeChargeId: 'ch_custom_schema_it_1',
        });
        const stripeContributor = afterStripe.contributors?.find(
          (c) => c.stripePaymentIntentId === 'pi_custom_schema_it_1'
        );
        expect(stripeContributor).toBeDefined();

        // Raw SQL #2: RegistryRepository.recomputeItemLedger (invoked via confirmContribution)
        const confirmedRes = await registryRepository.confirmContribution!(
          reservedContributorId!,
          'IntegrationTest'
        );
        expect(confirmedRes.changed).toBe(true);

        // Raw SQL #3: RegistryRepository.reconcileStripeAdjustment
        const reconcileRes = await registryRepository.reconcileStripeAdjustment!({
          stripeChargeId: 'ch_custom_schema_it_1',
          stripePaymentIntentId: 'pi_custom_schema_it_1',
          refundedCents: 2500,
        });
        expect(reconcileRes.matched).toBe(true);
        expect(reconcileRes.refundedAmount).toBe(25);

        // Raw SQL #4: RegistryRepository.updateContributor
        const updatedContribRes = await registryRepository.updateContributor!(
          reservedContributorId!,
          { amount: 60, message: 'Updated gift note' },
          'IntegrationTest'
        );
        expect(updatedContribRes.contributor.amount).toBe(60);

        // Raw SQL #5: RegistryRepository.deleteContributor
        const deletedContribRes = await registryRepository.deleteContributor!(
          reservedContributorId!,
          {},
          'IntegrationTest'
        );
        expect(deletedContribRes.deletedId).toBe(reservedContributorId);

        // Raw SQL #6: RegistryRepository.unclaimItem
        await registryRepository.contributeToItem(physicalItem.id, {
          name: 'Guest Gamma',
          amount: 200,
        });
        const unclaimedItem = await registryRepository.unclaimItem!(
          physicalItem.id,
          {},
          'IntegrationTest'
        );
        expect(unclaimedItem.purchased).toBe(false);

        // Raw SQL #7: ThankYouService.createOfflineGift
        const thankYouSvc = new ThankYouService(prisma);
        const offlineGift = await thankYouSvc.createOfflineGift(
          {
            name: 'Guest Delta',
            email: 'delta@example.com',
            amount: 75,
            registryItemId: groupFund.id,
            thankYouStatus: 'Unsent',
          },
          'IntegrationTest'
        );
        expect(offlineGift.amount).toBe(75);

        // Raw SQL #8: InvitationCodeAdminService.importBatch (collisionStrategy = 'update')
        const inviteAdminSvc = new InvitationCodeAdminService();
        const createdBatch = await inviteAdminSvc.importBatch(
          [
            {
              code: 'TENANT01',
              guestName: 'Guest Epsilon',
              email: 'epsilon@example.com',
              householdName: 'Epsilon Household',
              partyGroup: 'Friends',
              partyTags: ['VIP'],
            },
            {
              code: 'TENANT02',
              guestName: 'Guest Zeta',
              email: 'zeta@example.com',
              householdName: 'Zeta Household',
              partyGroup: 'Family',
              partyTags: ['Local'],
            },
          ],
          'skip',
          'IntegrationTest'
        );
        expect(createdBatch.imported).toBe(2);

        const updatedBatch = await inviteAdminSvc.importBatch(
          [
            {
              code: 'TENANT01',
              guestName: 'Guest Epsilon Updated',
              city: 'Seattle',
              partyTags: ['VIP', 'Out of Town'],
            },
          ],
          'update',
          'IntegrationTest'
        );
        expect(updatedBatch.updated).toBe(1);

        const persistedInvites = await prisma.invitationCode.findMany({
          where: { code: { in: ['TENANT01', 'TENANT02'] } },
          orderBy: { code: 'asc' },
        });
        expect(persistedInvites).toHaveLength(2);
        expect(persistedInvites[0]?.guestName).toBe('Guest Epsilon Updated');

        // Raw SQL #9: InvitationCodeAdminService.batchUpdateTags
        const retagged = await inviteAdminSvc.batchUpdateTags(
          persistedInvites.map((inv) => inv.id),
          ['Rehearsal'],
          'add',
          'IntegrationTest'
        );
        expect(retagged).toHaveLength(2);
        expect(retagged[0]?.partyTags).toContain('Rehearsal');

        // Raw SQL #9b: RegistryRepository.contributeToItem with verified code (FOR UPDATE on InvitationCode)
        const inviteReserved = await registryRepository.contributeToItem(groupFund.id, {
          name: 'Guest Epsilon Updated',
          amount: 25,
          code: 'TENANT01',
        });
        expect(
          inviteReserved.contributors?.some((c) => c.name === 'Guest Epsilon Updated')
        ).toBe(true);

        // Raw SQL #10: SubEventService.getAccessMatrix
        const welcomeSubEvent = await prisma.subEvent.create({
          data: {
            title: 'Welcome Drinks',
            description: 'Evening welcome gathering',
            locationName: 'Harbor Room',
            location: '10 Waterfront Way',
            category: 'Social',
            isPrivate: true,
          },
        });
        await prisma.subEventAccess.create({
          data: {
            subEventId: welcomeSubEvent.id,
            invitationCodeId: persistedInvites[0]!.id,
          },
        });
        await prisma.subEventRsvp.create({
          data: {
            subEventId: welcomeSubEvent.id,
            invitationCodeId: persistedInvites[0]!.id,
            status: 'attending',
            plusOneCount: 0,
          },
        });

        const subEventSvc = new SubEventService(prisma);
        const matrix = await subEventSvc.getAccessMatrix({ page: 1, limit: 25 });
        expect(matrix.pagination.total).toBe(2);
        expect(matrix.subEvents).toHaveLength(1);
        expect(matrix.subEvents[0]?.allowedInvitationCodeIds).toEqual([
          persistedInvites[0]!.id,
        ]);

        // Raw SQL #11: SeatingTableAdminService.assignSeatsBatch -> applyBatchSeatUpdates
        const seatingSvc = new SeatingTableAdminService();
        const table = await prisma.seatingTable.create({
          data: {
            name: 'Table 1',
            capacity: 8,
            shape: 'round',
            x: 100,
            y: 100,
            width: 120,
            height: 120,
          },
        });
        const assignedSeats = await seatingSvc.assignSeatsBatch(
          persistedInvites.map((inv) => inv.id),
          table.id,
          { author: 'IntegrationTest' }
        );
        expect(assignedSeats.updatedGuests).toHaveLength(2);
        expect(assignedSeats.updatedGuests[0]?.tableId).toBe(table.id);

        // Raw SQL #12: pruneSnapshotsBulk (src/lib/audit.ts)
        await prisma.snapshotVersion.createMany({
          data: Array.from({ length: 5 }, (_, idx) => ({
            entityType: 'RegistryItem',
            entityId: groupFund.id,
            data: { seq: idx },
            author: 'IntegrationTest',
          })),
        });
        await pruneSnapshotsBulk([{ entityType: 'RegistryItem', entityId: groupFund.id }]);

        // Raw SQL #13-15: ContentRepository.approvePhotosBatch, ContentRepository.rejectPhotosBatch & MediaRepository.deleteMediaBatch
        const { ContentRepository } = await import('@/features/content');
        const { MediaRepository } = await import('@/features/media');
        const customContentRepo = new ContentRepository(prisma);
        const customMediaRepo = new MediaRepository(prisma);

        const [customMedia1, customMedia2] = await Promise.all([
          prisma.media.create({
            data: { url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', altText: 'Custom Tenant Photo 1' },
          }),
          prisma.media.create({
            data: { url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', altText: 'Custom Tenant Photo 2' },
          }),
        ]);
        await prisma.contentNode.createMany({
          data: [
            {
              id: 'custom-photo-1',
              type: 'Photo',
              tags: ['gallery', 'guest-upload'],
              data: { url: customMedia1.url, mediaId: customMedia1.id, status: 'PENDING', isVisible: false },
            },
            {
              id: 'custom-photo-2',
              type: 'Photo',
              tags: ['gallery', 'guest-upload'],
              data: { url: customMedia2.url, mediaId: customMedia2.id, status: 'PENDING', isVisible: false },
            },
          ],
        });

        const approvedCustom = await customContentRepo.approvePhotosBatch(
          ['custom-photo-1', 'custom-photo-2'],
          'CustomTenantAdmin'
        );
        expect(approvedCustom).toHaveLength(2);

        const rejectedCustomIds = await customContentRepo.rejectPhotosBatch(
          ['custom-photo-1'],
          'CustomTenantAdmin'
        );
        expect(rejectedCustomIds).toEqual(['custom-photo-1']);

        const deletedCustomMedia = await customMediaRepo.deleteMediaBatch(
          [customMedia2.id],
          'CustomTenantAdmin'
        );
        expect(deletedCustomMedia).toHaveLength(1);
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Zero 42P01 (undefined_table) or other wire-level SQL errors occurred
        expect(recordedQueryErrors).toEqual([]);
      } finally {
        querySpy.mockRestore();
      }
    });
  }, 60_000);

  it('rejects ?ssl=true against plaintext PostgreSQL in both pre-migration checks and GET /api/ready', async () => {
    const sslTruePlaintextUrl = `${customDbBaseUrl}?schema=${CUSTOM_SCHEMA_NAME}&ssl=true`;

    const preflight = runPreflightCheck({
      requireDb: true,
      databaseUrl: sslTruePlaintextUrl,
    });
    expect(preflight.success).toBe(false);
    expect(preflight.summary).toContain('does not support SSL connections');

    await runWithIsolatedDatabaseUrl(sslTruePlaintextUrl, async () => {
      const { GET } = await import('@/app/api/ready/route');
      const res = await GET();
      expect(res.status).toBe(503);
      const body = (await res.json()) as { status: string; database: string };
      expect(body.status).toBe('unhealthy');
      expect(body.database).toBe('disconnected');
    });
  }, 30_000);

  it('rejects sslmode=require, sslmode=verify-ca, and sslmode=verify-full without sslrootcert against an untrusted self-signed certificate in both pre-flight and GET /api/ready', async () => {
    const untrustedProxy = await startTlsPostgresProxy({
      backendHost: pgHost,
      backendPort: pgPort,
      tlsKeyPem: untrustedKeyPem,
      tlsCertPem: untrustedCertPem,
    });

    try {
      for (const mode of ['require', 'verify-ca', 'verify-full'] as const) {
        const targetUrl = `postgresql://${authPart}127.0.0.1:${untrustedProxy.port}/${CUSTOM_DB_NAME}?schema=${CUSTOM_SCHEMA_NAME}&sslmode=${mode}`;

        const preflight = runPreflightCheck({
          requireDb: true,
          databaseUrl: targetUrl,
        });
        expect(preflight.success).toBe(false);

        await runWithIsolatedDatabaseUrl(targetUrl, async () => {
          const { GET } = await import('@/app/api/ready/route');
          const res = await GET();
          expect(res.status).toBe(503);
        });
      }
    } finally {
      await untrustedProxy.close();
    }
  }, 45_000);

  it('retains sslaccept=strict with custom sslrootcert in Prisma CLI for verify-ca and verify-full while preserving CA-only verify-ca vs hostname-checked require/verify-full in runtime and handshake probes', async () => {
    const mismatchedProxy = await startTlsPostgresProxy({
      backendHost: pgHost,
      backendPort: pgPort,
      tlsKeyPem: mismatchedHostKeyPem,
      tlsCertPem: mismatchedHostCertPem,
    });
    const matchingProxy = await startTlsPostgresProxy({
      backendHost: pgHost,
      backendPort: pgPort,
      tlsKeyPem: matchingHostKeyPem,
      tlsCertPem: matchingHostCertPem,
    });

    try {
      const encodedRootCert = encodeURIComponent(caCertPath);
      const mismatchedVerifyCaUrl = `postgresql://${authPart}127.0.0.1:${mismatchedProxy.port}/${CUSTOM_DB_NAME}?schema=${CUSTOM_SCHEMA_NAME}&sslmode=verify-ca&sslrootcert=${encodedRootCert}`;

      // Node handshake probe and pg.Pool honor CA-only verify-ca on mismatched SAN
      await expect(verifyPostgresTlsHandshake(mismatchedVerifyCaUrl)).resolves.toMatchObject({
        ok: true,
        tlsMode: 'verify-ca',
        upgraded: true,
      });

      // Prisma CLI now retains sslaccept=strict + sslcert=<caCertPath> on verify-ca, rejecting SAN mismatch
      const preflightMismatchedVerifyCa = runPreflightCheck({
        requireDb: true,
        databaseUrl: mismatchedVerifyCaUrl,
      });
      expect(preflightMismatchedVerifyCa.success).toBe(false);

      await runWithIsolatedDatabaseUrl(mismatchedVerifyCaUrl, async () => {
        const { GET } = await import('@/app/api/ready/route');
        const res = await GET();
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({
          status: 'ready',
          database: 'connected',
          timestamp: expect.any(String),
        });
      });

      for (const strictMode of ['require', 'verify-full'] as const) {
        const mismatchedStrictUrl = `postgresql://${authPart}127.0.0.1:${mismatchedProxy.port}/${CUSTOM_DB_NAME}?schema=${CUSTOM_SCHEMA_NAME}&sslmode=${strictMode}&sslrootcert=${encodedRootCert}`;

        const preflightStrict = runPreflightCheck({
          requireDb: true,
          databaseUrl: mismatchedStrictUrl,
        });
        expect(preflightStrict.success).toBe(false);

        await runWithIsolatedDatabaseUrl(mismatchedStrictUrl, async () => {
          const { GET } = await import('@/app/api/ready/route');
          const res = await GET();
          expect(res.status).toBe(503);
        });
      }

      // With matching SAN + custom sslrootcert, both pre-flight Prisma CLI (sslaccept=strict) and GET /api/ready succeed across require, verify-ca, and verify-full
      for (const validMode of ['require', 'verify-ca', 'verify-full'] as const) {
        const matchingUrl = `postgresql://${authPart}127.0.0.1:${matchingProxy.port}/${CUSTOM_DB_NAME}?schema=${CUSTOM_SCHEMA_NAME}&sslmode=${validMode}&sslrootcert=${encodedRootCert}`;

        const preflightValid = runPreflightCheck({
          requireDb: true,
          databaseUrl: matchingUrl,
        });
        expect(preflightValid.success).toBe(true);
        expect(preflightValid.summary).toContain('**Pre-Flight Gate:** `PASSED`');

        await runWithIsolatedDatabaseUrl(matchingUrl, async () => {
          const { GET } = await import('@/app/api/ready/route');
          const res = await GET();
          expect(res.status).toBe(200);
          await expect(res.json()).resolves.toEqual({
            status: 'ready',
            database: 'connected',
            timestamp: expect.any(String),
          });
        });
      }
    } finally {
      await mismatchedProxy.close();
      await matchingProxy.close();
    }
  }, 60_000);
});
