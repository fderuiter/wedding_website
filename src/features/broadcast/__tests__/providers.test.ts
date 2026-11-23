/** @jest-environment node */

import * as dns from 'node:dns';
import * as net from 'node:net';
import * as tls from 'node:tls';
import { validateAndResolveHost } from '@/utils/ssrf';
import { isAllowedSmtpPort } from '@/utils/validationPrimitives';
import { UpdateAppConfigSchema } from '@/features/content';
import { MultiChannelMessagingProvider, formatEmailHtmlBody } from '../providers';
import { TestConnectionSchema } from '../schemas';

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

function allowLoopbackTestTarget(ephemeralPort: number, resolvedIp = '127.0.0.1'): void {
  mockValidateAndResolveHost.mockResolvedValue({ address: resolvedIp, family: 4 });
  mockIsAllowedSmtpPort.mockImplementation(
    (port: number) => actualValidationPrimitives.isAllowedSmtpPort(port) || port === ephemeralPort
  );
}

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

interface MockSmtpServerOptions {
  implicitTls?: boolean;
  advertiseStartTls?: boolean;
  authMode?: 'NONE' | 'PLAIN' | 'LOGIN';
  expectedUser?: string;
  expectedPass?: string;
  hangAfterConnect?: boolean;
  greetingLine?: string;
  ehloRejectLine?: string;
  startTlsRejectLine?: string;
  authLoginStep1Line?: string;
  mailFromRejectLine?: string;
  rcptToRejectLine?: string;
  dataRejectLine?: string;
  queuedRejectLine?: string;
}

interface RunningSmtpServer {
  port: number;
  commands: string[];
  receivedMessages: string[];
  observedServernames: string[];
  upgradedToTls: () => boolean;
  close: () => Promise<void>;
}

async function startTestSmtpServer(options: MockSmtpServerOptions = {}): Promise<RunningSmtpServer> {
  const {
    implicitTls = false,
    advertiseStartTls = false,
    authMode = 'NONE',
    expectedUser = 'mailer@wedding.test',
    expectedPass = 's3cret-pass',
    hangAfterConnect = false,
    greetingLine,
    ehloRejectLine,
    startTlsRejectLine,
    authLoginStep1Line,
    mailFromRejectLine,
    rcptToRejectLine,
    dataRejectLine,
    queuedRejectLine,
  } = options;

  const commands: string[] = [];
  const receivedMessages: string[] = [];
  const observedServernames: string[] = [];
  let didUpgradeTls = implicitTls;
  const secureContext = tls.createSecureContext({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT });

  const attachProtocol = (sock: net.Socket | tls.TLSSocket, isTlsConn: boolean) => {
    let buffer = '';
    let state: 'COMMAND' | 'AUTH_LOGIN_USER' | 'AUTH_LOGIN_PASS' | 'DATA' = 'COMMAND';
    let loginUser = '';
    let dataBuffer = '';

    const processLine = (line: string) => {
      if (state === 'DATA') {
        if (line === '.') {
          receivedMessages.push(dataBuffer);
          dataBuffer = '';
          state = 'COMMAND';
          sock.write(`${queuedRejectLine || '250 2.0.0 Queued'}\r\n`);
        } else {
          const unstuffed = line.startsWith('..') ? line.slice(1) : line;
          dataBuffer += `${unstuffed}\r\n`;
        }
        return;
      }

      commands.push(line);

      if (state === 'AUTH_LOGIN_USER') {
        loginUser = Buffer.from(line.trim(), 'base64').toString('utf8');
        state = 'AUTH_LOGIN_PASS';
        sock.write('334 UGFzc3dvcmQ6\r\n');
        return;
      }

      if (state === 'AUTH_LOGIN_PASS') {
        const loginPass = Buffer.from(line.trim(), 'base64').toString('utf8');
        state = 'COMMAND';
        if (loginUser === expectedUser && loginPass === expectedPass) {
          sock.write('235 2.7.0 Authentication successful\r\n');
        } else {
          sock.write('535 5.7.8 Authentication credentials invalid\r\n');
        }
        return;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith('EHLO ') || upper.startsWith('HELO ')) {
        if (ehloRejectLine) {
          sock.write(`${ehloRejectLine}\r\n`);
          return;
        }
        const caps: string[] = ['250-127.0.0.1 Hello'];
        if (advertiseStartTls && !isTlsConn) {
          caps.push('250-STARTTLS');
        }
        if (authMode === 'PLAIN' && (isTlsConn || !advertiseStartTls)) {
          caps.push('250-AUTH PLAIN LOGIN');
        } else if (authMode === 'LOGIN' && (isTlsConn || !advertiseStartTls)) {
          caps.push('250-AUTH LOGIN');
        }
        caps.push('250 SIZE 10485760');
        sock.write(`${caps.join('\r\n')}\r\n`);
        return;
      }

      if (upper === 'STARTTLS' && advertiseStartTls && !isTlsConn) {
        if (startTlsRejectLine) {
          sock.write(`${startTlsRejectLine}\r\n`);
          return;
        }
        sock.removeAllListeners('data');
        sock.write('220 2.0.0 Ready to start TLS\r\n', () => {
          const tlsSock = new tls.TLSSocket(sock, {
            isServer: true,
            key: TEST_TLS_KEY,
            cert: TEST_TLS_CERT,
            SNICallback: (servername, cb) => {
              observedServernames.push(servername);
              cb(null, secureContext);
            },
          });
          didUpgradeTls = true;
          attachProtocol(tlsSock, true);
        });
        return;
      }

      if (upper.startsWith('AUTH PLAIN ')) {
        const token = line.slice('AUTH PLAIN '.length).trim();
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const parts = decoded.split('\0');
        const user = parts[1] || '';
        const pass = parts[2] || '';
        if (user === expectedUser && pass === expectedPass) {
          sock.write('235 2.7.0 Authentication successful\r\n');
        } else {
          sock.write('535 5.7.8 Authentication credentials invalid\r\n');
        }
        return;
      }

      if (upper === 'AUTH LOGIN') {
        if (authLoginStep1Line) {
          sock.write(`${authLoginStep1Line}\r\n`);
          return;
        }
        state = 'AUTH_LOGIN_USER';
        sock.write('334 VXNlcm5hbWU6\r\n');
        return;
      }

      if (upper.startsWith('MAIL FROM:')) {
        sock.write(`${mailFromRejectLine || '250 2.1.0 Sender OK'}\r\n`);
        return;
      }

      if (upper.startsWith('RCPT TO:')) {
        sock.write(`${rcptToRejectLine || '250 2.1.5 Recipient OK'}\r\n`);
        return;
      }

      if (upper === 'DATA') {
        if (dataRejectLine) {
          sock.write(`${dataRejectLine}\r\n`);
          return;
        }
        state = 'DATA';
        sock.write('354 Start mail input; end with <CRLF>.<CRLF>\r\n');
        return;
      }

      if (upper === 'QUIT') {
        sock.write('221 2.0.0 Bye\r\n', () => sock.end());
        return;
      }

      sock.write('500 Unrecognized command\r\n');
    };

    sock.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        let line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }
        processLine(line);
        idx = buffer.indexOf('\n');
      }
    });
  };

  const activeSockets = new Set<net.Socket>();
  const server = implicitTls
    ? tls.createServer(
      {
        key: TEST_TLS_KEY,
        cert: TEST_TLS_CERT,
        SNICallback: (servername, cb) => {
          observedServernames.push(servername);
          cb(null, secureContext);
        },
      },
      (tlsSock) => {
        activeSockets.add(tlsSock);
        tlsSock.on('close', () => activeSockets.delete(tlsSock));
        if (!hangAfterConnect) {
          tlsSock.write(`${greetingLine || '220 127.0.0.1 ESMTP Implicit TLS Ready'}\r\n`);
          attachProtocol(tlsSock, true);
        }
      }
    )
    : net.createServer((sock) => {
      activeSockets.add(sock);
      sock.on('close', () => activeSockets.delete(sock));
      if (!hangAfterConnect) {
        sock.write(`${greetingLine || '220 127.0.0.1 ESMTP Ready'}\r\n`);
        attachProtocol(sock, false);
      }
    });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as net.AddressInfo;

  return {
    port: addr.port,
    commands,
    receivedMessages,
    observedServernames,
    upgradedToTls: () => didUpgradeTls,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of activeSockets) {
          s.destroy();
        }
        server.close(() => resolve());
      }),
  };
}

describe('MultiChannelMessagingProvider', () => {
  afterEach(() => {
    mockValidateAndResolveHost.mockClear();
    mockIsAllowedSmtpPort.mockClear();
    mockValidateAndResolveHost.mockImplementation(actualSsrf.validateAndResolveHost);
    mockIsAllowedSmtpPort.mockImplementation(actualValidationPrimitives.isAllowedSmtpPort);
  });

  it('returns failure when recipient email is missing', async () => {
    const provider = new MultiChannelMessagingProvider({ emailProvider: 'smtp' });
    const result = await provider.sendEmail({ to: '', subject: 'Test', body: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing');
  });

  it('returns failure when recipient phone is missing', async () => {
    const provider = new MultiChannelMessagingProvider({ smsProvider: 'twilio' });
    const result = await provider.sendSms({ to: '', body: 'Test SMS' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing');
  });

  it('returns { success: false } when emailProvider is smtp and smtpHost is empty or blank while keeping simulation mode for emailProvider none', async () => {
    const emptyHostProvider = new MultiChannelMessagingProvider({
      emailProvider: 'smtp',
      smtpHost: '   ',
    });
    const smtpRes = await emptyHostProvider.sendEmail({
      to: 'guest@example.com',
      subject: 'Welcome',
      body: 'Hello guest',
    });
    expect(smtpRes.success).toBe(false);
    expect(smtpRes.error).toMatch(/SMTP Host is missing/i);

    const simulationProvider = new MultiChannelMessagingProvider({
      emailProvider: 'none',
      smtpHost: '',
    });
    const simRes = await simulationProvider.sendEmail({
      to: 'guest@example.com',
      subject: 'Welcome',
      body: 'Hello guest',
    });
    expect(simRes).toEqual({ success: true });
  });

  it('validates Resend API key presence', async () => {
    const provider = new MultiChannelMessagingProvider({
      emailProvider: 'resend',
      resendApiKey: '',
    });
    const result = await provider.sendEmail({
      to: 'guest@example.com',
      subject: 'Welcome',
      body: 'Hello',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Resend API Key is missing');
  });

  it('sends multipart text/plain + text/html MIME mail over STARTTLS + AUTH PLAIN with CRLF header sanitization and RFC 5321 dot-stuffing', async () => {
    const smtpServer = await startTestSmtpServer({
      advertiseStartTls: true,
      authMode: 'PLAIN',
      expectedUser: 'mailer@wedding.test',
      expectedPass: 's3cret-pass',
    });
    allowLoopbackTestTarget(smtpServer.port);

    try {
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: smtpServer.port,
        smtpSecure: false,
        smtpUser: 'mailer@wedding.test',
        smtpPass: 's3cret-pass',
        smtpFrom: 'Sarah & Dan\r\nBcc: leak@evil.invalid <couple@wedding.test>',
        smtpRejectUnauthorized: false,
      });

      const bodyWithLeadingDot =
        'Hello Alice,\n.leading-dot line must be stuffed\n..double-dot line\nSee you soon!';

      const result = await provider.sendEmail({
        to: 'Alice\r\nCc: injected@evil.invalid <guest@example.com>',
        subject: 'Wedding Invite\r\nX-Injected: bad',
        body: bodyWithLeadingDot,
      });

      expect(result).toEqual({ success: true });
      expect(smtpServer.upgradedToTls()).toBe(true);
      expect(smtpServer.commands).toEqual(
        expect.arrayContaining([
          'STARTTLS',
          expect.stringMatching(/^AUTH PLAIN /),
          'MAIL FROM:<couple@wedding.test>',
          'RCPT TO:<guest@example.com>',
          'QUIT',
        ])
      );
      expect(smtpServer.receivedMessages).toHaveLength(1);

      const rawMime = smtpServer.receivedMessages[0];
      expect(rawMime).toContain('MIME-Version: 1.0');
      expect(rawMime).toContain('Content-Type: multipart/alternative;');
      expect(rawMime).toContain('Content-Type: text/plain; charset="utf-8"');
      expect(rawMime).toContain('Content-Type: text/html; charset="utf-8"');
      // Header CRLF injection stripped onto single header lines
      expect(rawMime).not.toMatch(/\r\nX-Injected:/i);
      expect(rawMime).not.toMatch(/\r\nBcc:/i);
      expect(rawMime).not.toMatch(/\r\nCc:/i);
      // RFC 5321 dot-stuffing preserved leading dots cleanly through server unstuffing
      expect(rawMime).toContain('\r\n.leading-dot line must be stuffed\r\n');
      expect(rawMime).toContain('\r\n..double-dot line\r\n');

      // Raw malformed envelope injection without angle-bracket address is rejected outright
      const malformedRes = await provider.sendEmail({
        to: 'guest@example.com\r\nCc: injected@evil.invalid',
        subject: 'Rejected',
        body: 'Rejected',
      });
      expect(malformedRes.success).toBe(false);
    } finally {
      await smtpServer.close();
    }
  });

  it('supports implicit TLS (smtpSecure: true / port 465 semantics) and AUTH LOGIN', async () => {
    const tlsServer = await startTestSmtpServer({
      implicitTls: true,
      authMode: 'LOGIN',
      expectedUser: 'login-user@wedding.test',
      expectedPass: 'login-pass-465',
    });
    allowLoopbackTestTarget(tlsServer.port);

    try {
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: tlsServer.port,
        smtpSecure: true,
        smtpUser: 'login-user@wedding.test',
        smtpPass: 'login-pass-465',
        smtpFrom: 'couple@wedding.test',
        smtpRejectUnauthorized: false,
      });

      const sendRes = await provider.sendEmail({
        to: 'guest@example.com',
        subject: 'Port 465 Implicit TLS',
        body: 'Welcome over implicit TLS!',
      });

      expect(sendRes).toEqual({ success: true });
      expect(tlsServer.commands).toContain('AUTH LOGIN');
      expect(tlsServer.receivedMessages).toHaveLength(1);
    } finally {
      await tlsServer.close();
    }
  });

  it('verifies live SMTP greetings, STARTTLS, AUTH credentials, and QUIT in testConnection and rejects bad credentials or closed ports', async () => {
    const smtpServer = await startTestSmtpServer({
      advertiseStartTls: true,
      authMode: 'PLAIN',
      expectedUser: 'mailer@wedding.test',
      expectedPass: 'valid-secret',
    });
    allowLoopbackTestTarget(smtpServer.port);

    try {
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: smtpServer.port,
        smtpUser: 'mailer@wedding.test',
        smtpPass: 'valid-secret',
        smtpRejectUnauthorized: false,
      });

      // Valid live connection + stored secret fallback when input smtpPass is blank
      const okRes = await provider.testConnection({
        type: 'email',
        provider: 'smtp',
        smtpPass: '   ',
      });
      expect(okRes).toEqual({ success: true });
      expect(smtpServer.upgradedToTls()).toBe(true);
      expect(smtpServer.commands).toContain('QUIT');

      // Invalid SMTP password -> server returns 535 -> testConnection fails
      const badAuthRes = await provider.testConnection({
        type: 'email',
        provider: 'smtp',
        smtpPass: 'wrong-password',
      });
      expect(badAuthRes.success).toBe(false);
      expect(badAuthRes.error).toMatch(/authentication failed \(535\)/i);
    } finally {
      await smtpServer.close();
    }

    // Closed port -> connection refused -> testConnection fails
    allowLoopbackTestTarget(smtpServer.port);
    const closedProvider = new MultiChannelMessagingProvider({
      emailProvider: 'smtp',
      smtpRejectUnauthorized: false,
      smtpTimeoutMs: 1000,
    });
    const closedRes = await closedProvider.testConnection({
      type: 'email',
      provider: 'smtp',
      smtpHost: '127.0.0.1',
      smtpPort: smtpServer.port,
    });
    expect(closedRes.success).toBe(false);
  });

  it('enforces socket timeout when an SMTP server hangs without greeting', async () => {
    const hangingServer = await startTestSmtpServer({ hangAfterConnect: true });
    allowLoopbackTestTarget(hangingServer.port);
    try {
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: hangingServer.port,
        smtpTimeoutMs: 150,
      });

      const res = await provider.sendEmail({
        to: 'guest@example.com',
        subject: 'Timeout Check',
        body: 'Should time out cleanly',
      });
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/timed out/i);
    } finally {
      await hangingServer.close();
    }
  });

  it('tests sms connection error when Twilio credentials missing', async () => {
    const provider = new MultiChannelMessagingProvider({});
    const res = await provider.testConnection({ type: 'sms' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Twilio Account SID');
  });

  it('keeps stored secrets in testConnection when password inputs are blank or whitespace', async () => {
    const resendProvider = new MultiChannelMessagingProvider({
      emailProvider: 'resend',
      resendApiKey: 're_stored_key',
    });
    expect(await resendProvider.testConnection({ type: 'email', provider: 'resend', resendApiKey: '' })).toEqual({
      success: true,
    });
    expect(await resendProvider.testConnection({ type: 'email', provider: 'resend', resendApiKey: '   ' })).toEqual({
      success: true,
    });

    const sendgridProvider = new MultiChannelMessagingProvider({
      emailProvider: 'sendgrid',
      sendgridApiKey: 'SG.stored_key',
    });
    expect(await sendgridProvider.testConnection({ type: 'email', provider: 'sendgrid', sendgridApiKey: '' })).toEqual({
      success: true,
    });

    const twilioProvider = new MultiChannelMessagingProvider({
      smsProvider: 'twilio',
      twilioAccountSid: 'AC12345',
      twilioAuthToken: 'stored-twilio-token',
    });
    expect(await twilioProvider.testConnection({ type: 'sms', twilioAuthToken: '' })).toEqual({
      success: true,
    });
  });

  it('blocks SSRF targets (loopback, link-local metadata, private DNS records) and pins sockets while preserving SNI servername', async () => {
    const lookupSpy = jest.spyOn(dns.promises, 'lookup');
    try {
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpPort: 587,
      });

      for (const blockedHost of ['127.0.0.1', '169.254.169.254', '10.0.0.8', '[::1]']) {
        const res = await provider.testConnection({
          type: 'email',
          provider: 'smtp',
          smtpHost: blockedHost,
          smtpPort: 587,
        });
        expect(res.success).toBe(false);
        expect(res.error).toMatch(/private or restricted IP/i);
      }

      lookupSpy.mockResolvedValueOnce([{ address: '192.168.1.25', family: 4 }] as any);
      const privateDnsRes = await provider.testConnection({
        type: 'email',
        provider: 'smtp',
        smtpHost: 'internal-relay.wedding.example',
        smtpPort: 587,
      });
      expect(privateDnsRes.success).toBe(false);
      expect(privateDnsRes.error).toMatch(/private or restricted IP/i);
    } finally {
      lookupSpy.mockRestore();
    }

    // Verify socket connects to pinned IP while sending original domain in TLS SNI for both STARTTLS and implicit TLS
    const startTlsServer = await startTestSmtpServer({
      advertiseStartTls: true,
      authMode: 'PLAIN',
      expectedUser: 'mailer@wedding.test',
      expectedPass: 'sni-secret',
    });
    try {
      allowLoopbackTestTarget(startTlsServer.port, '127.0.0.1');
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: 'smtp.mailgun.org',
        smtpPort: startTlsServer.port,
        smtpSecure: false,
        smtpUser: 'mailer@wedding.test',
        smtpPass: 'sni-secret',
        smtpRejectUnauthorized: false,
      });
      const res = await provider.testConnection({ type: 'email', provider: 'smtp' });
      expect(res).toEqual({ success: true });
      expect(mockValidateAndResolveHost).toHaveBeenCalledWith('smtp.mailgun.org');
      expect(startTlsServer.observedServernames).toContain('smtp.mailgun.org');
    } finally {
      await startTlsServer.close();
    }

    const implicitTlsServer = await startTestSmtpServer({
      implicitTls: true,
      authMode: 'PLAIN',
      expectedUser: 'mailer@wedding.test',
      expectedPass: 'sni-secret',
    });
    try {
      allowLoopbackTestTarget(implicitTlsServer.port, '127.0.0.1');
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: 'smtp.sendgrid.net',
        smtpPort: implicitTlsServer.port,
        smtpSecure: true,
        smtpUser: 'mailer@wedding.test',
        smtpPass: 'sni-secret',
        smtpRejectUnauthorized: false,
      });
      const res = await provider.testConnection({ type: 'email', provider: 'smtp' });
      expect(res).toEqual({ success: true });
      expect(mockValidateAndResolveHost).toHaveBeenCalledWith('smtp.sendgrid.net');
      expect(implicitTlsServer.observedServernames).toContain('smtp.sendgrid.net');
    } finally {
      await implicitTlsServer.close();
    }
  });

  it('restricts smtpPort to standard submission ports (25, 465, 587, 2525) across schemas and provider methods', async () => {
    for (const validPort of [25, 465, 587, 2525]) {
      expect(
        TestConnectionSchema.safeParse({ type: 'email', provider: 'smtp', smtpPort: validPort })
          .success
      ).toBe(true);
    }

    for (const disallowedPort of [0, 1, 22, 80, 443, 6379, 8080, 65535]) {
      expect(
        TestConnectionSchema.safeParse({
          type: 'email',
          provider: 'smtp',
          smtpPort: disallowedPort,
        }).success
      ).toBe(false);

      const badConfigParse = UpdateAppConfigSchema.safeParse({
        partner1Name: 'A',
        partner2Name: 'B',
        weddingDate: '2026-06-20T00:00:00.000Z',
        baseUrl: 'https://example.com',
        venueName: 'Venue',
        venueAddress: '123 St',
        venueCity: 'City',
        venueState: 'ST',
        venueZip: '12345',
        latitude: 40,
        longitude: -70,
        storyText: '',
        venueDescription: '',
        travelAdvice: '',
        heroTitle: '',
        heroSubtitle: '',
        seoTitle: '',
        seoDescription: '',
        faviconUrl: '/favicon.ico',
        ogImageUrl: '/og.jpg',
        seoKeywords: '',
        smtpPort: disallowedPort,
      });
      expect(badConfigParse.success).toBe(false);

      const sendProvider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: 'smtp.mailgun.org',
        smtpPort: disallowedPort,
      });
      const sendRes = await sendProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'Port Limit',
        body: 'Blocked port',
      });
      expect(sendRes.success).toBe(false);
      expect(sendRes.error).toMatch(/25, 465, 587, or 2525/);

      const testRes = await sendProvider.testConnection({
        type: 'email',
        provider: 'smtp',
        smtpHost: 'smtp.mailgun.org',
        smtpPort: disallowedPort,
      });
      expect(testRes.success).toBe(false);
      expect(testRes.error).toMatch(/25, 465, 587, or 2525/);
      expect(mockValidateAndResolveHost).not.toHaveBeenCalled();
    }
  });

  it('strips raw server banners and response text from SMTP error messages', async () => {
    // 1. Non-SMTP protocol banner (e.g., SSH banner) -> must not leak raw line
    const sshBannerServer = await startTestSmtpServer({
      greetingLine: 'SSH-2.0-OpenSSH_9.6p1 SecretInternalBanner',
    });
    try {
      allowLoopbackTestTarget(sshBannerServer.port);
      const provider = new MultiChannelMessagingProvider({ emailProvider: 'smtp' });
      const res = await provider.testConnection({
        type: 'email',
        provider: 'smtp',
        smtpHost: 'smtp.example.org',
        smtpPort: sshBannerServer.port,
      });
      expect(res.success).toBe(false);
      expect(res.error).toBe('Invalid SMTP server response');
      expect(res.error).not.toContain('OpenSSH');
      expect(res.error).not.toContain('SecretInternalBanner');
    } finally {
      await sshBannerServer.close();
    }

    // 2. Non-220 SMTP greeting -> returns status code only without banner text
    const greetingErrServer = await startTestSmtpServer({
      greetingLine: '554 InternalHost-Banner-Secret Service unavailable',
    });
    try {
      allowLoopbackTestTarget(greetingErrServer.port);
      const provider = new MultiChannelMessagingProvider({ emailProvider: 'smtp' });
      const res = await provider.testConnection({
        type: 'email',
        provider: 'smtp',
        smtpHost: 'smtp.example.org',
        smtpPort: greetingErrServer.port,
      });
      expect(res).toEqual({
        success: false,
        error: 'Unexpected SMTP greeting (554)',
      });
    } finally {
      await greetingErrServer.close();
    }

    // 3. AUTH LOGIN & MAIL FROM rejections -> status code only without server message text
    const authRejectServer = await startTestSmtpServer({
      implicitTls: true,
      authMode: 'LOGIN',
      authLoginStep1Line: '503 InternalAuthBannerLeak bad sequence',
    });
    try {
      allowLoopbackTestTarget(authRejectServer.port);
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: 'smtp.example.org',
        smtpPort: authRejectServer.port,
        smtpSecure: true,
        smtpUser: 'mailer@wedding.test',
        smtpPass: 'secret',
        smtpRejectUnauthorized: false,
      });
      const res = await provider.testConnection({ type: 'email', provider: 'smtp' });
      expect(res).toEqual({
        success: false,
        error: 'SMTP AUTH LOGIN rejected (503)',
      });
      expect(res.error).not.toContain('InternalAuthBannerLeak');
    } finally {
      await authRejectServer.close();
    }

    const mailRejectServer = await startTestSmtpServer({
      implicitTls: true,
      mailFromRejectLine: '550 5.7.1 InternalPolicySecret sender blocked',
    });
    try {
      allowLoopbackTestTarget(mailRejectServer.port);
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: 'smtp.example.org',
        smtpPort: mailRejectServer.port,
        smtpSecure: true,
        smtpRejectUnauthorized: false,
      });
      const res = await provider.sendEmail({
        to: 'guest@example.com',
        subject: 'Banner Check',
        body: 'Hello',
      });
      expect(res).toEqual({
        success: false,
        error: 'SMTP MAIL FROM rejected (550)',
      });
      expect(res.error).not.toContain('InternalPolicySecret');
    } finally {
      await mailRejectServer.close();
    }
  });

  it('binds stored smtpPass fallback in testConnection to a blank or matching normalized smtpHost', async () => {
    const smtpServer = await startTestSmtpServer({
      advertiseStartTls: true,
      authMode: 'PLAIN',
      expectedUser: 'mailer@wedding.test',
      expectedPass: 'bound-stored-secret',
    });

    try {
      allowLoopbackTestTarget(smtpServer.port);
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: 'smtp.mailgun.org',
        smtpPort: smtpServer.port,
        smtpUser: 'mailer@wedding.test',
        smtpPass: 'bound-stored-secret',
        smtpRejectUnauthorized: false,
      });

      // Different smtpHost with blank smtpPass must NOT reuse stored smtpPass or connect
      const mismatchRes = await provider.testConnection({
        type: 'email',
        provider: 'smtp',
        smtpHost: 'evil-collector.example.net',
        smtpPort: smtpServer.port,
        smtpPass: '',
      });
      expect(mismatchRes).toEqual({
        success: false,
        error: 'SMTP Password required',
      });
      expect(smtpServer.commands).toHaveLength(0);

      // Matching normalized smtpHost (case/whitespace differences) reuses stored smtpPass
      const matchingHostRes = await provider.testConnection({
        type: 'email',
        provider: 'smtp',
        smtpHost: '  SMTP.MAILGUN.ORG  ',
        smtpPort: smtpServer.port,
        smtpPass: '   ',
      });
      expect(matchingHostRes).toEqual({ success: true });
    } finally {
      await smtpServer.close();
    }
  });

  it('requires implicit TLS or STARTTLS before sending AUTH PLAIN / AUTH LOGIN while allowing unauthenticated relays', async () => {
    const cleartextServer = await startTestSmtpServer({
      implicitTls: false,
      advertiseStartTls: false,
      authMode: 'PLAIN',
      expectedUser: 'mailer@wedding.test',
      expectedPass: 'never-send-in-cleartext',
    });

    try {
      allowLoopbackTestTarget(cleartextServer.port);

      // Authenticated session on cleartext server without STARTTLS must abort before AUTH
      const authedProvider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: 'relay.example.org',
        smtpPort: cleartextServer.port,
        smtpSecure: false,
        smtpUser: 'mailer@wedding.test',
        smtpPass: 'never-send-in-cleartext',
      });

      const testRes = await authedProvider.testConnection({
        type: 'email',
        provider: 'smtp',
      });
      expect(testRes.success).toBe(false);
      expect(testRes.error).toMatch(/TLS or STARTTLS is required before authentication/i);
      expect(cleartextServer.commands.some((cmd) => cmd.toUpperCase().startsWith('AUTH'))).toBe(
        false
      );

      const sendRes = await authedProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'No Cleartext Auth',
        body: 'Must fail before AUTH',
      });
      expect(sendRes.success).toBe(false);
      expect(sendRes.error).toMatch(/TLS or STARTTLS is required before authentication/i);
      expect(cleartextServer.commands.some((cmd) => cmd.toUpperCase().startsWith('AUTH'))).toBe(
        false
      );

      // Unauthenticated relay (no user/pass) can still send without AUTH
      const unauthRelayProvider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: 'relay.example.org',
        smtpPort: cleartextServer.port,
        smtpSecure: false,
      });
      const relayRes = await unauthRelayProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'Unauthenticated Relay',
        body: 'Allowed without credentials',
      });
      expect(relayRes).toEqual({ success: true });
      expect(cleartextServer.receivedMessages).toHaveLength(1);
    } finally {
      await cleartextServer.close();
    }
  });

  describe('HTML email escaping, paragraph formatting, and stationery cards', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('escapes unsafe HTML characters without double-escaping existing entities and converts paragraphs and line breaks', () => {
      const input =
        "Dear Sean O&#39;Connor &amp; Family,\n\nWe're thrilled for Sarah & Dan's ceremony <Main Hall>!\nShuttle departs at 4:30 PM.\r\n\r\nWarmly,\r\nThe Couple";

      const formatted = formatEmailHtmlBody(input);

      expect(formatted).toBe(
        '<p>Dear Sean O&#39;Connor &amp; Family,</p>' +
          '<p>We&#39;re thrilled for Sarah &amp; Dan&#39;s ceremony &lt;Main Hall&gt;!<br />Shuttle departs at 4:30 PM.</p>' +
          '<p>Warmly,<br />The Couple</p>'
      );
      expect(formatted).not.toContain('&amp;#39;');
      expect(formatted).not.toContain('&amp;amp;');
      expect(formatted).not.toContain('<Main Hall>');
    });

    it('renders themed HTML stationery cards via formatEmailHtmlBody with couple branding, AppConfig colors, calendar links, and RSVP CTA', () => {
      const cardBody =
        '[CARD:formal-invitation]\nDear Alice Smith,\n\nWe invite you to celebrate with us.\n\nRSVP: https://wedding.example.com/guest?code=ALICE2026';

      const html = formatEmailHtmlBody(cardBody, {
        partner1Name: 'Clara',
        partner2Name: 'Rory',
        weddingDate: new Date('2026-10-25T16:00:00Z'),
        venueName: 'Rosewood Conservatory',
        venueAddress: 'Napa Valley',
        venueState: 'CA',
        colorPrimary: '#1E3A5F',
        colorSecondary: '#C59B27',
      });

      expect(html).toContain('Clara &amp; Rory');
      expect(html).toContain('C &amp; R');
      expect(html).toContain('#1E3A5F');
      expect(html).toContain('#C59B27');
      expect(html).toContain('Rosewood Conservatory');
      expect(html).toContain('Napa Valley, CA');
      expect(html).toContain('https://calendar.google.com/calendar/render');
      expect(html).toContain('https://outlook.live.com/calendar/');
      expect(html).toContain('https://calendar.yahoo.com/');
      expect(html).toContain('href="https://wedding.example.com/guest?code=ALICE2026"');
      expect(html).not.toContain('[CARD:formal-invitation]');
    });

    it('sends escaped paragraph-formatted HTML in Resend and SendGrid email payloads', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => '',
      });
      global.fetch = fetchMock as any;

      const rawBody =
        'Hi O\'Connor & Friends,\n\n Ceremony starts <4pm>!\nBring umbrella.';
      const expectedHtml =
        '<p>Hi O&#39;Connor &amp; Friends,</p><p> Ceremony starts &lt;4pm&gt;!<br />Bring umbrella.</p>';

      const resendProvider = new MultiChannelMessagingProvider({
        emailProvider: 'resend',
        resendApiKey: 're_test_123',
        resendFrom: 'hosts@wedding.example',
      });
      const resendRes = await resendProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'Schedule Update',
        body: rawBody,
      });
      expect(resendRes.success).toBe(true);
      const resendPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(resendPayload.html).toBe(expectedHtml);

      const sendgridProvider = new MultiChannelMessagingProvider({
        emailProvider: 'sendgrid',
        sendgridApiKey: 'SG.test_123',
        sendgridFrom: 'hosts@wedding.example',
      });
      const sendgridRes = await sendgridProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'Schedule Update',
        body: rawBody,
      });
      expect(sendgridRes.success).toBe(true);
      const sendgridPayload = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(sendgridPayload.content).toEqual([
        { type: 'text/html', value: expectedHtml },
      ]);
      expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
      expect(fetchMock.mock.calls[1][1].signal).toBeDefined();
    });

    it('uses a 5,000 ms default AbortSignal.timeout for Resend and SendGrid and returns { success: false } on timeout', async () => {
      const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
      try {
        const stalledFetch = jest.fn((_url: string, init?: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) {
              reject(signal.reason ?? new DOMException('Timed out', 'TimeoutError'));
              return;
            }
            signal?.addEventListener(
              'abort',
              () => {
                reject(signal.reason ?? new DOMException('Timed out', 'TimeoutError'));
              },
              { once: true }
            );
          });
        });
        global.fetch = stalledFetch as unknown as typeof fetch;

        const defaultResend = new MultiChannelMessagingProvider({
          emailProvider: 'resend',
          resendApiKey: 're_test_default_timeout',
        });
        // Verify default 5,000 ms timeout argument when resolving immediately
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: async () => '',
        }) as unknown as typeof fetch;
        await defaultResend.sendEmail({
          to: 'guest@example.com',
          subject: 'Default Timeout Check',
          body: 'Checking default timeout',
        });
        expect(timeoutSpy).toHaveBeenCalledWith(5_000);

        // Verify stalled Resend & SendGrid connections abort cleanly at configured timeout
        global.fetch = stalledFetch as unknown as typeof fetch;

        const boundedResend = new MultiChannelMessagingProvider({
          emailProvider: 'resend',
          resendApiKey: 're_test_timeout',
          emailTimeoutMs: 35,
        });
        const resendResult = await boundedResend.sendEmail({
          to: 'guest@example.com',
          subject: 'Timeout Test',
          body: 'Stalled provider',
        });
        expect(resendResult.success).toBe(false);
        expect(resendResult.error).toMatch(/Resend API request timed out after 35ms/i);

        const boundedSendGrid = new MultiChannelMessagingProvider({
          emailProvider: 'sendgrid',
          sendgridApiKey: 'SG.test_timeout',
          emailTimeoutMs: 35,
        });
        const sendgridResult = await boundedSendGrid.sendEmail({
          to: 'guest@example.com',
          subject: 'Timeout Test',
          body: 'Stalled provider',
        });
        expect(sendgridResult.success).toBe(false);
        expect(sendgridResult.error).toMatch(/SendGrid API request timed out after 35ms/i);
      } finally {
        timeoutSpy.mockRestore();
      }
    });
  });
});
