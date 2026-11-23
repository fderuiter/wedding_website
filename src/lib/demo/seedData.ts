import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import {
  STATIC_EXPORT_PUBLIC_CONFIG,
  STATIC_EXPORT_REGISTRY_ITEMS,
  STATIC_MOCK_PUBLIC_PHOTOS,
  STATIC_MOCK_WEDDING_PARTY_MEMBERS,
} from '@/lib/sampleData/staticExportSeeds';
import type { RegistryItem } from '@/features/registry';
import type { ThemePreset } from '@/lib/theme/presets';
import type {
  DemoAttraction,
  DemoBroadcastRecord,
  DemoConfig,
  DemoContentNode,
  DemoInvitationCode,
  DemoMediaItem,
  DemoSeatingTable,
  DemoState,
  DemoSubEvent,
  DemoSubEventRsvp,
  DemoVersionRecord,
  DemoWeddingPartyMember,
} from './types';

const BASE_TIMESTAMP = '2026-06-01T15:00:00.000Z';

const ARCHETYPE_THEME_DETAILS: Record<
  ArchetypeId,
  {
    partner1Name: string;
    partner2Name: string;
    venueName: string;
    venueAddress: string;
    venueCity: string;
    venueState: string;
    venueZip: string;
    themePreset: ThemePreset;
    colorPrimary: string;
    colorSecondary: string;
    colorAccent: string;
    heroHeadline: string;
    venueDescription: string;
  }
> = {
  classic: {
    partner1Name: 'Alex',
    partner2Name: 'Taylor',
    venueName: 'The Grand Botanical Conservatory',
    venueAddress: '100 Conservatory Way',
    venueCity: 'Hudson',
    venueState: 'NY',
    venueZip: '12534',
    themePreset: 'classic',
    colorPrimary: '#9F1239',
    colorSecondary: '#B45309',
    colorAccent: '#D4AF37',
    heroHeadline: 'Join us in the Hudson Valley for an autumn celebration',
    venueDescription:
      'The Grand Botanical Conservatory is nestled amidst lush Hudson Valley gardens and historic stone terraces.',
  },
  destination: {
    partner1Name: 'Alex',
    partner2Name: 'Taylor',
    venueName: 'Cliffside Ocean Pavilion',
    venueAddress: '18 Coastal Bluff Road',
    venueCity: 'Carmel',
    venueState: 'CA',
    venueZip: '93923',
    themePreset: 'modern',
    colorPrimary: '#0F4C81',
    colorSecondary: '#0E7490',
    colorAccent: '#F59E0B',
    heroHeadline: 'Pack your bags for a coastal weekend in Carmel-by-the-Sea, CA',
    venueDescription:
      'Cliffside Ocean Pavilion overlooks the cypress groves and dramatic Pacific coastline of Carmel-by-the-Sea.',
  },
  romantic: {
    partner1Name: 'Alex',
    partner2Name: 'Taylor',
    venueName: 'Willow Creek Vineyard Estate',
    venueAddress: '420 Vineyard Lane',
    venueCity: 'Sonoma',
    venueState: 'CA',
    venueZip: '95476',
    themePreset: 'romantic',
    colorPrimary: '#166534',
    colorSecondary: '#9D174D',
    colorAccent: '#CA8A04',
    heroHeadline: 'An intimate candlelit evening among the Sonoma vines',
    venueDescription:
      'Willow Creek Vineyard Estate is surrounded by rolling Sonoma grapevines, olive trees, and string-lit courtyards.',
  },
};

const PARTY_PORTRAITS = [
  '/images/sample-party-1.jpg',
  '/images/sample-party-2.jpg',
  '/images/sample-party-3.jpg',
  '/images/sample-party-4.jpg',
];

function buildDefaultSubEvents(): DemoSubEvent[] {
  return [
    {
      id: 'demo-subevent-rehearsal',
      title: 'Wedding Party Rehearsal Dinner',
      description: 'Intimate wood-fired dinner and toasts for family and the wedding party.',
      location: 'The Carriage House Tavern',
      address: '42 Warren Street, Hudson, NY 12534',
      startTime: '2026-10-23T22:00:00.000Z',
      endTime: '2026-10-24T00:30:00.000Z',
      dressCode: 'Smart Casual',
      isPrivate: true,
      rsvpEnabled: true,
      mealOptions: [
        {
          id: 'rehearsal-herb-chicken',
          label: 'Herb-Roasted Hudson Chicken',
          dietaryTags: ['gluten-free'],
        },
        {
          id: 'rehearsal-risotto',
          label: 'Wild Mushroom Farro Risotto',
          dietaryTags: ['vegetarian'],
        },
      ],
      customQuestions: [],
      displayOrder: 0,
      isSample: true,
      createdAt: BASE_TIMESTAMP,
      updatedAt: BASE_TIMESTAMP,
    },
    {
      id: 'demo-subevent-welcome',
      title: 'Welcome Drinks & Conservatory Stroll',
      description: 'Kick off the weekend with local cider, sparkling cocktails, and acoustic strings.',
      location: 'Conservatory Terrace',
      address: '100 Conservatory Way, Hudson, NY 12534',
      startTime: '2026-10-24T00:30:00.000Z',
      endTime: '2026-10-24T02:30:00.000Z',
      dressCode: 'Festive Casual',
      isPrivate: false,
      rsvpEnabled: true,
      mealOptions: [],
      customQuestions: [
        {
          id: 'shuttle-friday',
          prompt: 'Will you use the downtown shuttle on Friday evening?',
          type: 'choice',
          options: ['Yes, count us in', 'No, driving ourselves'],
        },
      ],
      displayOrder: 1,
      isSample: true,
      createdAt: BASE_TIMESTAMP,
      updatedAt: BASE_TIMESTAMP,
    },
    {
      id: 'demo-subevent-ceremony',
      title: 'Wedding Ceremony & Dinner Reception',
      description: 'Garden ceremony followed by cocktail hour, plated dinner, and dancing.',
      location: 'The Grand Botanical Conservatory',
      address: '100 Conservatory Way, Hudson, NY 12534',
      startTime: '2026-10-24T20:30:00.000Z',
      endTime: '2026-10-25T03:00:00.000Z',
      dressCode: 'Cocktail Attire',
      isPrivate: false,
      rsvpEnabled: true,
      mealOptions: [
        {
          id: 'entree-short-rib',
          label: 'Braised Cabernet Short Rib',
          dietaryTags: ['gluten-free'],
        },
        {
          id: 'entree-halibut',
          label: 'Pan-Seared Atlantic Halibut',
          dietaryTags: ['dairy-free'],
        },
        {
          id: 'entree-gnocchi',
          label: 'Butternut Squash & Sage Gnocchi',
          dietaryTags: ['vegan', 'nut-free'],
        },
      ],
      customQuestions: [
        {
          id: 'song-request',
          prompt: 'What song is guaranteed to get you onto the dance floor?',
          type: 'text',
        },
      ],
      displayOrder: 2,
      isSample: true,
      createdAt: BASE_TIMESTAMP,
      updatedAt: BASE_TIMESTAMP,
    },
    {
      id: 'demo-subevent-brunch',
      title: 'Farewell Orchard Brunch',
      description: 'Drop by for espresso, warm apple cider donuts, and hugs before heading home.',
      location: 'Glasshouse Sunroom',
      address: '100 Conservatory Way, Hudson, NY 12534',
      startTime: '2026-10-25T14:30:00.000Z',
      endTime: '2026-10-25T17:00:00.000Z',
      dressCode: 'Travel Casual',
      isPrivate: false,
      rsvpEnabled: true,
      mealOptions: [],
      customQuestions: [],
      displayOrder: 3,
      isSample: true,
      createdAt: BASE_TIMESTAMP,
      updatedAt: BASE_TIMESTAMP,
    },
  ];
}

function buildRegistryForArchetype(archetypeId: ArchetypeId): RegistryItem[] {
  if (archetypeId === 'classic') {
    return JSON.parse(JSON.stringify(STATIC_EXPORT_REGISTRY_ITEMS)) as RegistryItem[];
  }
  const preset = ARCHETYPE_PRESETS[archetypeId];
  return preset.registryItems.map((item, idx) => {
    const itemId = `demo-reg-${archetypeId}-${idx + 1}`;
    const isCash = item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND';
    const initialContribution = idx === 0
      ? [
        {
          id: `demo-contrib-${archetypeId}-1`,
          name: 'Jordan Rivera',
          email: 'jordan.rivera@example.com',
          isPlusOne: false,
          message: 'Cannot wait to celebrate with you both!',
          amount: isCash ? Math.min(250, item.price) : item.price,
          refundedAmount: 0,
          status: 'CONFIRMED' as const,
          coverFee: false,
          feeAmount: 0,
          date: '2026-06-12T18:30:00.000Z',
          transactionTimestamp: null,
          thankYouStatus: 'Unsent',
          thankYouSentAt: null,
          thankYouNote: null,
          registryItemId: itemId,
        },
      ]
      : [];
    const amountContributed = initialContribution.reduce((sum, c) => sum + c.amount, 0);
    return {
      id: itemId,
      name: item.name,
      description: item.description,
      price: item.price,
      quantity: isCash ? 1 : 2,
      purchased: !isCash && amountContributed >= item.price,
      purchaserName: null,
      imageUrl: item.imageUrl,
      imageAlt: item.imageAlt,
      vendorUrl: isCash ? '' : `https://example.com/gifts/${archetypeId}-${idx + 1}`,
      category: item.category,
      isGroupGift: Boolean(item.isGroupGift || isCash),
      amountContributed,
      contributors: initialContribution,
      itemType: item.itemType ?? 'PHYSICAL',
      isMostWanted: Boolean(item.isMostWanted),
      isSample: true,
      displayOrder: idx,
      paymentHandleType: isCash ? 'Venmo' : null,
      paymentHandle: isCash ? '@alex-taylor-wedding' : null,
    };
  });
}

export function buildInitialDemoState(archetypeId: ArchetypeId = 'classic'): DemoState {
  const preset = ARCHETYPE_PRESETS[archetypeId];
  const themeDetails = ARCHETYPE_THEME_DETAILS[archetypeId];
  const basePublic = STATIC_EXPORT_PUBLIC_CONFIG;

  const config: DemoConfig = {
    ...basePublic,
    id: 'global',
    partner1Name: themeDetails.partner1Name,
    partner2Name: themeDetails.partner2Name,
    venueName: themeDetails.venueName,
    venueAddress: themeDetails.venueAddress,
    venueCity: themeDetails.venueCity,
    venueState: themeDetails.venueState,
    venueZip: themeDetails.venueZip,
    themePreset: themeDetails.themePreset,
    colorPrimary: themeDetails.colorPrimary,
    colorSecondary: themeDetails.colorSecondary,
    heroSubtitle: themeDetails.heroHeadline,
    venueDescription: themeDetails.venueDescription,
    baseUrl: 'https://example.github.io/wedding_website/demo',
    rsvpOpen: true,
    rsvpDeadlineDate: '2026-09-20',
    rsvpClosedMessage: 'Online RSVPs have closed. Please reach out to us directly with any changes.',
    defaultPaymentHandle: '@alex-taylor-wedding',
    defaultPaymentHandleType: 'Venmo',
    shippingRecipientName: `${themeDetails.partner1Name} & ${themeDetails.partner2Name}`,
    shippingAddressLine1: '742 Evergreen Terrace',
    shippingCity: themeDetails.venueCity,
    shippingState: themeDetails.venueState,
    shippingZip: themeDetails.venueZip,
    shippingCountry: 'US',
    moduleToggles: [
      {
        id: 'registry',
        name: 'Gift Registry & Cash Funds',
        description: 'Zero-fee P2P cash funds, group gifting, and physical registry reservations.',
        enabled: true,
      },
      {
        id: 'gallery',
        name: 'Photo Gallery & Live Slideshow',
        description: 'Curated album, QR guest uploads, moderation queue, and reception projection.',
        enabled: true,
      },
      {
        id: 'weddingParty',
        name: 'Wedding Party Bios',
        description: 'Portraits and stories introducing your wedding party.',
        enabled: true,
      },
      {
        id: 'attractions',
        name: 'Local Guide & Interactive Map',
        description: 'Curated hotels, dining, and weekend recommendations.',
        enabled: true,
      },
      {
        id: 'heart3d',
        name: '3D Interactive Heart',
        description: 'Physics-enabled 3D keepsake scene with graceful 2D fallback.',
        enabled: true,
      },
    ],
    siteSections: [
      { id: 'story', type: 'story', title: 'Our Story', visible: true },
      { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
      { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
      { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
      { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
      { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true },
    ],
  };

  const seatingTables: DemoSeatingTable[] = [
    ...preset.seatingTables.map((t, idx) => ({
      id: `demo-table-${idx + 1}`,
      name: t.name,
      shape: t.shape,
      capacity: t.capacity,
      x: t.x,
      y: t.y,
      width: t.shape === 'rectangular' ? 180 : 130,
      height: t.shape === 'rectangular' ? 100 : 130,
      rotation: 0,
      isSample: true,
      createdAt: BASE_TIMESTAMP,
      updatedAt: BASE_TIMESTAMP,
    })),
    {
      id: 'demo-table-sweetheart',
      name: 'Sweetheart Table',
      shape: 'sweetheart',
      capacity: 4,
      x: 350,
      y: 90,
      width: 160,
      height: 90,
      rotation: 0,
      isSample: true,
      createdAt: BASE_TIMESTAMP,
      updatedAt: BASE_TIMESTAMP,
    },
  ];

  const tableIdByName = new Map(seatingTables.map((t) => [t.name, t.id]));
  const subEvents = buildDefaultSubEvents();
  const publicSubEventIds = subEvents.filter((se) => !se.isPrivate).map((se) => se.id);
  const allSubEventIds = subEvents.map((se) => se.id);

  const extraDemoGuests = [
    {
      guestName: 'Jordan & Casey Rivera',
      code: 'RIVERA26',
      householdName: 'Rivera Household',
      partyGroup: 'Wedding Party',
      partyTags: ['wedding-party', 'vip'],
      plusOnesAllowed: 1,
      seatTableName: seatingTables[0]?.name,
      seatNumber: 3,
      dietaryNotes: 'Gluten-free',
      status: 'attending' as const,
    },
    {
      guestName: 'Morgan Chen',
      code: 'CHEN2026',
      householdName: 'Chen Household',
      partyGroup: 'College Friends',
      partyTags: ['friends', 'out-of-town'],
      plusOnesAllowed: 1,
      seatTableName: undefined,
      seatNumber: undefined,
      dietaryNotes: 'Vegetarian',
      status: 'attending' as const,
    },
    {
      guestName: 'Samir & Priya Patel',
      code: 'PATEL26',
      householdName: 'Patel Household',
      partyGroup: 'Family Friends',
      partyTags: ['family-friends'],
      plusOnesAllowed: 0,
      seatTableName: undefined,
      seatNumber: undefined,
      dietaryNotes: null,
      status: 'pending' as const,
    },
    {
      guestName: 'Avery Brooks',
      code: 'BROOKS26',
      householdName: 'Brooks Household',
      partyGroup: 'Work Colleagues',
      partyTags: ['colleagues'],
      plusOnesAllowed: 0,
      seatTableName: undefined,
      seatNumber: undefined,
      dietaryNotes: null,
      status: 'declined' as const,
    },
  ];

  const combinedGuests = [
    ...preset.guests.map((g, idx) => ({
      ...g,
      dietaryNotes: idx === 0 ? 'Nut-free' : null,
      status: 'attending' as const,
    })),
    ...extraDemoGuests,
  ];

  const invitationCodes: DemoInvitationCode[] = [];
  const subEventRsvps: DemoSubEventRsvp[] = [];

  combinedGuests.forEach((guest, idx) => {
    const id = `demo-invite-${idx + 1}`;
    const isVip =
      guest.partyTags.includes('vip') ||
      guest.partyTags.includes('wedding-party') ||
      guest.partyTags.includes('immediate-family');
    const allowedSubEventIds = isVip ? allSubEventIds : publicSubEventIds;
    const assignedTableId = guest.seatTableName
      ? (tableIdByName.get(guest.seatTableName) ?? null)
      : null;

    const mealSelection =
      guest.dietaryNotes === 'Vegetarian'
        ? ['entree-gnocchi']
        : idx % 2 === 0
          ? ['entree-short-rib']
          : ['entree-halibut'];

    invitationCodes.push({
      id,
      code: guest.code,
      guestName: guest.guestName,
      email: `${guest.code.toLowerCase()}@example.com`,
      householdName: guest.householdName,
      partyGroup: guest.partyGroup,
      partyTags: guest.partyTags,
      used: guest.status !== 'pending',
      plusOneAllocations: guest.plusOnesAllowed ?? 0,
      plusOneFirstName: (guest.plusOnesAllowed ?? 0) > 0 && guest.status === 'attending' ? 'Jamie' : null,
      plusOneLastName: (guest.plusOnesAllowed ?? 0) > 0 && guest.status === 'attending' ? 'Guest' : null,
      dietaryNotes: guest.dietaryNotes,
      addressLine1: `${100 + idx * 14} Maple Avenue`,
      addressLine2: idx % 3 === 0 ? 'Apt 4B' : null,
      city: 'Hudson',
      state: 'NY',
      zipCode: '12534',
      country: 'US',
      addressUpdatedAt: BASE_TIMESTAMP,
      tableId: guest.status === 'attending' ? assignedTableId : null,
      seatNumber: guest.status === 'attending' && assignedTableId ? (guest.seatNumber ?? idx + 1) : null,
      allowedSubEventIds,
      extraFields: {
        attendanceStatus: guest.status,
        rsvpStatus: guest.status,
        dietaryTags: guest.dietaryNotes ? [guest.dietaryNotes.toLowerCase()] : [],
        mealSelections: guest.status === 'attending' ? mealSelection : [],
      },
      isSample: true,
      createdAt: BASE_TIMESTAMP,
      updatedAt: BASE_TIMESTAMP,
    });

    for (const subEventId of allowedSubEventIds) {
      if (guest.status === 'pending') continue;
      const isCeremony = subEventId === 'demo-subevent-ceremony';
      subEventRsvps.push({
        id: `demo-rsvp-${id}-${subEventId}`,
        invitationCodeId: id,
        subEventId,
        status: guest.status,
        plusOneCount:
          guest.status === 'attending' && (guest.plusOnesAllowed ?? 0) > 0 ? 1 : 0,
        plusOneNames:
          guest.status === 'attending' && (guest.plusOnesAllowed ?? 0) > 0
            ? ['Jamie Guest']
            : [],
        mealSelections:
          guest.status === 'attending' && isCeremony ? mealSelection : [],
        dietaryNotes: guest.dietaryNotes,
        customAnswers:
          guest.status === 'attending' && isCeremony
            ? { 'song-request': idx % 2 === 0 ? 'September - Earth, Wind & Fire' : 'Signed, Sealed, Delivered' }
            : {},
        updatedAt: BASE_TIMESTAMP,
      });
    }
  });

  const weddingParty: DemoWeddingPartyMember[] =
    archetypeId === 'classic'
      ? STATIC_MOCK_WEDDING_PARTY_MEMBERS.map((member, idx) => ({
        id: member.id,
        name: member.name,
        role: member.role,
        side: member.side ?? 'JOINT',
        bio: member.bio ?? '',
        imageUrl: member.photoUrl || PARTY_PORTRAITS[idx % PARTY_PORTRAITS.length],
        imageAlt: member.photoAlt || `${member.name} portrait`,
        order: member.order,
        displayOrder: member.order,
        isSample: true,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      }))
      : preset.weddingParty.map((member, idx) => ({
        id: `demo-party-${archetypeId}-${idx + 1}`,
        name: member.name,
        role: member.role,
        side: member.side,
        bio: member.bio,
        imageUrl: PARTY_PORTRAITS[idx % PARTY_PORTRAITS.length],
        imageAlt: `Portrait of ${member.name}`,
        order: member.order,
        displayOrder: member.order,
        isSample: true,
        createdAt: BASE_TIMESTAMP,
        updatedAt: BASE_TIMESTAMP,
      }));

  const attractions: DemoAttraction[] = preset.attractions.map((item, idx) => ({
    id: `demo-attraction-${archetypeId}-${idx + 1}`,
    name: item.name,
    description: item.description,
    category: item.category,
    website: item.website,
    directions: item.directions,
    latitude: item.latitude,
    longitude: item.longitude,
    promoCode: item.promoCode ?? null,
    roomRate: item.roomRate ?? null,
    address: `${themeDetails.venueCity}, ${themeDetails.venueState}`,
    displayOrder: idx,
    isSample: true,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
  }));

  const faqNodes: DemoContentNode[] = preset.faqs.map((faq, idx) => ({
    id: `demo-faq-${archetypeId}-${idx + 1}`,
    slug: `faq-${archetypeId}-${idx + 1}`,
    type: 'FAQ',
    tags: faq.categoryTags,
    isPublished: true,
    data: {
      question: faq.question,
      answer: faq.answer,
      category: faq.category,
      categoryTags: faq.categoryTags,
      keywords: faq.keywords,
      isVisible: true,
      displayOrder: idx,
    },
    isSample: true,
    createdAt: BASE_TIMESTAMP,
    updatedAt: BASE_TIMESTAMP,
  }));

  const photoNodes: DemoContentNode[] = STATIC_MOCK_PUBLIC_PHOTOS.map((node) => ({
    id: node.id,
    slug: `photo-${node.id}`,
    type: 'PHOTO',
    tags: [...(node.tags ?? [])],
    isPublished: true,
    data: { ...(node.data as Record<string, unknown>) },
    isSample: true,
    createdAt: node.createdAt instanceof Date ? node.createdAt.toISOString() : String(node.createdAt ?? BASE_TIMESTAMP),
    updatedAt: node.updatedAt instanceof Date ? node.updatedAt.toISOString() : String(node.updatedAt ?? BASE_TIMESTAMP),
  }));

  const mediaItems: DemoMediaItem[] = [
    ...photoNodes.map((node, idx) => {
      const data = node.data as {
        url?: string;
        title?: string;
        altText?: string;
        caption?: string;
        uploaderName?: string;
      };
      return {
        id: `demo-media-${idx + 1}`,
        url: data.url ?? '/images/sample-photo-ceremony.jpg',
        filename: `wedding-gallery-${idx + 1}.jpg`,
        mimeType: 'image/jpeg',
        size: 9840,
        altText: data.altText ?? data.title ?? 'Wedding photo',
        caption: data.caption ?? data.title,
        category: node.tags.includes('guest-upload') ? 'Guest Uploads' : 'Engagement & Venue',
        isDecorative: false,
        uploaderName: data.uploaderName ?? 'Couple',
        moderationStatus: 'APPROVED' as const,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      };
    }),
    {
      id: 'demo-media-pending-1',
      url: '/images/sample-photo-dance.jpg',
      filename: 'guest-candid-sparklers.jpg',
      mimeType: 'image/jpeg',
      size: 9620,
      altText: 'Guests celebrating with sparklers on the patio',
      caption: 'Sparkler send-off practice!',
      category: 'Guest Uploads',
      isDecorative: false,
      uploaderName: 'Morgan Chen',
      moderationStatus: 'PENDING',
      createdAt: '2026-06-20T20:15:00.000Z',
      updatedAt: '2026-06-20T20:15:00.000Z',
    },
  ];

  const versions: DemoVersionRecord[] = [
    {
      id: 'demo-version-2',
      entityType: 'AppConfig',
      entityId: 'global',
      versionNumber: 2,
      author: 'Alex & Taylor (Demo Admin)',
      summary: `Applied ${preset.name} theme preset and weekend schedule`,
      data: {
        themePreset: config.themePreset,
        venueName: config.venueName,
        venueCity: config.venueCity,
      },
      createdAt: '2026-06-18T16:40:00.000Z',
    },
    {
      id: 'demo-version-1',
      entityType: 'AppConfig',
      entityId: 'global',
      versionNumber: 1,
      author: 'Setup Wizard',
      summary: 'Initialized wedding platform configuration',
      data: {
        themePreset: 'classic',
        venueName: 'The Grand Botanical Conservatory',
      },
      createdAt: BASE_TIMESTAMP,
    },
  ];

  const broadcasts: DemoBroadcastRecord[] = [
    {
      id: 'demo-broadcast-1',
      channel: 'EMAIL',
      subject: 'Save the Date & Hotel Room Block Details',
      body: '<p>We cannot wait to celebrate with you! Hotel block reservations are now open.</p>',
      audienceLabel: 'All Invited Households',
      status: 'SENT',
      totalRecipients: invitationCodes.length,
      sentCount: invitationCodes.length,
      failedCount: 0,
      scheduledFor: null,
      sentAt: '2026-06-10T14:00:00.000Z',
      createdAt: '2026-06-10T13:55:00.000Z',
      recipients: invitationCodes.slice(0, 3).map((inv, idx) => ({
        id: `demo-bcast-rec-${idx + 1}`,
        invitationCodeId: inv.id,
        guestName: inv.guestName,
        destination: inv.email ?? 'guest@example.com',
        status: 'SENT',
        error: null,
        sentAt: '2026-06-10T14:00:00.000Z',
      })),
    },
    {
      id: 'demo-broadcast-2',
      channel: 'EMAIL',
      subject: 'Welcome Drinks Shuttle Schedule Reminder',
      body: '<p>Shuttles depart from The Grand Hotel lobby at 6:15 PM on Friday evening.</p>',
      audienceLabel: 'Attending Guests',
      status: 'SCHEDULED',
      totalRecipients: 5,
      sentCount: 0,
      failedCount: 0,
      scheduledFor: '2026-10-20T15:00:00.000Z',
      sentAt: null,
      createdAt: '2026-06-19T18:00:00.000Z',
      recipients: [],
    },
  ];

  const primaryGuest = invitationCodes[0];

  return {
    schemaVersion: 1,
    isAdmin: true,
    setupWizardPreview: false,
    activeArchetype: archetypeId,
    guestSession: {
      invitationCodeId: primaryGuest.id,
      code: primaryGuest.code,
      guestName: primaryGuest.guestName,
      email: primaryGuest.email,
    },
    config,
    registryItems: buildRegistryForArchetype(archetypeId),
    invitationCodes,
    subEvents,
    subEventRsvps,
    seatingTables,
    weddingParty,
    attractions,
    contentNodes: [...faqNodes, ...photoNodes],
    mediaItems,
    versions,
    broadcasts,
  };
}
