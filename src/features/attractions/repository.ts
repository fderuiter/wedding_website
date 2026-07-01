import { prisma } from '@/lib/prisma';
import { AttractionSchema, AttractionDTO } from './schemas';

export class AttractionsRepository {
  async getVisibleAttractions(): Promise<AttractionDTO[]> {
    const attractions = await prisma.attraction.findMany({
      where: { isVisible: true },
    });
    return attractions.map((a: any) => AttractionSchema.parse(a));
  }

  async getAllAttractions(): Promise<AttractionDTO[]> {
    const attractions = await prisma.attraction.findMany();
    return attractions.map((a: any) => AttractionSchema.parse(a));
  }
}

export const attractionsRepository = new AttractionsRepository();
