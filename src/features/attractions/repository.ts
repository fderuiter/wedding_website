import { prisma } from '@/lib/prisma';
import { AttractionSchema, AttractionDTO } from './schemas';

export class AttractionsRepository {
  constructor(public client: any = prisma) {}

  withClient(client: any): this {
    return new (this.constructor as any)(client);
  }

  async getVisibleAttractions(): Promise<AttractionDTO[]> {
    const attractions = await this.client.attraction.findMany({
      where: { isVisible: true },
    });
    return attractions.map((a: any) => AttractionSchema.parse(a));
  }

  async getAllAttractions(): Promise<AttractionDTO[]> {
    const attractions = await this.client.attraction.findMany();
    return attractions.map((a: any) => AttractionSchema.parse(a));
  }
}

export const attractionsRepository = new AttractionsRepository();
