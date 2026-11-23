import { prisma } from '@/lib/prisma';
import { WeddingPartyMemberSchema, WeddingPartyMemberDTO } from './schemas';

const STATIC_MOCK_WEDDING_PARTY_RAW = [
  {
    id: 'mock-party-1',
    name: 'Jordan Avery',
    role: 'Honor Attendant',
    bio: 'Lifelong friend and travel companion since college.',
    side: 'BRIDE' as const,
    link: '',
    order: 1,
    isSample: false,
    photoId: null,
    photo: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  },
  {
    id: 'mock-party-2',
    name: 'Casey Quinn',
    role: 'Best Person',
    bio: 'Always ready with a great story and playlists for every road trip.',
    side: 'GROOM' as const,
    link: '',
    order: 2,
    isSample: false,
    photoId: null,
    photo: null,
    createdAt: new Date('2026-01-02T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  },
];

export class WeddingPartyRepository {
  constructor(public client: any = prisma) {}

  async getMembers(): Promise<WeddingPartyMemberDTO[]> {
    const isStaticExport =
      process.env.STATIC_EXPORT === 'true' ||
      process.env.STATIC_EXPORT === '1' ||
      process.env.npm_lifecycle_event === 'build:export';

    if (isStaticExport) {
      return STATIC_MOCK_WEDDING_PARTY_RAW.map((m) => WeddingPartyMemberSchema.parse(m));
    }

    const members = await this.client.weddingPartyMember.findMany({
      orderBy: { order: 'asc' }, include: { photo: true }
    });
    return members.map((m: any) => WeddingPartyMemberSchema.parse(m));
  }
}

export const weddingPartyRepository = new WeddingPartyRepository();

