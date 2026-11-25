import crypto from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import tls from 'node:tls';
import { validateAndResolveHost } from '@/utils/ssrf';
import { isAllowedSmtpPort } from '@/utils/validationPrimitives';
import {
  StationeryCardConfig,
  parseStationeryCardDirective,
  renderStationeryCardHtml,
  stripStationeryCardDirective,
} from '../template';
import { DispatchResult, TestConnectionInput } from '../types';

const DEFAULT_SMTP_TIMEOUT_MS = 10_000;
const HTML_ENTITY_OR_SPECIAL_REGEX = /&(?:amp|lt|gt|quot|#39|#x27);|[&<>"']/g;

const HTML_CHAR_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Renders themed HTML stationery cards for `[CARD:save-the-date]` and `[CARD:formal-invitation]`
 * templates, or escapes unsafe HTML characters without double-escaping existing standard entities
 * and converts blank lines into `<p>...</p>` blocks and single line breaks into `<br />` tags.
 */
export function formatEmailHtmlBody(
  body: string,
  appConfig?: StationeryCardConfig | null
): string {
  if (!body) return '';

  const cardDirective = parseStationeryCardDirective(body);
  if (cardDirective) {
    return renderStationeryCardHtml(cardDirective.variant, cardDirective.content, appConfig);
  }

  const escaped = body.replace(HTML_ENTITY_OR_SPECIAL_REGEX, (match) =>
    match.length === 1 ? (HTML_CHAR_MAP[match] ?? match) : match
  );

  const normalized = escaped.replace(/\r\n?/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);

  return paragraphs
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function sanitizeSmtpHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function normalizeSmtpHost(host?: string | null): string {
  if (typeof host !== 'string') return '';
  return host.trim().replace(/^\[|\]$/g, '').trim().toLowerCase();
}

function resolveSniServername(host: string): string | undefined {
  const clean = host.replace(/^\[|\]$/g, '').trim();
  if (!clean || net.isIP(clean) !== 0) {
    return undefined;
  }
  return clean;
}

function resolveValidatedSmtpPort(rawPort: unknown): number | null {
  if (
    rawPort === undefined ||
    rawPort === null ||
    (typeof rawPort === 'string' && rawPort.trim() === '')
  ) {
    return 587;
  }
  if (typeof rawPort === 'string') {
    const trimmed = rawPort.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    const parsed = Number(trimmed);
    return isAllowedSmtpPort(parsed) ? parsed : null;
  }
  if (typeof rawPort === 'number') {
    return isAllowedSmtpPort(rawPort) ? rawPort : null;
  }
  return null;
}

function encodeMimeHeaderIfNeeded(value: string): string {
  const clean = sanitizeSmtpHeaderValue(value);
  if (/^[\x20-\x7E]*$/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function extractSafeEnvelopeAddress(rawAddress: string): string {
  const sanitized = rawAddress.replace(/[\r\n]+/g, '').trim();
  const angleMatch = sanitized.match(/<([^<>]+)>/);
  const candidate = (angleMatch ? angleMatch[1] : sanitized).trim();
  if (!candidate || /[\s<>[\]\r\n\0]/.test(candidate) || !candidate.includes('@')) {
    throw new Error(`Invalid SMTP envelope address: ${candidate || 'empty'}`);
  }
  return candidate;
}

function unescapeHtmlEntitiesForPlainText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&middot;/g, '·');
}

function htmlToPlainText(html: string): string {
  const withLinks = html.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, label) => {
      const cleanLabel = String(label).replace(/<[^>]+>/g, '').trim();
      const cleanHref = unescapeHtmlEntitiesForPlainText(String(href).trim());
      if (!cleanHref || cleanLabel === cleanHref) return cleanLabel;
      return `${cleanLabel} (${cleanHref})`;
    }
  );
  const stripped = withLinks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n\n')
    .replace(/<td[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  return unescapeHtmlEntitiesForPlainText(stripped)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function dotStuffMimePayload(mimeContent: string): string {
  const crlfNormalized = mimeContent.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  return crlfNormalized
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function buildMultipartMimeMessage(params: {
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  ehloHost: string;
}): string {
  const boundary = `=_wedding_mime_${crypto.randomBytes(12).toString('hex')}`;
  const cleanFrom = sanitizeSmtpHeaderValue(params.from);
  const cleanTo = sanitizeSmtpHeaderValue(params.to);
  const encodedSubject = encodeMimeHeaderIfNeeded(params.subject || '');
  const cleanEhlo = sanitizeSmtpHeaderValue(params.ehloHost).replace(/[^a-zA-Z0-9.-]/g, '') || 'localhost';
  const messageId = `<${crypto.randomUUID()}@${cleanEhlo}>`;

  const lines = [
    `From: ${cleanFrom}`,
    `To: ${cleanTo}`,
    `Subject: ${encodedSubject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    params.textBody.replace(/\r\n?/g, '\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    params.htmlBody.replace(/\r\n?/g, '\n'),
    '',
    `--${boundary}--`,
  ];

  return dotStuffMimePayload(lines.join('\r\n'));
}

interface SmtpResponse {
  code: number;
  lines: string[];
}

class SmtpSocketSession {
  private socket: net.Socket | tls.TLSSocket;
  private rawSocket: net.Socket | null;
  private lineQueue: string[] = [];
  private partialLine = '';
  private pendingResolve: ((line: string) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private terminalError: Error | null = null;
  private detachFn: (() => void) | null = null;

  constructor(initialSocket: net.Socket | tls.TLSSocket, rawSocket: net.Socket | null) {
    this.socket = initialSocket;
    this.rawSocket = rawSocket;
    this.attachListeners(initialSocket);
  }

  private attachListeners(sock: net.Socket | tls.TLSSocket): void {
    const onData = (chunk: Buffer | string) => {
      this.partialLine += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let newlineIdx = this.partialLine.indexOf('\n');
      while (newlineIdx !== -1) {
        let line = this.partialLine.slice(0, newlineIdx);
        this.partialLine = this.partialLine.slice(newlineIdx + 1);
        if (line.endsWith('\r')) {
          line = line.slice(0, -1);
        }
        if (this.pendingResolve) {
          const resolve = this.pendingResolve;
          this.pendingResolve = null;
          this.pendingReject = null;
          resolve(line);
        } else {
          this.lineQueue.push(line);
        }
        newlineIdx = this.partialLine.indexOf('\n');
      }
    };

    const onError = (err: Error) => {
      this.terminalError = err;
      if (this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(err);
      }
    };

    const onClose = () => {
      if (!this.terminalError) {
        this.terminalError = new Error('SMTP connection closed unexpectedly by server');
      }
      if (this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(this.terminalError);
      }
    };

    sock.on('data', onData);
    sock.on('error', onError);
    sock.on('close', onClose);
    sock.on('end', onClose);

    this.detachFn = () => {
      sock.removeListener('data', onData);
      sock.removeListener('error', onError);
      sock.removeListener('close', onClose);
      sock.removeListener('end', onClose);
    };
  }

  async nextLine(timeoutMs: number): Promise<string> {
    if (this.lineQueue.length > 0) {
      return this.lineQueue.shift()!;
    }
    if (this.terminalError) {
      throw this.terminalError;
    }

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResolve = null;
        this.pendingReject = null;
        const err = new Error('SMTP connection timed out');
        this.terminalError = err;
        this.destroy();
        reject(err);
      }, timeoutMs);

      this.pendingResolve = (line: string) => {
        clearTimeout(timer);
        resolve(line);
      };
      this.pendingReject = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  async readResponse(timeoutMs: number): Promise<SmtpResponse> {
    const collected: string[] = [];
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const remaining = Math.max(1, deadline - Date.now());
      const line = await this.nextLine(remaining);
      collected.push(line);

      const multiMatch = line.match(/^(\d{3})-(.*)$/);
      if (multiMatch) {
        continue;
      }

      const finalMatch = line.match(/^(\d{3})(?: (.*))?$/);
      if (finalMatch) {
        return {
          code: Number(finalMatch[1]),
          lines: collected,
        };
      }

      throw new Error('Invalid SMTP server response');
    }
  }

  async writeCommand(rawPayload: string, timeoutMs: number): Promise<void> {
    if (this.terminalError) {
      throw this.terminalError;
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error('SMTP write timed out');
        this.terminalError = err;
        this.destroy();
        reject(err);
      }, timeoutMs);

      this.socket.write(rawPayload, 'utf8', (err) => {
        clearTimeout(timer);
        if (err) {
          this.terminalError = err;
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async upgradeToTls(
    host: string,
    rejectUnauthorized: boolean,
    timeoutMs: number
  ): Promise<void> {
    if (this.detachFn) {
      this.detachFn();
      this.detachFn = null;
    }
    this.lineQueue = [];
    this.partialLine = '';
    this.terminalError = null;

    const underlying = this.rawSocket || (this.socket as net.Socket);
    const tlsSock = tls.connect({
      socket: underlying,
      servername: resolveSniServername(host),
      rejectUnauthorized,
    });

    this.socket = tlsSock;
    this.attachListeners(tlsSock);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const err = new Error('SMTP STARTTLS handshake timed out');
        this.terminalError = err;
        this.destroy();
        reject(err);
      }, timeoutMs);

      const onSecure = () => {
        clearTimeout(timer);
        tlsSock.removeListener('error', onHandshakeErr);
        resolve();
      };
      const onHandshakeErr = (err: Error) => {
        clearTimeout(timer);
        tlsSock.removeListener('secureConnect', onSecure);
        reject(err);
      };

      tlsSock.once('secureConnect', onSecure);
      tlsSock.once('error', onHandshakeErr);
    });
  }

  destroy(): void {
    if (this.detachFn) {
      this.detachFn();
      this.detachFn = null;
    }
    try {
      this.socket.destroy();
    } catch {
      // Ignore socket teardown errors
    }
    if (this.rawSocket && this.rawSocket !== this.socket) {
      try {
        this.rawSocket.destroy();
      } catch {
        // Ignore underlying socket teardown errors
      }
    }
  }
}

function parseEhloCapabilities(lines: string[]): {
  supportsStartTls: boolean;
  authMechanisms: Set<string>;
} {
  let supportsStartTls = false;
  const authMechanisms = new Set<string>();

  for (const line of lines) {
    const stripped = line.replace(/^\d{3}[- ]/, '').trim();
    if (/^STARTTLS\b/i.test(stripped)) {
      supportsStartTls = true;
    }
    const authMatch = stripped.match(/^AUTH(?:=|\s+)(.+)$/i);
    if (authMatch) {
      for (const token of authMatch[1].split(/[\s=]+/)) {
        const upper = token.trim().toUpperCase();
        if (upper) {
          authMechanisms.add(upper);
        }
      }
    }
  }

  return { supportsStartTls, authMechanisms };
}

function createPinnedSmtpLookup(address: string, family: number): net.LookupFunction {
  return (_hostname, opts, cb) => {
    let callback = cb as (
      err: NodeJS.ErrnoException | null,
      addressOrAddresses: string | dns.LookupAddress[],
      resolvedFamily?: number
    ) => void;
    let options: dns.LookupOptions = typeof opts === 'object' && opts !== null ? opts : {};
    if (typeof opts === 'function') {
      callback = opts as unknown as typeof callback;
      options = {};
    }
    if (options.all) {
      callback(null, [{ address, family }]);
    } else {
      callback(null, address, family);
    }
  };
}

async function openSmtpSession(params: {
  host: string;
  port: number;
  secure: boolean;
  rejectUnauthorized: boolean;
  timeoutMs: number;
}): Promise<SmtpSocketSession> {
  const { host, port, secure, rejectUnauthorized, timeoutMs } = params;
  const resolved = await validateAndResolveHost(host);
  const servername = resolveSniServername(host);
  const lookup = createPinnedSmtpLookup(resolved.address, resolved.family);

  if (secure) {
    const tlsOptions: tls.ConnectionOptions & { family: number } = {
      host: resolved.address,
      port,
      family: resolved.family,
      lookup,
      servername,
      rejectUnauthorized,
    };
    const tlsSock = tls.connect(tlsOptions);
    tlsSock.setTimeout(timeoutMs);
    const session = new SmtpSocketSession(tlsSock, null);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.destroy();
        reject(new Error('SMTP TLS connection timed out'));
      }, timeoutMs);

      const onSecure = () => {
        clearTimeout(timer);
        tlsSock.removeListener('error', onErr);
        resolve();
      };
      const onErr = (err: Error) => {
        clearTimeout(timer);
        tlsSock.removeListener('secureConnect', onSecure);
        session.destroy();
        reject(err);
      };

      tlsSock.once('secureConnect', onSecure);
      tlsSock.once('error', onErr);
    });

    return session;
  }

  const rawSock = net.connect({
    host: resolved.address,
    port,
    family: resolved.family,
    lookup,
  });
  rawSock.setTimeout(timeoutMs);
  const session = new SmtpSocketSession(rawSock, rawSock);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.destroy();
      reject(new Error('SMTP connection timed out'));
    }, timeoutMs);

    const onConnect = () => {
      clearTimeout(timer);
      rawSock.removeListener('error', onErr);
      resolve();
    };
    const onErr = (err: Error) => {
      clearTimeout(timer);
      rawSock.removeListener('connect', onConnect);
      session.destroy();
      reject(err);
    };

    rawSock.once('connect', onConnect);
    rawSock.once('error', onErr);
  });

  return session;
}

async function authenticateSmtpSession(
  session: SmtpSocketSession,
  user: string,
  pass: string,
  authMechanisms: Set<string>,
  timeoutMs: number
): Promise<void> {
  const cleanUser = user.replace(/[\r\n]+/g, '');
  const cleanPass = pass.replace(/[\r\n]+/g, '');

  const runAuthLogin = async () => {
    await session.writeCommand('AUTH LOGIN\r\n', timeoutMs);
    const step1 = await session.readResponse(timeoutMs);
    if (step1.code !== 334) {
      throw new Error(`SMTP AUTH LOGIN rejected (${step1.code})`);
    }

    await session.writeCommand(`${Buffer.from(cleanUser, 'utf8').toString('base64')}\r\n`, timeoutMs);
    const step2 = await session.readResponse(timeoutMs);
    if (step2.code !== 334) {
      throw new Error(`SMTP AUTH LOGIN username rejected (${step2.code})`);
    }

    await session.writeCommand(`${Buffer.from(cleanPass, 'utf8').toString('base64')}\r\n`, timeoutMs);
    const step3 = await session.readResponse(timeoutMs);
    if (step3.code !== 235) {
      throw new Error(`SMTP authentication failed (${step3.code})`);
    }
  };

  const prefersLoginOnly =
    authMechanisms.size > 0 && !authMechanisms.has('PLAIN') && authMechanisms.has('LOGIN');

  if (prefersLoginOnly) {
    await runAuthLogin();
    return;
  }

  if (
    authMechanisms.size > 0 &&
    !authMechanisms.has('PLAIN') &&
    !authMechanisms.has('LOGIN')
  ) {
    throw new Error('SMTP server does not advertise AUTH PLAIN or AUTH LOGIN');
  }

  const plainToken = Buffer.from(`\0${cleanUser}\0${cleanPass}`, 'utf8').toString('base64');
  await session.writeCommand(`AUTH PLAIN ${plainToken}\r\n`, timeoutMs);
  let authResp = await session.readResponse(timeoutMs);

  if (authResp.code === 334) {
    await session.writeCommand(`${plainToken}\r\n`, timeoutMs);
    authResp = await session.readResponse(timeoutMs);
  }

  if (authResp.code === 235) {
    return;
  }

  if (
    (authResp.code === 504 || authResp.code === 500 || authResp.code === 502) &&
    (authMechanisms.has('LOGIN') || authMechanisms.size === 0)
  ) {
    await runAuthLogin();
    return;
  }

  throw new Error(`SMTP authentication failed (${authResp.code})`);
}

async function executeSmtpTransaction(params: {
  mode: 'test' | 'send';
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  ehloHost?: string;
  rejectUnauthorized: boolean;
  timeoutMs: number;
  message?: {
    from: string;
    to: string;
    subject: string;
    textBody: string;
    htmlBody: string;
  };
}): Promise<DispatchResult> {
  const {
    mode,
    host,
    port,
    secure,
    user = '',
    pass = '',
    rejectUnauthorized,
    timeoutMs,
    message,
  } = params;
  const cleanHost = sanitizeSmtpHeaderValue(host);
  const ehloHost =
    sanitizeSmtpHeaderValue(params.ehloHost || 'wedding.local').replace(/[^a-zA-Z0-9.-]/g, '') ||
    'wedding.local';

  let session: SmtpSocketSession | null = null;
  try {
    session = await openSmtpSession({
      host: cleanHost,
      port,
      secure,
      rejectUnauthorized,
      timeoutMs,
    });

    const greeting = await session.readResponse(timeoutMs);
    if (greeting.code !== 220) {
      return {
        success: false,
        error: `Unexpected SMTP greeting (${greeting.code})`,
      };
    }

    await session.writeCommand(`EHLO ${ehloHost}\r\n`, timeoutMs);
    let ehloResp = await session.readResponse(timeoutMs);
    if (ehloResp.code === 500 || ehloResp.code === 502) {
      await session.writeCommand(`HELO ${ehloHost}\r\n`, timeoutMs);
      ehloResp = await session.readResponse(timeoutMs);
    }
    if (ehloResp.code !== 250) {
      return {
        success: false,
        error: `SMTP EHLO rejected (${ehloResp.code})`,
      };
    }

    let capabilities = parseEhloCapabilities(ehloResp.lines);
    let isTlsEncrypted = secure;

    if (!secure) {
      if (port === 587 && !capabilities.supportsStartTls) {
        return {
          success: false,
          error: 'SMTP server on port 587 does not advertise STARTTLS',
        };
      }

      if (port === 587 || capabilities.supportsStartTls) {
        await session.writeCommand('STARTTLS\r\n', timeoutMs);
        const startTlsResp = await session.readResponse(timeoutMs);
        if (startTlsResp.code !== 220) {
          return {
            success: false,
            error: `SMTP STARTTLS rejected (${startTlsResp.code})`,
          };
        }

        await session.upgradeToTls(cleanHost, rejectUnauthorized, timeoutMs);
        isTlsEncrypted = true;

        await session.writeCommand(`EHLO ${ehloHost}\r\n`, timeoutMs);
        const postTlsEhlo = await session.readResponse(timeoutMs);
        if (postTlsEhlo.code !== 250) {
          return {
            success: false,
            error: `SMTP EHLO after STARTTLS rejected (${postTlsEhlo.code})`,
          };
        }
        capabilities = parseEhloCapabilities(postTlsEhlo.lines);
      }
    }

    const cleanUser = user.trim();
    const hasUser = cleanUser.length > 0;
    const hasPass = pass.trim().length > 0;

    if (hasUser || hasPass) {
      if (!hasUser) {
        return { success: false, error: 'SMTP Username required' };
      }
      if (!hasPass) {
        return { success: false, error: 'SMTP Password required' };
      }
      if (!isTlsEncrypted) {
        return {
          success: false,
          error: 'SMTP TLS or STARTTLS is required before authentication',
        };
      }
      await authenticateSmtpSession(
        session,
        cleanUser,
        pass,
        capabilities.authMechanisms,
        timeoutMs
      );
    }

    if (mode === 'send' && message) {
      const fromEnvelope = extractSafeEnvelopeAddress(message.from);
      const toEnvelope = extractSafeEnvelopeAddress(message.to);

      await session.writeCommand(`MAIL FROM:<${fromEnvelope}>\r\n`, timeoutMs);
      const mailFromResp = await session.readResponse(timeoutMs);
      if (mailFromResp.code !== 250) {
        return {
          success: false,
          error: `SMTP MAIL FROM rejected (${mailFromResp.code})`,
        };
      }

      await session.writeCommand(`RCPT TO:<${toEnvelope}>\r\n`, timeoutMs);
      const rcptResp = await session.readResponse(timeoutMs);
      if (rcptResp.code !== 250 && rcptResp.code !== 251) {
        return {
          success: false,
          error: `SMTP RCPT TO rejected (${rcptResp.code})`,
        };
      }

      await session.writeCommand('DATA\r\n', timeoutMs);
      const dataResp = await session.readResponse(timeoutMs);
      if (dataResp.code !== 354) {
        return {
          success: false,
          error: `SMTP DATA rejected (${dataResp.code})`,
        };
      }

      const mimePayload = buildMultipartMimeMessage({
        from: message.from,
        to: message.to,
        subject: message.subject,
        textBody: message.textBody,
        htmlBody: message.htmlBody,
        ehloHost,
      });

      await session.writeCommand(`${mimePayload}\r\n.\r\n`, timeoutMs);
      const queuedResp = await session.readResponse(timeoutMs);
      if (queuedResp.code !== 250) {
        return {
          success: false,
          error: `SMTP message rejected (${queuedResp.code})`,
        };
      }
    }

    try {
      await session.writeCommand('QUIT\r\n', Math.min(2_000, timeoutMs));
      await session.readResponse(Math.min(2_000, timeoutMs));
    } catch {
      // Ignore graceful QUIT close race once transaction or auth check succeeded
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: err instanceof Error && err.message ? err.message : 'SMTP connection failed',
    };
  } finally {
    session?.destroy();
  }
}

type EmailBodyFormat = 'text' | 'html';

export interface EmailMessagePayload {
  to: string;
  from?: string;
  subject: string;
  body: string;
  text?: string;
  isHtml?: boolean;
  format?: EmailBodyFormat;
}

interface SmsMessagePayload {
  to: string;
  from?: string;
  body: string;
}

interface ResolvedEmailBodies {
  htmlBody: string;
  textBody: string;
  includePlainTextPart: boolean;
}

function resolveEmailBodies(
  payload: EmailMessagePayload,
  appConfig?: StationeryCardConfig | null
): ResolvedEmailBodies {
  const isExplicitHtml = payload.isHtml === true || payload.format === 'html';
  const htmlBody = isExplicitHtml
    ? payload.body
    : formatEmailHtmlBody(payload.body, appConfig);
  const textBody =
    typeof payload.text === 'string'
      ? payload.text
      : isExplicitHtml
        ? htmlToPlainText(payload.body)
        : unescapeHtmlEntitiesForPlainText(
          stripStationeryCardDirective(payload.body).replace(/\r\n?/g, '\n')
        );

  return {
    htmlBody,
    textBody,
    includePlainTextPart: isExplicitHtml || typeof payload.text === 'string',
  };
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
        // Simulation / disabled mode (e.g. emailProvider === 'none')
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
    const { htmlBody, textBody, includePlainTextPart } = resolveEmailBodies(payload, this.config);

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: payload.from,
          to: payload.to,
          subject: payload.subject,
          html: htmlBody,
          ...(includePlainTextPart ? { text: textBody } : {}),
        }),
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
    const { htmlBody, textBody, includePlainTextPart } = resolveEmailBodies(payload, this.config);
    const content = includePlainTextPart
      ? [
        { type: 'text/plain', value: textBody },
        { type: 'text/html', value: htmlBody },
      ]
      : [{ type: 'text/html', value: htmlBody }];

    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: payload.to }] }],
          from: { email: payload.from },
          subject: payload.subject,
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

  private async sendSmtpEmail(payload: EmailMessagePayload): Promise<DispatchResult> {
    const host =
      typeof this.config.smtpHost === 'string' ? this.config.smtpHost.trim() : '';
    if (!host) {
      return { success: false, error: 'SMTP Host is missing in settings' };
    }

    const port = resolveValidatedSmtpPort(this.config.smtpPort);
    if (port === null) {
      return {
        success: false,
        error: 'SMTP Port must be 25, 465, 587, or 2525',
      };
    }
    const secure = Boolean(this.config.smtpSecure) || port === 465;
    const user =
      typeof this.config.smtpUser === 'string' ? this.config.smtpUser.trim() : '';
    const pass = this.resolveSecret(undefined, this.config.smtpPass);
    if (user && !pass) {
      return { success: false, error: 'SMTP Password is missing in settings' };
    }

    const timeoutMs =
      typeof this.config.smtpTimeoutMs === 'number' && this.config.smtpTimeoutMs > 0
        ? this.config.smtpTimeoutMs
        : DEFAULT_SMTP_TIMEOUT_MS;
    const rejectUnauthorized = this.config.smtpRejectUnauthorized !== false;

    const { htmlBody, textBody } = resolveEmailBodies(payload, this.config);

    return executeSmtpTransaction({
      mode: 'send',
      host,
      port,
      secure,
      user,
      pass,
      rejectUnauthorized,
      timeoutMs,
      message: {
        from: payload.from || this.config.smtpFrom || this.config.contactEmail || 'noreply@wedding.com',
        to: payload.to,
        subject: payload.subject,
        textBody,
        htmlBody,
      },
    });
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
        const normalizedInputHost = normalizeSmtpHost(input.smtpHost);
        const normalizedStoredHost = normalizeSmtpHost(this.config.smtpHost);
        const host = input.smtpHost?.trim() || this.config.smtpHost?.trim();
        if (!host) return { success: false, error: 'SMTP Host required' };

        const rawPort =
          input.smtpPort !== undefined && input.smtpPort !== null
            ? input.smtpPort
            : this.config.smtpPort;
        const port = resolveValidatedSmtpPort(rawPort);
        if (port === null) {
          return {
            success: false,
            error: 'SMTP Port must be 25, 465, 587, or 2525',
          };
        }
        const explicitSecure =
          input.smtpSecure !== undefined && input.smtpSecure !== null
            ? Boolean(input.smtpSecure)
            : Boolean(this.config.smtpSecure);
        const secure = explicitSecure || port === 465;

        const userRaw =
          input.smtpUser !== undefined && input.smtpUser !== null
            ? input.smtpUser
            : this.config.smtpUser;
        const user = typeof userRaw === 'string' ? userRaw.trim() : '';
        const canReuseStoredPass =
          !normalizedInputHost || normalizedInputHost === normalizedStoredHost;
        const pass = this.resolveSecret(
          input.smtpPass,
          canReuseStoredPass ? this.config.smtpPass : undefined
        );
        if (user && !pass) return { success: false, error: 'SMTP Password required' };
        if (!user && pass) return { success: false, error: 'SMTP Username required' };

        const timeoutMs =
          typeof this.config.smtpTimeoutMs === 'number' && this.config.smtpTimeoutMs > 0
            ? this.config.smtpTimeoutMs
            : DEFAULT_SMTP_TIMEOUT_MS;
        const rejectUnauthorized = this.config.smtpRejectUnauthorized !== false;

        return executeSmtpTransaction({
          mode: 'test',
          host,
          port,
          secure,
          user,
          pass,
          rejectUnauthorized,
          timeoutMs,
        });
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

