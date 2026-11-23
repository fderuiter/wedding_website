import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const INTERNAL_SOCKET_IP_HEADER = 'x-internal-socket-ip';
export const INTERNAL_SOCKET_IP_SIG_HEADER = 'x-internal-socket-ip-sig';

const SOCKET_IP_SECRET_SYMBOL = Symbol.for('wedding_website.internalSocketIpSecret');
const SOCKET_IP_HOOK_SYMBOL = Symbol.for('wedding_website.socketIpBoundaryInstalled');

const IPV4_MAPPED_IPV6_REGEX = /^(?:::ffff:|(?:0{1,4}:){5}ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i;
const HEX_SHA256_REGEX = /^[0-9a-f]{64}$/i;

/**
 * Normalizes a socket or forwarded IP address, canonicalizing IPv4-mapped IPv6
 * addresses (e.g. `::ffff:127.0.0.2`) to standard dotted-quad IPv4 (`127.0.0.2`).
 *
 * @param {unknown} rawIp
 * @returns {string | null}
 */
export function normalizeSocketIp(rawIp) {
  if (typeof rawIp !== 'string') {
    return null;
  }

  let candidate = rawIp.trim();
  if (!candidate) {
    return null;
  }

  if (candidate.startsWith('[') && candidate.endsWith(']')) {
    candidate = candidate.slice(1, -1).trim();
  }

  const zoneIdx = candidate.indexOf('%');
  if (zoneIdx !== -1) {
    candidate = candidate.slice(0, zoneIdx);
  }

  if (!candidate || /[\x00-\x20\x7f,]/.test(candidate)) {
    return null;
  }

  const mappedMatch = candidate.match(IPV4_MAPPED_IPV6_REGEX);
  if (mappedMatch && net.isIPv4(mappedMatch[1])) {
    return mappedMatch[1];
  }

  const version = net.isIP(candidate);
  if (version === 4) {
    return candidate;
  }
  if (version === 6) {
    return candidate.toLowerCase();
  }

  return null;
}

/**
 * Returns (or lazily initializes) the per-process 256-bit HMAC secret used to
 * sign and verify internal socket-IP headers across module graphs.
 *
 * @returns {string}
 */
export function getOrCreateSocketIpSecret() {
  const store = /** @type {Record<symbol, unknown>} */ (globalThis);
  const existing = store[SOCKET_IP_SECRET_SYMBOL];
  if (typeof existing === 'string' && HEX_SHA256_REGEX.test(existing)) {
    return existing;
  }

  const generated = crypto.randomBytes(32).toString('hex');
  store[SOCKET_IP_SECRET_SYMBOL] = generated;
  return generated;
}

/**
 * Reads the active per-process socket-IP HMAC secret without initializing a new one.
 *
 * @returns {string | null}
 */
function peekSocketIpSecret() {
  const store = /** @type {Record<symbol, unknown>} */ (globalThis);
  const existing = store[SOCKET_IP_SECRET_SYMBOL];
  if (typeof existing === 'string' && HEX_SHA256_REGEX.test(existing)) {
    return existing;
  }
  return null;
}

/**
 * Computes an HMAC-SHA256 signature for a normalized socket IP address.
 *
 * @param {string} normalizedIp
 * @param {string} secret
 * @returns {string}
 */
function computeSocketIpSignature(normalizedIp, secret) {
  return crypto.createHmac('sha256', secret).update(normalizedIp).digest('hex');
}

/**
 * Strips any client-supplied internal socket-IP headers from a Node HTTP request
 * before stamping the verified TCP peer address.
 *
 * @param {{ headers?: Record<string, unknown>; rawHeaders?: string[] }} req
 */
export function stripInternalSocketIpHeaders(req) {
  if (!req || typeof req !== 'object') {
    return;
  }

  if (req.headers && typeof req.headers === 'object') {
    for (const key of Object.keys(req.headers)) {
      const lower = key.toLowerCase();
      if (lower === INTERNAL_SOCKET_IP_HEADER || lower === INTERNAL_SOCKET_IP_SIG_HEADER) {
        delete req.headers[key];
      }
    }
  }

  if (Array.isArray(req.rawHeaders) && req.rawHeaders.length > 0) {
    const filtered = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      const value = req.rawHeaders[i + 1];
      const lower = typeof name === 'string' ? name.toLowerCase() : '';
      if (lower !== INTERNAL_SOCKET_IP_HEADER && lower !== INTERNAL_SOCKET_IP_SIG_HEADER) {
        filtered.push(name);
        if (value !== undefined) {
          filtered.push(value);
        }
      }
    }
    req.rawHeaders.length = 0;
    req.rawHeaders.push(...filtered);
  }
}

/**
 * Strips untrusted internal socket headers on an incoming Node HTTP request and
 * stamps the verified `socket.remoteAddress` with a per-process HMAC signature.
 *
 * @param {{
 *   headers?: Record<string, string | string[] | undefined>;
 *   rawHeaders?: string[];
 *   socket?: { remoteAddress?: string | null };
 *   connection?: { remoteAddress?: string | null };
 * }} req
 * @returns {string | null}
 */
export function stampIncomingMessageSocketIp(req) {
  if (!req || typeof req !== 'object' || !req.headers || typeof req.headers !== 'object') {
    return null;
  }

  stripInternalSocketIpHeaders(req);

  const remoteAddress = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? null;
  const normalizedIp = normalizeSocketIp(remoteAddress);
  if (!normalizedIp) {
    return null;
  }

  const secret = getOrCreateSocketIpSecret();
  const sig = computeSocketIpSignature(normalizedIp, secret);

  req.headers[INTERNAL_SOCKET_IP_HEADER] = normalizedIp;
  req.headers[INTERNAL_SOCKET_IP_SIG_HEADER] = sig;

  if (Array.isArray(req.rawHeaders)) {
    req.rawHeaders.push(INTERNAL_SOCKET_IP_HEADER, normalizedIp, INTERNAL_SOCKET_IP_SIG_HEADER, sig);
  }

  return normalizedIp;
}

/**
 * Wraps a Server prototype's `emit` method to sanitize and stamp incoming `'request'` events.
 *
 * @param {{ emit: (..._args: unknown[]) => boolean }} proto
 */
function wrapServerEmit(proto) {
  if (!proto || typeof proto.emit !== 'function') {
    return;
  }

  const originalEmit = proto.emit;
  proto.emit = function patchedEmit(event, ...args) {
    if (event === 'request' && args.length > 0 && args[0] && typeof args[0] === 'object') {
      stampIncomingMessageSocketIp(/** @type {http.IncomingMessage} */ (args[0]));
    }
    return originalEmit.call(this, event, ...args);
  };
}

/**
 * Idempotently installs the HTTP/HTTPS server `'request'` boundary hook so every
 * incoming TCP request strips forged headers and stamps a verified `socket.remoteAddress`.
 */
export function installHttpSocketIpBoundary() {
  const store = /** @type {Record<symbol, unknown>} */ (globalThis);
  if (store[SOCKET_IP_HOOK_SYMBOL] === true) {
    return;
  }

  getOrCreateSocketIpSecret();
  wrapServerEmit(http.Server.prototype);
  if (https.Server?.prototype && https.Server.prototype.emit !== http.Server.prototype.emit) {
    wrapServerEmit(https.Server.prototype);
  }

  store[SOCKET_IP_HOOK_SYMBOL] = true;
}

/**
 * Creates a header dictionary containing a verified internal socket-IP header pair
 * (optionally merged with additional request headers).
 *
 * @param {string} remoteAddress
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Record<string, string>}
 */
export function createVerifiedSocketIpHeaders(remoteAddress, extraHeaders = {}) {
  const merged = { ...extraHeaders };
  for (const key of Object.keys(merged)) {
    const lower = key.toLowerCase();
    if (lower === INTERNAL_SOCKET_IP_HEADER || lower === INTERNAL_SOCKET_IP_SIG_HEADER) {
      delete merged[key];
    }
  }

  const normalizedIp = normalizeSocketIp(remoteAddress);
  if (!normalizedIp) {
    return merged;
  }

  const secret = getOrCreateSocketIpSecret();
  const sig = computeSocketIpSignature(normalizedIp, secret);

  return {
    ...merged,
    [INTERNAL_SOCKET_IP_HEADER]: normalizedIp,
    [INTERNAL_SOCKET_IP_SIG_HEADER]: sig,
  };
}

/**
 * Reads a single header string from a Fetch `Headers` instance or plain header map.
 *
 * @param {unknown} headers
 * @param {string} headerName
 * @returns {string | null}
 */
function getHeaderString(headers, headerName) {
  if (!headers || typeof headers !== 'object') {
    return null;
  }

  const maybeFetchHeaders = /** @type {{ get?: (_name: string) => string | null }} */ (headers);
  if (typeof maybeFetchHeaders.get === 'function') {
    const val = maybeFetchHeaders.get(headerName);
    return typeof val === 'string' && val.trim() ? val.trim() : null;
  }

  const record = /** @type {Record<string, unknown>} */ (headers);
  const direct = record[headerName];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === headerName) {
      const val = record[key];
      if (typeof val === 'string' && val.trim()) {
        return val.trim();
      }
      if (Array.isArray(val) && typeof val[0] === 'string' && val[0].trim()) {
        return val[0].trim();
      }
    }
  }
  return null;
}

/**
 * Verifies and returns the stamped internal socket IP address from request headers,
 * or `null` if the header is missing, malformed, or fails constant-time HMAC verification.
 *
 * @param {unknown} headers
 * @returns {string | null}
 */
export function readVerifiedSocketIp(headers) {
  const secret = peekSocketIpSecret();
  if (!secret) {
    return null;
  }

  const rawIp = getHeaderString(headers, INTERNAL_SOCKET_IP_HEADER);
  const rawSig = getHeaderString(headers, INTERNAL_SOCKET_IP_SIG_HEADER);
  if (!rawIp || !rawSig || !HEX_SHA256_REGEX.test(rawSig)) {
    return null;
  }

  const normalizedIp = normalizeSocketIp(rawIp);
  if (!normalizedIp) {
    return null;
  }

  const expectedSig = computeSocketIpSignature(normalizedIp, secret);
  const actualBuf = Buffer.from(rawSig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');

  if (actualBuf.byteLength !== expectedBuf.byteLength || !crypto.timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  return normalizedIp;
}
