import { prisma } from '@/lib/prisma';
import { buildArchetypeSeedData, isStaticExportBuild } from '@/lib/sampleData/builder';
import { WeddingPartyMemberSchema, WeddingPartyMemberDTO } from './schemas';

export class WeddingPartyRepository {
  constructor(public client: any = prisma) {}

  async getMembers(): Promise<WeddingPartyMemberDTO[]> {
    if (isStaticExportBuild()) {
      return buildArchetypeSeedData('classic')
        .weddingParty.sort((a, b) => a.order - b.order)
        .map((member) => WeddingPartyMemberSchema.parse(member));
    }

    const members = await this.client.weddingPartyMember.findMany({
      orderBy: { order: 'asc' }, include: { photo: true }
    });
    return members.map((m: any) => WeddingPartyMemberSchema.parse(m));
  }
}

export const weddingPartyRepository = new WeddingPartyRepository();

