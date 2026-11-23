import { prisma } from '@/lib/prisma';
import { ARCHETYPE_PRESETS } from '@/lib/sampleData/archetypes';
import { WeddingPartyMemberSchema, WeddingPartyMemberDTO } from './schemas';

function isStaticExportBuild(): boolean {
  return (
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export'
  );
}

const STATIC_SEED_DATE = new Date('2026-01-15T12:00:00.000Z');

export class WeddingPartyRepository {
  constructor(public client: any = prisma) {}

  async getMembers(): Promise<WeddingPartyMemberDTO[]> {
    if (isStaticExportBuild()) {
      return ARCHETYPE_PRESETS.classic.weddingParty.map((member, idx) =>
        WeddingPartyMemberSchema.parse({
          id: `static-party-${idx + 1}`,
          name: member.name,
          role: member.role,
          bio: member.bio,
          side: member.side,
          link: null,
          order: member.order,
          isSample: true,
          photoId: null,
          photo: null,
          createdAt: STATIC_SEED_DATE,
          updatedAt: STATIC_SEED_DATE,
        })
      );
    }
    const members = await this.client.weddingPartyMember.findMany({
      orderBy: { order: 'asc' }, include: { photo: true }
    });
    return members.map((m: any) => WeddingPartyMemberSchema.parse(m));
  }
}

export const weddingPartyRepository = new WeddingPartyRepository();

