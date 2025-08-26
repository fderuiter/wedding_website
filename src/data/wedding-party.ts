export interface WeddingPartyMember {
  name: string;
  role: string;
  bio: string;
  photo: string;
  link?: string;
}

export const weddingPartyMembers: WeddingPartyMember[] = [
  {
    name: 'Emily Schultz',
    role: 'Maid of Honor',
    bio: 'Sister of the Bride',
    photo: '/images/placeholder.png',
  },
  {
    name: 'Callie Sebora',
    role: 'Bridesmaid',
    bio: 'Sister of the Bride',
    photo: '/images/placeholder.png',
  },
  {
    name: 'Isabella de Ruiter',
    role: 'Bridesmaid',
    bio: 'Sister of the Groom',
    photo: '/images/placeholder.png',
  },
  {
    name: 'Delaney Sebora',
    role: 'Bridesmaid',
    bio: 'Sister of the Bride',
    photo: '/images/placeholder.png',
  },
  {
    name: 'Vincent de Ruiter',
    role: 'Best Man',
    bio: 'Brother of the Groom',
    photo: '/images/placeholder.png',
  },
  {
    name: 'Peter de Ruiter',
    role: 'Groomsman',
    bio: 'Brother of the groom',
    photo: '/images/placeholder.png',
  },
  {
    name: 'Caleb Sebora',
    role: 'Groomsman',
    bio: 'Brother of the Bride',
    photo: '/images/placeholder.png',
  },
  {
    name: 'Ethan Schultz',
    role: 'Groomsman',
    bio: 'Brother of the Bride',
    photo: '/images/placeholder.png',
  },
];
