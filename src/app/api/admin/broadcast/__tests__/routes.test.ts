/** @jest-environment node */

import * as crypto from 'node:crypto';
import * as tls from 'node:tls';
import { POST as sendRoute } from '../send/route';
import { POST as previewRoute } from '../preview/route';
import { GET as historyRoute } from '../history/route';
import { GET as detailRoute } from '../[id]/route';
import { POST as retryRoute } from '../retry/route';
import { POST as testConnRoute } from '../test-connection/route';
import { POST as testSendRoute } from '../test-send/route';
import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { BroadcastService } from '@/features/broadcast';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { validateAndResolveHost } from '@/utils/ssrf';
import { isAllowedSmtpPort } from '@/utils/validationPrimitives';

jest.mock('node:tls', () => {
  const actualTls = jest.requireActual('node:tls') as typeof import('node:tls');
  return {
    ...actualTls,
    connect: jest.fn((...args: unknown[]) => {
      const [firstArg, ...rest] = args;
      if (
        testSmtpCaCert &&
        firstArg &&
        typeof firstArg === 'object' &&
        !('ca' in firstArg && (firstArg as tls.ConnectionOptions).ca !== undefined)
      ) {
        return (actualTls.connect as (...a: unknown[]) => tls.TLSSocket)(
          {
            ...(firstArg as tls.ConnectionOptions),
            ca: [...actualTls.rootCertificates, testSmtpCaCert],
          },
          ...rest
        );
      }
      return (actualTls.connect as (...a: unknown[]) => tls.TLSSocket)(...args);
    }),
  };
});

let testSmtpCaCert: string | null = null;

function createTestSmtpPki(): { caCert: string; serverKey: string; serverCert: string } {
  const derLen = (len: number): Buffer => {
    if (len < 0x80) return Buffer.from([len]);
    const bytes: number[] = [];
    let rem = len;
    while (rem > 0) {
      bytes.unshift(rem & 0xff);
      rem >>= 8;
    }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
  };
  const derTlv = (tag: number, content: Buffer): Buffer =>
    Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
  const derSeq = (items: Buffer[]): Buffer => derTlv(0x30, Buffer.concat(items));
  const derUtc = (d: Date): Buffer => {
    const p = (n: number) => String(n).padStart(2, '0');
    return derTlv(
      0x17,
      Buffer.from(
        `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`,
        'ascii'
      )
    );
  };
  const derCn = (cn: string): Buffer =>
    derSeq([
      derTlv(
        0x31,
        derSeq([derTlv(0x06, Buffer.from([0x55, 0x04, 0x03])), derTlv(0x0c, Buffer.from(cn, 'utf8'))])
      ),
    ]);
  const issueCert = (opts: {
    subjectCn: string;
    issuerCn: string;
    spkiDer: Buffer;
    issuerKey: crypto.KeyObject;
    serial: number;
    isCa: boolean;
    dnsNames?: string[];
    ipv4?: string[];
  }): string => {
    const sigAlg = derSeq([
      derTlv(0x06, Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02])),
    ]);
    const now = new Date(Date.now() - 60_000);
    const exp = new Date(Date.now() + 2 * 24 * 3600_000);
    const exts: Buffer[] = [
      opts.isCa
        ? derSeq([
          derTlv(0x06, Buffer.from([0x55, 0x1d, 0x13])),
          derTlv(0x01, Buffer.from([0xff])),
          derTlv(0x04, derSeq([derTlv(0x01, Buffer.from([0xff]))])),
        ])
        : derSeq([derTlv(0x06, Buffer.from([0x55, 0x1d, 0x13])), derTlv(0x04, derSeq([]))]),
    ];
    const sans: Buffer[] = [];
    for (const d of opts.dnsNames ?? []) sans.push(derTlv(0x82, Buffer.from(d, 'ascii')));
    for (const ip of opts.ipv4 ?? []) {
      sans.push(derTlv(0x87, Buffer.from(ip.split('.').map(Number))));
    }
    if (sans.length > 0) {
      exts.push(derSeq([derTlv(0x06, Buffer.from([0x55, 0x1d, 0x11])), derTlv(0x04, derSeq(sans))]));
    }
    const tbs = derSeq([
      derTlv(0xa0, derTlv(0x02, Buffer.from([0x02]))),
      derTlv(0x02, Buffer.from([opts.serial])),
      sigAlg,
      derCn(opts.issuerCn),
      derSeq([derUtc(now), derUtc(exp)]),
      derCn(opts.subjectCn),
      opts.spkiDer,
      derTlv(0xa3, derSeq(exts)),
    ]);
    const sig = crypto.sign('sha256', tbs, opts.issuerKey);
    const certDer = derSeq([tbs, sigAlg, derTlv(0x03, Buffer.concat([Buffer.from([0x00]), sig]))]);
    const b64 = certDer.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
    return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
  };

  const caKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const caCn = 'Broadcast Route Test Root CA';
  const caCert = issueCert({
    subjectCn: caCn,
    issuerCn: caCn,
    spkiDer: caKeys.publicKey.export({ type: 'spki', format: 'der' }),
    issuerKey: caKeys.privateKey,
    serial: 1,
    isCa: true,
  });
  const serverKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serverCert = issueCert({
    subjectCn: 'smtp.example.org',
    issuerCn: caCn,
    spkiDer: serverKeys.publicKey.export({ type: 'spki', format: 'der' }),
    issuerKey: caKeys.privateKey,
    serial: 2,
    isCa: false,
    dnsNames: ['smtp.example.org', 'localhost'],
    ipv4: ['127.0.0.1'],
  });
  return {
    caCert,
    serverKey: serverKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    serverCert,
  };
}

jest.mock('@/utils/ssrf', () => {
  const actual = jest.requireActual('@/utils/ssrf');
  return {
    ...actual,
    validateAndResolveHost: jest.fn(actual.validateAndResolveHost),
  };
});

jest.mock('@/utils/validationPrimitives', () => {
  const actual = jest.requireActual('@/utils/validationPrimitives');
  return {
    ...actual,
    isAllowedSmtpPort: jest.fn(actual.isAllowedSmtpPort),
  };
});

const actualSsrf = jest.requireActual('@/utils/ssrf') as typeof import('@/utils/ssrf');
const actualValidationPrimitives = jest.requireActual(
  '@/utils/validationPrimitives'
) as typeof import('@/utils/validationPrimitives');
const mockValidateAndResolveHost = validateAndResolveHost as jest.MockedFunction<
  typeof validateAndResolveHost
>;
const mockIsAllowedSmtpPort = isAllowedSmtpPort as jest.MockedFunction<typeof isAllowedSmtpPort>;

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/features/broadcast/service', () => ({
  BroadcastService: {
    sendBroadcast: jest.fn().mockResolvedValue({ id: 'b1', status: 'SENT', sentCount: 1, failedCount: 0 }),
    sendTestBroadcast: jest.fn().mockResolvedValue({ success: true, channel: 'EMAIL', destination: 'host@example.com', subject: '[TEST] Test Subject', body: 'Test Body' }),
    renderPreview: jest.fn().mockResolvedValue({ body: 'Rendered Body', destination: 'test@example.com' }),
    getBroadcastHistory: jest.fn().mockResolvedValue([{ id: 'b1', status: 'SENT' }]),
    countBroadcastHistory: jest.fn().mockResolvedValue(1),
    getBroadcastById: jest.fn().mockResolvedValue({
      id: 'b1',
      channel: 'EMAIL',
      subject: 'Welcome',
      body: 'Full body',
      status: 'SENT',
      totalRecipients: 1,
      sentCount: 1,
      failedCount: 0,
      createdAt: '2026-06-01T12:00:00.000Z',
      recipients: [
        {
          id: 'r1',
          guestName: 'Alice',
          destination: 'alice@example.com',
          status: 'SENT',
          error: null,
        },
      ],
    }),
    retryFailedRecipients: jest.fn().mockResolvedValue({ id: 'b1', status: 'SENT' }),
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({ emailProvider: 'smtp' }),
}));

describe('Broadcast API Routes', () => {
  afterEach(() => {
    mockValidateAndResolveHost.mockImplementation(actualSsrf.validateAndResolveHost);
    mockIsAllowedSmtpPort.mockImplementation(actualValidationPrimitives.isAllowedSmtpPort);
  });

  it('POST /api/admin/broadcast/send returns broadcast result', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        subject: 'Test Subject',
        body: 'Test Body',
      }),
    });

    const res = await sendRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('SENT');
  });

  it('POST /api/admin/broadcast/send returns 400 for invalid schema', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        body: '',
      }),
    });

    const res = await sendRoute(req);
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/broadcast/send returns 400 when legacy scheduledAt key is supplied', async () => {
    (BroadcastService.sendBroadcast as jest.Mock).mockClear();
    const req = new NextRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        subject: 'Scheduled Announcement',
        body: 'Save the date!',
        scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      }),
    });

    const res = await sendRoute(req);
    expect(res.status).toBe(400);
    expect(BroadcastService.sendBroadcast).not.toHaveBeenCalled();
  });

  it('POST /api/admin/broadcast/send returns 500 when service fails', async () => {
    (BroadcastService.sendBroadcast as jest.Mock).mockRejectedValueOnce(new Error('Send error'));
    const req = new NextRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        body: 'Test',
      }),
    });

    const res = await sendRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/send returns 500 with default message when error has no message', async () => {
    (BroadcastService.sendBroadcast as jest.Mock).mockRejectedValueOnce({});
    const req = new NextRequest('http://localhost/api/admin/broadcast/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        body: 'Test',
      }),
    });

    const res = await sendRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/preview returns preview object', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        subject: 'Test Subject',
        body: 'Test Body',
      }),
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.body).toBe('Rendered Body');
  });

  it('POST /api/admin/broadcast/preview returns 400 for empty body', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        body: '',
      }),
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/broadcast/preview returns 500 when render throws', async () => {
    (BroadcastService.renderPreview as jest.Mock).mockRejectedValueOnce(new Error('Preview error'));
    const req = new NextRequest('http://localhost/api/admin/broadcast/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        body: 'Test',
      }),
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/preview returns 500 with default message when error has no message', async () => {
    (BroadcastService.renderPreview as jest.Mock).mockRejectedValueOnce({});
    const req = new NextRequest('http://localhost/api/admin/broadcast/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'EMAIL',
        body: 'Test',
      }),
    });

    const res = await previewRoute(req);
    expect(res.status).toBe(500);
  });

  it('GET /api/admin/broadcast/history returns history array', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/history');
    const res = await historyRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('GET /api/admin/broadcast/history returns 500 when service fails', async () => {
    (BroadcastService.getBroadcastHistory as jest.Mock).mockRejectedValueOnce(new Error('History error'));
    const req = new NextRequest('http://localhost/api/admin/broadcast/history');
    const res = await historyRoute(req);
    expect(res.status).toBe(500);
  });

  it('GET /api/admin/broadcast/history returns 500 with default message when error has no message', async () => {
    (BroadcastService.getBroadcastHistory as jest.Mock).mockRejectedValueOnce({});
    const req = new NextRequest('http://localhost/api/admin/broadcast/history');
    const res = await historyRoute(req);
    expect(res.status).toBe(500);
  });

  it('GET /api/admin/broadcast/history parses page and caps limit at 100 with pagination headers', async () => {
    (BroadcastService.getBroadcastHistory as jest.Mock).mockResolvedValueOnce([
      { id: 'b-page-2', status: 'SENT' },
    ]);
    (BroadcastService.countBroadcastHistory as jest.Mock).mockResolvedValueOnce(135);

    const req = new NextRequest('http://localhost/api/admin/broadcast/history?page=2&limit=500');
    const res = await historyRoute(req);

    expect(res.status).toBe(200);
    expect(BroadcastService.getBroadcastHistory).toHaveBeenLastCalledWith({
      page: 2,
      limit: 100,
    });
    expect(res.headers.get('X-Total-Count')).toBe('135');
    expect(res.headers.get('X-Page')).toBe('2');
    expect(res.headers.get('X-Limit')).toBe('100');
    expect(res.headers.get('X-Total-Pages')).toBe('2');
    expect(res.headers.get('X-Has-Prev-Page')).toBe('true');
    expect(res.headers.get('X-Has-Next-Page')).toBe('false');
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
  });

  it('GET /api/admin/broadcast/history returns 400 for invalid page or limit parameters', async () => {
    const badLimitReq = new NextRequest('http://localhost/api/admin/broadcast/history?limit=0');
    const badLimitRes = await historyRoute(badLimitReq);
    expect(badLimitRes.status).toBe(400);

    const badPageReq = new NextRequest('http://localhost/api/admin/broadcast/history?page=abc');
    const badPageRes = await historyRoute(badPageReq);
    expect(badPageRes.status).toBe(400);
  });

  describe('GET /api/admin/broadcast/[id]', () => {
    it('returns full broadcast details and recipients for a known ID', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/b1');
      const res = await detailRoute(req, { params: Promise.resolve({ id: 'b1' }) });

      expect(res.status).toBe(200);
      expect(BroadcastService.getBroadcastById).toHaveBeenCalledWith('b1');
      const json = await res.json();
      expect(json.data.id).toBe('b1');
      expect(json.data.body).toBe('Full body');
      expect(json.data.recipients).toHaveLength(1);
      expect(json.data.recipients[0].guestName).toBe('Alice');
    });

    it('returns 404 when broadcast ID does not exist', async () => {
      (BroadcastService.getBroadcastById as jest.Mock).mockResolvedValueOnce(null);
      const req = new NextRequest('http://localhost/api/admin/broadcast/unknown-id');
      const res = await detailRoute(req, { params: Promise.resolve({ id: 'unknown-id' }) });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('returns 401 when caller is unauthenticated', async () => {
      (isAdminRequest as jest.Mock).mockResolvedValueOnce(false);
      const req = new NextRequest('http://localhost/api/admin/broadcast/b1');
      const res = await detailRoute(req, { params: Promise.resolve({ id: 'b1' }) });

      expect(res.status).toBe(401);
    });

    it('returns 500 when BroadcastService.getBroadcastById throws', async () => {
      (BroadcastService.getBroadcastById as jest.Mock).mockRejectedValueOnce(new Error('DB failure'));
      const req = new NextRequest('http://localhost/api/admin/broadcast/b1');
      const res = await detailRoute(req, { params: Promise.resolve({ id: 'b1' }) });

      expect(res.status).toBe(500);
    });
  });

  it('POST /api/admin/broadcast/retry retries failed recipients', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        broadcastId: 'b1',
      }),
    });

    const res = await retryRoute(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.status).toBe('SENT');
  });

  it('POST /api/admin/broadcast/retry returns 400 when broadcastId missing', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        broadcastId: '',
      }),
    });

    const res = await retryRoute(req);
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/broadcast/retry returns 500 when service throws', async () => {
    (BroadcastService.retryFailedRecipients as jest.Mock).mockRejectedValueOnce(new Error('Retry error'));
    const req = new NextRequest('http://localhost/api/admin/broadcast/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        broadcastId: 'b1',
      }),
    });

    const res = await retryRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/retry returns 500 with default message when error has no message', async () => {
    (BroadcastService.retryFailedRecipients as jest.Mock).mockRejectedValueOnce({});
    const req = new NextRequest('http://localhost/api/admin/broadcast/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        broadcastId: 'b1',
      }),
    });

    const res = await retryRoute(req);
    expect(res.status).toBe(500);
  });

  it('POST /api/admin/broadcast/test-connection verifies live SMTP greeting/EHLO/STARTTLS/QUIT and fails when unreachable', async () => {
    const net = await import('node:net');
    const pki = createTestSmtpPki();
    testSmtpCaCert = pki.caCert;

    const attachSmtpProtocol = (sock: import('node:net').Socket | tls.TLSSocket, isTls: boolean) => {
      let buf = '';
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let idx = buf.indexOf('\r\n');
        while (idx !== -1) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 2);
          const upper = line.toUpperCase();
          if (upper.startsWith('EHLO ')) {
            if (!isTls) {
              sock.write('250-127.0.0.1\r\n250-STARTTLS\r\n250 OK\r\n');
            } else {
              sock.write('250-127.0.0.1\r\n250 OK\r\n');
            }
          } else if (upper === 'STARTTLS' && !isTls) {
            sock.removeAllListeners('data');
            sock.write('220 2.0.0 Ready to start TLS\r\n', () => {
              const tlsSock = new tls.TLSSocket(sock, {
                isServer: true,
                key: pki.serverKey,
                cert: pki.serverCert,
              });
              attachSmtpProtocol(tlsSock, true);
            });
            return;
          } else if (upper.startsWith('QUIT')) {
            sock.write('221 Bye\r\n', () => sock.end());
          }
          idx = buf.indexOf('\r\n');
        }
      });
    };

    const smtpServer = net.createServer((sock) => {
      sock.write('220 127.0.0.1 ESMTP Ready\r\n');
      attachSmtpProtocol(sock, false);
    });
    await new Promise<void>((resolve) => smtpServer.listen(0, '127.0.0.1', () => resolve()));
    const port = (smtpServer.address() as import('node:net').AddressInfo).port;
    mockValidateAndResolveHost.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    mockIsAllowedSmtpPort.mockImplementation(
      (candidatePort: number) =>
        actualValidationPrimitives.isAllowedSmtpPort(candidatePort) || candidatePort === port
    );

    try {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'email',
          provider: 'smtp',
          smtpHost: 'smtp.example.org',
          smtpPort: port,
          smtpSecure: false,
        }),
      });

      const res = await testConnRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    } finally {
      testSmtpCaCert = null;
      await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
    }

    const failReq = new NextRequest('http://localhost/api/admin/broadcast/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'email',
        provider: 'smtp',
        smtpHost: 'smtp.example.org',
        smtpPort: port,
      }),
    });
    const failRes = await testConnRoute(failReq);
    expect(failRes.status).toBe(200);
    const failJson = await failRes.json();
    expect(failJson.success).toBe(false);

    mockIsAllowedSmtpPort.mockImplementation(actualValidationPrimitives.isAllowedSmtpPort);
    const badPortReq = new NextRequest('http://localhost/api/admin/broadcast/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'email',
        provider: 'smtp',
        smtpHost: 'smtp.example.org',
        smtpPort: 22,
      }),
    });
    const badPortRes = await testConnRoute(badPortReq);
    expect(badPortRes.status).toBe(400);
  });

  it('POST /api/admin/broadcast/test-connection returns 400 for invalid schema', async () => {
    const req = new NextRequest('http://localhost/api/admin/broadcast/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'invalid-type',
      }),
    });

    const res = await testConnRoute(req);
    expect(res.status).toBe(400);
  });

  describe('POST /api/admin/broadcast/test-send', () => {
    beforeEach(() => {
      resetRateLimitsForTesting();
    });

    it('returns test broadcast result for valid email payload', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.0.1' },
        body: JSON.stringify({
          channel: 'EMAIL',
          subject: 'Sample Subject',
          body: 'Hello {{guestName}}',
          destination: 'admin@example.com',
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.destination).toBe('host@example.com');
      expect(BroadcastService.sendTestBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'EMAIL',
          subject: 'Sample Subject',
          body: 'Hello {{guestName}}',
          destination: 'admin@example.com',
        })
      );
    });

    it('returns 400 for empty body', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.0.2' },
        body: JSON.stringify({
          channel: 'EMAIL',
          body: '',
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid email destination', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.0.3' },
        body: JSON.stringify({
          channel: 'EMAIL',
          body: 'Hello',
          destination: 'invalid-email-address',
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-E.164 phone destination on SMS', async () => {
      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.0.4' },
        body: JSON.stringify({
          channel: 'SMS',
          body: 'Hello',
          destination: '1234567890', // Missing leading '+'
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(400);
    });

    it('returns 500 when BroadcastService.sendTestBroadcast throws', async () => {
      (BroadcastService.sendTestBroadcast as jest.Mock).mockRejectedValueOnce(
        new Error('Provider API Key missing')
      );

      const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.0.5' },
        body: JSON.stringify({
          channel: 'EMAIL',
          body: 'Hello',
        }),
      });

      const res = await testSendRoute(req);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Provider API Key missing');
    });

    it('enforces rate limit of 5 requests per minute per admin session', async () => {
      // 5 requests should pass
      for (let i = 0; i < 5; i++) {
        const req = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '10.0.0.6',
            cookie: 'admin_auth=test-admin-session-token',
          },
          body: JSON.stringify({
            channel: 'EMAIL',
            body: 'Hello',
          }),
        });
        const res = await testSendRoute(req);
        expect(res.status).toBe(200);
      }

      // 6th request from the same session should receive 429
      const req6 = new NextRequest('http://localhost/api/admin/broadcast/test-send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': '10.0.0.6',
          cookie: 'admin_auth=test-admin-session-token',
        },
        body: JSON.stringify({
          channel: 'EMAIL',
          body: 'Hello',
        }),
      });
      const res6 = await testSendRoute(req6);
      expect(res6.status).toBe(429);
      const json6 = await res6.json();
      expect(json6.error).toContain('Too many requests');
    });
  });
});
