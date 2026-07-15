import { prisma } from '../src/lib/prisma.ts';

async function main() {
  console.log('Starting minimal database seed...');
  
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
    }
  });
  
  console.log('Successfully seeded global AppConfig.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
