import { AdminLoginSchema, safeUrlSchema, sanitizeUrl } from '../validation';

test('AdminLoginSchema is defined', () => {
  expect(AdminLoginSchema).toBeDefined();
});

describe('sanitizeUrl', () => {
  it('allows safe http, https, mailto, tel, and relative URLs', () => {
    expect(sanitizeUrl('https://example.com')).toBe('https://example.com');
    expect(sanitizeUrl('http://example.com/path?query=1')).toBe('http://example.com/path?query=1');
    expect(sanitizeUrl('mailto:test@example.com')).toBe('mailto:test@example.com');
    expect(sanitizeUrl('tel:+1234567890')).toBe('tel:+1234567890');
    expect(sanitizeUrl('/relative/path')).toBe('/relative/path');
  });

  it('rejects javascript, data, vbscript, and protocol-relative URLs', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeUndefined();
    expect(sanitizeUrl('JAVASCRIPT:alert(1)')).toBeUndefined();
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBeUndefined();
    expect(sanitizeUrl('//malicious.example.com')).toBeUndefined();
    expect(sanitizeUrl('   ')).toBeUndefined();
    expect(sanitizeUrl(null)).toBeUndefined();
  });
});

describe('safeUrlSchema', () => {
  it('validates safe URLs and rejects dangerous protocol URLs', () => {
    expect(safeUrlSchema.safeParse('https://example.com').success).toBe(true);
    expect(safeUrlSchema.safeParse('/path').success).toBe(true);
    expect(safeUrlSchema.safeParse('').success).toBe(true);
    expect(safeUrlSchema.safeParse(null).success).toBe(true);
    expect(safeUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
  });
});

