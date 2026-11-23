import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';
import type { AttractionDTO } from '@/features/attractions';
import type { AppConfigDTO, ContentNodeDTO } from '@/features/content';
import type { MediaDTO } from '@/features/media';
import type {
  ContributorRecord,
  InvitationCodeDTO,
  RegistryItem,
} from '@/features/registry';
import type { SeatingTableDTO } from '@/features/seating';
import type {
  CustomRsvpQuestionDTO,
  MealOptionDTO,
} from '@/features/sub-events';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import {
  ARCHETYPE_PRESETS,
  type ArchetypeId,
} from './archetypes';
import { ArchetypeIdSchema } from './schemas';

export const REGISTRY_EDIT_FALLBACK_ID = 'fallback';
export const SAMPLE_SUBEVENT_ID_PREFIX = 'sample-subevent-';

const BASE_SEED_TIMESTAMP_MS = Date.parse('2026-01-15T12:00:00.000Z');

interface SeededSubEventRsvpRecord {
  id: string;
  subEventId: string;
  invitationCodeId: string;
  guestCode: string;
  status: 'attending' | 'declined' | 'pending';
  plusOneCount: number;
  plusOneNames: string[];
  mealSelections: string[];
  dietaryNotes: string;
  customAnswers: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

interface SeededSubEventAccessRecord {
  id: string;
  subEventId: string;
  invitationCodeId: string;
  guestCode: string;
}

interface SeededSubEventRecord {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  locationName: string;
  location: string;
  category: string;
  attireRules: string | null;
  isPrivate: boolean;
  mealOptions: MealOptionDTO[];
  customQuestions: CustomRsvpQuestionDTO[];
  accesses: SeededSubEventAccessRecord[];
  rsvps: SeededSubEventRsvpRecord[];
  createdAt: Date;
  updatedAt: Date;
}

interface SeededGuestRecord extends InvitationCodeDTO {
  id: string;
  seatTableName?: string;
}

export interface ArchetypeSeedData {
  archetype: ArchetypeId;
  config: AppConfigDTO;
  media: MediaDTO[];
  boundMediaIds: string[];
  registryItems: RegistryItem[];
  contributors: ContributorRecord[];
  seatingTables: SeatingTableDTO[];
  guests: SeededGuestRecord[];
  weddingParty: WeddingPartyMemberDTO[];
  attractions: AttractionDTO[];
  faqNodes: Extract<ContentNodeDTO, { type: 'FAQ' }>[];
  logisticsNodes: Extract<ContentNodeDTO, { type: 'Logistics' }>[];
  scheduleNodes: Extract<ContentNodeDTO, { type: 'Schedule' }>[];
  publicPhotos: Extract<ContentNodeDTO, { type: 'Photo' }>[];
  pendingPhotos: Extract<ContentNodeDTO, { type: 'Photo' }>[];
  allContentNodes: ContentNodeDTO[];
  subEvents: SeededSubEventRecord[];
}

export function isStaticExportBuild(): boolean {
  return (
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export'
  );
}

function deterministicDate(offsetMinutes: number): Date {
  return new Date(BASE_SEED_TIMESTAMP_MS + offsetMinutes * 60_000);
}

const DEFAULT_FEATURES: NonNullable<AppConfigDTO['features']> = [
  { id: 'story', type: 'story', title: 'Our Story', visible: true },
  {
    id: 'details',
    type: 'details',
    title: 'Wedding Day Details',
    visible: true,
  },
  {
    id: 'accommodations',
    type: 'accommodations',
    title: 'Accommodations',
    visible: true,
  },
  { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
  {
    id: 'travel',
    type: 'travel',
    title: 'Travel & Things to Do',
    visible: true,
  },
  {
    id: 'faq',
    type: 'faq',
    title: 'Questions You Probably Have',
    visible: true,
  },
];

const memoizedSeedCache = new Map<ArchetypeId, ArchetypeSeedData>();

function createSeedDataForArchetype(archetypeId: ArchetypeId): ArchetypeSeedData {
  const preset = ARCHETYPE_PRESETS[archetypeId];
  const site = preset.siteConfig;
  const baseCreatedAt = deterministicDate(0);

  const config: AppConfigDTO = {
    id: 'global',
    subdomain: null,
    partner1Name: site.partner1Name,
    partner2Name: site.partner2Name,
    brideName: site.partner1Name,
    groomName: site.partner2Name,
    weddingDate: new Date(site.weddingDate),
    baseUrl: site.baseUrl,
    venueName: site.venueName,
    venueAddress: site.venueAddress,
    venueCity: site.venueCity,
    venueState: site.venueState,
    venueZip: site.venueZip,
    latitude: site.latitude,
    longitude: site.longitude,
    storyText: site.storyText,
    venueDescription: site.venueDescription,
    travelAdvice: site.travelAdvice,
    heroTitle: site.heroTitle,
    heroSubtitle: site.heroSubtitle,
    seoTitle: site.seoTitle,
    seoDescription: site.seoDescription,
    contactEmail: site.contactEmail,
    photoAlbumUrl: '',
    faviconUrl: site.faviconUrl,
    ogImageUrl: site.ogImageUrl,
    brandMonogram: undefined,
    brandLogoUrl: undefined,
    brandLogoAlt: undefined,
    heroImageUrl: site.heroImageUrl,
    heroImageAlt: site.heroImageAlt,
    brandWatermarkUrl: undefined,
    brandWatermarkAlt: undefined,
    badgeGraphicUrl: undefined,
    badgeGraphicAlt: undefined,
    seoKeywords: 'wedding, celebration, schedule, registry, photos',
    colorPrimary: site.colorPrimary,
    colorSecondary: site.colorSecondary,
    themePreset: site.themePreset,
    themeTokens: {},
    layoutContainerMaxWidth: '64rem',
    layoutGridGap: '1.5rem',
    layoutCardPadding: '2rem',
    layoutBorderRadius: '1rem',
    typographyScale: {
      fontSizeXs: '0.75rem',
      fontSizeSm: '0.875rem',
      fontSizeBase: '1rem',
      fontSizeLg: '1.125rem',
      fontSizeXl: '1.25rem',
      fontSize2xl: '1.5rem',
      fontWeightNormal: '400',
      fontWeightMedium: '500',
      fontWeightBold: '700',
      lineHeightTight: '1.25',
      lineHeightNormal: '1.5',
      lineHeightRelaxed: '1.75',
    },
    spacingScale: {
      spacingXs: '0.25rem',
      spacingSm: '0.5rem',
      spacingMd: '1rem',
      spacingLg: '1.5rem',
      spacingXl: '2rem',
      spacing2xl: '3rem',
      containerMaxWidth: '64rem',
      gridGap: '1.5rem',
      cardPadding: '2rem',
    },
    borderTreatment: {
      borderRadiusSm: '0.25rem',
      borderRadiusMd: '0.5rem',
      borderRadiusLg: '1rem',
      borderRadiusFull: '9999px',
      borderWidthThin: '1px',
      borderWidthMedium: '2px',
      borderWidthThick: '4px',
      borderStyleDefault: 'solid',
    },
    brandDimensions: {
      logoWidth: '120px',
      logoHeight: '40px',
      heroHeight: '400px',
      watermarkWidth: '200px',
      watermarkOpacity: '0.1',
      badgeSize: '48px',
    },
    brandLogoWidth: '120px',
    brandLogoHeight: '40px',
    brandHeroHeight: '400px',
    brandWatermarkWidth: '200px',
    brandWatermarkOpacity: '0.1',
    brandBadgeSize: '48px',
    timezone: site.timezone,
    showCountdown: true,
    showAddToCalendar: true,
    rsvpOpen: true,
    rsvpDeadlineDate: '',
    rsvpGracePeriodHours: 0,
    rsvpClosedMessage: '',
    emailProvider: 'smtp',
    smtpHost: '',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    smtpSecure: false,
    resendApiKey: '',
    resendFrom: '',
    sendgridApiKey: '',
    sendgridFrom: '',
    smsProvider: 'none',
    twilioAccountSid: '',
    twilioAuthToken: '',
    twilioFromNumber: '',
    broadcastBatchSize: 50,
    broadcastBatchDelayMs: 500,
    shippingRecipientName: site.shippingRecipientName,
    shippingAddressLine1: site.shippingAddressLine1,
    shippingAddressLine2: site.shippingAddressLine2,
    shippingCity: site.shippingCity,
    shippingState: site.shippingState,
    shippingZip: site.shippingZip,
    shippingCountry: site.shippingCountry,
    shippingPhone: site.shippingPhone,
    shippingDeliveryNotes: site.shippingDeliveryNotes,
    defaultPaymentHandleType: site.defaultPaymentHandleType,
    defaultPaymentHandle: site.defaultPaymentHandle,
    setupCompleted: true,
    modules: { ...DEFAULT_MODULE_CONFIG },
    features: DEFAULT_FEATURES.map((feature) => ({ ...feature })),
    createdAt: baseCreatedAt,
    updatedAt: baseCreatedAt,
  };

  const media: MediaDTO[] = [];
  const boundMediaIdSet = new Set<string>();

  // 1. Seating tables
  const tableIdByName = new Map<string, string>();
  const seatingTables: SeatingTableDTO[] = preset.seatingTables.map((table, idx) => {
    const tableStamp = deterministicDate(idx + 1);
    tableIdByName.set(table.name, table.id);
    return {
      id: table.id,
      name: table.name,
      shape: table.shape,
      capacity: table.capacity,
      x: table.x,
      y: table.y,
      width: table.shape === 'rectangular' ? 180 : 120,
      height: 120,
      rotation: 0,
      isSample: true,
      createdAt: tableStamp,
      updatedAt: tableStamp,
    };
  });

  // 2. Guests (InvitationCodes)
  const guestByCode = new Map<string, SeededGuestRecord>();
  const guests: SeededGuestRecord[] = preset.guests.map((guest, idx) => {
    const guestStamp = deterministicDate(10 + idx);
    const tableId = guest.seatTableName
      ? (tableIdByName.get(guest.seatTableName) ?? null)
      : null;
    const record: SeededGuestRecord = {
      id: guest.id,
      code: guest.code,
      guestName: guest.guestName,
      email: guest.email ?? null,
      addressLine1: guest.addressLine1 ?? null,
      addressLine2: null,
      city: guest.city ?? null,
      state: guest.state ?? null,
      zipCode: guest.zipCode ?? null,
      country: guest.country ?? null,
      dietaryNotes: guest.dietaryNotes ?? null,
      plusOneAllocations: guest.plusOnesAllowed,
      plusOneFirstName: guest.plusOneFirstName ?? null,
      plusOneLastName: guest.plusOneLastName ?? null,
      householdName: guest.householdName,
      partyGroup: guest.partyGroup,
      partyTags: [...guest.partyTags],
      extraFields:
        guest.plusOneNames && guest.plusOneNames.length > 0
          ? { plusOneNames: [...guest.plusOneNames] }
          : null,
      used: false,
      usedAt: null,
      tableId,
      seatNumber: guest.seatNumber ?? null,
      seatTableName: guest.seatTableName,
      isSample: true,
      createdAt: guestStamp,
      updatedAt: guestStamp,
    };
    guestByCode.set(guest.code.toUpperCase(), record);
    return record;
  });

  // 3. Registry items + media + contributors
  const contributors: ContributorRecord[] = [];
  const registryItems: RegistryItem[] = preset.registryItems.map((item, idx) => {
    const itemStamp = deterministicDate(30 + idx);
    const mediaId = `sample-media-registry-${archetypeId}-${idx + 1}`;
    const itemMedia: MediaDTO = {
      id: mediaId,
      url: item.imageUrl,
      altText: item.imageAlt,
      isDecorative: false,
      isSample: true,
      publishToGallery: false,
      createdAt: itemStamp,
      updatedAt: itemStamp,
    };
    media.push(itemMedia);
    boundMediaIdSet.add(mediaId);

    const itemContributors: ContributorRecord[] = item.contributors.map((contrib) => {
      const linkedGuest = contrib.guestCode
        ? guestByCode.get(contrib.guestCode.toUpperCase())
        : undefined;
      const contribDate = new Date(contrib.date);
      const contribIso = contribDate.toISOString();
      const record: ContributorRecord = {
        id: contrib.id,
        name: contrib.name,
        email: contrib.email,
        isPlusOne: false,
        amount: contrib.amount,
        refundedAmount: 0,
        status: contrib.status,
        coverFee: false,
        feeAmount: 0,
        message: contrib.message ?? null,
        date: contribIso,
        thankYouStatus: contrib.thankYouStatus,
        thankYouSentAt:
          contrib.thankYouStatus === 'Sent' ? contribIso : null,
        thankYouNote: null,
        stripePaymentIntentId: null,
        stripeChargeId: null,
        retailerOrderNumber: contrib.retailerOrderNumber ?? null,
        carrier: contrib.carrier ?? null,
        trackingNumber: contrib.trackingNumber ?? null,
        transactionTimestamp: contribIso,
        confirmationEmailSentAt: contribIso,
        alertEmailSentAt: null,
        reminderEmailSentAt: null,
        registryItemId: item.id,
        registryItem: {
          id: item.id,
          name: item.name,
          category: item.category,
        },
        invitationCodeId: linkedGuest?.id ?? null,
        invitationCode: linkedGuest
          ? {
            id: linkedGuest.id,
            code: linkedGuest.code,
            guestName: linkedGuest.guestName,
            householdName: linkedGuest.householdName ?? null,
            addressLine1: linkedGuest.addressLine1 ?? null,
            addressLine2: linkedGuest.addressLine2 ?? null,
            city: linkedGuest.city ?? null,
            state: linkedGuest.state ?? null,
            zipCode: linkedGuest.zipCode ?? null,
            country: linkedGuest.country ?? null,
          }
          : null,
      };
      contributors.push(record);
      return record;
    });

    const activeContributors = itemContributors.filter(
      (c) => c.status === 'CONFIRMED' || c.status === 'RESERVED'
    );
    const amountContributed = Number(
      activeContributors
        .reduce((sum, c) => sum + Math.max(0, c.amount - (c.refundedAmount ?? 0)), 0)
        .toFixed(2)
    );
    const totalTarget = item.price * item.quantity;
    const purchased =
      item.itemType === 'PHYSICAL' && !item.isGroupGift
        ? activeContributors.length >= item.quantity || amountContributed >= totalTarget
        : amountContributed >= totalTarget;

    return {
      id: item.id,
      name: item.name,
      description: item.description,
      category: item.category,
      price: item.price,
      quantity: item.quantity,
      itemType: item.itemType,
      isGroupGift: item.isGroupGift,
      isMostWanted: item.isMostWanted,
      displayOrder: idx,
      vendorUrl: item.vendorUrl ?? '',
      paymentHandleType: item.paymentHandleType ?? null,
      paymentHandle: item.paymentHandle ?? null,
      imageUrl: item.imageUrl,
      imageId: mediaId,
      image: itemMedia,
      purchased,
      purchaserName:
        purchased && activeContributors.length > 0
          ? activeContributors[0].name
          : null,
      amountContributed,
      isSample: true,
      contributors: itemContributors,
    };
  });

  // 4. Wedding party + portrait media
  const weddingParty: WeddingPartyMemberDTO[] = preset.weddingParty.map(
    (member, idx) => {
      const memberStamp = deterministicDate(50 + idx);
      const mediaId = `sample-media-party-${archetypeId}-${idx + 1}`;
      const memberPhoto: MediaDTO = {
        id: mediaId,
        url: member.imageUrl,
        altText: member.imageAlt,
        isDecorative: false,
        isSample: true,
        publishToGallery: false,
        createdAt: memberStamp,
        updatedAt: memberStamp,
      };
      media.push(memberPhoto);
      boundMediaIdSet.add(mediaId);

      return {
        id: member.id,
        name: member.name,
        role: member.role,
        bio: member.bio,
        side: member.side,
        order: member.order,
        photoId: mediaId,
        photo: memberPhoto,
        isSample: true,
        createdAt: memberStamp,
        updatedAt: memberStamp,
      };
    }
  );

  // 5. Attractions + image media
  const attractions: AttractionDTO[] = preset.attractions.map((attraction, idx) => {
    const attractionStamp = deterministicDate(70 + idx);
    const mediaId = `sample-media-attraction-${archetypeId}-${idx + 1}`;
    const attractionImage: MediaDTO = {
      id: mediaId,
      url: attraction.imageUrl,
      altText: attraction.imageAlt,
      isDecorative: false,
      isSample: true,
      publishToGallery: false,
      createdAt: attractionStamp,
      updatedAt: attractionStamp,
    };
    media.push(attractionImage);
    boundMediaIdSet.add(mediaId);

    return {
      id: attraction.id,
      name: attraction.name,
      description: attraction.description,
      category: attraction.category,
      website: attraction.website,
      directions: attraction.directions,
      latitude: attraction.latitude,
      longitude: attraction.longitude,
      isVisible: true,
      promoCode: attraction.promoCode ?? null,
      bookingUrl: attraction.bookingUrl ?? '',
      roomRate: attraction.roomRate ?? null,
      cutoffDate: attraction.cutoffDate ?? null,
      shuttleInfo: attraction.shuttleInfo ?? null,
      imageId: mediaId,
      image: attractionImage,
      isSample: true,
      createdAt: attractionStamp,
      updatedAt: attractionStamp,
    };
  });

  // 6. Gallery curated photos & guest photo uploads
  const allPhotoNodes: Extract<ContentNodeDTO, { type: 'Photo' }>[] =
    preset.photos.map((photo, idx) => {
      const photoDate = new Date(photo.createdAt);
      let linkedMediaId: string | undefined;

      if (photo.source === 'curated') {
        linkedMediaId = `sample-media-gallery-${archetypeId}-${idx + 1}`;
        media.push({
          id: linkedMediaId,
          url: photo.url,
          altText: photo.altText,
          isDecorative: false,
          isSample: true,
          publishToGallery: photo.status === 'APPROVED' && photo.isVisible,
          createdAt: photoDate,
          updatedAt: photoDate,
        });
      }

      const tags =
        photo.source === 'curated'
          ? ['gallery', 'curated']
          : ['gallery', 'guest-upload'];

      return {
        id: photo.id,
        type: 'Photo',
        tags,
        data: {
          url: photo.url,
          title: photo.title,
          caption: photo.caption,
          altText: photo.altText,
          category: photo.category,
          status: photo.status,
          isVisible: photo.isVisible,
          ...(linkedMediaId
            ? { mediaId: linkedMediaId, publishToGallery: true }
            : {}),
          ...(photo.uploaderName ? { uploaderName: photo.uploaderName } : {}),
          ...(photo.uploaderEmail ? { uploaderEmail: photo.uploaderEmail } : {}),
          isSample: true,
        },
        createdAt: photoDate,
        updatedAt: photoDate,
      };
    });

  const sortedPhotosDesc = [...allPhotoNodes].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  const publicPhotos = sortedPhotosDesc.filter(
    (node) => node.data.status === 'APPROVED' && node.data.isVisible !== false
  );
  const pendingPhotos = sortedPhotosDesc.filter(
    (node) => node.data.status === 'PENDING'
  );

  // 7. Sub-events, access grants, RSVPs, and public Schedule ContentNodes
  const subEvents: SeededSubEventRecord[] = preset.subEvents.map((evt, idx) => {
    const evtStamp = deterministicDate(90 + idx);
    const accesses: SeededSubEventAccessRecord[] = evt.allowedGuestCodes
      .map((guestCode, accessIdx) => {
        const guest = guestByCode.get(guestCode.toUpperCase());
        if (!guest) return null;
        return {
          id: `sample-access-${archetypeId}-${idx + 1}-${accessIdx + 1}`,
          subEventId: evt.id,
          invitationCodeId: guest.id,
          guestCode: guest.code,
        };
      })
      .filter((entry): entry is SeededSubEventAccessRecord => entry !== null);

    const rsvps: SeededSubEventRsvpRecord[] = evt.rsvps
      .map((rsvp) => {
        const guest = guestByCode.get(rsvp.guestCode.toUpperCase());
        if (!guest) return null;
        return {
          id: rsvp.id,
          subEventId: evt.id,
          invitationCodeId: guest.id,
          guestCode: guest.code,
          status: rsvp.status,
          plusOneCount: rsvp.plusOneCount,
          plusOneNames: [...rsvp.plusOneNames],
          mealSelections: [...rsvp.mealSelections],
          dietaryNotes: rsvp.dietaryNotes,
          customAnswers: { ...rsvp.customAnswers },
          createdAt: evtStamp,
          updatedAt: evtStamp,
        };
      })
      .filter((entry): entry is SeededSubEventRsvpRecord => entry !== null);

    return {
      id: evt.id,
      title: evt.title,
      description: evt.description,
      startTime: new Date(evt.startTime),
      endTime: new Date(evt.endTime),
      locationName: evt.locationName,
      location: evt.location,
      category: evt.category,
      attireRules: evt.attireRules ?? null,
      isPrivate: evt.isPrivate,
      mealOptions: evt.mealOptions.map((opt) => ({
        id: opt.id,
        label: opt.label,
        description: opt.description,
        dietaryTags: [...opt.dietaryTags],
      })),
      customQuestions: evt.customQuestions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        required: q.required,
        options: [...q.options],
      })),
      accesses,
      rsvps,
      createdAt: evtStamp,
      updatedAt: evtStamp,
    };
  });

  // Sync InvitationCode RSVP projection fields (attendanceStatus, meals, customAnswers, eventRsvps)
  const rsvpsByGuestId = new Map<
    string,
    Array<{ subEvent: SeededSubEventRecord; rsvp: SeededSubEventRsvpRecord }>
  >();
  for (const evt of subEvents) {
    for (const rsvp of evt.rsvps) {
      const list = rsvpsByGuestId.get(rsvp.invitationCodeId) ?? [];
      list.push({ subEvent: evt, rsvp });
      rsvpsByGuestId.set(rsvp.invitationCodeId, list);
    }
  }

  for (const guest of guests) {
    const entries = rsvpsByGuestId.get(guest.id);
    if (!entries || entries.length === 0) continue;

    const hasAttending = entries.some((e) => e.rsvp.status === 'attending');
    const hasPending = entries.some((e) => e.rsvp.status === 'pending');
    const attendanceStatus: 'attending' | 'declined' | 'pending' = hasAttending
      ? 'attending'
      : hasPending
        ? 'pending'
        : 'declined';
    const hasResponded = attendanceStatus === 'attending' || attendanceStatus === 'declined';
    guest.used = hasResponded;
    guest.usedAt = hasResponded
      ? entries[entries.length - 1]!.rsvp.updatedAt
      : null;

    const maxAttendingPlusOnes = entries.reduce(
      (max, e) =>
        e.rsvp.status === 'attending'
          ? Math.max(max, Math.max(0, e.rsvp.plusOneCount))
          : max,
      0
    );

    const collectedPlusOneNames: string[] = [];
    for (const { rsvp } of entries) {
      if (rsvp.status !== 'attending' || rsvp.plusOneCount <= 0) continue;
      for (const rawName of rsvp.plusOneNames.slice(0, rsvp.plusOneCount)) {
        const trimmed = rawName.trim();
        if (trimmed && !collectedPlusOneNames.includes(trimmed)) {
          collectedPlusOneNames.push(trimmed);
        }
      }
    }

    const existingExtra =
      guest.extraFields && typeof guest.extraFields === 'object'
        ? (guest.extraFields as Record<string, unknown>)
        : {};
    const fallbackPlusOneNames = Array.isArray(existingExtra.plusOneNames)
      ? existingExtra.plusOneNames.filter(
        (n): n is string => typeof n === 'string' && n.trim().length > 0
      )
      : [];
    const syncedPlusOneNames =
      maxAttendingPlusOnes === 0
        ? []
        : collectedPlusOneNames.length > 0
          ? collectedPlusOneNames
          : fallbackPlusOneNames;

    const dietaryTagSet = new Set<string>();
    const structuredMeals: Array<{
      subEventId: string;
      subEventTitle: string;
      selections: Array<{
        attendee: string;
        optionId: string;
        label: string;
        dietaryTags: string[];
      }>;
    }> = [];
    const structuredAnswers: Array<{
      subEventId: string;
      subEventTitle: string;
      answers: Array<{
        questionId: string;
        prompt: string;
        answer: string;
      }>;
    }> = [];
    const eventRsvps: Array<{
      subEventId: string;
      subEventTitle: string;
      status: 'attending' | 'declined' | 'pending';
      plusOneCount: number;
    }> = [];

    for (const { subEvent: evt, rsvp } of entries) {
      eventRsvps.push({
        subEventId: evt.id,
        subEventTitle: evt.title,
        status: rsvp.status,
        plusOneCount: rsvp.plusOneCount,
      });

      if (rsvp.status !== 'attending') continue;

      if (rsvp.mealSelections.some(Boolean)) {
        const optMap = new Map(evt.mealOptions.map((o) => [o.id, o]));
        const selections: Array<{
          attendee: string;
          optionId: string;
          label: string;
          dietaryTags: string[];
        }> = [];

        rsvp.mealSelections.forEach((optId, idx) => {
          if (!optId) return;
          const opt = optMap.get(optId);
          const label = opt?.label || optId;
          const tags = opt?.dietaryTags ?? [];
          tags.forEach((tag) => dietaryTagSet.add(tag));
          const attendee =
            idx === 0
              ? guest.guestName
              : rsvp.plusOneNames[idx - 1] ||
                syncedPlusOneNames[idx - 1] ||
                `Plus-One #${idx}`;
          selections.push({
            attendee,
            optionId: optId,
            label,
            dietaryTags: [...tags],
          });
        });

        if (selections.length > 0) {
          structuredMeals.push({
            subEventId: evt.id,
            subEventTitle: evt.title,
            selections,
          });
        }
      }

      const answerEntries = Object.entries(rsvp.customAnswers).filter(([, ans]) =>
        Boolean(ans)
      );
      if (answerEntries.length > 0) {
        const qMap = new Map(evt.customQuestions.map((q) => [q.id, q]));
        const answers = answerEntries.map(([qId, ans]) => ({
          questionId: qId,
          prompt: qMap.get(qId)?.prompt || qId,
          answer: ans,
        }));
        structuredAnswers.push({
          subEventId: evt.id,
          subEventTitle: evt.title,
          answers,
        });
      }
    }

    const mealSummary = structuredMeals
      .map((entry) => {
        const inner = entry.selections
          .map((sel) =>
            sel.dietaryTags.length > 0
              ? `${sel.attendee}: ${sel.label} (${sel.dietaryTags.join(', ')})`
              : `${sel.attendee}: ${sel.label}`
          )
          .join('; ');
        return structuredMeals.length > 1 ? `${entry.subEventTitle} — ${inner}` : inner;
      })
      .join(' | ');

    const customAnswersSummary = structuredAnswers
      .map((entry) => {
        const inner = entry.answers
          .map((ans) => `${ans.prompt}: ${ans.answer}`)
          .join('; ');
        return structuredAnswers.length > 1 ? `${entry.subEventTitle} — ${inner}` : inner;
      })
      .join(' | ');

    guest.extraFields = {
      ...existingExtra,
      attendanceStatus,
      plusOneCount: maxAttendingPlusOnes,
      plusOneNames: syncedPlusOneNames,
      dietaryTags: Array.from(dietaryTagSet),
      mealSelections: structuredMeals,
      mealSummary,
      customAnswers: structuredAnswers,
      customAnswersSummary,
      eventRsvps,
    };
  }

  const scheduleNodes: Extract<ContentNodeDTO, { type: 'Schedule' }>[] = subEvents
    .filter((evt) => !evt.isPrivate)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .map((evt) => ({
      id: evt.id,
      type: 'Schedule',
      tags: ['Homepage', 'Schedule'],
      data: {
        title: evt.title,
        description: evt.description,
        startTime: evt.startTime.toISOString(),
        endTime: evt.endTime.toISOString(),
        locationName: evt.locationName,
        location: evt.location,
        category: evt.category,
        categoryTags: evt.category ? [evt.category] : [],
        categoryColors: undefined,
        attireRules: evt.attireRules ?? undefined,
        isPrivate: false,
        isReadOnly: false,
        mealOptions: evt.mealOptions.map((opt) => ({
          id: opt.id,
          label: opt.label,
          description: opt.description,
          dietaryTags: [...opt.dietaryTags],
        })),
        customQuestions: evt.customQuestions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          type: q.type,
          required: q.required,
          options: [...q.options],
        })),
      },
      createdAt: evt.createdAt,
      updatedAt: evt.updatedAt,
    }));

  // 8. Logistics nodes
  const logisticsNodes: Extract<ContentNodeDTO, { type: 'Logistics' }>[] =
    preset.logistics.map((node, idx) => {
      const nodeStamp = deterministicDate(110 + idx);
      return {
        id: node.id,
        type: 'Logistics',
        tags: [...node.tags],
        data: {
          ...(node.title ? { title: node.title } : {}),
          ...(node.description ? { description: node.description } : {}),
          ...(node.ceremonyTitle ? { ceremonyTitle: node.ceremonyTitle } : {}),
          ...(node.ceremonyTime ? { ceremonyTime: node.ceremonyTime } : {}),
          ...(node.receptionTitle ? { receptionTitle: node.receptionTitle } : {}),
          ...(node.receptionTime ? { receptionTime: node.receptionTime } : {}),
          ...(node.receptionDetails
            ? { receptionDetails: node.receptionDetails }
            : {}),
          ...(node.receptionAttire
            ? { receptionAttire: node.receptionAttire }
            : {}),
          ...(node.locationName ? { locationName: node.locationName } : {}),
          isSample: true,
        },
        createdAt: nodeStamp,
        updatedAt: nodeStamp,
      };
    });

  // 9. FAQ nodes
  const faqNodes: Extract<ContentNodeDTO, { type: 'FAQ' }>[] = preset.faqs.map(
    (faq, idx) => {
      const faqStamp = deterministicDate(130 + idx);
      return {
        id: faq.id,
        type: 'FAQ',
        tags: ['Homepage', 'FAQ'],
        data: {
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          categoryTags: [...faq.categoryTags],
          keywords: [...faq.keywords],
          displayOrder: idx,
          isVisible: true,
          isSample: true,
        },
        createdAt: faqStamp,
        updatedAt: faqStamp,
      };
    }
  );

  const sortedMediaDesc = [...media].sort(
    (a, b) =>
      new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()
  );

  const allContentNodes: ContentNodeDTO[] = [
    ...scheduleNodes,
    ...logisticsNodes,
    ...faqNodes,
    ...sortedPhotosDesc,
  ];

  return {
    archetype: archetypeId,
    config,
    media: sortedMediaDesc,
    boundMediaIds: Array.from(boundMediaIdSet),
    registryItems,
    contributors,
    seatingTables,
    guests,
    weddingParty,
    attractions,
    faqNodes,
    logisticsNodes,
    scheduleNodes,
    publicPhotos,
    pendingPhotos,
    allContentNodes,
    subEvents,
  };
}

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as unknown as T;
  }
  const cloned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    cloned[key] = deepClone(entry);
  }
  return cloned as T;
}

export function buildArchetypeSeedData(
  archetype?: ArchetypeId | string | null
): ArchetypeSeedData {
  const parsed = ArchetypeIdSchema.safeParse(archetype);
  const resolvedId: ArchetypeId = parsed.success ? parsed.data : 'classic';
  let cached = memoizedSeedCache.get(resolvedId);
  if (!cached) {
    cached = createSeedDataForArchetype(resolvedId);
    memoizedSeedCache.set(resolvedId, cached);
  }
  return deepClone(cached);
}

export function getRegistryEditStaticParams(): Array<{ id: string }> {
  const seen = new Set<string>();
  const result: Array<{ id: string }> = [];
  const addId = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      result.push({ id });
    }
  };

  for (const archetypeId of ArchetypeIdSchema.options) {
    for (const item of ARCHETYPE_PRESETS[archetypeId].registryItems) {
      addId(item.id);
    }
  }

  addId(REGISTRY_EDIT_FALLBACK_ID);
  addId('1');

  return result;
}

export function findSeededRegistryItemById(
  id: string,
  options: { includeContributors?: boolean } = {}
): RegistryItem | null {
  const trimmed = id.trim();
  if (!trimmed) {
    return null;
  }

  const { includeContributors = false } = options;

  if (trimmed === '1') {
    const firstClassic = buildArchetypeSeedData('classic').registryItems[0];
    if (!firstClassic) return null;
    return includeContributors
      ? firstClassic
      : { ...firstClassic, contributors: [] };
  }

  for (const archetypeId of ArchetypeIdSchema.options) {
    const seed = buildArchetypeSeedData(archetypeId);
    const found = seed.registryItems.find((item) => item.id === trimmed);
    if (found) {
      return includeContributors
        ? found
        : { ...found, contributors: [] };
    }
  }

  return null;
}

export function findSeededContributorWithItem(contributorId: string): {
  contributor: ContributorRecord;
  item: RegistryItem | null;
} | null {
  const trimmed = contributorId.trim();
  if (!trimmed) {
    return null;
  }

  for (const archetypeId of ArchetypeIdSchema.options) {
    const seed = buildArchetypeSeedData(archetypeId);
    const contributor = seed.contributors.find((entry) => entry.id === trimmed);
    if (contributor) {
      const item =
        seed.registryItems.find(
          (candidate) => candidate.id === contributor.registryItemId
        ) ?? null;
      return { contributor, item };
    }
  }

  return null;
}
