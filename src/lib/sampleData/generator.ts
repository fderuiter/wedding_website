import { prisma } from '@/lib/prisma';
import { ARCHETYPE_PRESETS, ArchetypeId } from './archetypes';

export interface GenerateSampleDataOptions {
  archetype?: ArchetypeId;
  modules?: string[];
}

export interface SampleDataStatus {
  hasSampleData: boolean;
  counts: {
    registry: number;
    guests: number;
    seating: number;
    weddingParty: number;
    attractions: number;
  };
}

export async function getSampleDataStatus(): Promise<SampleDataStatus> {
  const [registry, guests, seating, weddingParty, attractions] = await Promise.all([
    prisma.registryItem.count({ where: { isSample: true } }),
    prisma.invitationCode.count({ where: { isSample: true } }),
    prisma.seatingTable.count({ where: { isSample: true } }),
    prisma.weddingPartyMember.count({ where: { isSample: true } }),
    prisma.attraction.count({ where: { isSample: true } }),
  ]);

  const counts = { registry, guests, seating, weddingParty, attractions };
  const hasSampleData = Object.values(counts).some((count) => count > 0);

  return {
    hasSampleData,
    counts,
  };
}

export async function purgeSampleData() {
  const previousStatus = await getSampleDataStatus();

  await prisma.$transaction(async (tx) => {
    // 1. Delete Contributors linked to sample registry items or sample invitation codes
    await tx.contributor.deleteMany({
      where: {
        OR: [
          { registryItem: { isSample: true } },
          { invitationCode: { isSample: true } },
        ],
      },
    });

    // 2. Delete SubEventAccess / SubEventRsvp for sample invitation codes
    await tx.subEventAccess.deleteMany({
      where: { invitationCode: { isSample: true } },
    });
    await tx.subEventRsvp.deleteMany({
      where: { invitationCode: { isSample: true } },
    });

    // 3. Delete sample invitation codes and seating tables
    await tx.invitationCode.deleteMany({ where: { isSample: true } });
    await tx.seatingTable.deleteMany({ where: { isSample: true } });

    // 4. Delete sample registry items, wedding party members, attractions
    await tx.registryItem.deleteMany({ where: { isSample: true } });
    await tx.weddingPartyMember.deleteMany({ where: { isSample: true } });
    await tx.attraction.deleteMany({ where: { isSample: true } });

    // 5. Delete sample media
    await tx.media.deleteMany({ where: { isSample: true } });
  });

  return {
    success: true,
    purgedCounts: previousStatus.counts,
  };
}

export async function generateSampleData(options: GenerateSampleDataOptions = {}) {
  const archetypeId: ArchetypeId = options.archetype && ARCHETYPE_PRESETS[options.archetype]
    ? options.archetype
    : 'classic';
  const preset = ARCHETYPE_PRESETS[archetypeId];

  const enabledModules = new Set(options.modules || ['registry', 'guests', 'seating', 'weddingParty', 'attractions']);

  // First purge any existing sample data to prevent duplicate unique key collisions (e.g. guest codes)
  await purgeSampleData();

  const createdCounts = {
    registry: 0,
    guests: 0,
    seating: 0,
    weddingParty: 0,
    attractions: 0,
  };

  await prisma.$transaction(async (tx) => {
    // A. Registry items
    if (enabledModules.has('registry')) {
      for (const item of preset.registryItems) {
        const media = await tx.media.create({
          data: {
            url: item.imageUrl,
            altText: item.imageAlt,
            isDecorative: false,
            isSample: true,
          },
        });

        await tx.registryItem.create({
          data: {
            name: item.name,
            description: item.description,
            category: item.category,
            price: item.price,
            itemType: item.itemType || 'PHYSICAL',
            isGroupGift: item.isGroupGift || false,
            isMostWanted: item.isMostWanted || false,
            imageId: media.id,
            isSample: true,
          },
        });
        createdCounts.registry++;
      }
    }

    // B. Seating layout
    const tableMap = new Map<string, string>(); // tableName -> tableId
    if (enabledModules.has('seating')) {
      for (const table of preset.seatingTables) {
        const createdTable = await tx.seatingTable.create({
          data: {
            name: table.name,
            shape: table.shape,
            capacity: table.capacity,
            x: table.x,
            y: table.y,
            isSample: true,
          },
        });
        tableMap.set(table.name, createdTable.id);
        createdCounts.seating++;
      }
    }

    // C. Guest list
    if (enabledModules.has('guests')) {
      for (const guest of preset.guests) {
        const tableId = guest.seatTableName ? tableMap.get(guest.seatTableName) || null : null;
        await tx.invitationCode.create({
          data: {
            guestName: guest.guestName,
            code: guest.code,
            householdName: guest.householdName,
            partyGroup: guest.partyGroup,
            partyTags: guest.partyTags,
            plusOneAllocations: guest.plusOnesAllowed ?? 0,
            tableId,
            seatNumber: guest.seatNumber ?? null,
            isSample: true,
          },
        });
        createdCounts.guests++;
      }
    }

    // D. Wedding party
    if (enabledModules.has('weddingParty')) {
      for (const member of preset.weddingParty) {
        await tx.weddingPartyMember.create({
          data: {
            name: member.name,
            role: member.role,
            bio: member.bio,
            side: member.side,
            order: member.order,
            isSample: true,
          },
        });
        createdCounts.weddingParty++;
      }
    }

    // E. Attractions
    if (enabledModules.has('attractions')) {
      for (const attraction of preset.attractions) {
        await tx.attraction.create({
          data: {
            name: attraction.name,
            description: attraction.description,
            category: attraction.category,
            website: attraction.website,
            directions: attraction.directions,
            latitude: attraction.latitude,
            longitude: attraction.longitude,
            promoCode: attraction.promoCode || null,
            roomRate: attraction.roomRate || null,
            isSample: true,
          },
        });
        createdCounts.attractions++;
      }
    }
  });

  return {
    success: true,
    archetype: archetypeId,
    createdCounts,
  };
}
