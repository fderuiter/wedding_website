import { ContentNodeAdminService } from '@/features/content/admin.service';
import { WeddingPartyAdminService } from '@/features/wedding-party/admin.service';
import { AttractionAdminService } from '@/features/attractions/admin.service';
import { RegistryItemAdminService } from '@/features/registry/admin.service';
import { InvitationCodeAdminService } from '@/features/registry/invitation-code.admin.service';

const serviceMap: Record<string, any> = {
  [ContentNodeAdminService.ENTITY_KEY]: new ContentNodeAdminService(),
  [WeddingPartyAdminService.ENTITY_KEY]: new WeddingPartyAdminService(),
  [AttractionAdminService.ENTITY_KEY]: new AttractionAdminService(),
  [RegistryItemAdminService.ENTITY_KEY]: new RegistryItemAdminService(),
  [InvitationCodeAdminService.ENTITY_KEY]: new InvitationCodeAdminService(),
};

export async function getEntityService(entityKey: string) {
  const service = serviceMap[entityKey];
  if (!service) return null;

  return { service };
}

