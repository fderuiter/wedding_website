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

describe('GuestPhotoUploadSchema', () => {
  const { GuestPhotoUploadSchema } = require('../validation');

  it('validates valid 10MB JPEG, PNG, and WebP files', () => {
    const validPng = { size: 1024, type: 'image/png', name: 'photo.png' };
    const validJpeg = { size: 1024, type: 'image/jpeg', name: 'photo.jpg' };
    const validWebp = { size: 1024, type: 'image/webp', name: 'photo.webp' };

    expect(GuestPhotoUploadSchema.safeParse({ file: validPng }).success).toBe(true);
    expect(GuestPhotoUploadSchema.safeParse({ file: validJpeg }).success).toBe(true);
    expect(GuestPhotoUploadSchema.safeParse({ file: validWebp }).success).toBe(true);
  });

  it('validates batch uploads with array of 1 to 10 photos', () => {
    const validPng = { size: 1024, type: 'image/png', name: 'photo.png' };
    const validJpeg = { size: 2048, type: 'image/jpeg', name: 'photo.jpg' };

    const batchResult = GuestPhotoUploadSchema.safeParse({ files: [validPng, validJpeg] });
    expect(batchResult.success).toBe(true);
    if (batchResult.success) {
      expect(batchResult.data.files).toHaveLength(2);
    }
  });

  it('rejects batch payloads exceeding 10 files limit', () => {
    const validPng = { size: 1024, type: 'image/png', name: 'photo.png' };
    const elevenFiles = Array(11).fill(validPng);

    const result = GuestPhotoUploadSchema.safeParse({ files: elevenFiles });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('Maximum 10 photos allowed per upload');
    }
  });

  it('rejects empty file payloads', () => {
    const result = GuestPhotoUploadSchema.safeParse({ files: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('No file provided');
    }
  });

  it('rejects files exceeding 10MB', () => {
    const oversized = { size: 10 * 1024 * 1024 + 1, type: 'image/png', name: 'photo.png' };
    const result = GuestPhotoUploadSchema.safeParse({ file: oversized });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('File size exceeds 10MB limit');
    }
  });

  it('rejects unsupported file formats', () => {
    const pdfFile = { size: 1024, type: 'application/pdf', name: 'doc.pdf' };
    const result = GuestPhotoUploadSchema.safeParse({ file: pdfFile });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe(
        'Invalid file format. Only JPEG, PNG, and WebP images are allowed'
      );
    }
  });

  it('rejects batch if any file extension does not match declared MIME type', () => {
    const validPng = { size: 1024, type: 'image/png', name: 'photo.png' };
    const mismatched = { size: 1024, type: 'image/jpeg', name: 'photo.png' };

    const result = GuestPhotoUploadSchema.safeParse({ files: [validPng, mismatched] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('File extension does not match the declared MIME type');
    }
  });
});

