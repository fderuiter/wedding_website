import type { ZodType } from 'zod';

interface AdminEntityRegistration {
  service: any;
  createSchema?: ZodType;
  updateSchema?: ZodType;
}

let serviceMap: Record<string, AdminEntityRegistration> | null = null;

async function getServiceMap(): Promise<Record<string, AdminEntityRegistration>> {
  if (!serviceMap) {
    const [
      { ContentNodeAdminService, ContentNodeInputSchema, ContentNodeUpdateInputSchema },
      { WeddingPartyAdminService, WeddingPartyInputSchema, WeddingPartyUpdateInputSchema },
      { AttractionAdminService, AttractionCreateInputSchema, AttractionInputSchema },
      {
        RegistryItemAdminService,
        RegistryItemCreateInputSchema,
        RegistryItemInputSchema,
        InvitationCodeAdminService,
        InvitationCodeInputSchema,
        InvitationCodeUpdateInputSchema,
      },
      { SeatingTableAdminService, SeatingTableInputSchema, SeatingTableUpdateInputSchema },
      { SubEventAdminService, SubEventInputSchema, SubEventUpdateInputSchema },
    ] = await Promise.all([
      import('@/features/content'),
      import('@/features/wedding-party'),
      import('@/features/attractions'),
      import('@/features/registry'),
      import('@/features/seating'),
      import('@/features/sub-events'),
    ]);

    serviceMap = {
      [ContentNodeAdminService.ENTITY_KEY]: {
        service: new ContentNodeAdminService(),
        createSchema: ContentNodeInputSchema,
        updateSchema: ContentNodeUpdateInputSchema,
      },
      [WeddingPartyAdminService.ENTITY_KEY]: {
        service: new WeddingPartyAdminService(),
        createSchema: WeddingPartyInputSchema,
        updateSchema: WeddingPartyUpdateInputSchema,
      },
      [AttractionAdminService.ENTITY_KEY]: {
        service: new AttractionAdminService(),
        createSchema: AttractionCreateInputSchema,
        updateSchema: AttractionInputSchema,
      },
      [RegistryItemAdminService.ENTITY_KEY]: {
        service: new RegistryItemAdminService(),
        createSchema: RegistryItemCreateInputSchema,
        updateSchema: RegistryItemInputSchema,
      },
      [InvitationCodeAdminService.ENTITY_KEY]: {
        service: new InvitationCodeAdminService(),
        createSchema: InvitationCodeInputSchema,
        updateSchema: InvitationCodeUpdateInputSchema,
      },
      [SeatingTableAdminService.ENTITY_KEY]: {
        service: new SeatingTableAdminService(),
        createSchema: SeatingTableInputSchema,
        updateSchema: SeatingTableUpdateInputSchema,
      },
      [SubEventAdminService.ENTITY_KEY]: {
        service: new SubEventAdminService(),
        createSchema: SubEventInputSchema,
        updateSchema: SubEventUpdateInputSchema,
      },
    };
  }
  return serviceMap;
}

export async function getEntityService(entityKey: string) {
  const map = await getServiceMap();
  const entry = map[entityKey];
  if (!entry) return null;

  return entry;
}

