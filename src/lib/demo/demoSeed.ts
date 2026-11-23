import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import type {
  InvitationCodeDTO,
  RegistryItem,
  RegistryShippingAddress,
} from '@/features/registry';
import type { SeatingTableDTO } from '@/features/seating';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import type { AttractionDTO } from '@/features/attractions';
import type { ContentNodeDTO } from '@/features/content';

export interface ArchetypeDataset {
  registryItems: RegistryItem[];
  guests: InvitationCodeDTO[];
  seatingTables: SeatingTableDTO[];
  weddingParty: WeddingPartyMemberDTO[];
  attractions: AttractionDTO[];
  faqs: ContentNodeDTO[];
  logisticsNodes: ContentNodeDTO[];
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

function createSampleItemSvgDataUrl(title: string, category: string): string {
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

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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

export function buildArchetypeDataset(archetypeId: ArchetypeId): ArchetypeDataset {
  const preset = ARCHETYPE_PRESETS[archetypeId] ?? ARCHETYPE_PRESETS.classic;
  const seedDate = new Date(DEMO_SEED_TIMESTAMP_ISO);

  const registryItems: RegistryItem[] = preset.registryItems.map((item, idx) => {
    const id = `demo-${archetypeId}-item-${idx + 1}`;
    const itemType = item.itemType ?? 'PHYSICAL';
    const isFund = itemType === 'CASH_FUND' || itemType === 'EXPERIENCE_FUND';
    const isGroupGift = Boolean(item.isGroupGift || isFund);
    const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    return {
      id,
      name: item.name,
      description: item.description,
      category: item.category,
      price: item.price,
      quantity: 1,
      itemType,
      isGroupGift,
      isMostWanted: Boolean(item.isMostWanted),
      displayOrder: idx,
      vendorUrl: isFund ? null : `https://example.com/gifts/${slug}`,
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

  const guests: InvitationCodeDTO[] = preset.guests.map((guest, idx) => {
    const id = `demo-${archetypeId}-guest-${idx + 1}`;
    const tableId = guest.seatTableName ? (tableIdByName.get(guest.seatTableName) ?? null) : null;
    return {
      id,
      code: guest.code.toUpperCase(),
      guestName: guest.guestName,
      email: '',
      addressLine1: `${100 + idx * 12} Maple Avenue`,
      addressLine2: '',
      city: archetypeId === 'destination' ? 'Miami' : archetypeId === 'romantic' ? 'Napa' : 'Chicago',
      state: archetypeId === 'destination' ? 'FL' : archetypeId === 'romantic' ? 'CA' : 'IL',
      zipCode: archetypeId === 'destination' ? '33139' : archetypeId === 'romantic' ? '94559' : '60611',
      country: 'USA',
      dietaryNotes: '',
      plusOneAllocations: guest.plusOnesAllowed ?? 0,
      plusOneFirstName: '',
      plusOneLastName: '',
      householdName: guest.householdName,
      partyGroup: guest.partyGroup,
      partyTags: [...guest.partyTags],
      extraFields: { rsvpStatus: 'ATTENDING' },
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
    bookingUrl: attraction.promoCode ? attraction.website : null,
    roomRate: attraction.roomRate ?? null,
    cutoffDate: null,
    shuttleInfo: null,
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
        startTime: '2026-09-19T16:00:00.000Z',
        endTime: '2026-09-19T23:00:00.000Z',
        locationName: locationLabel,
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
      },
      createdAt: seedDate,
      updatedAt: seedDate,
    },
  ];

  return {
    registryItems,
    guests,
    seatingTables,
    weddingParty,
    attractions,
    faqs,
    logisticsNodes,
  };
}
