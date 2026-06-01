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
      brideName: 'Abbigayle',
      groomName: 'Frederick',
      weddingDate: new Date('2025-10-10T00:00:00.000Z'),
      baseUrl: 'https://abbifred.com',
      venueName: 'historic Plummer House',
      venueAddress: '123 Wedding St',
      venueCity: 'Rochester',
      venueState: 'MN',
      venueZip: '12345',
      latitude: 0.0,
      longitude: 0.0,
      storyText: 'Our story began...',
      venueDescription: 'A beautiful venue...',
      travelAdvice: 'Travel safely...',
      heroTitle: 'We Tied the Knot!',
      heroSubtitle: 'Thank you for celebrating with us!',
      seoTitle: "Abbigayle & Frederick's Wedding",
      seoDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.',
      adminPassword: '',
      themePrimary: '#f43f5e',
      themeSecondary: '#fbbf24',
      themeAccent: '#e11d48',
      features: [
        { id: 'story', type: 'story', title: 'Our Story', visible: true },
        { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
        { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
        { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
        { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
        { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true }
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
  }
}

