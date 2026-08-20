import { AttractionSchema, AttractionDTO } from './schemas';

class AttractionsRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await import('@/lib/prisma')).prisma;
  }

  async getVisibleAttractions(): Promise<AttractionDTO[]> {
    const client = await this.getClient();
    const attractions = await client.attraction.findMany({
      where: { isVisible: true },
    });
    return attractions.map((a: any) => AttractionSchema.parse(a));
  }
}

export const attractionsRepository = new AttractionsRepository();
