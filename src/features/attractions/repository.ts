import { AttractionSchema, AttractionDTO } from './schemas';

async function getPrisma() {
  if (process.env.JEST_WORKER_ID) {
    const req = eval('require');
    return req('@/lib/prisma').prisma;
  }
  const { prisma } = await (0, eval)('import("../../lib/prisma")');
  return prisma;
}

class AttractionsRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await getPrisma());
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
