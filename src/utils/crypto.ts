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
