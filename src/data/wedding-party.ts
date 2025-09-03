/**
 * @interface WeddingPartyMember
 * @description Defines the structure for a wedding party member object.
 * @property {string} name - The full name of the wedding party member.
 * @property {string} role - The role of the member in the wedding (e.g., "Maid of Honor").
 * @property {string} bio - A short biography or relationship to the couple.
 * @property {string} photo - The URL of the member's photo.
 * @property {string} [link] - An optional URL to a social media profile or personal website.
 */
export interface WeddingPartyMember {
  name: string;
  role: string;
  bio: string;
  photo: string;
  link?: string;
}

/**
 * @const {WeddingPartyMember[]} weddingPartyMembers
 * @description An array of objects, each representing a member of the wedding party.
 * This data is used to populate the "Wedding Party" page.
 */
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
