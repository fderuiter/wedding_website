import fs from 'node:fs';
import path from 'node:path';
import { ARCHETYPE_PRESETS } from '@/lib/sampleData/archetypes';
import { STATIC_MOCK_CONFIG } from '@/lib/config';
import {
  STATIC_MOCK_WEDDING_PARTY_MEMBERS,
  weddingPartyRepository,
} from '@/features/wedding-party';
import {
  STATIC_MOCK_PUBLIC_PHOTOS,
  contentService,
} from '@/features/content';
import {
  STATIC_EXPORT_REGISTRY_ITEMS,
  STATIC_EXPORT_REGISTRY_ITEM_IDS,
  registryService,
} from '@/features/registry';

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
    const members = await weddingPartyRepository.getMembers();
    expect(members.length).toBe(STATIC_MOCK_WEDDING_PARTY_MEMBERS.length);
    expect(members.length).toBeGreaterThanOrEqual(4);

    const photos = await contentService.getPublicPhotos();
    expect(photos.length).toBe(STATIC_MOCK_PUBLIC_PHOTOS.length);
    expect(photos.length).toBeGreaterThanOrEqual(4);

    const registry = await registryService.getAllItems({ page: 1, limit: 20 });
    expect(registry.items.length).toBe(STATIC_EXPORT_REGISTRY_ITEMS.length);
    expect(STATIC_EXPORT_REGISTRY_ITEM_IDS).toEqual(
      expect.arrayContaining(['1', ...STATIC_EXPORT_REGISTRY_ITEMS.map((item) => item.id)]),
    );
  });

  it('ships real files in public/ for every archetype preset image, gallery photo, portrait, and favicon', () => {
    const referencedPaths = new Set<string>();

    for (const preset of Object.values(ARCHETYPE_PRESETS)) {
      for (const item of preset.registryItems) {
        referencedPaths.add(item.imageUrl);
      }
    }
    for (const member of STATIC_MOCK_WEDDING_PARTY_MEMBERS) {
      const portraitUrl = member.photoUrl ?? member.photo?.url;
      if (portraitUrl) referencedPaths.add(portraitUrl);
    }
    for (const photo of STATIC_MOCK_PUBLIC_PHOTOS) {
      const url = (photo.data as { url?: string })?.url;
      if (url) referencedPaths.add(url);
    }
    if (STATIC_MOCK_CONFIG.faviconUrl) {
      referencedPaths.add(STATIC_MOCK_CONFIG.faviconUrl);
    }

    for (const relUrl of referencedPaths) {
      const diskPath = path.join(publicDir, relUrl.replace(/^\//, ''));
      expect(fs.existsSync(diskPath)).toBe(true);
      expect(fs.statSync(diskPath).size).toBeGreaterThan(200);
    }
  });
});
