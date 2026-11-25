/** @jest-environment node */

import * as crypto from 'node:crypto';
import * as dns from 'node:dns';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { validateAndResolveHost } from '@/utils/ssrf';
import { isAllowedSmtpPort } from '@/utils/validationPrimitives';
import { MultiChannelMessagingProvider } from '../providers';
import {
  buildPinnedSmtpNetOptions,
  buildPinnedSmtpTlsOptions,
  createPinnedSmtpLookup,
} from '../providers/smtpSocket';

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
}

const PINNING_TEST_PKI = (() => {
  const caKeys = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const caCn = 'SMTP Pinning Test Root CA';
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
    subjectCn: 'smtp.public-mail.example',
    issuerCn: caCn,
    spkiDer: serverKeys.publicKey.export({ type: 'spki', format: 'der' }),
    issuerKey: caKeys.privateKey,
    serial: 2,
    isCa: false,
    dnsNames: ['smtp.public-mail.example', 'localhost'],
    ipv4: ['127.0.0.1'],
  });

  return {
    caCert,
    serverKey: serverKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    serverCert,
  };
})();

jest.mock('node:net', () => {
  const actualNet = jest.requireActual('node:net') as typeof import('node:net');
  return {
    ...actualNet,
    connect: jest.fn((...args: unknown[]) =>
      (actualNet.connect as (...a: unknown[]) => net.Socket)(...args)
    ),
  };
});

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
            ca: [...actualTls.rootCertificates, PINNING_TEST_PKI.caCert],
          },
          ...rest
        );
      }
      return (actualTls.connect as (...a: unknown[]) => tls.TLSSocket)(...args);
    }),
  };
});

jest.mock('@/utils/ssrf', () => {
  const actual = jest.requireActual('@/utils/ssrf') as typeof import('@/utils/ssrf');
  return {
    ...actual,
    validateAndResolveHost: jest.fn(actual.validateAndResolveHost),
  };
});

jest.mock('@/utils/validationPrimitives', () => {
  const actual = jest.requireActual(
    '@/utils/validationPrimitives'
  ) as typeof import('@/utils/validationPrimitives');
  return {
    ...actual,
    isAllowedSmtpPort: jest.fn(actual.isAllowedSmtpPort),
  };
});

const actualSsrf = jest.requireActual('@/utils/ssrf') as typeof import('@/utils/ssrf');
const actualValidation = jest.requireActual(
  '@/utils/validationPrimitives'
) as typeof import('@/utils/validationPrimitives');
const mockValidateAndResolveHost = validateAndResolveHost as jest.MockedFunction<
  typeof validateAndResolveHost
>;
const mockIsAllowedSmtpPort = isAllowedSmtpPort as jest.MockedFunction<typeof isAllowedSmtpPort>;

interface PinningSmtpServer {
  port: number;
  observedSni: string[];
  close: () => Promise<void>;
}

async function startPinningSmtpServer(options: { implicitTls: boolean }): Promise<PinningSmtpServer> {
  const observedSni: string[] = [];
  const secureContext = tls.createSecureContext({
    key: PINNING_TEST_PKI.serverKey,
    cert: PINNING_TEST_PKI.serverCert,
  });

  const attachDialogue = (sock: net.Socket | tls.TLSSocket, isTlsConn: boolean) => {
    let buffer = '';
    let inData = false;

    sock.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');

        if (inData) {
          if (line === '.') {
            inData = false;
            sock.write('250 2.0.0 Queued\r\n');
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO ') || upper.startsWith('HELO ')) {
          if (!isTlsConn) {
            sock.write('250-smtp.public-mail.example\r\n250-STARTTLS\r\n250 SIZE 1024000\r\n');
          } else {
            sock.write('250-smtp.public-mail.example\r\n250 SIZE 1024000\r\n');
          }
        } else if (upper === 'STARTTLS' && !isTlsConn) {
          sock.removeAllListeners('data');
          sock.write('220 2.0.0 Ready to start TLS\r\n', () => {
            const tlsSock = new tls.TLSSocket(sock, {
              isServer: true,
              key: PINNING_TEST_PKI.serverKey,
              cert: PINNING_TEST_PKI.serverCert,
              SNICallback: (servername, cb) => {
                observedSni.push(servername);
                cb(null, secureContext);
              },
            });
            attachDialogue(tlsSock, true);
          });
        } else if (upper.startsWith('MAIL FROM:')) {
          sock.write('250 2.1.0 OK\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          sock.write('250 2.1.5 OK\r\n');
        } else if (upper === 'DATA') {
          inData = true;
          sock.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (upper === 'QUIT') {
          sock.write('221 2.0.0 Bye\r\n', () => sock.end());
        } else {
          sock.write('500 Unknown command\r\n');
        }
      }
    });
  };

  const server = options.implicitTls
    ? tls.createServer(
      {
        key: PINNING_TEST_PKI.serverKey,
        cert: PINNING_TEST_PKI.serverCert,
        SNICallback: (servername, cb) => {
          observedSni.push(servername);
          cb(null, secureContext);
        },
      },
      (tlsSock) => {
        attachDialogue(tlsSock, true);
        tlsSock.write('220 smtp.public-mail.example ESMTP\r\n');
      }
    )
    : net.createServer((sock) => {
      attachDialogue(sock, false);
      sock.write('220 smtp.public-mail.example ESMTP\r\n');
    });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  return {
    port,
    observedSni,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

describe('SMTP socket IP pinning & binary CIDR SSRF guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateAndResolveHost.mockImplementation(actualSsrf.validateAndResolveHost);
    mockIsAllowedSmtpPort.mockImplementation(actualValidation.isAllowedSmtpPort);
  });

  describe('createPinnedSmtpLookup & option builders', () => {
    it('returns the pre-validated IP and family for both single-address and { all: true } lookup modes', () => {
      const lookupV4 = createPinnedSmtpLookup('93.184.216.34', 4);
      let singleResult: {
        err: NodeJS.ErrnoException | null;
        address: string | dns.LookupAddress[];
        family?: number;
      } | null = null;
      lookupV4('smtp.public-mail.example', {}, (err, address, family) => {
        singleResult = { err, address, family };
      });
      expect(singleResult).toEqual({ err: null, address: '93.184.216.34', family: 4 });

      let allResult: {
        err: NodeJS.ErrnoException | null;
        addresses: string | dns.LookupAddress[];
      } | null = null;
      const lookupV6 = createPinnedSmtpLookup('2606:4700:4700::1111', 6);
      lookupV6('smtp.public-mail.example', { all: true }, (err, addresses) => {
        allResult = { err, addresses };
      });
      expect(allResult).toEqual({
        err: null,
        addresses: [{ address: '2606:4700:4700::1111', family: 6 }],
      });

      const netOpts = buildPinnedSmtpNetOptions({
        resolved: { address: '93.184.216.34', family: 4 },
        port: 587,
      });
      expect(netOpts.host).toBe('93.184.216.34');
      expect(netOpts.port).toBe(587);
      expect(netOpts.family).toBe(4);
      expect(typeof netOpts.lookup).toBe('function');

      const tlsOpts = buildPinnedSmtpTlsOptions({
        resolved: { address: '2606:4700:4700::1111', family: 6 },
        port: 465,
        servername: 'smtp.public-mail.example',
        rejectUnauthorized: true,
      });
      expect(tlsOpts.host).toBe('2606:4700:4700::1111');
      expect(tlsOpts.port).toBe(465);
      expect(tlsOpts.family).toBe(6);
      expect(tlsOpts.servername).toBe('smtp.public-mail.example');
      expect(tlsOpts.rejectUnauthorized).toBe(true);
      expect(typeof tlsOpts.lookup).toBe('function');
    });
  });

  describe('MultiChannelMessagingProvider non-canonical SSRF rejection & socket pinning', () => {
    it('blocks non-canonical IPv6, NAT64, transitional IPv6, and benchmarking hosts before opening sockets', async () => {
      const netConnectMock = net.connect as unknown as jest.Mock;
      const tlsConnectMock = tls.connect as unknown as jest.Mock;

      for (const blockedHost of [
        '0:0:0:0:0:0:0:1',
        '[0:0:0:0:0:ffff:127.0.0.1]',
        '0:0:0:0:0:ffff:169.254.169.254',
        '64:ff9b::a9fe:a9fe',
        '::7f00:1',
        '198.18.0.1',
      ]) {
        const provider = new MultiChannelMessagingProvider({
          emailProvider: 'smtp',
          smtpHost: blockedHost,
          smtpPort: 587,
          smtpSecure: false,
          emailFromAddress: 'couple@wedding.test',
        });

        const sendResult = await provider.sendEmail({
          to: 'guest@example.com',
          subject: 'Save the Date',
          body: 'Hello!',
        });
        expect(sendResult.success).toBe(false);
        expect(sendResult.error).toContain('Blocked: URL resolves to a private or restricted IP address');

        const testResult = await provider.testConnection({ type: 'email', provider: 'smtp' });
        expect(testResult.success).toBe(false);
        expect(testResult.error).toContain('Blocked: URL resolves to a private or restricted IP address');
      }

      expect(netConnectMock).not.toHaveBeenCalled();
      expect(tlsConnectMock).not.toHaveBeenCalled();
    });

    it('pins net.connect and STARTTLS upgrade to the resolved IP with family and strict TLS SNI verification', async () => {
      const server = await startPinningSmtpServer({ implicitTls: false });
      try {
        mockValidateAndResolveHost.mockResolvedValue({ address: '127.0.0.1', family: 4 });
        mockIsAllowedSmtpPort.mockImplementation(
          (port: number) => actualValidation.isAllowedSmtpPort(port) || port === server.port
        );

        const provider = new MultiChannelMessagingProvider({
          emailProvider: 'smtp',
          smtpHost: 'smtp.public-mail.example',
          smtpPort: server.port,
          smtpSecure: false,
          emailFromAddress: 'couple@wedding.test',
        });

        const res = await provider.sendEmail({
          to: 'guest@example.com',
          subject: 'Pinned STARTTLS',
          body: 'Welcome!',
        });
        expect(res.success).toBe(true);

        const netConnectCalls = (net.connect as unknown as jest.Mock).mock.calls;
        expect(netConnectCalls).toHaveLength(1);
        const [netOpts] = netConnectCalls[0] as [net.TcpSocketConnectOpts];
        expect(netOpts.host).toBe('127.0.0.1');
        expect(netOpts.port).toBe(server.port);
        expect(netOpts.family).toBe(4);
        expect(typeof netOpts.lookup).toBe('function');

        const tlsConnectCalls = (tls.connect as unknown as jest.Mock).mock.calls;
        expect(tlsConnectCalls).toHaveLength(1);
        const [upgradeOpts] = tlsConnectCalls[0] as [tls.ConnectionOptions];
        expect(upgradeOpts.socket).toBeInstanceOf(net.Socket);
        expect(upgradeOpts.host).toBe('smtp.public-mail.example');
        expect(upgradeOpts.servername).toBe('smtp.public-mail.example');
        expect(upgradeOpts.rejectUnauthorized).toBe(true);
        expect(server.observedSni).toEqual(['smtp.public-mail.example']);
      } finally {
        await server.close();
      }
    });

    it('pins implicit SMTPS tls.connect to the resolved IP, family, custom lookup, and strict TLS SNI', async () => {
      const server = await startPinningSmtpServer({ implicitTls: true });
      try {
        mockValidateAndResolveHost.mockResolvedValue({ address: '127.0.0.1', family: 4 });
        mockIsAllowedSmtpPort.mockImplementation(
          (port: number) => actualValidation.isAllowedSmtpPort(port) || port === server.port
        );

        const provider = new MultiChannelMessagingProvider({
          emailProvider: 'smtp',
          smtpHost: 'smtp.public-mail.example',
          smtpPort: server.port,
          smtpSecure: true,
          emailFromAddress: 'couple@wedding.test',
        });

        const res = await provider.testConnection({ type: 'email', provider: 'smtp' });
        expect(res.success).toBe(true);

        const tlsConnectCalls = (tls.connect as unknown as jest.Mock).mock.calls;
        expect(tlsConnectCalls).toHaveLength(1);
        const [tlsOpts] = tlsConnectCalls[0] as [tls.ConnectionOptions & { family?: number }];
        expect(tlsOpts.host).toBe('127.0.0.1');
        expect(tlsOpts.port).toBe(server.port);
        expect(tlsOpts.family).toBe(4);
        expect(typeof tlsOpts.lookup).toBe('function');
        expect(tlsOpts.servername).toBe('smtp.public-mail.example');
        expect(tlsOpts.rejectUnauthorized).toBe(true);
        expect(server.observedSni).toEqual(['smtp.public-mail.example']);
      } finally {
        await server.close();
      }
    });
  });
});
