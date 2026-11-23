import { prisma } from '@/lib/prisma';
import { WeddingPartyMemberSchema, WeddingPartyMemberDTO } from './schemas';

const STATIC_MOCK_WEDDING_PARTY_MEMBERS_RAW = [
  {
    id: 'mock-party-maid-of-honor',
    name: 'Jordan Rivera',
    role: 'Maid of Honor',
    bio: 'College roommate and lifelong travel companion.',
    side: 'BRIDE' as const,
    link: 'https://example.com/party/jordan',
    order: 0,
    isSample: false,
    photoId: null,
    photo: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    id: 'mock-party-best-person',
    name: 'Cameron Brooks',
    role: 'Best Person',
    bio: 'Childhood friend and weekend hiking partner.',
    side: 'GROOM' as const,
    link: 'https://example.com/party/cameron',
    order: 1,
    isSample: false,
    photoId: null,
    photo: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  },
];

function isStaticExportBuild(): boolean {
  return (
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export'
  );
}

export class WeddingPartyRepository {
  constructor(public client: any = prisma) {}

  async getMembers(): Promise<WeddingPartyMemberDTO[]> {
    if (isStaticExportBuild()) {
      return STATIC_MOCK_WEDDING_PARTY_MEMBERS_RAW.map((m) => WeddingPartyMemberSchema.parse(m));
    }

    const members = await this.client.weddingPartyMember.findMany({
      orderBy: { order: 'asc' }, include: { photo: true }
    });
    return members.map((m: any) => WeddingPartyMemberSchema.parse(m));
  }
}

export const weddingPartyRepository = new WeddingPartyRepository();

