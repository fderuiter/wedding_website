import fs from 'fs';
import path from 'path';
import os from 'os';
import { getLocalImageDimensions } from '../image-metadata';

describe('getLocalImageDimensions', () => {
  const publicDir = path.resolve(process.cwd(), 'public');
  const tempPublicSubdir = `__test_svg_fixtures_${process.pid}__`;
  const tempPublicFixtureDir = path.join(publicDir, tempPublicSubdir);
  const srcFixturesDir = path.resolve(process.cwd(), 'src/utils/__tests__/fixtures');
  let outsideTempDir: string;

  beforeAll(async () => {
    await fs.promises.mkdir(tempPublicFixtureDir, { recursive: true });
    await fs.promises.copyFile(
      path.join(srcFixturesDir, 'next.svg'),
      path.join(tempPublicFixtureDir, 'next.svg')
    );
    await fs.promises.copyFile(
      path.join(srcFixturesDir, 'globe.svg'),
      path.join(tempPublicFixtureDir, 'globe.svg')
    );
    outsideTempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'img-meta-outside-'));
  });

  afterAll(async () => {
    await fs.promises.rm(tempPublicFixtureDir, { recursive: true, force: true });
    if (outsideTempDir) {
      await fs.promises.rm(outsideTempDir, { recursive: true, force: true });
    }
  });

  it('extracts dimensions from a JPEG file', async () => {
    const dims = await getLocalImageDimensions('/images/sunset-embrace.jpg');
    expect(dims).toEqual({ width: 1024, height: 1024 });
  });

  it('extracts dimensions from a PNG file', async () => {
    const dims = await getLocalImageDimensions('/images/placeholder.png');
    expect(dims).toEqual({ width: 1024, height: 1024 });
  });

  it('extracts dimensions from an SVG file (viewBox)', async () => {
    const dims = await getLocalImageDimensions(`/${tempPublicSubdir}/next.svg`);
    expect(dims).toEqual({ width: 394, height: 80 });
  });

  it('extracts dimensions from an SVG file with a different viewBox', async () => {
    const dims = await getLocalImageDimensions(`/${tempPublicSubdir}/globe.svg`);
    expect(dims).toEqual({ width: 16, height: 16 });
  });

  it('returns null for repo-relative paths without a leading slash', async () => {
    const dims = await getLocalImageDimensions('src/utils/__tests__/fixtures/next.svg');
    expect(dims).toBeNull();
  });

  it('returns null for parent traversal, encoded traversal, backslashes, and null bytes', async () => {
    const outsideSvg = path.join(outsideTempDir, 'canary.svg');
    await fs.promises.writeFile(
      outsideSvg,
      '<svg width="31337" height="42424" xmlns="http://www.w3.org/2000/svg"></svg>\n',
      'utf8'
    );

    expect(await getLocalImageDimensions('/../package.json')).toBeNull();
    expect(await getLocalImageDimensions('/%2e%2e/package.json')).toBeNull();
    expect(await getLocalImageDimensions('/images/../../package.json')).toBeNull();
    expect(await getLocalImageDimensions('/images\\placeholder.png')).toBeNull();
    expect(await getLocalImageDimensions('/images/%5cplaceholder.png')).toBeNull();
    expect(await getLocalImageDimensions('/images/placeholder.png\0')).toBeNull();
    expect(await getLocalImageDimensions('//example.com/placeholder.png')).toBeNull();
  });

  it('returns null for symlinks inside public/ pointing outside public/ and for directories', async () => {
    const outsideSvg = path.join(outsideTempDir, 'outside.svg');
    await fs.promises.writeFile(
      outsideSvg,
      '<svg width="31337" height="42424" xmlns="http://www.w3.org/2000/svg"></svg>\n',
      'utf8'
    );
    const symlinkInPublic = path.join(tempPublicFixtureDir, 'outside-link.svg');
    await fs.promises.symlink(outsideSvg, symlinkInPublic);

    expect(await getLocalImageDimensions(`/${tempPublicSubdir}/outside-link.svg`)).toBeNull();
    expect(await getLocalImageDimensions('/images')).toBeNull();
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
