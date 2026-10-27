import { prisma } from '@/lib/prisma';
import { executeInTransaction } from '@/lib/transaction';
import { WeddingPartyMemberSchema, WeddingPartyMemberDTO } from './schemas';

export class WeddingPartyRepository {
  constructor(public client: any = prisma) {}

  async getMembers(): Promise<WeddingPartyMemberDTO[]> {
    const members = await this.client.weddingPartyMember.findMany({
      orderBy: { order: 'asc' }, include: { photo: true }
    });
    return members.map((m: any) => WeddingPartyMemberSchema.parse(m));
  }

  async reorderMembers(orderedIds: string[]): Promise<WeddingPartyMemberDTO[]> {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      throw new Error('Ordered IDs array cannot be empty');
    }

    const existingMembers = await this.client.weddingPartyMember.findMany({
      where: { id: { in: orderedIds } },
      select: { id: true }
    });

    const existingSet = new Set(existingMembers.map((m: any) => m.id));
    const missingIds = orderedIds.filter((id) => !existingSet.has(id));

    if (missingIds.length > 0) {
      throw new Error(`Invalid member ID(s): ${missingIds.join(', ')}`);
    }

    return executeInTransaction(this.client, async (tx: any) => {
      await Promise.all(
        orderedIds.map((id, index) =>
          tx.weddingPartyMember.update({
            where: { id },
            data: { order: index }
          })
        )
      );

      const reorderedMembers = await tx.weddingPartyMember.findMany({
        where: { id: { in: orderedIds } },
        orderBy: { order: 'asc' },
        include: { photo: true }
      });

      return reorderedMembers.map((m: any) => WeddingPartyMemberSchema.parse(m));
    });
  }
}

export const weddingPartyRepository = new WeddingPartyRepository();

