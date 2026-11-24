/** @jest-environment node */

import * as net from 'node:net';
import * as tls from 'node:tls';
import { validateAndResolveHost } from '@/utils/ssrf';
import { isAllowedSmtpPort } from '@/utils/validationPrimitives';
import { getAppConfig } from '@/lib/config';
import {
  dispatchContributionNotifications,
  dispatchConfirmedContributionAlert,
  dispatchPoliteReminderNotification,
  dispatchLedgerAdjustmentNotification,
} from '../notifications';
import { ThankYouService } from '../thank-you.service';

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

const TEST_TLS_KEY = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDtavb/rvKg/rcK',
  'TyjZcxCjyNCnnKnSXddlW5NmavTBbvbdgXHt497aXrZPbBoWFR8VnZIwz4hWSnkr',
  '/Batn0gD9ay16vVN8rYwdJGJrEnLjxXiUaFx3TeoLfFBGieOPKpHSXXFy1D4r1OA',
  'C4HUypvbsA37cqnikKEBUZyr0KQ3bsNu33vV2X0mDCqeRFKbKmF1tJ+Tzl9aswdm',
  'dyB9wpqOhkv5Z3ZQmkVqUVZyrb0lZxaybq02bFQejYLTFHiuesnMO0/AfBBrQTbI',
  '9utKOs8nhZf8ZJb7oIFu7pxmFv4QjP7IfYXH2T/LTNxor3NAVsAqVxxJchWOuvtv',
  '9jG+zCVPAgMBAAECggEAPW7WJubgBWSjfFlrWoj5n0fRJe3Vy4dYuvNtOq0mU/8g',
  'hcR+9G1oNt0XE4oHXfttJay2LUcmIh33KLh8LcTvX4bsf84iV18cYYFoP1WDatbF',
  'dOBmhA4X3r60lIHuBlIQRY3umZW4iADl/FX97E/Y8ImntI7BAs0lvC+f+J1uQKE6',
  '+poEirMhEpY97xsaFpDXKQzJUOyl+K1Ko0ma3eds+kw+yViLOMpE1BXD96mqJ50H',
  'xnU2xF8b+srB/SPpiP7y4E9PM/PVs9am+sl5pmoVnricWtPNdMXQ/uz5RgplVPmO',
  'Rfkp0kWy7LEGxv90YxcyacmizXTfC9WHuedhnC/DAQKBgQD6hDb9XzCc7vgUmgVi',
  'WYbMFfGYqRNDciSW/M9MUbeAdTUfRAhQOG3i7cFHXiTI1tOZV7cSm732f0y8qJ9p',
  'SF9CPf93KrhuPMKmCgNrgaPww7bSaLkO2BNFtfHKBrMQaO+OpTtQd7i4HdzgHZIU',
  'rvCGhPyggdwexwJmz7msNYL+wQKBgQDynVnbLE0YSVMuDzheZxfy0hnDiD6NcQGa',
  'R9Yr6wj5pXsvlTof4oeKdKxwVopvvmPqehJvEsHsy5Bo0B+i2BNwnuWnkF/SvFUJ',
  '6nOJsDKwuh+zcJWT57i+aeJminMQal8prRg+f/0v32BLJ7nVun9Kz3iLy5N7Cq2/',
  'iaLKQqU4DwKBgQDuIK+EuO8kvaLjMmTbz+3qIRG94zmEawOM4lLKYQLlAIS2a5zb',
  'ZEhP5WBLzpl4r3wDzvUeoxw3K1puGnstQLYL6ZLkW59kai08V1hY4KpNOjyWVSVT',
  'juEC6qgjOasMdjMAjN+M5cCYgwppnrI1JvVLaS4aBFaQiuslf18m6tbSAQKBgEwT',
  'NwfYvlvtMh3xO9WuMf48D0QWxraHRt9fwzKGQow1bYkgG9e/qoypxSB8onAjnST7',
  'HiiiExjzQ9b529GuO3pG+PAv/zwPPgMb9xqnm117H1Ge7egw8ucSQKGyrB3rnOdu',
  'lXmTnIqUWpd2X3k7P4rvv3bmYNpmINE8kUUm3LPVAoGBALofmrkfRT4YtMENbnHs',
  'p1BZWsStT3DhGU2Y+kYuSkJqYa6CSinMZoSptGhBzHOMgTluvhMwVvoGFE12s3DP',
  'HODdDbcOMhyH34buesM4uTaKjJHNKMFPHW+MOcvJivSCnmH6awMRgRixmuxpnBzp',
  '/OVQXbb/Xo/eQxI0eEBTxHGI',
  '-----END PRIVATE KEY-----',
].join('\n');

const TEST_TLS_CERT = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDJTCCAg2gAwIBAgIUINWwA0gdFWF/kVWwWoQrl+dXYMowDQYJKoZIhvcNAQEL',
  'BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MTEyMzA0NTMzM1oXDTM2MTEy',
  'MDA0NTMzM1owFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF',
  'AAOCAQ8AMIIBCgKCAQEA7Wr2/67yoP63Ck8o2XMQo8jQp5yp0l3XZVuTZmr0wW72',
  '3YFx7ePe2l62T2waFhUfFZ2SMM+IVkp5K/wWrZ9IA/Wster1TfK2MHSRiaxJy48V',
  '4lGhcd03qC3xQRonjjyqR0l1xctQ+K9TgAuB1Mqb27AN+3Kp4pChAVGcq9CkN27D',
  'bt971dl9JgwqnkRSmyphdbSfk85fWrMHZncgfcKajoZL+Wd2UJpFalFWcq29JWcW',
  'sm6tNmxUHo2C0xR4rnrJzDtPwHwQa0E2yPbrSjrPJ4WX/GSW+6CBbu6cZhb+EIz+',
  'yH2Fx9k/y0zcaK9zQFbAKlccSXIVjrr7b/YxvswlTwIDAQABo28wbTAdBgNVHQ4E',
  'FgQUbkXukpc+ilw3igPU5dqZ+8XPIrwwHwYDVR0jBBgwFoAUbkXukpc+ilw3igPU',
  '5dqZ+8XPIrwwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARhwR/AAABgglsb2Nh',
  'bGhvc3QwDQYJKoZIhvcNAQELBQADggEBAGE7u1UEvaWTObLrQF7rKivMt6cIfIxr',
  'P6FrTmew2jYaUc3t4SbY3Lrwe4q2oFAyF0wPBh99nQeqU1XnMS7nPIV1xQb7Bfjl',
  'ghsFdzs7SoAHbhkBXtIc2REJ0kQYreJEUMrIiTpIOvG0/ptglTXwr/mD/zVE2ba0',
  'UjXh4menmp0gRbmvhFhFoJACvly8JD41pLU2Ngn5PPNIBuyOKLXiA71mXY4EmpsV',
  '6pNr8osXuLA3daHat68RUhLHkA6tjPX1BNpLwUa/sLW4IeCO7/m4TgxRof5xunDv',
  'yPhLDn0njXceSfKj7K0T5/GaTS1E0P/IJF0NamFLDLzxKitgr5mF/W4=',
  '-----END CERTIFICATE-----',
].join('\n');

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
      contribution: { name: 'Zelle Guest', email: 'guest@example.com', amount: 120 },
      config,
      repository: mockRepo,
      isReservation: true,
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].html).toContain('open your bank&#39;s app');
    expect(fetchCalls[0].html).not.toContain('mailto:');
    expect(fetchCalls[0].html).not.toContain('tel:');

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

    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[1].html).toContain('https://cash.app/$happycouple/45.00');
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
