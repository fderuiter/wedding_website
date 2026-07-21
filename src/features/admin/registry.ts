import { RegistryItemAdminService } from '@/features/registry/admin.service';
import { ContentNodeAdminService } from '@/features/content/admin.service';
import { AttractionAdminService } from '@/features/attractions/admin.service';
import { WeddingPartyAdminService } from '@/features/wedding-party/admin.service';

const serviceMap: Record<string, any> = {
  [RegistryItemAdminService.ENTITY_KEY]: new RegistryItemAdminService(),
  [ContentNodeAdminService.ENTITY_KEY]: new ContentNodeAdminService(),
  [AttractionAdminService.ENTITY_KEY]: new AttractionAdminService(),
  [WeddingPartyAdminService.ENTITY_KEY]: new WeddingPartyAdminService(),
};

export async function getEntityService(entityKey: string) {
  const service = serviceMap[entityKey];
  if (!service) return null;

  return { service };
}
