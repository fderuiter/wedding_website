import { prisma } from '../src/lib/prisma.ts';

async function main() {
  console.log('Starting multi-model database seed...');

  // 1. AppConfig
  await prisma.appConfig.upsert({
    where: { id: 'global' },
    update: {},
    create: {
      id: 'global',
      brideName: 'Jane',
      groomName: 'John',
      weddingDate: new Date('2026-10-10T15:00:00Z'),
      baseUrl: 'http://localhost:3000',
      venueName: 'The Grand Estate',
      venueAddress: '123 Wedding Way',
      venueCity: 'Napa',
      venueState: 'CA',
      venueZip: '94559',
      latitude: 38.2975,
      longitude: -122.2868,
      heroTitle: 'Jane & John',
      heroSubtitle: 'Are getting married!',
    },
  });

  // 2. Media
  await prisma.media.upsert({
    where: { id: 'seed-media-1' },
    update: {},
    create: {
      id: 'seed-media-1',
      url: '/images/sunset-embrace.jpg',
      altText: 'Jane and John Sunset Embrace',
      isDecorative: false,
    },
  });

  // 3. WeddingPartyMember
  await prisma.weddingPartyMember.upsert({
    where: { id: 'seed-party-member-1' },
    update: {},
    create: {
      id: 'seed-party-member-1',
      name: 'Sarah Connor',
      role: 'Maid of Honor',
      bio: 'Best friend of the bride since middle school.',
      photoId: 'seed-media-1',
      order: 1,
    },
  });

  // 4. Attraction
  await prisma.attraction.upsert({
    where: { id: 'seed-attraction-1' },
    update: {},
    create: {
      id: 'seed-attraction-1',
      name: 'Napa Valley Vineyard Tour',
      description: 'Scenic wine tasting tour through the valley.',
      imageId: 'seed-media-1',
      category: 'Sightseeing',
      website: 'https://example.com/napa-tours',
      directions: 'Take Hwy 29 North from downtown Napa.',
      latitude: 38.2975,
      longitude: -122.2868,
      isVisible: true,
    },
  });

  // 5. RegistryItem
  await prisma.registryItem.upsert({
    where: { id: 'seed-registry-item-1' },
    update: {},
    create: {
      id: 'seed-registry-item-1',
      name: 'Espresso Machine',
      description: 'High-end espresso machine for daily morning coffee.',
      category: 'Kitchen',
      price: 300.0,
      imageId: 'seed-media-1',
      vendorUrl: 'https://example.com/espresso',
      quantity: 1,
      isGroupGift: true,
      purchased: false,
      amountContributed: 50.0,
    },
  });

  // 6. InvitationCode
  await prisma.invitationCode.upsert({
    where: { id: 'seed-invitation-code-1' },
    update: {},
    create: {
      id: 'seed-invitation-code-1',
      code: 'VIPGUEST2026',
      guestName: 'Jane Smith',
      used: true,
      usedAt: new Date(),
    },
  });

  // 7. Contributor
  await prisma.contributor.upsert({
    where: { id: 'seed-contributor-1' },
    update: {},
    create: {
      id: 'seed-contributor-1',
      name: 'Jane Smith',
      email: 'janesmith@example.com',
      isPlusOne: false,
      amount: 50.0,
      registryItemId: 'seed-registry-item-1',
      invitationCodeId: 'seed-invitation-code-1',
    },
  });

  // 8. ContentNode
  await prisma.contentNode.upsert({
    where: { id: 'seed-content-node-1' },
    update: {},
    create: {
      id: 'seed-content-node-1',
      type: 'FAQ',
      tags: ['Homepage', 'FAQ'],
      data: {
        question: 'What is the dress code?',
        answer: 'Cocktail attire is requested.',
      },
    },
  });

  // 9. SnapshotVersion
  await prisma.snapshotVersion.upsert({
    where: { id: 'seed-snapshot-version-1' },
    update: {},
    create: {
      id: 'seed-snapshot-version-1',
      entityType: 'AppConfig',
      entityId: 'global',
      data: {
        brideName: 'Jane',
        groomName: 'John',
        venueName: 'The Grand Estate',
      },
      author: 'Admin',
    },
  });

  console.log('Verifying seed completeness across all core database models...');

  const modelCounts = [
    { name: 'AppConfig', count: await prisma.appConfig.count() },
    { name: 'Media', count: await prisma.media.count() },
    { name: 'WeddingPartyMember', count: await prisma.weddingPartyMember.count() },
    { name: 'Attraction', count: await prisma.attraction.count() },
    { name: 'RegistryItem', count: await prisma.registryItem.count() },
    { name: 'Contributor', count: await prisma.contributor.count() },
    { name: 'InvitationCode', count: await prisma.invitationCode.count() },
    { name: 'ContentNode', count: await prisma.contentNode.count() },
    { name: 'SnapshotVersion', count: await prisma.snapshotVersion.count() },
  ];

  for (const m of modelCounts) {
    console.log(` - ${m.name}: ${m.count} records`);
    if (m.count === 0) {
      throw new Error(`Seed verification failed: Model '${m.name}' has 0 records!`);
    }
  }

  console.log('Successfully seeded and verified all core database models.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

