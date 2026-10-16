import {
  base64urlEncode,
  base64urlEncodeBytes,
  base64urlDecode,
  base64urlDecodeToBytes,
  hmacSha256,
  timingSafeEqualJS,
} from '../crypto';

describe('src/utils/crypto', () => {
  describe('base64url encoding and decoding', () => {
    test('base64urlEncode and base64urlDecode roundtrip for standard text', () => {
      const input = 'Hello, World!';
      const encoded = base64urlEncode(input);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');

      const decoded = base64urlDecode(encoded);
      expect(decoded).toBe(input);
    });

    test('base64urlEncode produces correct base64url characters for known input requiring + and / in standard base64', () => {
      // JSON strings often produce '+' and '/' in standard base64
      const jsonString = JSON.stringify({ isAdmin: true, iat: 1700000000, exp: 1700028800 });
      const encoded = base64urlEncode(jsonString);

      expect(encoded).not.toMatch(/[+/=]/);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toBe(jsonString);
    });

    test('base64urlDecode handles padding variations', () => {
      const input = 'test-string-padding';
      const encoded = base64urlEncode(input);
      const decoded = base64urlDecode(encoded);
      expect(decoded).toBe(input);
    });

    test('base64urlEncodeBytes and base64urlDecodeToBytes roundtrip for binary Uint8Array', () => {
      const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
      const encoded = base64urlEncodeBytes(bytes);
      expect(encoded).not.toMatch(/[+/=]/);

      const decodedBytes = base64urlDecodeToBytes(encoded);
      expect(Array.from(decodedBytes)).toEqual(Array.from(bytes));
    });

    test('handles empty strings and empty byte arrays', () => {
      expect(base64urlEncode('')).toBe('');
      expect(base64urlDecode('')).toBe('');

      const emptyBytes = new Uint8Array([]);
      expect(base64urlEncodeBytes(emptyBytes)).toBe('');
      expect(base64urlDecodeToBytes('')).toEqual(new Uint8Array(0));
    });
  });

  describe('hmacSha256', () => {
    test('computes deterministic HMAC-SHA256 signature in base64url format', async () => {
      const secret = 'supersecretkey';
      const data = 'payload-data-to-sign';

      const sig1 = await hmacSha256(secret, data);
      const sig2 = await hmacSha256(secret, data);

      expect(typeof sig1).toBe('string');
      expect(sig1.length).toBeGreaterThan(0);
      expect(sig1).toBe(sig2);
      expect(sig1).not.toMatch(/[+/=]/);
    });

    test('produces different HMAC signature for different secrets or payloads', async () => {
      const secret1 = 'key1';
      const secret2 = 'key2';
      const data1 = 'message1';
      const data2 = 'message2';

      const sig1 = await hmacSha256(secret1, data1);
      const sig2 = await hmacSha256(secret2, data1);
      const sig3 = await hmacSha256(secret1, data2);

      expect(sig1).not.toBe(sig2);
      expect(sig1).not.toBe(sig3);
    });
  });

  describe('timingSafeEqualJS', () => {
    test('returns true for matching Uint8Array buffers', () => {
      const a = new Uint8Array([10, 20, 30, 40]);
      const b = new Uint8Array([10, 20, 30, 40]);
      expect(timingSafeEqualJS(a, b)).toBe(true);
    });

    test('returns true for empty Uint8Array buffers', () => {
      const a = new Uint8Array([]);
      const b = new Uint8Array([]);
      expect(timingSafeEqualJS(a, b)).toBe(true);
    });

    test('returns false for buffers with mismatched lengths', () => {
      const a = new Uint8Array([10, 20, 30]);
      const b = new Uint8Array([10, 20, 30, 40]);
      expect(timingSafeEqualJS(a, b)).toBe(false);
    });

    test('returns false for buffers with same length but differing content', () => {
      const a = new Uint8Array([10, 20, 30, 40]);
      const b = new Uint8Array([10, 20, 30, 41]);
      expect(timingSafeEqualJS(a, b)).toBe(false);

      const c = new Uint8Array([11, 20, 30, 40]);
      expect(timingSafeEqualJS(a, c)).toBe(false);
    });
  });
});
