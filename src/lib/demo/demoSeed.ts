import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import { withBasePath } from '@/lib/basePath';
import type {
  ContributorRecord,
  InvitationCodeDTO,
  RegistryItem,
  RegistryShippingAddress,
} from '@/features/registry';
import type { SeatingTableDTO } from '@/features/seating';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import type { AttractionDTO } from '@/features/attractions';
import type { ContentNodeDTO } from '@/features/content';
import type { MediaDTO } from '@/features/media';
import type { SubEventDTO } from '@/features/sub-events';
import type { ModuleConfig } from '@/lib/modules';

export interface DemoFeatureItem {
  id: string;
  type: string;
  title?: string;
  visible: boolean;
  content?: string;
}

export interface DemoPhotoRecord {
  id: string;
  nodeId: string;
  mediaId: string;
  url: string;
  title: string;
  caption: string;
  altText: string;
  category: 'curated' | 'guest';
  source: 'curated' | 'guest-upload';
  status: 'APPROVED' | 'PENDING' | 'REJECTED';
  isVisible: boolean;
  isGuestUpload: boolean;
  uploaderName?: string;
  uploaderEmail?: string;
  sizeBytes?: number;
  isSample?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DemoSubEventAccessRecord {
  id: string;
  subEventId: string;
  invitationCodeId: string;
  createdAt: string;
}

export interface DemoSubEventRsvpRecord {
  id: string;
  subEventId: string;
  invitationCodeId: string;
  guestCode: string;
  guestName: string;
  status: 'ATTENDING' | 'DECLINED' | 'PENDING';
  plusOneCount: number;
  plusOneNames: string[];
  mealSelection: string | null;
  mealSelections: string[];
  dietaryNotes: string;
  customAnswers: Record<string, string>;
  respondedAt: string;
  updatedAt: string;
}

export interface DemoBroadcastRecipientRecord {
  id: string;
  broadcastId: string;
  invitationCodeId: string | null;
  recipientName: string;
  recipientEmail: string | null;
  recipientPhone?: string | null;
  channel: 'EMAIL' | 'SMS';
  status: 'SENT' | 'DELIVERED' | 'VIEWED' | 'FAILED' | 'PENDING';
  sentAt: string | null;
  viewedAt: string | null;
  errorMessage: string | null;
}

export interface DemoBroadcastRecord {
  id: string;
  subject: string;
  body: string;
  htmlBody?: string;
  channel: 'EMAIL' | 'SMS';
  status: 'SENT' | 'SCHEDULED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
  audienceLabel: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  viewedCount: number;
  scheduledAt: string | null;
  sentAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  isSample?: boolean;
  recipients: DemoBroadcastRecipientRecord[];
}

export interface DemoSnapshotVersionRecord {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
  createdBy: string;
  createdAt: string;
  data: Record<string, unknown>;
  snapshotState?: Record<string, unknown>;
}

interface DemoSiteConfigSeed {
  partner1Name: string;
  partner2Name: string;
  weddingDate: string;
  baseUrl: string;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  venueState: string;
  venueZip: string;
  latitude: number;
  longitude: number;
  storyText: string;
  venueDescription: string;
  travelAdvice: string;
  heroTitle: string;
  heroSubtitle: string;
  seoTitle: string;
  seoDescription: string;
  contactEmail: string;
  faviconUrl: string;
  ogImageUrl: string;
  heroImageUrl: string;
  heroImageAlt: string;
  colorPrimary: string;
  colorSecondary: string;
  themePreset: 'classic' | 'modern' | 'romantic' | 'minimal' | 'editorial';
  timezone: string;
  autoApproveGuestPhotos: boolean;
  guestPhotoQrTokenVersion: number;
  adminTokenVersion: number;
  rsvpOpen: boolean;
  rsvpDeadlineDate: string | null;
  rsvpGracePeriodHours: number;
  rsvpClosedMessage: string;
  showCountdown: boolean;
  showAddToCalendar: boolean;
  shippingRecipientName: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingCountry: string;
  shippingPhone: string;
  shippingDeliveryNotes: string;
  defaultPaymentHandleType: string;
  defaultPaymentHandle: string;
  updatedAt?: string;
}

export interface ArchetypeDataset {
  registryItems: RegistryItem[];
  offlineContributors: ContributorRecord[];
  guests: InvitationCodeDTO[];
  seatingTables: SeatingTableDTO[];
  weddingParty: WeddingPartyMemberDTO[];
  attractions: AttractionDTO[];
  faqs: ContentNodeDTO[];
  logisticsNodes: ContentNodeDTO[];
  scheduleNodes: ContentNodeDTO[];
  customNodes: ContentNodeDTO[];
  photos: DemoPhotoRecord[];
  media: MediaDTO[];
  subEvents: SubEventDTO[];
  subEventAccess: DemoSubEventAccessRecord[];
  subEventRsvps: DemoSubEventRsvpRecord[];
  features: DemoFeatureItem[];
  modules: ModuleConfig;
  broadcastMessages: DemoBroadcastRecord[];
  snapshotVersions: DemoSnapshotVersionRecord[];
  siteConfig: DemoSiteConfigSeed;
}

const DEMO_SEED_TIMESTAMP_ISO = '2026-01-15T12:00:00.000Z';

const CATEGORY_PALETTES: Record<string, { bgStart: string; bgEnd: string; accent: string }> = {
  Kitchen: { bgStart: '#fff1f2', bgEnd: '#ffe4e6', accent: '#be123c' },
  Dining: { bgStart: '#fefce8', bgEnd: '#fef3c7', accent: '#b45309' },
  Honeymoon: { bgStart: '#ecfeff', bgEnd: '#cffafe', accent: '#0e7490' },
  Travel: { bgStart: '#eff6ff', bgEnd: '#dbeafe', accent: '#1d4ed8' },
  Excursions: { bgStart: '#f0fdf4', bgEnd: '#dcfce7', accent: '#15803d' },
  Stay: { bgStart: '#f5f3ff', bgEnd: '#ede9fe', accent: '#6d28d9' },
  Home: { bgStart: '#fafaf9', bgEnd: '#f5f5f4', accent: '#57534e' },
  Experiences: { bgStart: '#fdf2f8', bgEnd: '#fce7f3', accent: '#be185d' },
  Patio: { bgStart: '#ecfdf5', bgEnd: '#d1fae5', accent: '#047857' },
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const sampleItemSvgCache = new Map<string, string>();

export function createSampleItemSvgDataUrl(title: string, category: string): string {
  const cacheKey = `${category}::${title}`;
  const cached = sampleItemSvgCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const palette = CATEGORY_PALETTES[category] ?? {
    bgStart: '#fff1f2',
    bgEnd: '#fce7f3',
    accent: '#9f1239',
  };
  const safeCategory = escapeXml(category.toUpperCase());
  const truncatedTitle = title.length > 28 ? `${title.slice(0, 26)}...` : title;
  const safeTitle = escapeXml(truncatedTitle);

  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">',
    '<defs>',
    '<linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">',
    `<stop offset="0%" stop-color="${palette.bgStart}"/>`,
    `<stop offset="100%" stop-color="${palette.bgEnd}"/>`,
    '</linearGradient>',
    '</defs>',
    '<rect width="600" height="600" fill="url(#g)"/>',
    `<circle cx="300" cy="240" r="96" fill="#ffffff" fill-opacity="0.88" stroke="${palette.accent}" stroke-width="4"/>`,
    `<rect x="252" y="216" width="96" height="68" rx="10" fill="none" stroke="${palette.accent}" stroke-width="5"/>`,
    `<line x1="300" y1="196" x2="300" y2="284" stroke="${palette.accent}" stroke-width="5"/>`,
    `<line x1="244" y1="238" x2="356" y2="238" stroke="${palette.accent}" stroke-width="5"/>`,
    `<path d="M300 216 C280 188, 258 196, 274 216 C284 224, 300 216, 300 216 Z" fill="none" stroke="${palette.accent}" stroke-width="4"/>`,
    `<path d="M300 216 C320 188, 342 196, 326 216 C316 224, 300 216, 300 216 Z" fill="none" stroke="${palette.accent}" stroke-width="4"/>`,
    `<text x="300" y="392" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="700" letter-spacing="3" fill="${palette.accent}">${safeCategory}</text>`,
    `<text x="300" y="434" text-anchor="middle" font-family="system-ui, sans-serif" font-size="24" font-weight="600" fill="#1f2937">${safeTitle}</text>`,
    '</svg>',
  ].join('');

  const encoded = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  sampleItemSvgCache.set(cacheKey, encoded);
  return encoded;
}

export const DEMO_SHIPPING_ADDRESS: RegistryShippingAddress = {
  recipientName: 'Alex & Taylor',
  addressLine1: '742 Evergreen Terrace',
  addressLine2: 'Apt 4B',
  city: 'Chicago',
  state: 'IL',
  zip: '60611',
  country: 'USA',
  phone: '(312) 555-0192',
  deliveryNotes: 'Front desk concierge accepts packages daily 8am–8pm.',
};

function prefixDemoAssetUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  const trimmed = rawUrl.trim();
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed;
  }
  return withBasePath(trimmed);
}

function buildDefaultFeatures(): DemoFeatureItem[] {
  return [
    { id: 'story', type: 'story', title: 'Our Story', visible: true },
    { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
    { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
    { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
    { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
    { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true },
  ];
}

function buildDefaultModules(): ModuleConfig {
  return {
    registry: true,
    groupGifting: true,
    weather: true,
    weddingParty: true,
    attractions: true,
    gallery: true,
    countdown: true,
    addToCalendar: true,
    interactive3D: true,
  };
}

export function buildArchetypeDataset(archetypeId: ArchetypeId): ArchetypeDataset {
  const preset = ARCHETYPE_PRESETS[archetypeId] ?? ARCHETYPE_PRESETS.classic;
  const seedDate = new Date(DEMO_SEED_TIMESTAMP_ISO);

  const tableIdByName = new Map<string, string>();
  const rawTables: SeatingTableDTO[] = preset.seatingTables.map((table, idx) => {
    const id = `demo-${archetypeId}-table-${idx + 1}`;
    tableIdByName.set(table.name, id);
    return {
      id,
      name: table.name,
      shape: table.shape,
      capacity: table.capacity,
      x: table.x,
      y: table.y,
      width: table.shape === 'rectangular' ? 180 : 120,
      height: 120,
      rotation: 0,
      isSample: true,
      createdAt: DEMO_SEED_TIMESTAMP_ISO,
      updatedAt: DEMO_SEED_TIMESTAMP_ISO,
      invitationCodes: [],
    };
  });

  const guestCity =
    archetypeId === 'destination' ? 'Miami' : archetypeId === 'romantic' ? 'Napa' : 'Chicago';
  const guestState =
    archetypeId === 'destination' ? 'FL' : archetypeId === 'romantic' ? 'CA' : 'IL';
  const guestZip =
    archetypeId === 'destination' ? '33139' : archetypeId === 'romantic' ? '94559' : '60611';

  const guestIdByCode = new Map<string, string>();
  const guests: InvitationCodeDTO[] = preset.guests.map((guest, idx) => {
    const id = `demo-${archetypeId}-guest-${idx + 1}`;
    const upperCode = guest.code.toUpperCase();
    guestIdByCode.set(upperCode, id);
    const tableId = guest.seatTableName ? (tableIdByName.get(guest.seatTableName) ?? null) : null;
    const defaultEmail =
      guest.email ||
      `${guest.code.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.com`;
    return {
      id,
      code: upperCode,
      guestName: guest.guestName,
      email: defaultEmail,
      addressLine1: guest.addressLine1 || `${100 + idx * 12} Maple Avenue`,
      addressLine2: '',
      city: guestCity,
      state: guestState,
      zipCode: guestZip,
      country: guest.country || 'USA',
      dietaryNotes: guest.dietaryNotes || '',
      plusOneAllocations: guest.plusOnesAllowed ?? 0,
      plusOneFirstName: guest.plusOneFirstName || '',
      plusOneLastName: guest.plusOneLastName || '',
      householdName: guest.householdName,
      partyGroup: guest.partyGroup,
      partyTags: [...guest.partyTags],
      extraFields: { rsvpStatus: 'ATTENDING', attendanceStatus: 'attending' },
      used: true,
      usedAt: DEMO_SEED_TIMESTAMP_ISO,
      tableId,
      seatNumber: guest.seatNumber ?? null,
      isSample: true,
      createdAt: DEMO_SEED_TIMESTAMP_ISO,
      updatedAt: DEMO_SEED_TIMESTAMP_ISO,
    };
  });

  const seatingTables: SeatingTableDTO[] = rawTables.map((table) => ({
    ...table,
    invitationCodes: guests.filter((g) => g.tableId === table.id),
  }));

  const seededOfflineFromPreset: ContributorRecord[] = [];
  const registryItems: RegistryItem[] = preset.registryItems.map((item, idx) => {
    const id = `demo-${archetypeId}-item-${idx + 1}`;
    const itemType = item.itemType ?? 'PHYSICAL';
    const isFund = itemType === 'CASH_FUND' || itemType === 'EXPERIENCE_FUND';
    const isGroupGift = Boolean(item.isGroupGift || isFund);
    const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    for (let cIdx = 0; cIdx < (item.contributors ?? []).length; cIdx += 1) {
      const contrib = item.contributors![cIdx];
      const linkedGuestId = contrib.guestCode
        ? guestIdByCode.get(contrib.guestCode.toUpperCase())
        : undefined;
      const linkedGuest = linkedGuestId
        ? guests.find((g) => g.id === linkedGuestId)
        : undefined;
      seededOfflineFromPreset.push({
        id: contrib.id || `demo-${archetypeId}-contrib-${idx + 1}-${cIdx + 1}`,
        name: contrib.name,
        email: contrib.email || null,
        addressLine1: linkedGuest?.addressLine1 ?? null,
        addressLine2: linkedGuest?.addressLine2 ?? null,
        city: linkedGuest?.city ?? null,
        state: linkedGuest?.state ?? null,
        zipCode: linkedGuest?.zipCode ?? null,
        country: linkedGuest?.country ?? 'USA',
        isPlusOne: false,
        amount: contrib.amount,
        refundedAmount: 0,
        status: contrib.status ?? 'CONFIRMED',
        coverFee: false,
        feeAmount: 0,
        message: contrib.message ?? null,
        date: contrib.date || DEMO_SEED_TIMESTAMP_ISO,
        thankYouStatus: contrib.thankYouStatus ?? 'Unsent',
        thankYouSentAt:
          contrib.thankYouStatus === 'Sent' ? DEMO_SEED_TIMESTAMP_ISO : null,
        thankYouEmailSentAt: null,
        thankYouNote: item.name,
        stripePaymentIntentId: null,
        stripeChargeId: null,
        retailerOrderNumber: contrib.retailerOrderNumber ?? null,
        carrier: contrib.carrier ?? null,
        trackingNumber: contrib.trackingNumber ?? null,
        transactionTimestamp: contrib.date || DEMO_SEED_TIMESTAMP_ISO,
        registryItemId: null,
        ...(linkedGuestId ? { invitationCodeId: linkedGuestId } : {}),
      });
    }

    return {
      id,
      name: item.name,
      description: item.description,
      category: item.category,
      price: item.price,
      quantity: item.quantity ?? 1,
      itemType,
      isGroupGift,
      isMostWanted: Boolean(item.isMostWanted),
      displayOrder: idx,
      vendorUrl: isFund ? null : item.vendorUrl || `https://example.com/gifts/${slug}`,
      paymentHandleType: 'Venmo',
      paymentHandle: '@alex-and-taylor',
      purchased: false,
      purchaserName: null,
      amountContributed: 0,
      isSample: true,
      imageId: `${id}-img`,
      image: {
        id: `${id}-img`,
        url: createSampleItemSvgDataUrl(item.name, item.category),
        altText: item.imageAlt,
        isDecorative: false,
        isSample: true,
      },
      contributors: [],
    };
  });

  const firstGuest = guests[0];
  const offlineContributors: ContributorRecord[] = [
    ...seededOfflineFromPreset,
    {
      id: `demo-${archetypeId}-offline-contrib-1`,
      name: firstGuest ? `${firstGuest.householdName || firstGuest.guestName} Family` : 'Aunt Clara & Uncle Ben',
      email: firstGuest?.email || 'family@example.com',
      addressLine1: firstGuest?.addressLine1 || '240 Oak Ridge Lane',
      addressLine2: null,
      city: guestCity,
      state: guestState,
      zipCode: guestZip,
      country: 'USA',
      isPlusOne: false,
      amount: 150,
      refundedAmount: 0,
      status: 'CONFIRMED',
      coverFee: false,
      feeAmount: 0,
      message: 'Handwritten card & check brought to the engagement dinner!',
      date: DEMO_SEED_TIMESTAMP_ISO,
      thankYouStatus: 'Unsent',
      thankYouSentAt: null,
      thankYouEmailSentAt: null,
      thankYouNote: 'Crystal vase & engagement card',
      stripePaymentIntentId: null,
      stripeChargeId: null,
      retailerOrderNumber: null,
      carrier: null,
      trackingNumber: null,
      transactionTimestamp: DEMO_SEED_TIMESTAMP_ISO,
      registryItemId: null,
      ...(firstGuest ? { invitationCodeId: firstGuest.id } : {}),
    },
  ];

  const weddingParty: WeddingPartyMemberDTO[] = preset.weddingParty.map((member, idx) => ({
    id: `demo-${archetypeId}-party-${idx + 1}`,
    name: member.name,
    role: member.role,
    bio: member.bio,
    side: member.side,
    link: null,
    order: member.order,
    isSample: true,
    photoId: null,
    photo: null,
    createdAt: seedDate,
    updatedAt: seedDate,
  }));

  const attractions: AttractionDTO[] = preset.attractions.map((attraction, idx) => ({
    id: `demo-${archetypeId}-attraction-${idx + 1}`,
    name: attraction.name,
    description: attraction.description,
    category: attraction.category,
    website: attraction.website,
    directions: attraction.directions,
    latitude: attraction.latitude,
    longitude: attraction.longitude,
    isVisible: true,
    promoCode: attraction.promoCode ?? null,
    bookingUrl: attraction.bookingUrl ?? (attraction.promoCode ? attraction.website : null),
    roomRate: attraction.roomRate ?? null,
    cutoffDate: attraction.cutoffDate ?? null,
    shuttleInfo: attraction.shuttleInfo ?? null,
    isSample: true,
    imageId: null,
    image: null,
    createdAt: seedDate,
    updatedAt: seedDate,
  }));

  const faqs: ContentNodeDTO[] = preset.faqs.map((faq, idx) => ({
    id: `demo-${archetypeId}-faq-${idx + 1}`,
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
    createdAt: seedDate,
    updatedAt: seedDate,
  }));

  const stayAttraction = preset.attractions.find((a) => a.category === 'Stay');
  const locationLabel =
    archetypeId === 'destination'
      ? 'Oceanview Palms Beachfront Pavilion'
      : archetypeId === 'romantic'
        ? 'Willow Creek Botanical Arbor'
        : 'The Glasshouse Estate';

  const logisticsNodes: ContentNodeDTO[] = [
    {
      id: `demo-${archetypeId}-logistics-ceremony`,
      type: 'Logistics',
      tags: ['Homepage', 'Schedule', 'Logistics'],
      data: {
        ceremonyTitle: 'Wedding Ceremony',
        ceremonyTime: archetypeId === 'destination' ? '5:00 PM' : '4:00 PM',
        receptionTitle: 'Evening Reception',
        receptionTime: archetypeId === 'destination' ? '6:30 PM' : '6:00 PM',
        receptionDetails: 'Dinner, toasts, and dancing into the evening.',
        receptionAttire:
          archetypeId === 'destination'
            ? 'Resort Cocktail Attire'
            : archetypeId === 'romantic'
              ? 'Garden Semi-Formal Attire'
              : 'Semi-Formal / Cocktail Attire',
        startTime: preset.siteConfig.weddingDate || '2026-09-19T16:00:00.000Z',
        endTime: '2026-09-19T23:00:00.000Z',
        locationName: locationLabel,
        isSample: true,
      },
      createdAt: seedDate,
      updatedAt: seedDate,
    },
    {
      id: `demo-${archetypeId}-logistics-accommodations`,
      type: 'Logistics',
      tags: ['Homepage', 'Logistics'],
      data: {
        title: 'Accommodations',
        description: stayAttraction
          ? `A block of rooms has been reserved at ${stayAttraction.name}${stayAttraction.promoCode ? ` (Promo Code: ${stayAttraction.promoCode})` : ''}.`
          : 'Partner hotel room blocks are listed below for out-of-town guests.',
        isSample: true,
      },
      createdAt: seedDate,
      updatedAt: seedDate,
    },
    {
      id: `demo-${archetypeId}-logistics-travel`,
      type: 'Logistics',
      tags: ['Homepage', 'Logistics'],
      data: {
        title: 'Travel & Parking',
        description:
          archetypeId === 'destination'
            ? 'Resort shuttle transfers depart from the main arrival terminal every 30 minutes.'
            : archetypeId === 'romantic'
              ? 'Complimentary on-site garden parking and partner inn shuttles are provided.'
              : 'Valet parking is provided at the estate gates with ride-share drop-off at the front turnaround.',
        isSample: true,
      },
      createdAt: seedDate,
      updatedAt: seedDate,
    },
  ];

  // Sub-events, guest access matrix, and RSVPs (using canonical preset subEvent IDs)
  const subEventAccess: DemoSubEventAccessRecord[] = [];
  const subEventRsvps: DemoSubEventRsvpRecord[] = [];

  const subEvents: SubEventDTO[] = preset.subEvents.map((se, sIdx) => {
    const subEventId = se.id || `demo-${archetypeId}-subevent-${sIdx + 1}`;
    const allowedCodes = new Set(se.allowedGuestCodes.map((c) => c.toUpperCase()));
    const targetGuests = se.isPrivate
      ? guests.filter((g) => allowedCodes.has(g.code.toUpperCase()))
      : guests;

    targetGuests.forEach((guest, gIdx) => {
      subEventAccess.push({
        id: `demo-${archetypeId}-access-${sIdx + 1}-${gIdx + 1}`,
        subEventId,
        invitationCodeId: guest.id,
        createdAt: DEMO_SEED_TIMESTAMP_ISO,
      });
    });

    se.rsvps.forEach((rsvpPreset, rIdx) => {
      const upperCode = rsvpPreset.guestCode.toUpperCase();
      const matchedGuest = guests.find((g) => g.code.toUpperCase() === upperCode);
      if (!matchedGuest) return;
      const mappedStatus: 'ATTENDING' | 'DECLINED' | 'PENDING' =
        rsvpPreset.status === 'attending'
          ? 'ATTENDING'
          : rsvpPreset.status === 'declined'
            ? 'DECLINED'
            : 'PENDING';
      subEventRsvps.push({
        id: rsvpPreset.id || `demo-${archetypeId}-rsvp-${sIdx + 1}-${rIdx + 1}`,
        subEventId,
        invitationCodeId: matchedGuest.id,
        guestCode: matchedGuest.code,
        guestName: matchedGuest.guestName,
        status: mappedStatus,
        plusOneCount: rsvpPreset.plusOneCount ?? 0,
        plusOneNames: [...(rsvpPreset.plusOneNames ?? [])],
        mealSelection: rsvpPreset.mealSelections?.[0] ?? null,
        mealSelections: [...(rsvpPreset.mealSelections ?? [])],
        dietaryNotes: rsvpPreset.dietaryNotes || '',
        customAnswers: { ...(rsvpPreset.customAnswers ?? {}) },
        respondedAt: DEMO_SEED_TIMESTAMP_ISO,
        updatedAt: DEMO_SEED_TIMESTAMP_ISO,
      });
    });

    return {
      id: subEventId,
      title: se.title,
      description: se.description,
      startTime: se.startTime,
      endTime: se.endTime,
      locationName: se.locationName,
      location: se.location || se.locationName,
      category: se.category,
      attireRules: se.attireRules ?? null,
      isPrivate: Boolean(se.isPrivate),
      displayOrder: sIdx,
      mealOptions: se.mealOptions.map((m) => ({
        id: m.id,
        label: m.label,
        description: m.description,
        dietaryTags: [...m.dietaryTags],
      })),
      customQuestions: se.customQuestions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        type: q.type,
        required: q.required,
        options: [...q.options],
      })),
      isSample: true,
      createdAt: DEMO_SEED_TIMESTAMP_ISO,
      updatedAt: DEMO_SEED_TIMESTAMP_ISO,
    } as SubEventDTO;
  });

  const scheduleNodes: ContentNodeDTO[] = subEvents
    .filter((se) => !se.isPrivate)
    .map((se, idx) => ({
      id: `demo-${archetypeId}-schedule-${idx + 1}`,
      type: 'Schedule',
      tags: ['Homepage', 'Schedule'],
      data: {
        title: se.title,
        description: se.description ?? '',
        startTime: String(se.startTime),
        endTime: String(se.endTime),
        locationName: se.locationName ?? locationLabel,
        location: se.location ?? locationLabel,
        category: se.category ?? 'Wedding',
        displayOrder: idx,
        isVisible: true,
        isSample: true,
      },
      createdAt: seedDate,
      updatedAt: seedDate,
    }));

  // Photos & Media library (with basePath-prefixed asset URLs + guaranteed pending moderation item)
  const rawPhotoPresets = [...preset.photos];
  if (!rawPhotoPresets.some((p) => p.status === 'PENDING')) {
    rawPhotoPresets.push({
      id: `sample-photo-${archetypeId}-pending`,
      source: 'guest-upload',
      status: 'PENDING',
      isVisible: true,
      url: '/images/sample-photo-dance.jpg',
      title: 'Candid Toast at Cocktail Hour',
      caption: 'Raising a glass on the terrace!',
      altText: 'Guests raising glasses during cocktail hour',
      category: 'Reception',
      uploaderName: firstGuest?.guestName || 'Jordan Lee',
      uploaderEmail: firstGuest?.email || 'guest@example.com',
      createdAt: DEMO_SEED_TIMESTAMP_ISO,
    });
  }

  const photos: DemoPhotoRecord[] = rawPhotoPresets.map((photo, pIdx) => {
    const nodeId = `demo-${archetypeId}-photo-node-${pIdx + 1}`;
    const mediaId = `demo-${archetypeId}-media-${pIdx + 1}`;
    const resolvedUrl = prefixDemoAssetUrl(photo.url);
    const isGuestUpload = photo.source === 'guest-upload';
    return {
      id: nodeId,
      nodeId,
      mediaId,
      url: resolvedUrl,
      title: photo.title,
      caption: photo.caption,
      altText: photo.altText,
      category: isGuestUpload ? 'guest' : 'curated',
      source: photo.source,
      status: photo.status,
      isVisible: photo.isVisible !== false,
      isGuestUpload,
      ...(photo.uploaderName ? { uploaderName: photo.uploaderName } : {}),
      ...(photo.uploaderEmail ? { uploaderEmail: photo.uploaderEmail } : {}),
      isSample: true,
      createdAt: photo.createdAt || DEMO_SEED_TIMESTAMP_ISO,
      updatedAt: photo.createdAt || DEMO_SEED_TIMESTAMP_ISO,
    };
  });

  const media: MediaDTO[] = photos.map((photo) => ({
    id: photo.mediaId,
    url: photo.url,
    altText: photo.altText || photo.title,
    isDecorative: false,
    tags: photo.isGuestUpload ? ['Gallery', 'guest-upload'] : ['Gallery', 'Curated'],
    isSample: true,
    createdAt: new Date(photo.createdAt),
    updatedAt: new Date(photo.updatedAt),
  }));

  const broadcastRecipients: DemoBroadcastRecipientRecord[] = guests
    .slice(0, Math.min(4, guests.length))
    .map((g, idx) => ({
      id: `demo-${archetypeId}-broadcast-rcpt-${idx + 1}`,
      broadcastId: `demo-${archetypeId}-broadcast-1`,
      invitationCodeId: g.id,
      recipientName: g.guestName,
      recipientEmail: g.email || `${g.code.toLowerCase()}@example.com`,
      channel: 'EMAIL',
      status: idx < 2 ? 'VIEWED' : 'DELIVERED',
      sentAt: DEMO_SEED_TIMESTAMP_ISO,
      viewedAt: idx < 2 ? DEMO_SEED_TIMESTAMP_ISO : null,
      errorMessage: null,
    }));

  const broadcastMessages: DemoBroadcastRecord[] = [
    {
      id: `demo-${archetypeId}-broadcast-1`,
      subject: `Save the Date & Weekend Schedule — ${preset.siteConfig.partner1Name} & ${preset.siteConfig.partner2Name}`,
      body: `We can't wait to celebrate with you at ${preset.siteConfig.venueName}! Use your household code on our wedding website to view your weekend itinerary and RSVP.`,
      channel: 'EMAIL',
      status: 'SENT',
      audienceLabel: 'All Invited Households',
      recipientCount: broadcastRecipients.length,
      sentCount: broadcastRecipients.length,
      failedCount: 0,
      viewedCount: broadcastRecipients.filter((r) => r.status === 'VIEWED').length,
      scheduledAt: null,
      sentAt: DEMO_SEED_TIMESTAMP_ISO,
      createdBy: 'Admin',
      createdAt: DEMO_SEED_TIMESTAMP_ISO,
      updatedAt: DEMO_SEED_TIMESTAMP_ISO,
      isSample: true,
      recipients: broadcastRecipients,
    },
  ];

  const features = buildDefaultFeatures();
  const modules = buildDefaultModules();

  const siteConfig: DemoSiteConfigSeed = {
    partner1Name: preset.siteConfig.partner1Name,
    partner2Name: preset.siteConfig.partner2Name,
    weddingDate: preset.siteConfig.weddingDate,
    baseUrl: preset.siteConfig.baseUrl,
    venueName: preset.siteConfig.venueName,
    venueAddress: preset.siteConfig.venueAddress,
    venueCity: preset.siteConfig.venueCity,
    venueState: preset.siteConfig.venueState,
    venueZip: preset.siteConfig.venueZip,
    latitude: preset.siteConfig.latitude,
    longitude: preset.siteConfig.longitude,
    storyText: preset.siteConfig.storyText,
    venueDescription: preset.siteConfig.venueDescription,
    travelAdvice: preset.siteConfig.travelAdvice,
    heroTitle: preset.siteConfig.heroTitle,
    heroSubtitle: preset.siteConfig.heroSubtitle,
    seoTitle: preset.siteConfig.seoTitle,
    seoDescription: preset.siteConfig.seoDescription,
    contactEmail: preset.siteConfig.contactEmail,
    faviconUrl: prefixDemoAssetUrl(preset.siteConfig.faviconUrl),
    ogImageUrl: prefixDemoAssetUrl(preset.siteConfig.ogImageUrl),
    heroImageUrl: prefixDemoAssetUrl(preset.siteConfig.heroImageUrl),
    heroImageAlt: preset.siteConfig.heroImageAlt,
    colorPrimary: preset.siteConfig.colorPrimary,
    colorSecondary: preset.siteConfig.colorSecondary,
    themePreset: preset.siteConfig.themePreset,
    timezone: preset.siteConfig.timezone,
    autoApproveGuestPhotos: false,
    guestPhotoQrTokenVersion: 1,
    adminTokenVersion: 1,
    rsvpOpen: true,
    rsvpDeadlineDate: null,
    rsvpGracePeriodHours: 24,
    rsvpClosedMessage: 'Online RSVPs have closed. Please reach out to us directly for changes.',
    showCountdown: true,
    showAddToCalendar: true,
    shippingRecipientName: preset.siteConfig.shippingRecipientName,
    shippingAddressLine1: preset.siteConfig.shippingAddressLine1,
    shippingAddressLine2: preset.siteConfig.shippingAddressLine2,
    shippingCity: preset.siteConfig.shippingCity,
    shippingState: preset.siteConfig.shippingState,
    shippingZip: preset.siteConfig.shippingZip,
    shippingCountry: preset.siteConfig.shippingCountry,
    shippingPhone: preset.siteConfig.shippingPhone,
    shippingDeliveryNotes: preset.siteConfig.shippingDeliveryNotes,
    defaultPaymentHandleType: 'Venmo',
    defaultPaymentHandle: '@alex-and-taylor',
  };

  const snapshotVersions: DemoSnapshotVersionRecord[] = [
    {
      id: `demo-${archetypeId}-version-1`,
      entityType: 'AppConfig',
      entityId: 'app-config-primary',
      action: 'INITIAL_SEED',
      summary: `Initialized ${preset.name} preset configuration and starter records`,
      createdBy: 'System',
      createdAt: DEMO_SEED_TIMESTAMP_ISO,
      data: {
        themePreset: siteConfig.themePreset,
        venueName: siteConfig.venueName,
        partner1Name: siteConfig.partner1Name,
        partner2Name: siteConfig.partner2Name,
      },
    },
    {
      id: `demo-${archetypeId}-version-2`,
      entityType: 'FeatureOrder',
      entityId: 'homepage-features',
      action: 'UPDATE',
      summary: 'Configured default homepage section order and visibility',
      createdBy: 'Admin',
      createdAt: DEMO_SEED_TIMESTAMP_ISO,
      data: {
        features: features.map((f) => ({ ...f })),
      },
    },
  ];

  return {
    registryItems,
    offlineContributors,
    guests,
    seatingTables,
    weddingParty,
    attractions,
    faqs,
    logisticsNodes,
    scheduleNodes,
    customNodes: [],
    photos,
    media,
    subEvents,
    subEventAccess,
    subEventRsvps,
    features,
    modules,
    broadcastMessages,
    snapshotVersions,
    siteConfig,
  };
}
