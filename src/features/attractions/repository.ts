import { prisma } from '@/lib/prisma';
import { AttractionSchema, AttractionDTO } from './schemas';

class AttractionsRepository {
  constructor(public client: any = prisma) {}

  async getVisibleAttractions(): Promise<AttractionDTO[]> {
    const attractions = await this.client.attraction.findMany({
      where: { isVisible: true },
    });
    return attractions.map((a: any) => AttractionSchema.parse(a));
  }
}

export const attractionsRepository = new AttractionsRepository();
