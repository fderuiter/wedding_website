import { prisma } from '@/lib/prisma';
import { WeddingPartyMemberSchema, WeddingPartyMemberDTO } from './schemas';

export class WeddingPartyRepository {
  async getMembers(): Promise<WeddingPartyMemberDTO[]> {
    const members = await prisma.weddingPartyMember.findMany({
      orderBy: { order: 'asc' },
    });
    return members.map((m: any) => WeddingPartyMemberSchema.parse(m));
  }
}

export const weddingPartyRepository = new WeddingPartyRepository();
