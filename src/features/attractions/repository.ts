import { prisma } from '@/lib/prisma';
import { buildArchetypeSeedData, isStaticExportBuild } from '@/lib/sampleData/builder';
import { AttractionSchema, AttractionDTO } from './schemas';

class AttractionsRepository {
  constructor(public client: any = prisma) {}

  async getVisibleAttractions(): Promise<AttractionDTO[]> {
    if (isStaticExportBuild()) {
      return buildArchetypeSeedData('classic')
        .attractions.filter((attraction) => attraction.isVisible !== false)
        .map((attraction) => AttractionSchema.parse(attraction));
    }

    const attractions = await this.client.attraction.findMany({
      where: { isVisible: true },
      include: { image: true },
    });
    return attractions.map((a: any) => AttractionSchema.parse(a));
  }
}

export const attractionsRepository = new AttractionsRepository();
