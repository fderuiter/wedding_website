import fs from 'node:fs';
import path from 'node:path';
import { ARCHETYPE_PRESETS } from '@/lib/sampleData/archetypes';
import {
  buildArchetypeSeedData,
  getRegistryEditStaticParams,
} from '@/lib/sampleData/builder';
import { STATIC_MOCK_CONFIG } from '@/lib/config';
import { weddingPartyRepository } from '@/features/wedding-party';
import { contentService } from '@/features/content';
import { registryService } from '@/features/registry';

describe('STATIC_EXPORT repositories & sample assets', () => {
  const originalStaticExport = process.env.STATIC_EXPORT;
  const publicDir = path.resolve(process.cwd(), 'public');

  beforeEach(() => {
    process.env.STATIC_EXPORT = 'true';
  });

  afterAll(() => {
    if (originalStaticExport === undefined) {
      delete process.env.STATIC_EXPORT;
    } else {
      process.env.STATIC_EXPORT = originalStaticExport;
    }
  });

  it('populates non-empty wedding party members, public gallery photos, and registry items in STATIC_EXPORT mode', async () => {
    const classicSeed = buildArchetypeSeedData('classic');

    const members = await weddingPartyRepository.getMembers();
    expect(members.length).toBe(classicSeed.weddingParty.length);
    expect(members.length).toBeGreaterThanOrEqual(4);

    const photos = await contentService.getPublicPhotos();
    expect(photos.length).toBe(classicSeed.publicPhotos.length);
    expect(photos.length).toBeGreaterThanOrEqual(3);

    const registry = await registryService.getAllItems({ page: 1, limit: 20 });
    expect(registry.items.length).toBe(classicSeed.registryItems.length);

    const staticParams = getRegistryEditStaticParams().map((entry) => entry.id);
    expect(staticParams).toEqual(
      expect.arrayContaining(classicSeed.registryItems.map((item) => item.id))
    );
  });

  it('ships real files in public/ for every archetype preset image, portrait, gallery photo, and favicon', () => {
    const referencedPaths = new Set<string>();

    for (const preset of Object.values(ARCHETYPE_PRESETS)) {
      for (const item of preset.registryItems) {
        if (item.imageUrl.startsWith('/')) referencedPaths.add(item.imageUrl);
      }
      for (const member of preset.weddingParty) {
        if (member.imageUrl.startsWith('/')) referencedPaths.add(member.imageUrl);
      }
      for (const photo of preset.photos) {
        if (photo.url.startsWith('/')) referencedPaths.add(photo.url);
      }
    }
    if (STATIC_MOCK_CONFIG.faviconUrl?.startsWith('/')) {
      referencedPaths.add(STATIC_MOCK_CONFIG.faviconUrl);
    }

    for (const relUrl of referencedPaths) {
      const diskPath = path.join(publicDir, relUrl.replace(/^\//, ''));
      expect(fs.existsSync(diskPath)).toBe(true);
      expect(fs.statSync(diskPath).size).toBeGreaterThan(200);
    }
  });
});
