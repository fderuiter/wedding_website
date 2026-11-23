/** @jest-environment node */

import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { MultiChannelMessagingProvider, formatEmailHtmlBody } from '../providers';

let cachedTlsCredentials: { key: string; cert: string } | null = null;

function derLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  const hex = len.toString(16).padStart(len > 0xff ? 4 : 2, '0');
  const bytes = Buffer.from(hex, 'hex');
  return Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes]);
}

function derTlv(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
}

function derSequence(...items: Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(items));
}

function derTime(date: Date): Buffer {
  const isoDigits = date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  if (date.getUTCFullYear() < 2050) {
    return derTlv(0x17, Buffer.from(`${isoDigits.slice(2)}Z`, 'ascii'));
  }
  return derTlv(0x18, Buffer.from(`${isoDigits}Z`, 'ascii'));
}

function getTestTlsCredentials(): { key: string; cert: string } {
  if (cachedTlsCredentials) {
    return cachedTlsCredentials;
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
  const sha256RsaAlgId = derSequence(
    derTlv(0x06, Buffer.from([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b])),
    Buffer.from([0x05, 0x00])
  );
  const subjectName = derSequence(
    derTlv(
      0x31,
      derSequence(
        derTlv(0x06, Buffer.from([0x55, 0x04, 0x03])),
        derTlv(0x0c, Buffer.from('127.0.0.1', 'utf8'))
      )
    )
  );
  const now = Date.now();
  const validity = derSequence(derTime(new Date(now - 3_600_000)), derTime(new Date(now + 86_400_000)));
  const versionV3 = derTlv(0xa0, Buffer.from([0x02, 0x01, 0x02]));
  const serialNumber = derTlv(0x02, Buffer.from([0x01]));
  const tbsCertificate = derSequence(
    versionV3,
    serialNumber,
    sha256RsaAlgId,
    subjectName,
    validity,
    subjectName,
    spkiDer
  );
  const signature = crypto.sign('sha256', tbsCertificate, privateKey);
  const signatureBitString = derTlv(0x03, Buffer.concat([Buffer.from([0x00]), signature]));
  const certDer = derSequence(tbsCertificate, sha256RsaAlgId, signatureBitString);
  const certLines = certDer.toString('base64').match(/.{1,64}/g) ?? [];
  cachedTlsCredentials = {
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    cert: `-----BEGIN CERTIFICATE-----\n${certLines.join('\n')}\n-----END CERTIFICATE-----\n`,
  };
  return cachedTlsCredentials;
}

interface EphemeralSmtpServerOptions {
  rejectAuth?: boolean;
  advertiseStartTls?: boolean;
  implicitTls?: boolean;
  invalidGreeting?: boolean;
}

async function startEphemeralSmtpServer(options: EphemeralSmtpServerOptions = {}) {
  const receivedFrames: string[] = [];
  const encryptedFrames: string[] = [];
  let messageData = '';
  let inDataMode = false;

  const tlsCreds =
    options.advertiseStartTls || options.implicitTls ? getTestTlsCredentials() : null;

  const activeSockets = new Set<net.Socket>();

  const attachSmtpProtocol = (socket: net.Socket | tls.TLSSocket, isStartTlsUpgrade = false) => {
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));
    socket.on('error', () => {
      // Ignore client disconnect errors during teardown
    });
    socket.setEncoding('utf8');

    if (!isStartTlsUpgrade) {
      if (options.invalidGreeting) {
        socket.write('554 Service unavailable\r\n');
        socket.end();
        return;
      }
      socket.write('220 localhost ESMTP TestServer\r\n');
    }

    const isEncrypted = socket instanceof tls.TLSSocket;
    let buffer = '';

    const onData = (chunk: string) => {
      buffer += chunk;

      if (inDataMode) {
        const endIdx = buffer.indexOf('\r\n.\r\n');
        if (endIdx !== -1) {
          messageData = buffer.slice(0, endIdx);
          buffer = buffer.slice(endIdx + 5);
          inDataMode = false;
          socket.write('250 2.0.0 Queued as test-msg-1\r\n');
        }
        return;
      }

      let lineEnd = buffer.indexOf('\r\n');
      while (lineEnd !== -1) {
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        receivedFrames.push(line);
        if (isEncrypted) {
          encryptedFrames.push(line);
        }

        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO')) {
          if (options.advertiseStartTls && !isEncrypted) {
            socket.write('250-localhost\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN\r\n');
          } else {
            socket.write('250-localhost\r\n250 AUTH PLAIN LOGIN\r\n');
          }
        } else if (upper === 'STARTTLS' && tlsCreds && !isEncrypted) {
          socket.off('data', onData);
          socket.write('220 2.0.0 Ready to start TLS\r\n');
          const upgradedSocket = new tls.TLSSocket(socket, {
            isServer: true,
            key: tlsCreds.key,
            cert: tlsCreds.cert,
          });
          attachSmtpProtocol(upgradedSocket, true);
          return;
        } else if (upper.startsWith('AUTH PLAIN')) {
          if (options.rejectAuth) {
            socket.write('535 5.7.8 Authentication credentials invalid\r\n');
          } else {
            socket.write('235 2.7.0 Authentication successful\r\n');
          }
        } else if (upper.startsWith('MAIL FROM:')) {
          socket.write('250 2.1.0 Sender OK\r\n');
        } else if (upper.startsWith('RCPT TO:')) {
          socket.write('250 2.1.5 Recipient OK\r\n');
        } else if (upper === 'DATA') {
          inDataMode = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          break;
        } else if (upper === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 OK\r\n');
        }

        lineEnd = buffer.indexOf('\r\n');
      }
    };

    socket.on('data', onData);
  };

  const server =
    options.implicitTls && tlsCreds
      ? tls.createServer({ key: tlsCreds.key, cert: tlsCreds.cert }, (tlsSocket) =>
        attachSmtpProtocol(tlsSocket, false)
      )
      : net.createServer((socket) => attachSmtpProtocol(socket, false));

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as net.AddressInfo;

  return {
    port: address.port,
    receivedFrames,
    encryptedFrames,
    getMessageData: () => messageData,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of activeSockets) {
          s.destroy();
        }
        activeSockets.clear();
        server.close(() => resolve());
      }),
  };
}

describe('MultiChannelMessagingProvider', () => {
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

  it('delivers multipart plain-text and HTML email over live SMTP socket with dot-stuffing', async () => {
    const smtpServer = await startEphemeralSmtpServer();
    try {
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: smtpServer.port,
        smtpSecure: false,
        smtpUser: 'mailer@example.com',
        smtpPass: 'smtp-secret',
        smtpFrom: 'couple@wedding.example',
      });

      const result = await provider.sendEmail({
        to: 'guest@example.com',
        subject: 'Gift Receipt',
        body: 'Hello guest\n.Leading dot line',
        html: '<table><tr><td>Hello &amp; thanks!</td></tr></table>',
      });

      expect(result.success).toBe(true);
      expect(smtpServer.receivedFrames.some((line) => line.startsWith('AUTH PLAIN '))).toBe(true);
      expect(smtpServer.receivedFrames).toContain('MAIL FROM:<couple@wedding.example>');
      expect(smtpServer.receivedFrames).toContain('RCPT TO:<guest@example.com>');
      const rawData = smtpServer.getMessageData();
      expect(rawData).toContain('Content-Type: multipart/alternative;');
      expect(rawData).toContain('..Leading dot line');
      expect(rawData).toContain('<table><tr><td>Hello &amp; thanks!</td></tr></table>');
    } finally {
      await smtpServer.close();
    }
  });

  it('upgrades STARTTLS when advertised and supports implicit TLS on smtpSecure=true', async () => {
    const startTlsServer = await startEphemeralSmtpServer({ advertiseStartTls: true });
    const implicitTlsServer = await startEphemeralSmtpServer({ implicitTls: true });
    try {
      const startTlsProvider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: startTlsServer.port,
        smtpSecure: false,
        smtpUser: 'starttls-user',
        smtpPass: 'starttls-pass',
        smtpRejectUnauthorized: false,
      });
      const startTlsRes = await startTlsProvider.testConnection({ type: 'email', provider: 'smtp' });
      expect(startTlsRes).toEqual({ success: true });
      expect(startTlsServer.receivedFrames).toContain('STARTTLS');
      expect(startTlsServer.encryptedFrames).toContain('EHLO localhost');
      expect(startTlsServer.encryptedFrames.some((f) => f.startsWith('AUTH PLAIN '))).toBe(true);

      const implicitTlsProvider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: implicitTlsServer.port,
        smtpSecure: true,
        smtpUser: 'tls-user',
        smtpPass: 'tls-pass',
        smtpFrom: 'couple@wedding.example',
        smtpRejectUnauthorized: false,
      });

      const connRes = await implicitTlsProvider.testConnection({ type: 'email', provider: 'smtp' });
      expect(connRes).toEqual({ success: true });

      const sendRes = await implicitTlsProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'TLS Receipt',
        body: 'Encrypted body',
        html: '<p>Encrypted body</p>',
      });
      expect(sendRes).toEqual({ success: true });
      expect(implicitTlsServer.encryptedFrames).toContain('EHLO localhost');
      expect(implicitTlsServer.encryptedFrames.some((f) => f.startsWith('AUTH PLAIN '))).toBe(true);
      expect(implicitTlsServer.encryptedFrames).toContain('MAIL FROM:<couple@wedding.example>');
      expect(implicitTlsServer.getMessageData()).toContain('<p>Encrypted body</p>');
    } finally {
      await startTlsServer.close();
      await implicitTlsServer.close();
    }
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

  it('verifies live SMTP connection and fails on unreachable hosts or invalid SMTP credentials', async () => {
    const smtpServer = await startEphemeralSmtpServer();
    const validPort = smtpServer.port;
    try {
      const provider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: validPort,
        smtpSecure: false,
      });
      const okRes = await provider.testConnection({
        type: 'email',
        provider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: validPort,
        smtpSecure: false,
      });
      expect(okRes.success).toBe(true);
    } finally {
      await smtpServer.close();
    }

    const deadProvider = new MultiChannelMessagingProvider({
      emailProvider: 'smtp',
      smtpHost: '127.0.0.1',
      smtpPort: validPort,
      smtpSecure: false,
    });
    const deadRes = await deadProvider.testConnection({
      type: 'email',
      provider: 'smtp',
      smtpHost: '127.0.0.1',
      smtpPort: validPort,
      smtpSecure: false,
    });
    expect(deadRes.success).toBe(false);
    expect(deadRes.error).toMatch(/SMTP/i);

    const rejectAuthServer = await startEphemeralSmtpServer({ rejectAuth: true });
    try {
      const badAuthProvider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: rejectAuthServer.port,
        smtpSecure: false,
        smtpUser: 'mailer@example.com',
        smtpPass: 'wrong-password',
      });
      const authFailRes = await badAuthProvider.testConnection({
        type: 'email',
        provider: 'smtp',
      });
      expect(authFailRes.success).toBe(false);
      expect(authFailRes.error).toMatch(/535|Authentication/i);
    } finally {
      await rejectAuthServer.close();
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

    const smtpServer = await startEphemeralSmtpServer();
    try {
      const smtpProvider = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '127.0.0.1',
        smtpPort: smtpServer.port,
        smtpSecure: false,
        smtpUser: 'mailer@example.com',
        smtpPass: 'stored-smtp-pass',
      });
      expect(
        await smtpProvider.testConnection({ type: 'email', provider: 'smtp', smtpPass: '' })
      ).toEqual({
        success: true,
      });
      expect(smtpServer.receivedFrames.some((line) => line.startsWith('AUTH PLAIN '))).toBe(true);
    } finally {
      await smtpServer.close();
    }

    const twilioProvider = new MultiChannelMessagingProvider({
      smsProvider: 'twilio',
      twilioAccountSid: 'AC12345',
      twilioAuthToken: 'stored-twilio-token',
    });
    expect(await twilioProvider.testConnection({ type: 'sms', twilioAuthToken: '' })).toEqual({
      success: true,
    });
  });

  describe('HTML email escaping and paragraph formatting', () => {
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

    it('uses formatEmailHtmlBody when html is omitted and preserves pre-escaped html + plain text when html is provided', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => '',
      });
      global.fetch = fetchMock as unknown as typeof fetch;

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
      expect(resendPayload.text).toBeUndefined();

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

      // Structured HTML + plain-text fallback
      const structuredHtml = '<table><tr><th>Gift</th><td>Stand Mixer</td></tr></table>';
      await resendProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'Receipt',
        body: 'Gift: Stand Mixer',
        html: structuredHtml,
      });
      const resendStructured = JSON.parse(fetchMock.mock.calls[2][1].body);
      expect(resendStructured.html).toBe(structuredHtml);
      expect(resendStructured.text).toBe('Gift: Stand Mixer');

      await sendgridProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'Receipt',
        body: 'Gift: Stand Mixer',
        html: structuredHtml,
      });
      const sendgridStructured = JSON.parse(fetchMock.mock.calls[3][1].body);
      expect(sendgridStructured.content).toEqual([
        { type: 'text/plain', value: 'Gift: Stand Mixer' },
        { type: 'text/html', value: structuredHtml },
      ]);

      const unconfiguredSmtp = new MultiChannelMessagingProvider({
        emailProvider: 'smtp',
        smtpHost: '',
      });
      expect(
        await unconfiguredSmtp.sendEmail({ to: 'guest@example.com', subject: 'Sim', body: 'Hi' })
      ).toEqual({ success: true });
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
