import { prisma } from './prisma';

export const DEFAULT_FEATURES = [
  { id: 'hero', title: 'Hero', type: 'Hero', isVisible: true },
  { id: 'story', title: 'Our Story', type: 'Story', isVisible: true },
  { id: 'details', title: 'Details', type: 'Details', isVisible: true },
  { id: 'accommodations', title: 'Accommodations', type: 'Accommodations', isVisible: true },
  { id: 'venue', title: 'Venue', type: 'Venue', isVisible: true },
  { id: 'travel', title: 'Travel', type: 'Travel', isVisible: true },
  { id: 'faq', title: 'FAQ', type: 'FAQ', isVisible: true },
];

export async function getAppConfig() {
  try {
    let config = await prisma.appConfig.findUnique({
      where: { id: 'global' },
    });

    if (!config) {
      config = await prisma.appConfig.create({
        data: { id: 'global', features: DEFAULT_FEATURES },
      });
    } else {
      const currentFeatures = Array.isArray(config.features) ? config.features : [];
      if (currentFeatures.length === 0) {
        config = await prisma.appConfig.update({
          where: { id: 'global' },
          data: { features: DEFAULT_FEATURES },
        });
      }
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
      heroTitle: 'We Tied the Knot!',
      heroSubtitle: 'Thank you for celebrating with us!',
      seoTitle: 'Our Wedding',
      seoDescription: 'Join us to celebrate our wedding.',
      adminPassword: '',
      features: DEFAULT_FEATURES,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
  }
}


