import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ARCHETYPE_PRESETS, type ArchetypeId } from './archetypes';
import {
  SAMPLE_SUBEVENT_ID_PREFIX,
  buildArchetypeSeedData,
} from './builder';

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
    faqs: number;
    photos: number;
    subEvents: number;
  };
}

export async function getSampleDataStatus(): Promise<SampleDataStatus> {
  const [
    registry,
    guests,
    seating,
    weddingParty,
    attractions,
    faqs,
    photos,
    subEvents,
  ] = await Promise.all([
    prisma.registryItem.count({ where: { isSample: true } }),
    prisma.invitationCode.count({ where: { isSample: true } }),
    prisma.seatingTable.count({ where: { isSample: true } }),
    prisma.weddingPartyMember.count({ where: { isSample: true } }),
    prisma.attraction.count({ where: { isSample: true } }),
    prisma.contentNode?.count
      ? prisma.contentNode.count({
        where: {
          type: 'FAQ',
          data: { path: ['isSample'], equals: true },
        },
      })
      : Promise.resolve(0),
    prisma.contentNode?.count
      ? prisma.contentNode.count({
        where: {
          type: 'Photo',
          data: { path: ['isSample'], equals: true },
        },
      })
      : Promise.resolve(0),
    prisma.subEvent?.count
      ? prisma.subEvent.count({
        where: {
          id: { startsWith: SAMPLE_SUBEVENT_ID_PREFIX },
        },
      })
      : Promise.resolve(0),
  ]);

  const counts = {
    registry,
    guests,
    seating,
    weddingParty,
    attractions,
    faqs,
    photos,
    subEvents,
  };
  const hasSampleData = Object.values(counts).some((count) => count > 0);

  return {
    hasSampleData,
    counts,
  };
}

export async function purgeSampleData() {
  const previousStatus = await getSampleDataStatus();

  await prisma.$transaction(async (tx) => {
    // 1. Delete Contributors linked to sample registry items, sample invitation codes, or sample IDs
    await tx.contributor.deleteMany({
      where: {
        OR: [
          { registryItem: { isSample: true } },
          { invitationCode: { isSample: true } },
          { id: { startsWith: 'sample-contributor-' } },
        ],
      },
    });

    // 2. Delete SubEventAccess / SubEventRsvp for sample invitation codes or sample sub-events
    await tx.subEventAccess.deleteMany({
      where: {
        OR: [
          { invitationCode: { isSample: true } },
          { subEventId: { startsWith: SAMPLE_SUBEVENT_ID_PREFIX } },
        ],
      },
    });
    await tx.subEventRsvp.deleteMany({
      where: {
        OR: [
          { invitationCode: { isSample: true } },
          { subEventId: { startsWith: SAMPLE_SUBEVENT_ID_PREFIX } },
        ],
      },
    });

    if (tx.subEvent?.deleteMany) {
      await tx.subEvent.deleteMany({
        where: {
          id: { startsWith: SAMPLE_SUBEVENT_ID_PREFIX },
        },
      });
    }

    // 3. Delete sample invitation codes and seating tables
    await tx.invitationCode.deleteMany({ where: { isSample: true } });
    await tx.seatingTable.deleteMany({ where: { isSample: true } });

    // 4. Delete sample registry items, wedding party members, attractions
    await tx.registryItem.deleteMany({ where: { isSample: true } });
    await tx.weddingPartyMember.deleteMany({ where: { isSample: true } });
    await tx.attraction.deleteMany({ where: { isSample: true } });

    // 5. Delete sample CMS content nodes (FAQ, Photo, Logistics)
    if (tx.contentNode?.deleteMany) {
      await tx.contentNode.deleteMany({
        where: {
          data: { path: ['isSample'], equals: true },
        },
      });
    }

    // 6. Delete sample media
    await tx.media.deleteMany({ where: { isSample: true } });
  });

  return {
    success: true,
    purgedCounts: previousStatus.counts,
  };
}

export async function generateSampleData(
  options: GenerateSampleDataOptions = {}
) {
  const archetypeId: ArchetypeId =
    options.archetype && ARCHETYPE_PRESETS[options.archetype]
      ? options.archetype
      : 'classic';
  const seed = buildArchetypeSeedData(archetypeId);

  const enabledModules = new Set(
    options.modules || [
      'registry',
      'guests',
      'seating',
      'weddingParty',
      'attractions',
      'faqs',
      'photos',
      'subEvents',
      'logistics',
    ]
  );

  // First purge any existing sample data to prevent duplicate unique key collisions (e.g. guest codes, IDs)
  await purgeSampleData();

  const createdCounts = {
    registry: 0,
    guests: 0,
    seating: 0,
    weddingParty: 0,
    attractions: 0,
    faqs: 0,
    photos: 0,
    subEvents: 0,
  };

  await prisma.$transaction(async (tx) => {
    // A. Seating layout
    const createdTableIds = new Set<string>();
    if (enabledModules.has('seating')) {
      for (const table of seed.seatingTables) {
        const createdTable = await tx.seatingTable.create({
          data: {
            id: table.id,
            name: table.name,
            shape: table.shape,
            capacity: table.capacity,
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
            rotation: table.rotation,
            isSample: true,
          },
        });
        createdTableIds.add(createdTable.id);
        createdCounts.seating++;
      }
    }

    // B. Guest list
    const createdGuestIds = new Set<string>();
    if (enabledModules.has('guests')) {
      for (const guest of seed.guests) {
        const tableId =
          guest.tableId && createdTableIds.has(guest.tableId)
            ? guest.tableId
            : null;
        const createdGuest = await tx.invitationCode.create({
          data: {
            id: guest.id,
            guestName: guest.guestName,
            code: guest.code,
            email: guest.email ?? null,
            addressLine1: guest.addressLine1 ?? null,
            addressLine2: guest.addressLine2 ?? null,
            city: guest.city ?? null,
            state: guest.state ?? null,
            zipCode: guest.zipCode ?? null,
            country: guest.country ?? null,
            dietaryNotes: guest.dietaryNotes ?? null,
            householdName: guest.householdName ?? null,
            partyGroup: guest.partyGroup ?? null,
            partyTags: guest.partyTags ?? [],
            plusOneAllocations: guest.plusOneAllocations ?? 0,
            plusOneFirstName: guest.plusOneFirstName ?? null,
            plusOneLastName: guest.plusOneLastName ?? null,
            extraFields: guest.extraFields
              ? (guest.extraFields as Prisma.InputJsonValue)
              : undefined,
            used: Boolean(guest.used),
            usedAt: guest.usedAt ? new Date(guest.usedAt) : null,
            tableId,
            seatNumber: tableId ? (guest.seatNumber ?? null) : null,
            isSample: true,
          },
        });
        createdGuestIds.add(createdGuest.id);
        createdCounts.guests++;
      }
    }

    // C. Registry items + media + contributors
    if (enabledModules.has('registry')) {
      for (const item of seed.registryItems) {
        const media = await tx.media.create({
          data: {
            id: item.image?.id ?? `sample-media-registry-fallback-${item.id}`,
            url: item.image?.url ?? '/images/placeholder.png',
            altText: item.image?.altText ?? item.name,
            isDecorative: item.image?.isDecorative ?? false,
            isSample: true,
          },
        });
        const imageId = media.id;

        const createdItem = await tx.registryItem.create({
          data: {
            id: item.id,
            name: item.name,
            description: item.description ?? '',
            category: item.category,
            price: item.price,
            quantity: item.quantity,
            itemType: item.itemType,
            isGroupGift: Boolean(item.isGroupGift),
            isMostWanted: Boolean(item.isMostWanted),
            displayOrder: item.displayOrder,
            vendorUrl: item.vendorUrl || null,
            paymentHandleType: item.paymentHandleType ?? null,
            paymentHandle: item.paymentHandle ?? null,
            purchased: item.purchased,
            purchaserName: item.purchaserName ?? null,
            amountContributed: item.amountContributed,
            imageId,
            isSample: true,
          },
        });

        if (tx.contributor?.create && item.contributors.length > 0) {
          for (const contributor of item.contributors) {
            const linkedGuestId =
              contributor.invitationCodeId &&
              createdGuestIds.has(contributor.invitationCodeId)
                ? contributor.invitationCodeId
                : null;
            await tx.contributor.create({
              data: {
                id: contributor.id,
                name: contributor.name,
                email: contributor.email ?? null,
                amount: contributor.amount,
                refundedAmount: contributor.refundedAmount ?? 0,
                status: contributor.status ?? 'CONFIRMED',
                coverFee: contributor.coverFee ?? false,
                feeAmount: contributor.feeAmount ?? 0,
                message: contributor.message ?? null,
                date: new Date(contributor.date),
                thankYouStatus: contributor.thankYouStatus ?? 'Unsent',
                thankYouSentAt: contributor.thankYouSentAt
                  ? new Date(contributor.thankYouSentAt)
                  : null,
                retailerOrderNumber: contributor.retailerOrderNumber ?? null,
                carrier: contributor.carrier ?? null,
                trackingNumber: contributor.trackingNumber ?? null,
                registryItemId: createdItem.id,
                invitationCodeId: linkedGuestId,
              },
            });
          }
        }

        createdCounts.registry++;
      }
    }

    // D. Wedding party + portrait media
    if (enabledModules.has('weddingParty')) {
      for (const member of seed.weddingParty) {
        let photoId: string | undefined;
        if (member.photo) {
          const photo = await tx.media.create({
            data: {
              id: member.photo.id,
              url: member.photo.url,
              altText: member.photo.altText ?? null,
              isDecorative: member.photo.isDecorative,
              isSample: true,
            },
          });
          photoId = photo.id;
        }

        await tx.weddingPartyMember.create({
          data: {
            id: member.id,
            name: member.name,
            role: member.role,
            bio: member.bio ?? '',
            side: member.side,
            order: member.order,
            photoId: photoId ?? null,
            isSample: true,
          },
        });
        createdCounts.weddingParty++;
      }
    }

    // E. Attractions + image media
    if (enabledModules.has('attractions')) {
      for (const attraction of seed.attractions) {
        let imageId: string | undefined;
        if (attraction.image) {
          const image = await tx.media.create({
            data: {
              id: attraction.image.id,
              url: attraction.image.url,
              altText: attraction.image.altText ?? null,
              isDecorative: attraction.image.isDecorative,
              isSample: true,
            },
          });
          imageId = image.id;
        }

        await tx.attraction.create({
          data: {
            id: attraction.id,
            name: attraction.name,
            description: attraction.description ?? '',
            category: attraction.category,
            website: attraction.website ?? '',
            directions: attraction.directions ?? '',
            latitude: attraction.latitude,
            longitude: attraction.longitude,
            isVisible: attraction.isVisible,
            promoCode: attraction.promoCode || null,
            bookingUrl: attraction.bookingUrl || null,
            roomRate: attraction.roomRate || null,
            cutoffDate: attraction.cutoffDate || null,
            shuttleInfo: attraction.shuttleInfo || null,
            imageId: imageId ?? null,
            isSample: true,
          },
        });
        createdCounts.attractions++;
      }
    }

    // F. Starter Wedding Q&A (FAQs)
    if (enabledModules.has('faqs') && tx.contentNode?.create) {
      for (const faq of seed.faqNodes) {
        await tx.contentNode.create({
          data: {
            id: faq.id,
            type: 'FAQ',
            tags: faq.tags,
            data: faq.data as Prisma.InputJsonValue,
          },
        });
        createdCounts.faqs++;
      }
    }

    // G. Curated gallery photos & guest photo uploads
    if (enabledModules.has('photos') && tx.contentNode?.create) {
      const galleryMediaMap = new Map(
        seed.media
          .filter((m) => m.id.startsWith('sample-media-gallery-'))
          .map((m) => [m.id, m])
      );
      const photoNodes = [...seed.publicPhotos, ...seed.pendingPhotos];
      for (const photoNode of photoNodes) {
        const mediaId = photoNode.data.mediaId;
        if (mediaId && galleryMediaMap.has(mediaId)) {
          const mediaItem = galleryMediaMap.get(mediaId)!;
          await tx.media.create({
            data: {
              id: mediaItem.id,
              url: mediaItem.url,
              altText: mediaItem.altText ?? null,
              isDecorative: mediaItem.isDecorative,
              isSample: true,
            },
          });
        }

        await tx.contentNode.create({
          data: {
            id: photoNode.id,
            type: 'Photo',
            tags: photoNode.tags,
            data: photoNode.data as Prisma.InputJsonValue,
          },
        });
        createdCounts.photos++;
      }
    }

    // H. Sub-event schedules, access grants, and RSVPs
    if (enabledModules.has('subEvents') && tx.subEvent?.create) {
      for (const evt of seed.subEvents) {
        await tx.subEvent.create({
          data: {
            id: evt.id,
            title: evt.title,
            description: evt.description,
            startTime: evt.startTime,
            endTime: evt.endTime,
            locationName: evt.locationName,
            location: evt.location,
            category: evt.category,
            isPrivate: evt.isPrivate,
            mealOptions: evt.mealOptions as unknown as Prisma.InputJsonValue,
            customQuestions:
              evt.customQuestions as unknown as Prisma.InputJsonValue,
          },
        });

        if (tx.subEventAccess?.create) {
          for (const access of evt.accesses) {
            if (!createdGuestIds.has(access.invitationCodeId)) continue;
            await tx.subEventAccess.create({
              data: {
                id: access.id,
                subEventId: evt.id,
                invitationCodeId: access.invitationCodeId,
              },
            });
          }
        }

        if (tx.subEventRsvp?.create) {
          for (const rsvp of evt.rsvps) {
            if (!createdGuestIds.has(rsvp.invitationCodeId)) continue;
            await tx.subEventRsvp.create({
              data: {
                id: rsvp.id,
                subEventId: evt.id,
                invitationCodeId: rsvp.invitationCodeId,
                status: rsvp.status,
                plusOneCount: rsvp.plusOneCount,
                plusOneNames: rsvp.plusOneNames as Prisma.InputJsonValue,
                mealSelections: rsvp.mealSelections as Prisma.InputJsonValue,
                dietaryNotes: rsvp.dietaryNotes,
                customAnswers: rsvp.customAnswers as Prisma.InputJsonValue,
              },
            });
          }
        }

        createdCounts.subEvents++;
      }
    }

    // I. Logistics content nodes
    if (enabledModules.has('logistics') && tx.contentNode?.create) {
      for (const logisticsNode of seed.logisticsNodes) {
        await tx.contentNode.create({
          data: {
            id: logisticsNode.id,
            type: 'Logistics',
            tags: logisticsNode.tags,
            data: logisticsNode.data as Prisma.InputJsonValue,
          },
        });
      }
    }
  });

  return {
    success: true,
    archetype: archetypeId,
    createdCounts,
  };
}
