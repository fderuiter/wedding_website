export interface WeddingPartyMember {
  name: string;
  role: string;
  bio: string;
  photo: string;
  link?: string;
}

export const weddingPartyMembers: WeddingPartyMember[] = [
  {
    name: 'Jane Doe',
    role: 'Maid of Honor',
    bio: 'Jane has been a friend of the bride since college. They share a love for hiking and bad movies.',
    photo: '/images/placeholder.png',
  },
  {
    name: 'John Smith',
    role: 'Best Man',
    bio: 'John and the groom have been friends since childhood. They grew up playing video games together.',
    photo: '/images/placeholder.png',
  },
  {
    name: 'Emily Jones',
    role: 'Bridesmaid',
    bio: 'Emily and the bride met through a local book club and quickly bonded over their love for fantasy novels.',
    photo: '/images/placeholder.png',
  },
  {
    name: 'Michael Johnson',
    role: 'Groomsman',
    bio: 'Michael is the groom\'s brother and partner in crime. They enjoy fishing and camping together.',
    photo: '/images/placeholder.png',
  },
];
