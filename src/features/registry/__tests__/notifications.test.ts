/** @jest-environment node */

import * as crypto from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { validateAndResolveHost } from '@/utils/ssrf';
import { isAllowedSmtpPort } from '@/utils/validationPrimitives';
import { getAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import {
  dispatchContributionNotifications,
  dispatchConfirmedContributionAlert,
  dispatchPoliteReminderNotification,
  dispatchLedgerAdjustmentNotification,
} from '../notifications';
import { ThankYouService } from '../thank-you.service';

function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let rem = len;
  while (rem > 0) {
    bytes.unshift(rem & 0xff);
    rem >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content]);
}
function derSeq(items: Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(items));
}
function derUtc(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, '0');
  return derTlv(
    0x17,
    Buffer.from(
      `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`,
      'ascii'
    )
  );
}
function derCn(cn: string): Buffer {
  return derSeq([
    derTlv(
      0x31,
      derSeq([derTlv(0x06, Buffer.from([0x55, 0x04, 0x03])), derTlv(0x0c, Buffer.from(cn, 'utf8'))])
    ),
  ]);
}
function issueEcCert(opts: {
  subjectCn: string;
  issuerCn: string;
  spkiDer: Buffer;
  issuerKey: crypto.KeyObject;
  serial: number;
  isCa: boolean;
  dnsNames?: string[];
  ipv4?: string[];
}): string {
  const sigAlg = derSeq([derTlv(0x06, Buffer.from([0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02]))]);
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
    exts.push(
      derSeq([derTlv(0x06, Buffer.from([0x55, 0x1d, 0x11])), derTlv(0x04, derSeq(sans))])
    );
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
}

const TEST_REGISTRY_SMTP_PKI = (() => {
  const caKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const caCn = 'Registry Test SMTP Root CA';
  const caCert = issueEcCert({
    subjectCn: caCn,
    issuerCn: caCn,
    spkiDer: caKeys.publicKey.export({ type: 'spki', format: 'der' }),
    issuerKey: caKeys.privateKey,
    serial: 1,
    isCa: true,
  });
  const serverKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const serverCert = issueEcCert({
    subjectCn: '127.0.0.1',
    issuerCn: caCn,
    spkiDer: serverKeys.publicKey.export({ type: 'spki', format: 'der' }),
    issuerKey: caKeys.privateKey,
    serial: 2,
    isCa: false,
    dnsNames: ['localhost'],
    ipv4: ['127.0.0.1'],
  });
  return {
    caCert,
    serverKey: serverKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    serverCert,
  };
})();

jest.mock('node:tls', () => {
  const actualTls = jest.requireActual('node:tls') as typeof import('node:tls');
  return {
    ...actualTls,
    connect: jest.fn((...args: unknown[]) => {
      const [firstArg, ...rest] = args;
      if (
        firstArg &&
        typeof firstArg === 'object' &&
        !('ca' in firstArg && (firstArg as tls.ConnectionOptions).ca !== undefined)
      ) {
        return (actualTls.connect as (...a: unknown[]) => tls.TLSSocket)(
          {
            ...(firstArg as tls.ConnectionOptions),
            ca: [...actualTls.rootCertificates, TEST_REGISTRY_SMTP_PKI.caCert],
          },
          ...rest
        );
      }
      return (actualTls.connect as (...a: unknown[]) => tls.TLSSocket)(...args);
    }),
  };
});

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  createAuditSnapshot: jest.fn().mockResolvedValue(undefined),
  createBatchAuditSnapshots: jest.fn().mockResolvedValue(undefined),
}));

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

const TEST_TLS_KEY = TEST_REGISTRY_SMTP_PKI.serverKey;
const TEST_TLS_CERT = TEST_REGISTRY_SMTP_PKI.serverCert;

const mockValidateAndResolveHost = validateAndResolveHost as jest.MockedFunction<
  typeof validateAndResolveHost
>;
const mockIsAllowedSmtpPort = isAllowedSmtpPort as jest.MockedFunction<typeof isAllowedSmtpPort>;
const mockedGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

async function startLoopbackTlsSmtpServer(): Promise<{
  port: number;
  receivedMessages: string[];
  close: () => Promise<void>;
}> {
  const receivedMessages: string[] = [];
  const activeSockets = new Set<net.Socket>();

  const server = tls.createServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }, (sock) => {
    activeSockets.add(sock);
    sock.on('close', () => activeSockets.delete(sock));
    sock.write('220 127.0.0.1 ESMTP Ready\r\n');

    let buffer = '';
    let inData = false;
    let dataBuffer = '';

    sock.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);

        if (inData) {
          if (line === '.') {
            receivedMessages.push(dataBuffer);
            dataBuffer = '';
            inData = false;
            sock.write('250 2.0.0 Queued\r\n');
          } else {
            dataBuffer += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          }
        } else {
          const upper = line.toUpperCase();
          if (upper.startsWith('EHLO ') || upper.startsWith('HELO ')) {
            sock.write('250-127.0.0.1 Hello\r\n250 SIZE 10485760\r\n');
          } else if (upper.startsWith('MAIL FROM:') || upper.startsWith('RCPT TO:')) {
            sock.write('250 OK\r\n');
          } else if (upper === 'DATA') {
            inData = true;
            sock.write('354 Start mail input\r\n');
          } else if (upper === 'QUIT') {
            sock.write('221 Bye\r\n', () => sock.end());
          } else {
            sock.write('500 Unknown\r\n');
          }
        }
        idx = buffer.indexOf('\n');
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as net.AddressInfo).port;
  mockValidateAndResolveHost.mockResolvedValue({ address: '127.0.0.1', family: 4 });
  mockIsAllowedSmtpPort.mockImplementation((p: number) => p === port || p === 587 || p === 465);

  return {
    port,
    receivedMessages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of activeSockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

function splitSmtpMimeParts(rawMime: string): { plain: string; html: string } {
  const plainMarker = 'Content-Type: text/plain; charset="utf-8"';
  const htmlMarker = 'Content-Type: text/html; charset="utf-8"';
  const plainIdx = rawMime.indexOf(plainMarker);
  const htmlIdx = rawMime.indexOf(htmlMarker);
  const plain =
    plainIdx !== -1 && htmlIdx !== -1 ? rawMime.slice(plainIdx + plainMarker.length, htmlIdx) : '';
  const html = htmlIdx !== -1 ? rawMime.slice(htmlIdx + htmlMarker.length) : '';
  return { plain, html };
}

describe('Registry Transactional HTML Notifications & Plain-Text Thank-You Escaping', () => {
  const originalFetch = global.fetch;
  const originalJwtSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-at-least-32-characters-long-12345';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.JWT_SECRET = originalJwtSecret;
  });

  it.each(['resend', 'sendgrid', 'smtp'] as const)(
    'sends unescaped <div>, <table>, and <a> HTML with plain-text parts for all 4 notifications.ts builders via %s',
    async (providerType) => {
      const smtp = providerType === 'smtp' ? await startLoopbackTlsSmtpServer() : null;
      const fetchCalls: Array<{ url: string; body: Record<string, any> }> = [];
      global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push({
          url: String(url),
          body: init?.body ? JSON.parse(String(init.body)) : {},
        });
        return {
          ok: true,
          status: 200,
          text: async () => '',
        } as Response;
      }) as unknown as typeof fetch;

      const config: Record<string, unknown> = {
        emailProvider: providerType,
        contactEmail: 'couple@wedding.example',
        baseUrl: 'https://wedding.example',
        resendApiKey: 're_test_key',
        resendFrom: 'hosts@wedding.example',
        sendgridApiKey: 'SG.test_key',
        sendgridFrom: 'hosts@wedding.example',
        smtpHost: '127.0.0.1',
        smtpPort: smtp?.port ?? 465,
        smtpSecure: true,
        smtpFrom: 'hosts@wedding.example',
        smtpRejectUnauthorized: false,
      };

      const mockRepo = {
        claimContributorEmailSend: jest.fn().mockResolvedValue(true),
        releaseContributorEmailSend: jest.fn().mockResolvedValue(undefined),
      } as any;

      try {
        // 1. dispatchContributionNotifications (sends Guest Confirmation + Couple Alert)
        await dispatchContributionNotifications({
          itemId: 'fund-venmo',
          updatedItem: {
            id: 'fund-venmo',
            name: 'Honeymoon Fund',
            itemType: 'CASH_FUND',
            isGroupGift: true,
            paymentHandleType: 'Venmo',
            paymentHandle: '@happycouple',
            contributors: [
              {
                id: 'contrib-1',
                name: 'Alex <script>alert(1)</script>',
                email: 'alex@example.com',
                amount: 50,
                status: 'CONFIRMED',
              },
            ],
          },
          contribution: {
            name: 'Alex <script>alert(1)</script>',
            email: 'alex@example.com',
            amount: 50,
          },
          config,
          repository: mockRepo,
        });

        // 2. dispatchConfirmedContributionAlert
        await dispatchConfirmedContributionAlert({
          contributor: {
            id: 'contrib-2',
            name: 'Jordan Guest',
            email: 'jordan@example.com',
            amount: 75,
          },
          item: {
            id: 'gift-1',
            name: 'Espresso Machine',
            itemType: 'PHYSICAL',
          },
          config,
          repository: mockRepo,
        });

        // 3. dispatchPoliteReminderNotification
        const reminderRes = await dispatchPoliteReminderNotification({
          contributor: {
            id: 'contrib-3',
            name: 'Casey Guest',
            email: 'casey@example.com',
            amount: 60,
          },
          item: {
            id: 'fund-paypal',
            name: 'Flight Upgrade Fund',
            itemType: 'EXPERIENCE_FUND',
            isGroupGift: true,
            paymentHandleType: 'PayPal',
            paymentHandle: '@happycouple',
          },
          config,
        });
        expect(reminderRes).toEqual({ sent: true });

        // 4. dispatchLedgerAdjustmentNotification
        await dispatchLedgerAdjustmentNotification({
          eventType: 'partial_refund',
          contributor: {
            id: 'contrib-4',
            name: 'Taylor Guest',
            email: 'taylor@example.com',
            amount: 100,
          },
          item: {
            id: 'fund-venmo',
            name: 'Honeymoon Fund',
            amountContributed: 150,
            purchased: false,
          },
          refundedAmount: 25,
          config,
        });

        // Collect all 5 dispatched messages (2 from dispatchContributionNotifications + 1 + 1 + 1)
        const capturedEmails: Array<{ html: string; text: string }> = [];
        if (providerType === 'resend') {
          expect(fetchCalls).toHaveLength(5);
          for (const call of fetchCalls) {
            capturedEmails.push({ html: call.body.html, text: call.body.text });
          }
        } else if (providerType === 'sendgrid') {
          expect(fetchCalls).toHaveLength(5);
          for (const call of fetchCalls) {
            const plainPart = call.body.content.find((c: any) => c.type === 'text/plain');
            const htmlPart = call.body.content.find((c: any) => c.type === 'text/html');
            capturedEmails.push({ html: htmlPart?.value ?? '', text: plainPart?.value ?? '' });
          }
        } else {
          expect(smtp!.receivedMessages).toHaveLength(5);
          for (const rawMime of smtp!.receivedMessages) {
            const parts = splitSmtpMimeParts(rawMime);
            capturedEmails.push({ html: parts.html, text: parts.plain });
          }
        }

        // Every builder sends unescaped <div> and <a> HTML + plain-text fallback
        for (const msg of capturedEmails) {
          expect(msg.html).toContain('<div');
          expect(msg.html).toContain('<a href="');
          expect(msg.html).not.toContain('&lt;div');
          expect(msg.html).not.toContain('&lt;table');
          expect(msg.text.length).toBeGreaterThan(20);
          expect(msg.text).not.toContain('<div');
        }

        // Guest confirmation, couple alert, and ledger adjustment contain unescaped <table> markup
        expect(capturedEmails[0].html).toContain('<table');
        expect(capturedEmails[1].html).toContain('<table');
        expect(capturedEmails[2].html).toContain('<table');
        expect(capturedEmails[4].html).toContain('<table');

        // Untrusted contributor name inside HTML template is still entity-escaped
        expect(capturedEmails[0].html).toContain('Alex &lt;script&gt;alert(1)&lt;/script&gt;');
        expect(capturedEmails[0].html).not.toContain('<script>alert(1)</script>');

        // Amount-parameterized Venmo and PayPal links in transactional emails
        expect(capturedEmails[0].html).toContain(
          'https://venmo.com/u/happycouple?txn=pay&amp;amount=50.00'
        );
        expect(capturedEmails[3].html).toContain('https://paypal.me/happycouple/60.00');
      } finally {
        if (smtp) await smtp.close();
      }
    }
  );

  it('omits mailto:/tel: links for Zelle handles and appends positive amounts for Cash App in transactional emails', async () => {
    const fetchCalls: Array<Record<string, any>> = [];
    global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push(init?.body ? JSON.parse(String(init.body)) : {});
      return { ok: true, status: 200, text: async () => '' } as Response;
    }) as unknown as typeof fetch;

    const config = {
      emailProvider: 'resend',
      resendApiKey: 're_test_key',
      resendFrom: 'hosts@wedding.example',
      baseUrl: 'https://wedding.example',
    };
    const mockRepo = {
      claimContributorEmailSend: jest.fn().mockResolvedValue(true),
      releaseContributorEmailSend: jest.fn().mockResolvedValue(undefined),
    } as any;

    (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValueOnce({
      email: 'guest@example.com',
      isSample: false,
      source: 'admin',
    });

    await dispatchContributionNotifications({
      itemId: 'fund-zelle',
      updatedItem: {
        id: 'fund-zelle',
        name: 'Home Down Payment',
        itemType: 'CASH_FUND',
        isGroupGift: true,
        paymentHandleType: 'Zelle',
        paymentHandle: 'couple@example.com',
        contributors: [
          {
            id: 'c-zelle',
            name: 'Zelle Guest',
            email: 'guest@example.com',
            amount: 120,
            status: 'RESERVED',
          },
        ],
      },
      contribution: {
        name: 'Zelle Guest',
        email: 'guest@example.com',
        amount: 120,
      },
      verifiedInvitationCode: 'ZELLE123',
      config,
      repository: mockRepo,
      isReservation: true,
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].html).toContain('open your bank&#39;s app');
    expect(fetchCalls[0].html).not.toContain('mailto:');
    expect(fetchCalls[0].html).not.toContain('tel:');

    // Anti-relay: unverified or spoofed RESERVED claims never send guest confirmation emails, while still sending couple reservation alerts
    fetchCalls.length = 0;
    (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValueOnce({
      email: null,
      isSample: false,
      source: 'admin',
    });
    await dispatchContributionNotifications({
      itemId: 'fund-zelle',
      updatedItem: {
        id: 'fund-zelle',
        name: 'Home Down Payment',
        itemType: 'CASH_FUND',
        isGroupGift: true,
        paymentHandleType: 'Zelle',
        paymentHandle: 'couple@example.com',
        contributors: [
          {
            id: 'c-spoofed',
            name: 'Spoofed Guest',
            email: 'victim@thirdparty.example',
            amount: 120,
            status: 'RESERVED',
          },
        ],
      },
      contribution: {
        name: 'Spoofed Guest',
        email: 'victim@thirdparty.example',
        amount: 120,
      },
      verifiedInvitationCode: 'NOEMAIL1',
      config: {
        ...config,
        contactEmail: 'couple@wedding.example',
      },
      repository: mockRepo,
      isReservation: true,
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].to).toBe('couple@wedding.example');
    expect(fetchCalls[0].subject).toContain('New Registry Reservation:');
    expect(fetchCalls[0].html).toContain('Direct Transfer (Zelle) (Reserved)');

    fetchCalls.length = 0;
    await dispatchPoliteReminderNotification({
      contributor: {
        id: 'c-cashapp',
        name: 'CashApp Guest',
        email: 'guest@example.com',
        amount: 45,
      },
      item: {
        id: 'fund-cashapp',
        name: 'Date Night Fund',
        itemType: 'CASH_FUND',
        isGroupGift: true,
        paymentHandleType: 'Cash App',
        paymentHandle: '$happycouple',
      },
      config,
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].html).toContain('https://cash.app/$happycouple/45.00');

    // Passcode RESERVED claim (no invitation code linked) sends guest confirmation email with signed /guest/claim links
    fetchCalls.length = 0;
    await dispatchContributionNotifications({
      itemId: 'item-phys-passcode',
      updatedItem: {
        id: 'item-phys-passcode',
        name: 'Espresso Machine',
        itemType: 'PHYSICAL',
        isGroupGift: false,
        vendorUrl: 'https://retailer.example.com/espresso',
        contributors: [
          {
            id: 'c-passcode-mail',
            name: 'Passcode Claimer',
            email: 'claimer@example.com',
            amount: 250,
            status: 'RESERVED',
          },
        ],
      },
      contribution: {
        name: 'Passcode Claimer',
        email: 'claimer@example.com',
        amount: 250,
      },
      verifiedInvitationCode: null,
      allowPasscodeReservationEmail: true,
      config,
      repository: mockRepo,
      isReservation: true,
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].to).toBe('claimer@example.com');
    expect(fetchCalls[0].html).toContain('/guest/claim?token=');
  });

  it.each(['resend', 'sendgrid', 'smtp'] as const)(
    'escapes <script> and <div> entities in plain-text thank-you notes via %s',
    async (providerType) => {
      const smtp = providerType === 'smtp' ? await startLoopbackTlsSmtpServer() : null;
      const fetchCalls: Array<Record<string, any>> = [];
      global.fetch = jest.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        fetchCalls.push(init?.body ? JSON.parse(String(init.body)) : {});
        return { ok: true, status: 200, text: async () => '' } as Response;
      }) as unknown as typeof fetch;

      mockedGetAppConfig.mockResolvedValue({
        partner1Name: 'Alex',
        partner2Name: 'Jordan',
        contactEmail: 'couple@wedding.example',
        emailProvider: providerType,
        resendApiKey: 're_thankyou_key',
        resendFrom: 'hosts@wedding.example',
        sendgridApiKey: 'SG.thankyou_key',
        sendgridFrom: 'hosts@wedding.example',
        smtpHost: '127.0.0.1',
        smtpPort: smtp?.port ?? 465,
        smtpSecure: true,
        smtpFrom: 'hosts@wedding.example',
        smtpRejectUnauthorized: false,
      } as any);

      const contributorRecord = {
        id: 'contrib-ty-1',
        name: 'Morgan Guest',
        email: 'morgan@example.com',
        amount: 100,
        refundedAmount: 0,
        status: 'CONFIRMED',
        coverFee: false,
        feeAmount: 0,
        date: new Date('2026-06-01T12:00:00Z'),
        message: 'Congrats!',
        isPlusOne: false,
        thankYouStatus: 'Unsent',
        thankYouSentAt: null,
        thankYouNote: null,
        registryItem: {
          id: 'item-ty-1',
          name: 'Crystal Vase',
          category: 'Home',
        },
        invitationCode: null,
      };

      const mockPrisma = {
        contributor: {
          findUnique: jest.fn().mockResolvedValue(contributorRecord),
          update: jest.fn().mockImplementation(async ({ data }: any) => ({
            ...contributorRecord,
            ...data,
          })),
        },
      };

      try {
        const service = new ThankYouService(mockPrisma);
        await service.sendThankYouEmail('contrib-ty-1', {
          mode: 'send',
          subject: 'Thank you!',
          body: 'Dear {{guest_name}},\n\n<div>Thank you</div> <script>alert("xss")</script>',
        });

        let deliveredHtml = '';
        if (providerType === 'resend') {
          deliveredHtml = fetchCalls[0].html;
        } else if (providerType === 'sendgrid') {
          deliveredHtml = fetchCalls[0].content.find((c: any) => c.type === 'text/html')?.value ?? '';
        } else {
          deliveredHtml = splitSmtpMimeParts(smtp!.receivedMessages[0]).html;
        }

        expect(deliveredHtml).toContain('&lt;div&gt;Thank you&lt;/div&gt;');
        expect(deliveredHtml).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(deliveredHtml).not.toContain('<script>');
        expect(deliveredHtml).not.toContain('<div>Thank you</div>');
      } finally {
        if (smtp) await smtp.close();
      }
    }
  );
});
