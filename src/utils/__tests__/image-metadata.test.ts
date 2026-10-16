import { getLocalImageDimensions } from '../image-metadata';

describe('getLocalImageDimensions', () => {
  it('extracts dimensions from a JPEG file', async () => {
    const dims = await getLocalImageDimensions('/images/sunset-embrace.jpg');
    expect(dims).toEqual({ width: 1024, height: 1024 });
  });

  it('extracts dimensions from a PNG file', async () => {
    const dims = await getLocalImageDimensions('/images/placeholder.png');
    expect(dims).toEqual({ width: 1024, height: 1024 });
  });

  it('extracts dimensions from an SVG file (viewBox)', async () => {
    const dims = await getLocalImageDimensions('src/utils/__tests__/fixtures/next.svg');
    expect(dims).toEqual({ width: 394, height: 80 });
  });

  it('extracts dimensions from an SVG file with a different viewBox', async () => {
    const dims = await getLocalImageDimensions('src/utils/__tests__/fixtures/globe.svg');
    expect(dims).toEqual({ width: 16, height: 16 });
  });

  it('returns null for remote URLs', async () => {
    const dims = await getLocalImageDimensions('https://example.com/image.jpg');
    expect(dims).toBeNull();
  });

  it('returns null for missing files', async () => {
    const dims = await getLocalImageDimensions('/images/missing-image.png');
    expect(dims).toBeNull();
  });

  it('returns null for unsupported formats or malformed files', async () => {
    const dims = await getLocalImageDimensions('/API_DOCUMENTATION.md');
    expect(dims).toBeNull();
  });
});
