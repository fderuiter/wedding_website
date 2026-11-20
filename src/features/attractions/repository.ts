import { prisma } from '@/lib/prisma';
import { AttractionSchema, AttractionDTO } from './schemas';

const STATIC_MOCK_ATTRACTIONS_RAW = [
  {
    id: 'mock-attraction-hotel',
    name: 'The Grand Hotel',
    description: 'Discounted wedding room block located minutes from The Glasshouse Estate.',
    category: 'hotel',
    website: 'https://example.com/hotel',
    directions: 'https://maps.google.com/?q=44.9778,-93.2650',
    latitude: 44.9778,
    longitude: -93.2650,
    isVisible: true,
    promoCode: 'WEDDING2026',
    bookingUrl: 'https://example.com/hotel-block',
    roomRate: '$189/night',
    cutoffDate: 'August 15, 2026',
    shuttleInfo: 'Complimentary shuttle service departs every 30 minutes between the hotel lobby and the estate.',
    isSample: false,
    image: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    id: 'mock-attraction-garden',
    name: 'Minneapolis Sculpture Garden',
    description: 'Iconic outdoor art park and conservatory near downtown.',
    category: 'park',
    website: 'https://example.com/garden',
    directions: 'https://maps.google.com/?q=44.9700,-93.2890',
    latitude: 44.9700,
    longitude: -93.2890,
    isVisible: true,
    promoCode: null,
    bookingUrl: '',
    roomRate: null,
    cutoffDate: null,
    shuttleInfo: null,
    isSample: false,
    image: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  },
];

class AttractionsRepository {
  constructor(public client: any = prisma) {}

  async getVisibleAttractions(): Promise<AttractionDTO[]> {
    const isStaticExport =
      process.env.STATIC_EXPORT === 'true' ||
      process.env.STATIC_EXPORT === '1' ||
      process.env.npm_lifecycle_event === 'build:export';

    if (isStaticExport) {
      return STATIC_MOCK_ATTRACTIONS_RAW.map((a) => AttractionSchema.parse(a));
    }

    const attractions = await this.client.attraction.findMany({
      where: { isVisible: true },
      include: { image: true },
    });
    return attractions.map((a: any) => AttractionSchema.parse(a));
  }
}

export const attractionsRepository = new AttractionsRepository();
