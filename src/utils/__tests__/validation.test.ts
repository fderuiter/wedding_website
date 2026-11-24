import {
  AdminEntityBatchUpdateSchema,
  AdminLoginSchema,
  AdminSetupSchema,
  GuestLoginSchema,
  GuestPhotoUploadSchema,
  HEIC_EXTENSIONS,
  ScrapeUrlSchema,
  isHeicExtension,
  safeUrlSchema,
  sanitizeUrl,
} from '../validation';

test('AdminLoginSchema is defined', () => {
  expect(AdminLoginSchema).toBeDefined();
});

describe('Password and Passcode 256-character caps', () => {
  it('accepts secrets up to 256 characters and rejects 257+ characters across login and setup schemas', () => {
    expect(AdminLoginSchema.safeParse({ password: 'a'.repeat(256) }).success).toBe(true);
    expect(AdminLoginSchema.safeParse({ password: 'a'.repeat(257) }).success).toBe(false);

    expect(GuestLoginSchema.safeParse({ passcode: 'p'.repeat(256) }).success).toBe(true);
    expect(GuestLoginSchema.safeParse({ passcode: 'p'.repeat(257) }).success).toBe(false);

    expect(AdminSetupSchema.safeParse({ password: 's'.repeat(256) }).success).toBe(true);
    expect(AdminSetupSchema.safeParse({ password: 's'.repeat(257) }).success).toBe(false);
  });
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
  it('validates valid 10MB JPEG, PNG, WebP, and HEIC/HEIF files', () => {
    const validPng = { size: 1024, type: 'image/png', name: 'photo.png' };
    const validJpeg = { size: 1024, type: 'image/jpeg', name: 'photo.jpg' };
    const validWebp = { size: 1024, type: 'image/webp', name: 'photo.webp' };
    const validHeic = { size: 1024, type: 'image/heic', name: 'IMG_1234.HEIC' };
    const validHeif = { size: 1024, type: 'image/heif', name: 'IMG_1235.heif' };
    const emptyMimeHeic = { size: 1024, type: '', name: 'IMG_1236.heic' };
    const octetStreamHeic = { size: 1024, type: 'application/octet-stream', name: 'IMG_1237.HEIF' };

    expect(HEIC_EXTENSIONS).toEqual(['.heic', '.heif']);
    expect(isHeicExtension('.heic')).toBe(true);
    expect(isHeicExtension('.jpg')).toBe(false);

    expect(GuestPhotoUploadSchema.safeParse({ file: validPng }).success).toBe(true);
    expect(GuestPhotoUploadSchema.safeParse({ file: validJpeg }).success).toBe(true);
    expect(GuestPhotoUploadSchema.safeParse({ file: validWebp }).success).toBe(true);
    expect(GuestPhotoUploadSchema.safeParse({ file: validHeic }).success).toBe(true);
    expect(GuestPhotoUploadSchema.safeParse({ file: validHeif }).success).toBe(true);
    expect(GuestPhotoUploadSchema.safeParse({ file: emptyMimeHeic }).success).toBe(true);
    expect(GuestPhotoUploadSchema.safeParse({ file: octetStreamHeic }).success).toBe(true);
  });

  it('trims optional uploaderName and caption and enforces length limits', () => {
    const validJpeg = { size: 1024, type: 'image/jpeg', name: 'photo.jpg' };

    const parsed = GuestPhotoUploadSchema.safeParse({
      file: validJpeg,
      uploaderName: '  Aunt Clara  ',
      caption: '  Sparkler send-off!  ',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.uploaderName).toBe('Aunt Clara');
      expect(parsed.data.caption).toBe('Sparkler send-off!');
    }

    const blankOptional = GuestPhotoUploadSchema.safeParse({
      file: validJpeg,
      uploaderName: '   ',
      caption: '',
    });
    expect(blankOptional.success).toBe(true);
    if (blankOptional.success) {
      expect(blankOptional.data.uploaderName).toBeUndefined();
      expect(blankOptional.data.caption).toBeUndefined();
    }

    const longName = GuestPhotoUploadSchema.safeParse({
      file: validJpeg,
      uploaderName: 'a'.repeat(101),
    });
    expect(longName.success).toBe(false);

    const longCaption = GuestPhotoUploadSchema.safeParse({
      file: validJpeg,
      caption: 'c'.repeat(501),
    });
    expect(longCaption.success).toBe(false);
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
        'Invalid file format. Only JPEG, PNG, WebP, and HEIC images are allowed'
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

describe('ScrapeUrlSchema and AdminEntityBatchUpdateSchema', () => {
  it('returns URL is required for missing or empty URLs and Invalid URL format for malformed URLs', () => {
    const missing = ScrapeUrlSchema.safeParse({});
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues[0].message).toBe('URL is required');
    }

    const empty = ScrapeUrlSchema.safeParse({ url: '' });
    expect(empty.success).toBe(false);
    if (!empty.success) {
      expect(empty.error.issues[0].message).toBe('URL is required');
    }

    const malformed = ScrapeUrlSchema.safeParse({ url: 'not-a-valid-url' });
    expect(malformed.success).toBe(false);
    if (!malformed.success) {
      expect(malformed.error.issues[0].message).toBe('Invalid URL format');
    }

    const valid = ScrapeUrlSchema.safeParse({ url: 'https://example.com/item' });
    expect(valid.success).toBe(true);

    const jsonSchema = ScrapeUrlSchema.toJSONSchema({ unrepresentable: 'any' }) as {
      properties?: { url?: { minLength?: number; format?: string } };
    };
    expect(jsonSchema.properties?.url?.minLength).toBe(1);
    expect(jsonSchema.properties?.url?.format).toBe('uri');
  });

  it('preserves unknown batch update properties via .loose()', () => {
    const parsed = AdminEntityBatchUpdateSchema.safeParse({
      ids: ['id-1', 'id-2'],
      isVisible: true,
      category: 'Featured',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        ids: ['id-1', 'id-2'],
        isVisible: true,
        category: 'Featured',
      });
    }
  });
});

