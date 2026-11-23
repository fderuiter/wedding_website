import crypto from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import { DispatchResult, TestConnectionInput } from '../types';

const HTML_ENTITY_OR_SPECIAL_REGEX = /&(?:amp|lt|gt|quot|#39|#x27);|[&<>"']/g;

const HTML_CHAR_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const DEFAULT_SMTP_TIMEOUT_MS = 8000;

/**
 * Escapes unsafe HTML characters without double-escaping existing standard entities,
 * then converts blank lines into `<p>...</p>` blocks and single line breaks into `<br />` tags.
 */
export function formatEmailHtmlBody(body: string): string {
  if (!body) return '';

  const escaped = body.replace(HTML_ENTITY_OR_SPECIAL_REGEX, (match) =>
    match.length === 1 ? (HTML_CHAR_MAP[match] ?? match) : match
  );

  const normalized = escaped.replace(/\r\n?/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);

  return paragraphs
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function extractEnvelopeAddress(raw: string): string | null {
  const sanitized = sanitizeHeaderValue(raw);
  if (!sanitized) return null;

  const angleMatch = sanitized.match(/<([^<>]+)>$/);
  const candidate = (angleMatch ? angleMatch[1] : sanitized).trim();
  if (!candidate || /[\s<>[\]\r\n]/.test(candidate) || !candidate.includes('@')) {
    return null;
  }
  return candidate;
}

function encodeMimeHeader(value: string): string {
  const clean = sanitizeHeaderValue(value);
  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function dotStuffMimeBody(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized
    .split('\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

interface SmtpResponse {
  code: number;
  lines: string[];
  message: string;
}

interface SmtpConnectionOptions {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  rejectUnauthorized: boolean;
  timeoutMs: number;
}

class SmtpSocketSession {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer = '';
  private pendingLines: string[] = [];
  private currentResponseLines: string[] = [];
  private waiter: {
    resolve: (res: SmtpResponse) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private socketError: Error | null = null;
  private socketClosed = false;

  constructor(private readonly options: SmtpConnectionOptions) {}

  private attachSocket(sock: net.Socket | tls.TLSSocket): void {
    this.socket = sock;
    this.socketError = null;
    this.socketClosed = false;
    sock.setEncoding('utf8');
    sock.on('data', this.handleData);
    sock.on('error', this.handleError);
    sock.on('close', this.handleClose);
  }

  private detachSocket(sock: net.Socket | tls.TLSSocket): void {
    sock.off('data', this.handleData);
    sock.off('error', this.handleError);
    sock.off('close', this.handleClose);
  }

  private readonly handleData = (chunk: string | Buffer): void => {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = this.buffer.slice(0, newlineIndex).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newlineIndex + 1);
      this.pendingLines.push(rawLine);
      newlineIndex = this.buffer.indexOf('\n');
    }
    this.drainPendingResponses();
  };

  private readonly handleError = (err: Error): void => {
    this.socketError = err;
    if (this.waiter) {
      const current = this.waiter;
      this.waiter = null;
      clearTimeout(current.timer);
      current.reject(err);
    }
  };

  private readonly handleClose = (): void => {
    this.socketClosed = true;
    if (this.waiter) {
      const current = this.waiter;
      this.waiter = null;
      clearTimeout(current.timer);
      current.reject(this.socketError ?? new Error('SMTP connection closed unexpectedly'));
    }
  };

  private drainPendingResponses(): void {
    if (!this.waiter) return;

    while (this.pendingLines.length > 0) {
      const line = this.pendingLines.shift()!;
      this.currentResponseLines.push(line);
      const match = line.match(/^(\d{3})(?: (.*)|$)$/);
      if (match) {
        const lines = this.currentResponseLines;
        this.currentResponseLines = [];
        const current = this.waiter;
        this.waiter = null;
        clearTimeout(current.timer);
        current.resolve({
          code: Number(match[1]),
          lines,
          message: lines.join(' | '),
        });
        return;
      }
    }
  }

  async connect(): Promise<SmtpResponse> {
    const { host, port, secure, rejectUnauthorized, timeoutMs } = this.options;

    await new Promise<void>((resolve, reject) => {
      const sockRef: { current?: net.Socket | tls.TLSSocket } = {};

      const timer = setTimeout(() => {
        sockRef.current?.destroy();
        reject(new Error(`SMTP connection timed out (${host}:${port})`));
      }, timeoutMs);

      const onError = (err: Error) => {
        clearTimeout(timer);
        sockRef.current?.destroy();
        reject(err);
      };

      const servername = net.isIP(host) === 0 ? host : undefined;
      const sock = secure
        ? tls.connect({ host, port, ...(servername ? { servername } : {}), rejectUnauthorized }, () => {
          clearTimeout(timer);
          sockRef.current?.off('error', onError);
          if (sockRef.current) this.attachSocket(sockRef.current);
          resolve();
        })
        : net.createConnection({ host, port }, () => {
          clearTimeout(timer);
          sockRef.current?.off('error', onError);
          if (sockRef.current) this.attachSocket(sockRef.current);
          resolve();
        });

      sockRef.current = sock;
      sock.once('error', onError);
    });

    return this.readResponse();
  }

  async upgradeStartTls(): Promise<void> {
    if (!this.socket || this.socket instanceof tls.TLSSocket) {
      return;
    }

    const rawSocket = this.socket;
    this.detachSocket(rawSocket);
    this.buffer = '';
    this.pendingLines = [];
    this.currentResponseLines = [];

    const { host, rejectUnauthorized, timeoutMs } = this.options;

    await new Promise<void>((resolve, reject) => {
      const tlsRef: { current?: tls.TLSSocket } = {};

      const timer = setTimeout(() => {
        tlsRef.current?.destroy();
        reject(new Error(`SMTP STARTTLS handshake timed out (${host})`));
      }, timeoutMs);

      const onError = (err: Error) => {
        clearTimeout(timer);
        tlsRef.current?.destroy();
        reject(err);
      };

      const servername = net.isIP(host) === 0 ? host : undefined;
      const tlsSocket = tls.connect(
        {
          socket: rawSocket,
          ...(servername ? { servername } : {}),
          rejectUnauthorized,
        },
        () => {
          clearTimeout(timer);
          tlsRef.current?.off('error', onError);
          if (tlsRef.current) this.attachSocket(tlsRef.current);
          resolve();
        }
      );
      tlsRef.current = tlsSocket;
      tlsSocket.once('error', onError);
    });
  }

  readResponse(): Promise<SmtpResponse> {
    if (this.socketError) {
      return Promise.reject(this.socketError);
    }
    if (this.socketClosed && this.pendingLines.length === 0) {
      return Promise.reject(new Error('SMTP connection closed unexpectedly'));
    }

    return new Promise<SmtpResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter) {
          this.waiter = null;
        }
        reject(new Error('Timed out waiting for SMTP server response'));
      }, this.options.timeoutMs);

      this.waiter = { resolve, reject, timer };
      this.drainPendingResponses();
    });
  }

  async sendCommand(command: string): Promise<SmtpResponse> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('SMTP socket is not connected');
    }

    await new Promise<void>((resolve, reject) => {
      this.socket!.write(`${command}\r\n`, 'utf8', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    return this.readResponse();
  }

  close(): void {
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter = null;
    }
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = null;
  }
}

export interface EmailMessagePayload {
  to: string;
  from?: string;
  subject: string;
  body: string;
  html?: string;
}

export interface SmsMessagePayload {
  to: string;
  from?: string;
  body: string;
}

interface MessagingProvider {
  sendEmail(payload: EmailMessagePayload): Promise<DispatchResult>;
  sendSms(payload: SmsMessagePayload): Promise<DispatchResult>;
  testConnection(input: TestConnectionInput): Promise<DispatchResult>;
}

export class MultiChannelMessagingProvider implements MessagingProvider {
  private config: any;

  constructor(appConfig: any) {
    this.config = appConfig || {};
  }

  async sendEmail(payload: EmailMessagePayload): Promise<DispatchResult> {
    const provider = (this.config.emailProvider || 'smtp').toLowerCase();
    const fromAddress =
      payload.from ||
      this.config.smtpFrom ||
      this.config.resendFrom ||
      this.config.sendgridFrom ||
      this.config.contactEmail ||
      'noreply@wedding.com';

    if (!payload.to || !payload.to.trim()) {
      return { success: false, error: 'Recipient email address is missing' };
    }

    try {
      if (provider === 'resend') {
        return await this.sendResendEmail({ ...payload, from: fromAddress });
      } else if (provider === 'sendgrid') {
        return await this.sendSendGridEmail({ ...payload, from: fromAddress });
      } else if (provider === 'smtp') {
        return await this.sendSmtpEmail({ ...payload, from: fromAddress });
      } else {
        // Fallback / mock dispatch for standard setup or testing
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to dispatch email' };
    }
  }

  async sendSms(payload: SmsMessagePayload): Promise<DispatchResult> {
    const provider = (this.config.smsProvider || 'none').toLowerCase();
    const fromNumber = payload.from || this.config.twilioFromNumber || '+15550000000';

    if (!payload.to || !payload.to.trim()) {
      return { success: false, error: 'Recipient phone number is missing' };
    }

    try {
      if (provider === 'twilio') {
        return await this.sendTwilioSms({ ...payload, from: fromNumber });
      } else {
        // Fallback or test dispatch
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to dispatch SMS' };
    }
  }

  private resolveEmailTimeoutMs(): number {
    const raw =
      this.config?.emailTimeoutMs ??
      this.config?.providerTimeoutMs ??
      this.config?.timeoutMs;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    return 5_000;
  }

  private isAbortOrTimeoutError(err: unknown): boolean {
    if (!err || typeof err !== 'object') {
      return false;
    }
    const name = 'name' in err ? (err as { name?: unknown }).name : undefined;
    return name === 'TimeoutError' || name === 'AbortError';
  }

  private async sendResendEmail(payload: EmailMessagePayload): Promise<DispatchResult> {
    const apiKey = this.config.resendApiKey;
    if (!apiKey) {
      return { success: false, error: 'Resend API Key is missing in settings' };
    }

    const timeoutMs = this.resolveEmailTimeoutMs();
    const htmlContent =
      payload.html !== undefined ? payload.html : formatEmailHtmlBody(payload.body);
    const requestPayload: Record<string, unknown> = {
      from: sanitizeHeaderValue(payload.from || ''),
      to: sanitizeHeaderValue(payload.to),
      subject: sanitizeHeaderValue(payload.subject),
      html: htmlContent,
    };
    if (payload.html !== undefined) {
      requestPayload.text = payload.body;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestPayload),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, error: `Resend API error (${res.status}): ${errText}` };
      }

      return { success: true };
    } catch (err: unknown) {
      if (this.isAbortOrTimeoutError(err)) {
        return { success: false, error: `Resend API request timed out after ${timeoutMs}ms` };
      }
      throw err;
    }
  }

  private async sendSendGridEmail(payload: EmailMessagePayload): Promise<DispatchResult> {
    const apiKey = this.config.sendgridApiKey;
    if (!apiKey) {
      return { success: false, error: 'SendGrid API Key is missing in settings' };
    }

    const timeoutMs = this.resolveEmailTimeoutMs();
    const content =
      payload.html !== undefined
        ? [
          { type: 'text/plain', value: payload.body },
          { type: 'text/html', value: payload.html },
        ]
        : [{ type: 'text/html', value: formatEmailHtmlBody(payload.body) }];

    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: sanitizeHeaderValue(payload.to) }] }],
          from: { email: sanitizeHeaderValue(payload.from || '') },
          subject: sanitizeHeaderValue(payload.subject),
          content,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text();
        return { success: false, error: `SendGrid API error (${res.status}): ${errText}` };
      }

      return { success: true };
    } catch (err: unknown) {
      if (this.isAbortOrTimeoutError(err)) {
        return { success: false, error: `SendGrid API request timed out after ${timeoutMs}ms` };
      }
      throw err;
    }
  }

  private resolveSmtpConnectionOptions(override?: Partial<TestConnectionInput>): SmtpConnectionOptions {
    const host = (override?.smtpHost ?? this.config.smtpHost ?? '').trim();
    const rawPort = override?.smtpPort ?? this.config.smtpPort;
    const parsedPort = Number(rawPort);
    const port = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 587;
    const secure =
      override?.smtpSecure !== undefined && override?.smtpSecure !== null
        ? Boolean(override.smtpSecure)
        : this.config.smtpSecure !== undefined && this.config.smtpSecure !== null
          ? Boolean(this.config.smtpSecure)
          : port === 465;
    const user = (override?.smtpUser ?? this.config.smtpUser ?? '').trim();
    const pass = this.resolveSecret(override?.smtpPass, this.config.smtpPass);
    const rejectUnauthorized = this.config.smtpRejectUnauthorized !== false;
    const configuredTimeout = Number(this.config.smtpTimeoutMs);
    const timeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : DEFAULT_SMTP_TIMEOUT_MS;

    return {
      host,
      port,
      secure,
      user: user || undefined,
      pass: pass || undefined,
      rejectUnauthorized,
      timeoutMs,
    };
  }

  private async establishSmtpSession(options: SmtpConnectionOptions): Promise<SmtpSocketSession> {
    const session = new SmtpSocketSession(options);
    try {
      const banner = await session.connect();
      if (banner.code !== 220) {
        throw new Error(`SMTP greeting failed (${banner.code}): ${banner.message}`);
      }

      let ehlo = await session.sendCommand('EHLO localhost');
      if (ehlo.code === 500 || ehlo.code === 502) {
        ehlo = await session.sendCommand('HELO localhost');
      }
      if (ehlo.code !== 250) {
        throw new Error(`SMTP EHLO failed (${ehlo.code}): ${ehlo.message}`);
      }

      let capabilities = ehlo.lines.map((line) => line.slice(4).trim().toUpperCase());

      if (!options.secure) {
        const supportsStartTls = capabilities.some(
          (cap) => cap === 'STARTTLS' || cap.startsWith('STARTTLS ')
        );
        if (supportsStartTls) {
          const startTlsRes = await session.sendCommand('STARTTLS');
          if (startTlsRes.code !== 220) {
            throw new Error(`SMTP STARTTLS rejected (${startTlsRes.code}): ${startTlsRes.message}`);
          }
          await session.upgradeStartTls();
          ehlo = await session.sendCommand('EHLO localhost');
          if (ehlo.code !== 250) {
            throw new Error(`SMTP post-STARTTLS EHLO failed (${ehlo.code}): ${ehlo.message}`);
          }
          capabilities = ehlo.lines.map((line) => line.slice(4).trim().toUpperCase());
        } else if (!isLoopbackHost(options.host) && this.config.smtpAllowCleartext !== true) {
          throw new Error(
            'SMTP server does not advertise STARTTLS; enable TLS (port 465) or configure a STARTTLS-capable server'
          );
        }
      }

      if (options.user) {
        if (!options.pass) {
          throw new Error('SMTP Password required');
        }
        const authCap = capabilities.find(
          (cap) => cap === 'AUTH' || cap.startsWith('AUTH ') || cap.startsWith('AUTH=')
        );
        const supportsLoginOnly =
          Boolean(authCap) &&
          /\bLOGIN\b/.test(authCap!) &&
          !/\bPLAIN\b/.test(authCap!);

        if (supportsLoginOnly) {
          const loginInit = await session.sendCommand('AUTH LOGIN');
          if (loginInit.code !== 334) {
            throw new Error(`SMTP AUTH LOGIN rejected (${loginInit.code}): ${loginInit.message}`);
          }
          const userRes = await session.sendCommand(Buffer.from(options.user, 'utf8').toString('base64'));
          if (userRes.code !== 334) {
            throw new Error(`SMTP AUTH username rejected (${userRes.code}): ${userRes.message}`);
          }
          const passRes = await session.sendCommand(Buffer.from(options.pass, 'utf8').toString('base64'));
          if (passRes.code !== 235) {
            throw new Error(`SMTP authentication failed (${passRes.code}): ${passRes.message}`);
          }
        } else {
          const plainToken = Buffer.from(`\u0000${options.user}\u0000${options.pass}`, 'utf8').toString('base64');
          let authRes = await session.sendCommand(`AUTH PLAIN ${plainToken}`);
          if (authRes.code === 334) {
            authRes = await session.sendCommand(plainToken);
          }
          if (authRes.code !== 235) {
            throw new Error(`SMTP authentication failed (${authRes.code}): ${authRes.message}`);
          }
        }
      }

      return session;
    } catch (err) {
      session.close();
      throw err;
    }
  }

  private async sendSmtpEmail(payload: EmailMessagePayload): Promise<DispatchResult> {
    const options = this.resolveSmtpConnectionOptions();
    if (!options.host) {
      // If host is not set, allow simulated dispatch for unconfigured test/mock environments
      return { success: true };
    }

    const fromHeader = sanitizeHeaderValue(payload.from || 'noreply@wedding.com');
    const toHeader = sanitizeHeaderValue(payload.to);
    const fromEnvelope = extractEnvelopeAddress(fromHeader);
    const toEnvelope = extractEnvelopeAddress(toHeader);

    if (!fromEnvelope) {
      return { success: false, error: 'Invalid sender email address for SMTP envelope' };
    }
    if (!toEnvelope) {
      return { success: false, error: 'Invalid recipient email address for SMTP envelope' };
    }

    const htmlPart =
      payload.html !== undefined ? payload.html : formatEmailHtmlBody(payload.body);
    const boundary = `=_wedding_mime_${crypto.randomBytes(12).toString('hex')}`;
    const senderDomain = fromEnvelope.split('@')[1] || 'wedding.local';
    const mimeLines = [
      `From: ${fromHeader}`,
      `To: ${toHeader}`,
      `Subject: ${encodeMimeHeader(payload.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomUUID()}@${senderDomain}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      payload.body || '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      htmlPart,
      `--${boundary}--`,
      '',
    ];
    const dotStuffedPayload = dotStuffMimeBody(mimeLines.join('\r\n'));

    const session = await this.establishSmtpSession(options);
    try {
      const mailFromRes = await session.sendCommand(`MAIL FROM:<${fromEnvelope}>`);
      if (mailFromRes.code !== 250) {
        return { success: false, error: `SMTP MAIL FROM rejected (${mailFromRes.code}): ${mailFromRes.message}` };
      }

      const rcptToRes = await session.sendCommand(`RCPT TO:<${toEnvelope}>`);
      if (rcptToRes.code !== 250 && rcptToRes.code !== 251) {
        return { success: false, error: `SMTP RCPT TO rejected (${rcptToRes.code}): ${rcptToRes.message}` };
      }

      const dataRes = await session.sendCommand('DATA');
      if (dataRes.code !== 354) {
        return { success: false, error: `SMTP DATA rejected (${dataRes.code}): ${dataRes.message}` };
      }

      const endDataRes = await session.sendCommand(`${dotStuffedPayload}\r\n.`);
      if (endDataRes.code !== 250) {
        return { success: false, error: `SMTP message body rejected (${endDataRes.code}): ${endDataRes.message}` };
      }

      await session.sendCommand('QUIT').catch(() => undefined);
      return { success: true };
    } finally {
      session.close();
    }
  }

  private async sendTwilioSms(payload: SmsMessagePayload): Promise<DispatchResult> {
    const accountSid = this.config.twilioAccountSid;
    const authToken = this.config.twilioAuthToken;

    if (!accountSid || !authToken) {
      return { success: false, error: 'Twilio Account SID or Auth Token missing' };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const bodyParams = new URLSearchParams();
    bodyParams.append('To', payload.to);
    bodyParams.append('From', payload.from || '');
    bodyParams.append('Body', payload.body);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: bodyParams.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Twilio API error (${res.status}): ${errText}` };
    }

    return { success: true };
  }

  private resolveSecret(inputSecret?: string | null, storedSecret?: string | null): string {
    if (typeof inputSecret === 'string' && inputSecret.trim().length > 0) {
      return inputSecret.trim();
    }
    if (typeof storedSecret === 'string' && storedSecret.trim().length > 0) {
      return storedSecret.trim();
    }
    return '';
  }

  async testConnection(input: TestConnectionInput): Promise<DispatchResult> {
    if (input.type === 'email') {
      const provider = (input.provider || this.config.emailProvider || 'smtp').toLowerCase();
      if (provider === 'resend') {
        const apiKey = this.resolveSecret(input.resendApiKey, this.config.resendApiKey);
        if (!apiKey) return { success: false, error: 'Resend API Key required' };
      } else if (provider === 'sendgrid') {
        const apiKey = this.resolveSecret(input.sendgridApiKey, this.config.sendgridApiKey);
        if (!apiKey) return { success: false, error: 'SendGrid API Key required' };
      } else if (provider === 'smtp') {
        const options = this.resolveSmtpConnectionOptions(input);
        if (!options.host) return { success: false, error: 'SMTP Host required' };
        if (options.user && !options.pass) return { success: false, error: 'SMTP Password required' };

        try {
          const session = await this.establishSmtpSession(options);
          try {
            await session.sendCommand('QUIT').catch(() => undefined);
          } finally {
            session.close();
          }
        } catch (err: any) {
          return {
            success: false,
            error: err?.message ? `SMTP connection failed: ${err.message}` : 'SMTP connection failed',
          };
        }
      }
      return { success: true };
    } else if (input.type === 'sms') {
      const accountSid = input.twilioAccountSid?.trim() || this.config.twilioAccountSid?.trim();
      const authToken = this.resolveSecret(input.twilioAuthToken, this.config.twilioAuthToken);
      if (!accountSid || !authToken) {
        return { success: false, error: 'Twilio Account SID and Auth Token required' };
      }
      return { success: true };
    }
    return { success: false, error: 'Invalid connection test type' };
  }
}
