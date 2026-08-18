import { WeddingPartyMemberSchema, WeddingPartyMemberDTO } from './schemas';

async function getPrisma() {
  if (process.env.JEST_WORKER_ID) {
    const req = eval('require');
    return req('@/lib/prisma').prisma;
  }
  const { prisma } = await (0, eval)('import("../../lib/prisma")');
  return prisma;
}

class WeddingPartyRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await getPrisma());
  }

  async getMembers(): Promise<WeddingPartyMemberDTO[]> {
    const client = await this.getClient();
    const members = await client.weddingPartyMember.findMany({
      orderBy: { order: 'asc' }, include: { photo: true }
    });
    return members.map((m: any) => WeddingPartyMemberSchema.parse(m));
  }
}

export const weddingPartyRepository = new WeddingPartyRepository();
