import { prisma } from './prisma';

export async function getAppConfig() {
  try {
    let config = await prisma.appConfig.findUnique({
      where: { id: 'global' },
    });

    if (!config) {
      config = await prisma.appConfig.create({
        data: { id: 'global' },
      });
    }
    return config;
  } catch (error) {
    console.warn("Database unreachable, using fallback config.");
    return {
      id: 'global',
      brideName: 'Bride',
      groomName: 'Groom',
      weddingDate: new Date('2025-10-10T00:00:00.000Z'),
      baseUrl: 'https://example.com',
      venueName: 'Wedding Venue',
      venueAddress: '123 Wedding St',
      venueCity: 'City',
      venueState: 'State',
      venueZip: '12345',
      latitude: 0.0,
      longitude: 0.0,
      storyText: 'Our story began...',
      venueDescription: 'A beautiful venue...',
      travelAdvice: 'Travel safely...',
      adminPassword: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

