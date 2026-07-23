import { getLocalImageDimensions } from '../image-metadata';

describe('getLocalImageDimensions', () => {
  it('extracts dimensions from a JPEG file', () => {
    const dims = getLocalImageDimensions('/images/sunset-embrace.jpg');
    expect(dims).toEqual({ width: 1024, height: 1024 });
  });

  it('extracts dimensions from a PNG file', () => {
    const dims = getLocalImageDimensions('/images/placeholder.png');
    expect(dims).toEqual({ width: 1024, height: 1024 });
  });

  it('extracts dimensions from an SVG file (viewBox)', () => {
    const dims = getLocalImageDimensions('src/utils/__tests__/fixtures/next.svg');
    expect(dims).toEqual({ width: 394, height: 80 });
  });

  it('extracts dimensions from an SVG file with a different viewBox', () => {
    const dims = getLocalImageDimensions('src/utils/__tests__/fixtures/globe.svg');
    expect(dims).toEqual({ width: 16, height: 16 });
  });

  it('returns null for remote URLs', () => {
    const dims = getLocalImageDimensions('https://example.com/image.jpg');
    expect(dims).toBeNull();
  });

  it('returns null for missing files', () => {
    const dims = getLocalImageDimensions('/images/missing-image.png');
    expect(dims).toBeNull();
  });

  it('returns null for unsupported formats or malformed files', () => {
    const dims = getLocalImageDimensions('/API_DOCUMENTATION.md');
    expect(dims).toBeNull();
  });
});
