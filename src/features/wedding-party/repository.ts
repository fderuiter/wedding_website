import { prisma } from '@/lib/prisma';
import { WeddingPartyMemberSchema, WeddingPartyMemberDTO } from './schemas';

function isStaticExportBuild(): boolean {
  return (
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export'
  );
}

const STATIC_EXPORT_TIMESTAMP = new Date('2026-01-15T12:00:00.000Z');

export const STATIC_MOCK_WEDDING_PARTY_MEMBERS: WeddingPartyMemberDTO[] = [
  {
    id: 'demo-party-1',
    name: 'Jordan Rivera',
    role: 'Maid of Honor',
    bio: 'College roommate, fellow espresso enthusiast, and the calm strategist behind every celebration milestone.',
    side: 'BRIDE',
    link: null,
    order: 0,
    isSample: false,
    photoId: 'demo-media-party-1',
    photo: {
      id: 'demo-media-party-1',
      url: '/images/sample-party-1.jpg',
      altText: 'Portrait of Jordan Rivera, Maid of Honor',
      isDecorative: false,
      isSample: false,
    },
    createdAt: STATIC_EXPORT_TIMESTAMP,
    updatedAt: STATIC_EXPORT_TIMESTAMP,
  },
  {
    id: 'demo-party-2',
    name: 'Cameron Brooks',
    role: 'Best Person',
    bio: 'Childhood neighbor and hiking partner who has kept every speech equal parts heartfelt and unforgettable.',
    side: 'GROOM',
    link: null,
    order: 1,
    isSample: false,
    photoId: 'demo-media-party-2',
    photo: {
      id: 'demo-media-party-2',
      url: '/images/sample-party-2.jpg',
      altText: 'Portrait of Cameron Brooks, Best Person',
      isDecorative: false,
      isSample: false,
    },
    createdAt: STATIC_EXPORT_TIMESTAMP,
    updatedAt: STATIC_EXPORT_TIMESTAMP,
  },
  {
    id: 'demo-party-3',
    name: 'Clara Chen',
    role: 'Bridesmaid',
    bio: 'Design studio collaborator who introduced the couple at a rooftop gallery opening five years ago.',
    side: 'BRIDE',
    link: null,
    order: 2,
    isSample: false,
    photoId: 'demo-media-party-3',
    photo: {
      id: 'demo-media-party-3',
      url: '/images/sample-party-3.jpg',
      altText: 'Portrait of Clara Chen, Bridesmaid',
      isDecorative: false,
      isSample: false,
    },
    createdAt: STATIC_EXPORT_TIMESTAMP,
    updatedAt: STATIC_EXPORT_TIMESTAMP,
  },
  {
    id: 'demo-party-4',
    name: 'Julian Brooks',
    role: 'Groomsman',
    bio: 'University rowing teammate, amateur sommelier, and unofficial curator of the reception dance playlist.',
    side: 'GROOM',
    link: null,
    order: 3,
    isSample: false,
    photoId: 'demo-media-party-4',
    photo: {
      id: 'demo-media-party-4',
      url: '/images/sample-party-4.jpg',
      altText: 'Portrait of Julian Brooks, Groomsman',
      isDecorative: false,
      isSample: false,
    },
    createdAt: STATIC_EXPORT_TIMESTAMP,
    updatedAt: STATIC_EXPORT_TIMESTAMP,
  },
];
export class WeddingPartyRepository {
  constructor(public client: any = prisma) {}

  async getMembers(): Promise<WeddingPartyMemberDTO[]> {
    if (isStaticExportBuild()) {
      return STATIC_MOCK_WEDDING_PARTY_MEMBERS.map((m) => WeddingPartyMemberSchema.parse(m));
    }

    const members = await this.client.weddingPartyMember.findMany({
      orderBy: { order: 'asc' }, include: { photo: true }
    });
    return members.map((m: any) => WeddingPartyMemberSchema.parse(m));
  }
}

export const weddingPartyRepository = new WeddingPartyRepository();

