import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import { DEFAULT_MODULE_CONFIG } from '@/lib/modules';
import { splitMemberFullName } from '@/utils/invitationValidation';
import { createDemoSvgDataUrl } from './svgAssets';
import {
  STATIC_DEMO_BACKUP_SCHEMA_VERSION,
  STATIC_DEMO_STORE_VERSION,
  type DemoAppConfigRecord,
  type DemoAttractionRecord,
  type DemoBroadcastMessageRecord,
  type DemoBroadcastRecipientRecord,
  type DemoContentNodeRecord,
  type DemoContributorRecord,
  type DemoHouseholdMemberRecord,
  type DemoHouseholdRole,
  type DemoInvitationCodeRecord,
  type DemoMediaRecord,
  type DemoRegistryItemRecord,
  type DemoSeatingTableRecord,
  type DemoSnapshotVersionRecord,
  type DemoSubEventAccessRecord,
  type DemoSubEventMemberRsvpRecord,
  type DemoSubEventRecord,
  type DemoSubEventRsvpRecord,
  type DemoWeddingPartyMemberRecord,
  type StaticDemoSnapshot,
} from './types';

export function synthesizeDemoHouseholdMembersFromInvitations(
  invitations: DemoInvitationCodeRecord[],
  nowIso = '2026-05-01T12:00:00.000Z',
): DemoHouseholdMemberRecord[] {
  const members: DemoHouseholdMemberRecord[] = [];
  for (const inv of invitations) {
    const primaryParts = splitMemberFullName(inv.guestName);
    const primaryPhone =
      inv.extraFields && typeof inv.extraFields === 'object'
        ? (typeof inv.extraFields.phone === 'string' && inv.extraFields.phone.trim()) ||
          (typeof inv.extraFields.mobile === 'string' && inv.extraFields.mobile.trim()) ||
          null
        : null;
    members.push({
      id: `${inv.id}-member-1`,
      invitationCodeId: inv.id,
      firstName: primaryParts.firstName,
      lastName: primaryParts.lastName,
      fullName: inv.guestName,
      role: 'PRIMARY',
      email: inv.email,
      phone: primaryPhone,
      dietaryNotes: inv.dietaryNotes,
      tags: [...(inv.partyTags ?? [])],
      displayOrder: 0,
      seatNumber: inv.tableId ? inv.seatNumber : null,
      createdAt: inv.createdAt || nowIso,
      updatedAt: inv.updatedAt || nowIso,
    });

    const companionCount = Math.max(0, inv.plusOneAllocations || 0);
    const namedCompanion = [inv.plusOneFirstName, inv.plusOneLastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    for (let i = 0; i < companionCount; i += 1) {
      const fullName =
        i === 0 && namedCompanion
          ? namedCompanion
          : companionCount === 1
            ? `${inv.guestName} (Plus One)`
            : `${inv.guestName} (Guest ${i + 1})`;
      const parts = splitMemberFullName(fullName);
      const seat =
        inv.tableId && Array.isArray(inv.plusOneSeatNumbers)
          ? (inv.plusOneSeatNumbers[i] ?? null)
          : null;
      members.push({
        id: `${inv.id}-member-${i + 2}`,
        invitationCodeId: inv.id,
        firstName: i === 0 && inv.plusOneFirstName ? inv.plusOneFirstName : parts.firstName,
        lastName: i === 0 && inv.plusOneLastName ? inv.plusOneLastName : parts.lastName,
        fullName,
        role: i === 0 && namedCompanion ? 'PARTNER' : 'PLUS_ONE',
        email: null,
        phone: null,
        dietaryNotes: null,
        tags: [],
        displayOrder: i + 1,
        seatNumber: seat,
        createdAt: inv.createdAt || nowIso,
        updatedAt: inv.updatedAt || nowIso,
      });
    }
  }
  return members;
}

export function synthesizeDemoSubEventMemberRsvps(
  rsvps: DemoSubEventRsvpRecord[],
  members: DemoHouseholdMemberRecord[],
  nowIso = '2026-05-01T12:00:00.000Z',
): DemoSubEventMemberRsvpRecord[] {
  const byInvite = new Map<string, DemoHouseholdMemberRecord[]>();
  for (const m of members) {
    const list = byInvite.get(m.invitationCodeId) ?? [];
    list.push(m);
    byInvite.set(m.invitationCodeId, list);
  }
  byInvite.forEach((list) => list.sort((a, b) => a.displayOrder - b.displayOrder));

  const out: DemoSubEventMemberRsvpRecord[] = [];
  for (const rsvp of rsvps) {
    const inviteMembers = byInvite.get(rsvp.invitationCodeId) ?? [];
    inviteMembers.forEach((member, idx) => {
      const status =
        rsvp.status === 'declined'
          ? 'declined'
          : rsvp.status === 'attending'
            ? idx <= (rsvp.plusOneCount ?? 0)
              ? 'attending'
              : 'declined'
            : 'pending';
      const mealOptionId =
        status === 'attending' && Array.isArray(rsvp.mealSelections) && rsvp.mealSelections[idx]
          ? rsvp.mealSelections[idx]
          : null;
      out.push({
        id: `mrsvp-${rsvp.id}-${member.id}`,
        subEventRsvpId: rsvp.id,
        householdMemberId: member.id,
        status,
        mealOptionId,
        dietaryNotes:
          status === 'attending'
            ? member.dietaryNotes || (idx === 0 ? rsvp.dietaryNotes : null)
            : null,
        createdAt: rsvp.createdAt || nowIso,
        updatedAt: rsvp.updatedAt || nowIso,
      });
    });
  }
  return out;
}

interface ArchetypeMeta {
  partner1Name: string;
  partner2Name: string;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  venueState: string;
  venueZip: string;
  latitude: number;
  longitude: number;
  timezone: string;
  weddingDate: string;
  themePreset: 'classic' | 'modern' | 'romantic';
  colorPrimary: string;
  colorSecondary: string;
  paymentHandle: string;
  heroSubtitle: string;
  storyText: string;
  venueDescription: string;
  travelAdvice: string;
}

const ARCHETYPE_META: Record<ArchetypeId, ArchetypeMeta> = {
  classic: {
    partner1Name: 'Alex Morgan',
    partner2Name: 'Taylor Jordan',
    venueName: 'The Glasshouse Estate',
    venueAddress: '123 Meadow Lane',
    venueCity: 'Minneapolis',
    venueState: 'MN',
    venueZip: '55401',
    latitude: 44.9778,
    longitude: -93.265,
    timezone: 'America/Chicago',
    weddingDate: '2026-09-19T16:00:00.000Z',
    themePreset: 'classic',
    colorPrimary: '#991B1B',
    colorSecondary: '#B45309',
    paymentHandle: '@AlexAndTaylor2026',
    heroSubtitle: 'Join us under the oaks in Minneapolis',
    storyText:
      'Welcome to our wedding showcase! From coffee dates along the riverfront to weekends baking at home, we cannot wait to gather our favorite people under one roof.\n\nExplore the weekend schedule, RSVP with your invitation code, or browse our registry below.',
    venueDescription:
      'The Glasshouse Estate features sunlit botanical conservatories, century-old oak lawns, and a lakeside reception ballroom.',
    travelAdvice:
      'Minneapolis-Saint Paul International Airport (MSP) is 20 minutes from downtown hotels, with complimentary evening shuttles to the estate.',
  },
  destination: {
    partner1Name: 'Elena Morales',
    partner2Name: 'Julian Brooks',
    venueName: 'Oceanview Palms Resort & Spa',
    venueAddress: '1 Ocean Drive',
    venueCity: 'Key Biscayne',
    venueState: 'FL',
    venueZip: '33149',
    latitude: 25.6938,
    longitude: -80.1628,
    timezone: 'America/New_York',
    weddingDate: '2026-11-14T17:00:00.000Z',
    themePreset: 'modern',
    colorPrimary: '#0F766E',
    colorSecondary: '#0369A1',
    paymentHandle: '@ElenaAndJulianSea',
    heroSubtitle: 'A coastal weekend by the Atlantic breeze',
    storyText:
      'Our favorite memories have always been by the water—from sunrise paddleboarding to sunset sails.\n\nPack your linen attire and celebrate three days of coastal dining, ocean views, and dancing under the palms.',
    venueDescription:
      'Oceanview Palms Resort & Spa sits on a private stretch of white sand with open-air cabanas and a breezy oceanfront pavilion.',
    travelAdvice:
      'Fly into Miami International Airport (MIA), located 25 minutes from Key Biscayne via the Rickenbacker Causeway.',
  },
  romantic: {
    partner1Name: 'Clara Bennett',
    partner2Name: 'Oliver Wright',
    venueName: 'Willow Creek Vineyard & Gardens',
    venueAddress: '45 Country Lane',
    venueCity: 'Sonoma',
    venueState: 'CA',
    venueZip: '95476',
    latitude: 38.2919,
    longitude: -122.458,
    timezone: 'America/Los_Angeles',
    weddingDate: '2026-10-10T16:30:00.000Z',
    themePreset: 'romantic',
    colorPrimary: '#831843',
    colorSecondary: '#6D28D9',
    paymentHandle: '@ClaraAndOliverGarden',
    heroSubtitle: 'Candlelight, vines, and autumn harvest joy',
    storyText:
      'We fell in love over farmers market mornings, acoustic guitar evenings, and long walks through Northern California orchards.\n\nWe are honored to share an intimate garden ceremony and harvest table dinner with you.',
    venueDescription:
      'Willow Creek pairs heirloom rose arbors and olive groves with a timbered vineyard barn lit by warm lanterns.',
    travelAdvice:
      'San Francisco (SFO), Oakland (OAK), and Sonoma County (STS) airports offer easy scenic drives into Sonoma Valley.',
  },
};

export function isValidArchetypeId(value: unknown): value is ArchetypeId {
  return value === 'classic' || value === 'destination' || value === 'romantic';
}

export function buildArchetypeSeedSnapshot(
  archetype: ArchetypeId = 'classic',
): StaticDemoSnapshot {
  const resolvedArchetype: ArchetypeId = isValidArchetypeId(archetype) ? archetype : 'classic';
  const preset = ARCHETYPE_PRESETS[resolvedArchetype];
  const meta = ARCHETYPE_META[resolvedArchetype];
  const nowIso = '2026-05-01T12:00:00.000Z';

  const media: DemoMediaRecord[] = [];
  const registryItem: DemoRegistryItemRecord[] = [];

  preset.registryItems.forEach((item, idx) => {
    const itemId = idx === 0 ? '1' : `reg-${resolvedArchetype}-${idx + 1}`;
    const mediaId = `media-reg-${resolvedArchetype}-${idx + 1}`;
    const svgUrl = createDemoSvgDataUrl(item.name, item.category, resolvedArchetype);

    media.push({
      id: mediaId,
      url: svgUrl,
      altText: item.imageAlt,
      isDecorative: false,
      isSample: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const isGroup = Boolean(
      item.isGroupGift || item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND',
    );
    const initialContributed = idx === 2 ? Math.min(100, Math.round(item.price * 0.25)) : 0;

    registryItem.push({
      id: itemId,
      name: item.name,
      description: item.description,
      category: item.category,
      price: item.price,
      imageId: mediaId,
      quantity: 1,
      itemType: item.itemType ?? 'PHYSICAL',
      paymentHandleType: isGroup ? 'Venmo' : null,
      paymentHandle: isGroup ? meta.paymentHandle : null,
      vendorUrl: item.itemType === 'PHYSICAL' ? `https://example.com/shop/${itemId}` : null,
      isGroupGift: isGroup,
      isMostWanted: Boolean(item.isMostWanted),
      displayOrder: idx,
      purchased: false,
      isSample: false,
      purchaserName: null,
      amountContributed: initialContributed,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  const seatingTable: DemoSeatingTableRecord[] = preset.seatingTables.map((table, idx) => ({
    id: `table-${resolvedArchetype}-${idx + 1}`,
    name: table.name,
    shape: table.shape,
    capacity: table.capacity,
    x: table.x,
    y: table.y,
    width: table.shape === 'rectangular' ? 180 : 120,
    height: 120,
    rotation: 0,
    isSample: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  const tableIdByName = new Map(seatingTable.map((t) => [t.name, t.id]));

  const tableById = new Map(seatingTable.map((t) => [t.id, t]));
  const occupiedSeatsByTable = new Map<string, Set<number>>();
  for (const guest of preset.guests) {
    const resolvedTableId = guest.seatTableName
      ? (tableIdByName.get(guest.seatTableName) ?? null)
      : null;
    if (resolvedTableId && typeof guest.seatNumber === 'number') {
      const set = occupiedSeatsByTable.get(resolvedTableId) ?? new Set<number>();
      set.add(guest.seatNumber);
      occupiedSeatsByTable.set(resolvedTableId, set);
    }
  }

  const householdMember: DemoHouseholdMemberRecord[] = [];
  const invitationCode: DemoInvitationCodeRecord[] = preset.guests.map((guest, idx) => {
    const resolvedTableId = guest.seatTableName
      ? (tableIdByName.get(guest.seatTableName) ?? null)
      : null;
    const primarySeat = guest.seatNumber ?? null;
    const presetMembers = Array.isArray(guest.members) ? guest.members : [];
    const plusOneCount = Math.max(
      guest.plusOnesAllowed ?? 0,
      presetMembers.length > 1 ? presetMembers.length - 1 : 0,
    );
    const plusOneSeatNumbers: number[] = [];
    if (resolvedTableId && primarySeat !== null && plusOneCount > 0) {
      const tableCap = tableById.get(resolvedTableId)?.capacity ?? 8;
      const used = occupiedSeatsByTable.get(resolvedTableId) ?? new Set<number>([primarySeat]);
      occupiedSeatsByTable.set(resolvedTableId, used);
      for (let s = 1; s <= tableCap && plusOneSeatNumbers.length < plusOneCount; s += 1) {
        if (!used.has(s)) {
          used.add(s);
          plusOneSeatNumbers.push(s);
        }
      }
    }

    const invId = `inv-${resolvedArchetype}-${idx + 1}`;
    const defaultDietary = idx === 0 ? 'Vegetarian' : idx === 1 ? 'Gluten-free' : '';
    const firstSecondaryPreset = presetMembers.find((m) => m.role !== 'PRIMARY');
    const firstSecondaryParts = firstSecondaryPreset
      ? splitMemberFullName(firstSecondaryPreset.fullName)
      : null;

    if (presetMembers.length > 0) {
      let secIdx = 0;
      presetMembers.forEach((pm, mIdx) => {
        const parts = splitMemberFullName(pm.fullName);
        const role: DemoHouseholdRole =
          pm.role === 'PRIMARY' || pm.role === 'PARTNER' || pm.role === 'CHILD'
            ? pm.role
            : 'PLUS_ONE';
        const seat =
          resolvedTableId === null
            ? null
            : mIdx === 0
              ? primarySeat
              : (plusOneSeatNumbers[secIdx++] ?? null);
        householdMember.push({
          id: `${invId}-member-${mIdx + 1}`,
          invitationCodeId: invId,
          firstName: parts.firstName,
          lastName: parts.lastName,
          fullName: pm.fullName,
          role,
          email: pm.email ?? (mIdx === 0 ? `guest${idx + 1}@example.org` : null),
          phone: pm.phone ?? null,
          dietaryNotes: pm.dietaryNotes ?? (mIdx === 0 ? defaultDietary || null : null),
          tags: pm.tags ? [...pm.tags] : mIdx === 0 ? [...guest.partyTags] : [],
          displayOrder: mIdx,
          seatNumber: seat,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      });
    } else {
      const primaryParts = splitMemberFullName(guest.guestName);
      householdMember.push({
        id: `${invId}-member-1`,
        invitationCodeId: invId,
        firstName: primaryParts.firstName,
        lastName: primaryParts.lastName,
        fullName: guest.guestName,
        role: 'PRIMARY',
        email: `guest${idx + 1}@example.org`,
        phone: null,
        dietaryNotes: defaultDietary || null,
        tags: [...guest.partyTags],
        displayOrder: 0,
        seatNumber: resolvedTableId ? primarySeat : null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      for (let cIdx = 0; cIdx < plusOneCount; cIdx += 1) {
        const compName = cIdx === 0 ? 'Sam Guest' : `${guest.guestName} (Guest ${cIdx + 1})`;
        const compParts = splitMemberFullName(compName);
        householdMember.push({
          id: `${invId}-member-${cIdx + 2}`,
          invitationCodeId: invId,
          firstName: compParts.firstName,
          lastName: compParts.lastName,
          fullName: compName,
          role: cIdx === 0 ? 'PARTNER' : 'PLUS_ONE',
          email: null,
          phone: null,
          dietaryNotes: null,
          tags: [],
          displayOrder: cIdx + 1,
          seatNumber: resolvedTableId ? (plusOneSeatNumbers[cIdx] ?? null) : null,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }

    return {
      id: invId,
      code: guest.code,
      guestName: guest.guestName,
      email: `guest${idx + 1}@example.org`,
      addressLine1: `${100 + idx * 12} Maple Street`,
      addressLine2: null,
      city: meta.venueCity,
      state: meta.venueState,
      zipCode: meta.venueZip,
      country: 'US',
      dietaryNotes: defaultDietary,
      plusOneAllocations: plusOneCount,
      plusOneFirstName:
        plusOneCount > 0 ? (firstSecondaryParts?.firstName ?? 'Sam') : null,
      plusOneLastName:
        plusOneCount > 0 ? (firstSecondaryParts?.lastName ?? 'Guest') : null,
      householdName: guest.householdName,
      partyGroup: guest.partyGroup,
      partyTags: [...guest.partyTags],
      extraFields: null,
      used: idx < 2,
      usedAt: idx < 2 ? nowIso : null,
      tableId: resolvedTableId,
      seatNumber: primarySeat,
      plusOneSeatNumbers,
      isSample: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  const contributor: DemoContributorRecord[] = [];
  const seededFundItem = registryItem[2] ?? registryItem[0];
  const firstInvite = invitationCode[0];
  if (seededFundItem && firstInvite && seededFundItem.amountContributed > 0) {
    contributor.push({
      id: `contrib-${resolvedArchetype}-1`,
      name: firstInvite.guestName,
      email: firstInvite.email,
      addressLine1: firstInvite.addressLine1,
      addressLine2: firstInvite.addressLine2,
      city: firstInvite.city,
      state: firstInvite.state,
      zipCode: firstInvite.zipCode,
      country: firstInvite.country,
      isPlusOne: false,
      amount: seededFundItem.amountContributed,
      refundedAmount: 0,
      status: 'CONFIRMED',
      coverFee: false,
      feeAmount: 0,
      date: nowIso,
      message: 'Wishing you both a lifetime of happiness and adventure!',
      thankYouStatus: 'Unsent',
      thankYouSentAt: null,
      thankYouEmailSentAt: null,
      thankYouNote: 'Thank you so much for your generous gift!',
      stripePaymentIntentId: null,
      stripeChargeId: null,
      transactionTimestamp: nowIso,
      confirmationEmailSentAt: nowIso,
      alertEmailSentAt: nowIso,
      reminderEmailSentAt: null,
      retailerOrderNumber: null,
      carrier: null,
      trackingNumber: null,
      registryItemId: seededFundItem.id,
      invitationCodeId: firstInvite.id,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  const weddingPartyMember: DemoWeddingPartyMemberRecord[] = preset.weddingParty.map(
    (member, idx) => {
      const photoMediaId = `media-party-${resolvedArchetype}-${idx + 1}`;
      media.push({
        id: photoMediaId,
        url: createDemoSvgDataUrl(member.name, member.role, resolvedArchetype),
        altText: `Portrait of ${member.name}, ${member.role}`,
        isDecorative: false,
        isSample: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      return {
        id: `party-${resolvedArchetype}-${idx + 1}`,
        name: member.name,
        role: member.role,
        bio: member.bio,
        photoId: photoMediaId,
        side: member.side,
        link: null,
        order: member.order,
        isSample: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    },
  );

  const attraction: DemoAttractionRecord[] = preset.attractions.map((item, idx) => {
    const attrMediaId = `media-attr-${resolvedArchetype}-${idx + 1}`;
    media.push({
      id: attrMediaId,
      url: createDemoSvgDataUrl(item.name, item.category, resolvedArchetype),
      altText: item.name,
      isDecorative: false,
      isSample: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return {
      id: `attr-${resolvedArchetype}-${idx + 1}`,
      name: item.name,
      description: item.description,
      category: item.category,
      website: item.website,
      directions: item.directions,
      latitude: item.latitude,
      longitude: item.longitude,
      imageId: attrMediaId,
      isVisible: true,
      isSample: false,
      promoCode: item.promoCode ?? null,
      bookingUrl: item.promoCode ? item.website : null,
      roomRate: item.roomRate ?? null,
      cutoffDate: item.promoCode ? '2026-08-15' : null,
      shuttleInfo: item.promoCode ? 'Complimentary shuttle departs 45 minutes before ceremony.' : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  const subEvent: DemoSubEventRecord[] = [
    {
      id: 'sub-1',
      title: 'Welcome Dinner & Cocktails',
      description: 'Join us for drinks and welcoming appetizers as guests arrive.',
      startTime: '2026-09-18T18:00:00.000Z',
      endTime: '2026-09-18T21:00:00.000Z',
      locationName: 'Sunset Terrace',
      location: `${meta.venueAddress}, ${meta.venueCity}`,
      attireRules: 'Cocktail Chic',
      category: 'Celebration',
      isPrivate: false,
      mealOptions: [],
      customQuestions: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'sub-2',
      title: 'Wedding Ceremony',
      description: `Exchange of vows at ${meta.venueName}.`,
      startTime: '2026-09-19T15:30:00.000Z',
      endTime: '2026-09-19T16:30:00.000Z',
      locationName: resolvedArchetype === 'classic' ? 'Grand Oak Lawn' : meta.venueName,
      location: `${meta.venueAddress}, ${meta.venueCity}`,
      attireRules: 'Formal / Black Tie Optional',
      category: 'Ceremony',
      isPrivate: false,
      mealOptions: [],
      customQuestions: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'sub-3',
      title: 'Reception & Dancing',
      description: 'Dinner, toasts, and dancing late into the night.',
      startTime: '2026-09-19T17:00:00.000Z',
      endTime: '2026-09-19T23:30:00.000Z',
      locationName:
        resolvedArchetype === 'classic' ? 'Lakeside Ballroom' : 'Grand Pavilion Ballroom',
      location: `${meta.venueAddress}, ${meta.venueCity}`,
      attireRules: 'Formal',
      category: 'Reception',
      isPrivate: false,
      mealOptions: [
        {
          id: 'meal-beef',
          label: 'Braised Short Rib',
          description: 'Garlic mashed potatoes & seasonal greens',
          dietaryTags: ['gluten-free'],
        },
        {
          id: 'meal-fish',
          label: 'Herb-Crusted Halibut',
          description: 'Lemon risotto & asparagus',
          dietaryTags: ['gluten-free', 'nut-free'],
        },
        {
          id: 'meal-veg',
          label: 'Wild Mushroom Risotto',
          description: 'Truffle oil & roasted root vegetables',
          dietaryTags: ['vegan', 'gluten-free', 'dairy-free'],
        },
      ],
      customQuestions: [
        {
          id: 'q-shuttle',
          prompt: `Will you use the hotel shuttle to ${resolvedArchetype === 'classic' ? 'Lakeside Ballroom' : meta.venueName}?`,
          type: 'choice',
          required: true,
          options: ['Yes, round-trip', 'No, driving separately'],
        },
        {
          id: 'q-song',
          prompt: 'What song will get you out on the dance floor?',
          type: 'text',
          required: false,
          options: [],
        },
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'sub-4',
      title: 'Farewell Brunch',
      description: 'Coffee, pastries, and farewell embraces before departures.',
      startTime: '2026-09-20T10:00:00.000Z',
      endTime: '2026-09-20T13:00:00.000Z',
      locationName: resolvedArchetype === 'classic' ? 'Garden Pavilion' : 'Garden Conservatory',
      location: `${meta.venueAddress}, ${meta.venueCity}`,
      attireRules: 'Casual',
      category: 'Brunch',
      isPrivate: false,
      mealOptions: [],
      customQuestions: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const subEventAccess: DemoSubEventAccessRecord[] = [];
  const subEventRsvp: DemoSubEventRsvpRecord[] = [];

  invitationCode.forEach((inv, guestIdx) => {
    subEvent.forEach((evt, evtIdx) => {
      subEventAccess.push({
        id: `access-${inv.id}-${evt.id}`,
        subEventId: evt.id,
        invitationCodeId: inv.id,
        createdAt: nowIso,
      });

      if (guestIdx === 0 && evtIdx !== 2) {
        subEventRsvp.push({
          id: `rsvp-${inv.id}-${evt.id}`,
          subEventId: evt.id,
          invitationCodeId: inv.id,
          status: evtIdx === 3 ? 'declined' : 'attending',
          plusOneCount: evtIdx < 2 && inv.plusOneAllocations > 0 ? 1 : 0,
          dietaryNotes: evtIdx === 0 ? inv.dietaryNotes || 'Vegetarian' : '',
          mealSelections: [],
          customAnswers: {},
          plusOneNames: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      } else if (guestIdx === 1 && evtIdx < 3) {
        subEventRsvp.push({
          id: `rsvp-${inv.id}-${evt.id}`,
          subEventId: evt.id,
          invitationCodeId: inv.id,
          status: 'attending',
          plusOneCount: inv.plusOneAllocations > 0 ? 1 : 0,
          dietaryNotes: inv.dietaryNotes || '',
          mealSelections: evt.id === 'sub-3' ? ['meal-fish'] : [],
          customAnswers: evt.id === 'sub-3' ? { 'q-shuttle': 'No, driving separately' } : {},
          plusOneNames: inv.plusOneAllocations > 0 ? ['Sam Guest'] : [],
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    });
  });

  const subEventMemberRsvp = synthesizeDemoSubEventMemberRsvps(
    subEventRsvp,
    householdMember,
    nowIso,
  );

  const curatedPhotoMediaId = `media-photo-curated-${resolvedArchetype}-1`;
  const curatedPhotoUrl = createDemoSvgDataUrl(
    `${meta.partner1Name.split(' ')[0]} & ${meta.partner2Name.split(' ')[0]}`,
    meta.venueName,
    resolvedArchetype,
  );
  media.push({
    id: curatedPhotoMediaId,
    url: curatedPhotoUrl,
    altText: `${meta.partner1Name} and ${meta.partner2Name} engagement portrait`,
    isDecorative: false,
    isSample: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const guestPhotoMediaId = `media-photo-guest-${resolvedArchetype}-1`;
  const guestPhotoUrl = createDemoSvgDataUrl(
    'Sunset Welcome Toast',
    'Uploaded by Guests',
    resolvedArchetype,
  );
  media.push({
    id: guestPhotoMediaId,
    url: guestPhotoUrl,
    altText: 'Guests raising glasses at sunset welcome dinner',
    isDecorative: false,
    isSample: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const pendingPhotoMediaId = `media-photo-pending-${resolvedArchetype}-1`;
  const pendingPhotoUrl = createDemoSvgDataUrl(
    'Dance Floor Candid',
    'Pending Moderation',
    'neutral',
  );
  media.push({
    id: pendingPhotoMediaId,
    url: pendingPhotoUrl,
    altText: 'Candid dance floor celebration photo',
    isDecorative: false,
    isSample: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const contentNode: DemoContentNodeRecord[] = [
    ...preset.faqs.map((faq, idx) => ({
      id: `faq-${resolvedArchetype}-${idx + 1}`,
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
        isSample: false,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    })),
    {
      id: `logistics-${resolvedArchetype}-1`,
      type: 'Logistics',
      tags: ['Homepage'],
      data: {
        title: 'Wedding Day Details',
        ceremonyTitle: 'Wedding Ceremony',
        ceremonyTime: '3:30 PM',
        receptionTitle: 'Reception & Dinner',
        receptionTime: '5:00 PM',
        receptionDetails: `Cocktails, dinner, and dancing at ${meta.venueName}.`,
        receptionAttire: 'Formal / Cocktail Attire',
        locationName: meta.venueName,
        location: `${meta.venueAddress}, ${meta.venueCity}, ${meta.venueState}`,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: `photo-curated-${resolvedArchetype}-1`,
      type: 'Photo',
      tags: ['Gallery', 'Curated'],
      data: {
        url: curatedPhotoUrl,
        mediaId: curatedPhotoMediaId,
        title: 'Golden Hour Portrait',
        altText: `${meta.partner1Name} and ${meta.partner2Name} engagement portrait`,
        caption: `Captured at ${meta.venueName}`,
        status: 'APPROVED',
        isVisible: true,
        publishToGallery: true,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: `photo-guest-${resolvedArchetype}-1`,
      type: 'Photo',
      tags: ['Gallery', 'guest-upload'],
      data: {
        url: guestPhotoUrl,
        mediaId: guestPhotoMediaId,
        title: 'Sunset Welcome Toast',
        altText: 'Guests raising glasses at sunset welcome dinner',
        caption: 'Cheers to the happy couple!',
        uploaderName: firstInvite?.guestName ?? 'Sarah Johnson',
        status: 'APPROVED',
        isVisible: true,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: `photo-pending-${resolvedArchetype}-1`,
      type: 'Photo',
      tags: ['Gallery', 'guest-upload'],
      data: {
        url: pendingPhotoUrl,
        mediaId: pendingPhotoMediaId,
        title: 'Dance Floor Candid',
        altText: 'Candid dance floor celebration photo',
        caption: 'Best night ever!',
        uploaderName: invitationCode[1]?.guestName ?? 'Guest Photographer',
        status: 'PENDING',
        isVisible: false,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const appConfigRecord: DemoAppConfigRecord = {
    id: 'global',
    createdAt: nowIso,
    updatedAt: nowIso,
    partner1Name: meta.partner1Name,
    partner2Name: meta.partner2Name,
    brideName: meta.partner1Name,
    groomName: meta.partner2Name,
    subdomain: null,
    weddingDate: meta.weddingDate,
    baseUrl: 'https://showcase.wedding-demo.org',
    venueName: meta.venueName,
    venueAddress: meta.venueAddress,
    venueCity: meta.venueCity,
    venueState: meta.venueState,
    venueZip: meta.venueZip,
    latitude: meta.latitude,
    longitude: meta.longitude,
    storyText: meta.storyText,
    venueDescription: meta.venueDescription,
    travelAdvice: meta.travelAdvice,
    heroTitle: `${meta.partner1Name.split(' ')[0]} & ${meta.partner2Name.split(' ')[0]}`,
    heroSubtitle: meta.heroSubtitle,
    seoTitle: `${meta.partner1Name} & ${meta.partner2Name} Wedding`,
    seoDescription: `Celebrate with ${meta.partner1Name} and ${meta.partner2Name} at ${meta.venueName}.`,
    seoKeywords: 'wedding, celebration, schedule, registry',
    contactEmail: 'hosts@wedding-demo.org',
    photoAlbumUrl: '',
    faviconUrl: '/assets/favicon.png',
    ogImageUrl: '/images/placeholder.png',
    brandMonogram: `${meta.partner1Name[0]}&${meta.partner2Name[0]}`,
    brandLogoUrl: null,
    brandLogoAlt: null,
    heroImageUrl: null,
    heroImageAlt: null,
    brandWatermarkUrl: null,
    brandWatermarkAlt: null,
    badgeGraphicUrl: null,
    badgeGraphicAlt: null,
    colorPrimary: meta.colorPrimary,
    colorSecondary: meta.colorSecondary,
    themePreset: meta.themePreset,
    themeTokens: {},
    layoutContainerMaxWidth: '64rem',
    layoutGridGap: '1.5rem',
    layoutCardPadding: '2rem',
    layoutBorderRadius: '1rem',
    features: [
      { id: 'story', type: 'story', title: 'Our Story', visible: true },
      { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
      { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
      { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
      { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
      { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true },
    ],
    modules: { ...DEFAULT_MODULE_CONFIG },
    timezone: meta.timezone,
    showCountdown: true,
    showAddToCalendar: true,
    autoApproveGuestPhotos: false,
    guestPhotoQrTokenVersion: 1,
    setupCompleted: true,
    rsvpOpen: true,
    rsvpDeadlineDate: '',
    rsvpGracePeriodHours: 0,
    rsvpClosedMessage:
      'Online RSVPs are now closed. Please contact the hosts directly if your plans or dietary needs have changed.',
    emailProvider: 'smtp',
    smtpHost: 'smtp.wedding-demo.org',
    smtpPort: 587,
    smtpUser: 'notifications@wedding-demo.org',
    smtpFrom: 'Wedding Showcase <notifications@wedding-demo.org>',
    smtpSecure: false,
    resendFrom: null,
    sendgridFrom: null,
    smsProvider: 'none',
    twilioAccountSid: null,
    twilioFromNumber: null,
    broadcastBatchSize: 50,
    broadcastBatchDelayMs: 500,
    shippingRecipientName: `${meta.partner1Name} & ${meta.partner2Name}`,
    shippingAddressLine1: meta.venueAddress,
    shippingAddressLine2: 'Suite 2B',
    shippingCity: meta.venueCity,
    shippingState: meta.venueState,
    shippingZip: meta.venueZip,
    shippingCountry: 'United States',
    shippingPhone: '555-0199',
    shippingDeliveryNotes: 'Leave packages with the concierge desk.',
    defaultPaymentHandleType: 'Venmo',
    defaultPaymentHandle: meta.paymentHandle,
    registryGiftAccessTier: 'PASSCODE_GUESTS',
    shippingDisclosureTier: 'PASSCODE_GUESTS',
    maxPendingReservations: 5,
  };

  const broadcastId = `broadcast-${resolvedArchetype}-1`;
  const broadcastMessage: DemoBroadcastMessageRecord[] = [
    {
      id: broadcastId,
      channel: 'EMAIL',
      subject: `Save the Date — ${appConfigRecord.heroTitle}`,
      body: `We are thrilled to invite you to ${meta.venueName}! Visit your Guest Portal to RSVP.`,
      targetFilters: { attendanceStatus: 'all' },
      status: 'COMPLETED',
      totalRecipients: invitationCode.length,
      sentCount: invitationCode.length,
      failedCount: 0,
      scheduledFor: null,
      sentAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const broadcastRecipient: DemoBroadcastRecipientRecord[] = invitationCode.map((inv, idx) => ({
    id: `brecip-${resolvedArchetype}-${idx + 1}`,
    broadcastId,
    invitationCodeId: inv.id,
    guestName: inv.guestName,
    destination: inv.email ?? `guest${idx + 1}@example.org`,
    status: 'SENT',
    error: null,
    sentAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  const snapshotVersion: DemoSnapshotVersionRecord[] = [
    {
      id: `ver-${resolvedArchetype}-1`,
      entityType: 'AppConfig',
      entityId: 'global',
      data: { ...appConfigRecord },
      createdAt: nowIso,
      author: 'Demo Seed',
    },
  ];

  return {
    storeVersion: STATIC_DEMO_STORE_VERSION,
    schemaVersion: STATIC_DEMO_BACKUP_SCHEMA_VERSION,
    activeArchetype: resolvedArchetype,
    isSetupMode: false,
    isAdminAuthenticated: true,
    guestSession: null,
    storageWarning: null,
    updatedAt: nowIso,
    appConfig: [appConfigRecord],
    contentNode,
    media,
    seatingTable,
    invitationCode,
    householdMember,
    weddingPartyMember,
    attraction,
    registryItem,
    contributor,
    subEvent,
    subEventAccess,
    subEventRsvp,
    subEventMemberRsvp,
    broadcastMessage,
    broadcastRecipient,
    snapshotVersion,
  };
}
