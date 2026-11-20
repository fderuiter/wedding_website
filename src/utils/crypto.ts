/**
 * Cryptographic and binary encoding/decoding utilities.
 * Designed for Edge runtime and Node.js compatibility using standard Web Crypto APIs.
 */

/**
 * Encodes a Uint8Array byte array into a URL-safe base64 string (base64url).
 *
 * @param bytes - Byte array to encode
 * @returns Base64url encoded string without padding
 */
export function base64urlEncodeBytes(bytes: Uint8Array): string {
  let binString = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binString += String.fromCharCode(bytes[i]);
  }
  return btoa(binString)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Encodes a UTF-8 string into a URL-safe base64 string (base64url).
 *
 * @param str - String to encode
 * @returns Base64url encoded string without padding
 */
export function base64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return base64urlEncodeBytes(bytes);
}

/**
 * Decodes a base64url encoded string into a Uint8Array byte array.
 *
 * @param str - Base64url encoded string
 * @returns Decoded byte array
 */
export function base64urlDecodeToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binString = atob(base64 + padding);
  const bytes = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decodes a base64url encoded string into a UTF-8 decoded string.
 *
 * @param str - Base64url encoded string
 * @returns Decoded UTF-8 string
 */
export function base64urlDecode(str: string): string {
  const bytes = base64urlDecodeToBytes(str);
  return new TextDecoder().decode(bytes);
}

/**
 * Computes an HMAC-SHA256 signature for data using Web Crypto API (`globalThis.crypto.subtle`).
 *
 * @param secret - Secret key used for signing
 * @param data - Message string to sign
 * @returns Promise resolving to the base64url-encoded HMAC signature
 */
export async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    messageData
  );

  return base64urlEncodeBytes(new Uint8Array(signature));
}

const ADMIN_COOKIE_SIGNING_DOMAIN = 'wedding-website:admin-cookie-signing-key:v1';
const STRICT_BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function decodeStandardBase64ToBytes(b64: string): Uint8Array | null {
  if (!b64 || b64.length % 4 !== 0 || !STRICT_BASE64_PATTERN.test(b64)) {
    return null;
  }
  try {
    const binString = atob(b64);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
      bytes[i] = binString.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Derives a domain-separated HMAC-SHA256 signing secret from `ADMIN_PASSWORD`.
 * Decodes the 16-byte salt and 64-byte scrypt key so raw `ADMIN_PASSWORD` strings
 * cannot forge `admin_auth` session cookies.
 */
export async function deriveAdminSigningKey(adminPassword: string): Promise<string> {
  if (!adminPassword) {
    return '';
  }

  let keyMaterial: Uint8Array;
  if (adminPassword.startsWith('scrypt:')) {
    const parts = adminPassword.split(':');
    if (parts.length !== 3) {
      return '';
    }
    const saltBytes = decodeStandardBase64ToBytes(parts[1]);
    const keyBytes = decodeStandardBase64ToBytes(parts[2]);
    if (!saltBytes || !keyBytes || saltBytes.byteLength !== 16 || keyBytes.byteLength !== 64) {
      return '';
    }
    keyMaterial = new Uint8Array(saltBytes.byteLength + 1 + keyBytes.byteLength);
    keyMaterial.set(saltBytes, 0);
    keyMaterial[saltBytes.byteLength] = 0x3a;
    keyMaterial.set(keyBytes, saltBytes.byteLength + 1);
  } else if (process.env.NODE_ENV === 'test') {
    keyMaterial = new TextEncoder().encode(adminPassword);
  } else {
    return '';
  }

  const domainBytes = new TextEncoder().encode(ADMIN_COOKIE_SIGNING_DOMAIN);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    keyMaterial as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const derived = await globalThis.crypto.subtle.sign('HMAC', cryptoKey, domainBytes);
  return base64urlEncodeBytes(new Uint8Array(derived));
}

/**
 * Constant-time byte array comparison to prevent timing side-channel attacks.
 * Returns false immediately if byte lengths differ.
 *
 * @param a - First byte array
 * @param b - Second byte array
 * @returns True if byte arrays are equal in length and content, false otherwise
 */
export function timingSafeEqualJS(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.byteLength; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
