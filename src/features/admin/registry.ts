export async function getEntityService(entityKey: string) {
  switch (entityKey) {
    case 'content-nodes': {
      const { ContentNodeAdminService } = await import('@/features/content');
      return { service: new ContentNodeAdminService() };
    }
    case 'wedding-party': {
      const { WeddingPartyAdminService } = await import('@/features/wedding-party');
      return { service: new WeddingPartyAdminService() };
    }
    case 'attractions': {
      const { AttractionAdminService } = await import('@/features/attractions');
      return { service: new AttractionAdminService() };
    }
    case 'registry-items': {
      const { RegistryItemAdminService } = await import('@/features/registry');
      return { service: new RegistryItemAdminService() };
    }
    case 'invitation-codes': {
      const { InvitationCodeAdminService } = await import('@/features/registry');
      return { service: new InvitationCodeAdminService() };
    }
    default:
      return null;
  }
}

