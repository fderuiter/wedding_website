import { WeddingPartyMemberSchema, WeddingPartyMemberDTO } from './schemas';

class WeddingPartyRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await import('@/lib/prisma')).prisma;
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
