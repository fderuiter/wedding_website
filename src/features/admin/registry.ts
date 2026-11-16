let serviceMap: Record<string, any> | null = null;

async function getServiceMap(): Promise<Record<string, any>> {
  if (!serviceMap) {
    const [
      { ContentNodeAdminService },
      { WeddingPartyAdminService },
      { AttractionAdminService },
      { RegistryItemAdminService, InvitationCodeAdminService },
      { SeatingTableAdminService },
      { SubEventAdminService },
    ] = await Promise.all([
      import('@/features/content'),
      import('@/features/wedding-party'),
      import('@/features/attractions'),
      import('@/features/registry'),
      import('@/features/seating'),
      import('@/features/sub-events'),
    ]);

    serviceMap = {
      [ContentNodeAdminService.ENTITY_KEY]: new ContentNodeAdminService(),
      [WeddingPartyAdminService.ENTITY_KEY]: new WeddingPartyAdminService(),
      [AttractionAdminService.ENTITY_KEY]: new AttractionAdminService(),
      [RegistryItemAdminService.ENTITY_KEY]: new RegistryItemAdminService(),
      [InvitationCodeAdminService.ENTITY_KEY]: new InvitationCodeAdminService(),
      [SeatingTableAdminService.ENTITY_KEY]: new SeatingTableAdminService(),
      [SubEventAdminService.ENTITY_KEY]: new SubEventAdminService(),
    };
  }
  return serviceMap;
}

export async function getEntityService(entityKey: string) {
  const map = await getServiceMap();
  const service = map[entityKey];
  if (!service) return null;

  return { service };
}

