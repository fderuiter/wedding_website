import { getAppConfig, STATIC_MOCK_CONFIG, isSiteInitialized } from '../config';
import { attractionsRepository } from '@/features/attractions';
import { contentRepository } from '@/features/content';
import { logisticsRepository } from '@/features/logistics';
import { mediaRepository } from '@/features/media';
import { registryRepository } from '@/features/registry';
import { subEventService } from '@/features/sub-events';
import { weddingPartyRepository } from '@/features/wedding-party';
import { ARCHETYPE_PRESETS } from '../sampleData/archetypes';
import {
  REGISTRY_EDIT_FALLBACK_ID,
  buildArchetypeSeedData,
  getRegistryEditStaticParams,
} from '../sampleData/builder';
import { prisma } from '../prisma';

jest.mock('../prisma', () => ({
  prisma: {
    appConfig: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    attraction: {
      findMany: jest.fn(),
    },
    contentNode: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    weddingPartyMember: {
      findMany: jest.fn(),
    },
    registryItem: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    contributor: {
      findUnique: jest.fn(),
    },
    invitationCode: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    subEvent: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    subEventRsvp: {
      findMany: jest.fn(),
    },
    media: {
      findMany: jest.fn(),
    },
  },
}));

describe('Dual-mode static export mock adapter', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('builds deterministic, deeply cloned seed data across classic, destination, and romantic archetypes', () => {
    for (const archetypeId of ['classic', 'destination', 'romantic'] as const) {
      const first = buildArchetypeSeedData(archetypeId);
      const second = buildArchetypeSeedData(archetypeId);

      expect(first).toEqual(second);
      expect(first.registryItems.length).toBe(
        ARCHETYPE_PRESETS[archetypeId].registryItems.length
      );
      expect(first.contributors.length).toBeGreaterThan(0);
      expect(first.weddingParty.length).toBe(
        ARCHETYPE_PRESETS[archetypeId].weddingParty.length
      );
      expect(first.attractions.length).toBe(
        ARCHETYPE_PRESETS[archetypeId].attractions.length
      );
      expect(first.publicPhotos.length).toBeGreaterThan(0);
      expect(first.subEvents.length).toBeGreaterThan(0);
      expect(first.scheduleNodes.length).toBeGreaterThan(0);
      expect(first.media.length).toBeGreaterThan(0);
      expect(first.config.shippingAddressLine1).toBeTruthy();
      expect(first.config.defaultPaymentHandle).toBeTruthy();

      // Mutating a returned seed clone must not mutate memoized builder state
      first.registryItems[0].name = 'Mutated Title';
      const third = buildArchetypeSeedData(archetypeId);
      expect(third.registryItems[0].name).toBe(second.registryItems[0].name);
    }
  });

  it('emits static registry edit-item params for every archetype preset ID plus fallback', () => {
    const params = getRegistryEditStaticParams().map((entry) => entry.id);

    for (const archetypeId of ['classic', 'destination', 'romantic'] as const) {
      for (const item of ARCHETYPE_PRESETS[archetypeId].registryItems) {
        expect(params).toContain(item.id);
      }
    }
    expect(params).toContain(REGISTRY_EDIT_FALLBACK_ID);
    expect(params).toContain('1');
  });

  it('provides initialized static mock config without database queries when STATIC_EXPORT is enabled', async () => {
    process.env.STATIC_EXPORT = 'true';

    const config = await getAppConfig();

    expect(prisma.appConfig.findUnique).not.toHaveBeenCalled();
    expect(prisma.appConfig.upsert).not.toHaveBeenCalled();
    expect(config.venueName).toBe(STATIC_MOCK_CONFIG.venueName);
    expect(config.partner1Name).toBe('Alex Morgan');
    expect(config.partner2Name).toBe('Taylor Jordan');
    expect(config.shippingRecipientName).toContain('Alex Morgan');
    expect(config.defaultPaymentHandleType).toBe('venmo');
    expect(isSiteInitialized(config)).toBe(true);
  });

  it('provides mock logistics and schedule nodes with meal options, custom questions, and FAQs without database queries', async () => {
    process.env.STATIC_EXPORT = 'true';

    const nodes = await logisticsRepository.getLogisticsNodes();
    const faqs = await logisticsRepository.getVisibleFaqs();

    expect(prisma.contentNode.findMany).not.toHaveBeenCalled();
    expect(nodes.length).toBeGreaterThan(0);
    const ceremony = nodes.find(
      (n) => n.type === 'Logistics' && Boolean(n.data.ceremonyTitle)
    );
    expect(ceremony).toBeDefined();
    if (ceremony && ceremony.type === 'Logistics') {
      expect(ceremony.data.ceremonyTitle).toBe('Wedding Ceremony');
    }

    const receptionSchedule = nodes.find(
      (n) => n.type === 'Schedule' && n.data.title === 'Evening Dinner & Reception'
    );
    expect(receptionSchedule).toBeDefined();
    if (receptionSchedule && receptionSchedule.type === 'Schedule') {
      const scheduleData = receptionSchedule.data as Record<string, unknown>;
      expect(Array.isArray(scheduleData.mealOptions)).toBe(true);
      expect((scheduleData.mealOptions as unknown[]).length).toBeGreaterThan(0);
      expect(Array.isArray(scheduleData.customQuestions)).toBe(true);
      expect((scheduleData.customQuestions as unknown[]).length).toBeGreaterThan(0);
    }

    expect(faqs.length).toBe(ARCHETYPE_PRESETS.classic.faqs.length);
  });

  it('provides mock attractions with hotel block details and media images without database queries when STATIC_EXPORT is enabled', async () => {
    process.env.STATIC_EXPORT = 'true';

    const attractions = await attractionsRepository.getVisibleAttractions();

    expect(prisma.attraction.findMany).not.toHaveBeenCalled();
    expect(attractions.length).toBeGreaterThan(0);
    const hotel = attractions.find((a) => a.category === 'hotel');
    expect(hotel).toBeDefined();
    expect(hotel?.promoCode).toBe('WEDDING2026');
    expect(hotel?.roomRate).toBe('$189/night');
    expect(hotel?.image?.url).toBe('/images/sunset-embrace.jpg');
  });

  it('provides content photos, features, nodes, media, wedding party, registry, and sub-events without database queries', async () => {
    process.env.STATIC_EXPORT = 'true';

    const allMedia = await mediaRepository.getAllMedia();
    expect(allMedia.data.length).toBeGreaterThan(0);

    const [
      publicPhotos,
      pendingPhotos,
      features,
      faqNodes,
      boundMediaIds,
      partyMembers,
      registryPage,
      destinationItem,
      contributorWithItem,
      guestSchedule,
      privateGuestSchedule,
      rsvpSummary,
      accessMatrix,
    ] = await Promise.all([
      contentRepository.getPublicPhotos(),
      contentRepository.getPendingPhotos(),
      contentRepository.getFeatures(),
      contentRepository.getNodesByType('FAQ'),
      contentRepository.getEntityBoundMediaIds(allMedia.data.map((m) => m.id)),
      weddingPartyRepository.getMembers(),
      registryRepository.getAllItems({
        page: 1,
        limit: 20,
        includeContributors: true,
      }),
      registryRepository.getItemById('sample-registry-destination-1', {
        includeContributors: true,
      }),
      registryRepository.getContributorWithItem
        ? registryRepository.getContributorWithItem('sample-contributor-classic-1')
        : Promise.resolve(null),
      subEventService.getScheduleForGuest(),
      subEventService.getScheduleForGuest('SMITH2026'),
      subEventService.getRsvpSummary(),
      subEventService.getAccessMatrix({ page: 1, limit: 10 }),
    ]);

    expect(publicPhotos.length).toBeGreaterThan(0);
    expect(pendingPhotos.photos.length).toBeGreaterThan(0);
    expect(features.length).toBeGreaterThan(0);
    expect(faqNodes.length).toBe(ARCHETYPE_PRESETS.classic.faqs.length);
    expect(boundMediaIds.size).toBeGreaterThan(0);

    const singlePhotoNode = await contentRepository.getNodeById(publicPhotos[0].id);
    expect(singlePhotoNode?.id).toBe(publicPhotos[0].id);

    expect(partyMembers.length).toBe(ARCHETYPE_PRESETS.classic.weddingParty.length);
    expect(partyMembers[0].photo?.url).toBeTruthy();

    expect(registryPage.items.length).toBe(
      ARCHETYPE_PRESETS.classic.registryItems.length
    );
    expect(registryPage.items.some((item) => item.contributors.length > 0)).toBe(true);
    expect(destinationItem?.name).toBe('Hardside Spinner Luggage Set');
    expect(contributorWithItem?.contributor.name).toBe('Mr. & Mrs. Robert Smith');
    expect(contributorWithItem?.item?.id).toBe('sample-registry-classic-1');

    // Public schedule hides private rehearsal dinner; invited VIP guest sees it
    expect(guestSchedule.every((evt) => !evt.isPrivate)).toBe(true);
    expect(privateGuestSchedule.some((evt) => evt.isPrivate)).toBe(true);

    const plusOneAllowance =
      await subEventService.getPlusOneAllowanceForGuest('JOHNSON2026');
    const plusOneNames =
      await subEventService.getSavedPlusOneNamesForGuest('JOHNSON2026');
    const singleEvent = await subEventService.getSubEventByIdForGuest(
      'sample-subevent-classic-reception',
      'JOHNSON2026'
    );
    const adminRsvpDetail = await subEventService.getAdminInvitationRsvps(
      'sample-guest-classic-2'
    );

    expect(plusOneAllowance).toBe(1);
    expect(plusOneNames).toEqual(['Daniel Kim']);
    expect(singleEvent.mealOptions?.length).toBeGreaterThan(0);
    expect(singleEvent.userRsvp?.mealSelections).toEqual([
      'classic-salmon',
      'classic-risotto',
    ]);
    expect(rsvpSummary.global.attendingHouseholds).toBeGreaterThan(0);
    expect(rsvpSummary.global.mealTotals.length).toBeGreaterThan(0);
    expect(accessMatrix.subEvents.length).toBe(
      ARCHETYPE_PRESETS.classic.subEvents.length
    );
    expect(adminRsvpDetail.rsvps.length).toBeGreaterThan(0);

    expect(prisma.contentNode.findMany).not.toHaveBeenCalled();
    expect(prisma.contentNode.findUnique).not.toHaveBeenCalled();
    expect(prisma.media.findMany).not.toHaveBeenCalled();
    expect(prisma.weddingPartyMember.findMany).not.toHaveBeenCalled();
    expect(prisma.registryItem.findMany).not.toHaveBeenCalled();
    expect(prisma.registryItem.findUnique).not.toHaveBeenCalled();
    expect(prisma.contributor.findUnique).not.toHaveBeenCalled();
    expect(prisma.invitationCode.findMany).not.toHaveBeenCalled();
    expect(prisma.invitationCode.findUnique).not.toHaveBeenCalled();
    expect(prisma.subEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.subEvent.findUnique).not.toHaveBeenCalled();
  });
});

