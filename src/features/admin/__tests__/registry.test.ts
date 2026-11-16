import { getEntityService } from '../registry';
import { ContentNodeAdminService } from '@/features/content';
import { WeddingPartyAdminService } from '@/features/wedding-party';
import { AttractionAdminService } from '@/features/attractions';
import { RegistryItemAdminService } from '@/features/registry';

describe('Admin Service Registry', () => {
  test('resolves content-nodes service', async () => {
    const result = await getEntityService('content-nodes');
    expect(result).not.toBeNull();
    expect(result?.service).toBeInstanceOf(ContentNodeAdminService);
  });

  test('resolves wedding-party service', async () => {
    const result = await getEntityService('wedding-party');
    expect(result).not.toBeNull();
    expect(result?.service).toBeInstanceOf(WeddingPartyAdminService);
  });

  test('resolves attractions service', async () => {
    const result = await getEntityService('attractions');
    expect(result).not.toBeNull();
    expect(result?.service).toBeInstanceOf(AttractionAdminService);
  });

  test('resolves registry-items service', async () => {
    const result = await getEntityService('registry-items');
    expect(result).not.toBeNull();
    expect(result?.service).toBeInstanceOf(RegistryItemAdminService);
  });

  test('returns null for unknown entity key', async () => {
    const result = await getEntityService('non-existent-entity');
    expect(result).toBeNull();
  });
});
