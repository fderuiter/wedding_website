export type ArchetypeId = 'classic' | 'destination' | 'romantic';

interface SampleRegistryPreset {
  name: string;
  description: string;
  category: string;
  price: number;
  itemType?: 'PHYSICAL' | 'CASH_FUND' | 'EXPERIENCE_FUND';
  isGroupGift?: boolean;
  isMostWanted?: boolean;
  imageUrl: string;
  imageAlt: string;
}

interface SampleGuestPreset {
  guestName: string;
  code: string;
  householdName: string;
  partyGroup: string;
  partyTags: string[];
  plusOnesAllowed?: number;
  seatTableName?: string; // name of seating table to assign
  seatNumber?: number;
}

interface SampleSeatingPreset {
  name: string;
  shape: 'round' | 'rectangular';
  capacity: number;
  x: number;
  y: number;
}

interface SampleWeddingPartyPreset {
  name: string;
  role: string;
  bio: string;
  side: 'BRIDE' | 'GROOM' | 'JOINT';
  order: number;
}

interface SampleAttractionPreset {
  name: string;
  description: string;
  category: string;
  website: string;
  directions: string;
  latitude: number;
  longitude: number;
  promoCode?: string;
  roomRate?: string;
}

export interface ArchetypePreset {
  id: ArchetypeId;
  name: string;
  description: string;
  registryItems: SampleRegistryPreset[];
  guests: SampleGuestPreset[];
  seatingTables: SampleSeatingPreset[];
  weddingParty: SampleWeddingPartyPreset[];
  attractions: SampleAttractionPreset[];
}

export const ARCHETYPE_PRESETS: Record<ArchetypeId, ArchetypePreset> = {
  classic: {
    id: 'classic',
    name: 'Classic Celebration',
    description: 'A traditional wedding setup with registry essentials, classic table layouts, and local accommodations.',
    registryItems: [
      {
        name: 'KitchenAid Stand Mixer',
        description: 'Tilt-head stand mixer in classic Empire Red, perfect for baking together.',
        category: 'Kitchen',
        price: 349.99,
        itemType: 'PHYSICAL',
        isMostWanted: true,
        imageUrl: '/images/sample-registry-mixer.jpg',
        imageAlt: 'Red KitchenAid Stand Mixer',
      },
      {
        name: 'Porcelain 16-Piece Dinnerware Set',
        description: 'Elegant white porcelain service for 4, dishwasher and microwave safe.',
        category: 'Dining',
        price: 120.00,
        itemType: 'PHYSICAL',
        isGroupGift: false,
        imageUrl: '/images/sample-registry-dinnerware.jpg',
        imageAlt: 'White porcelain dinnerware set',
      },
      {
        name: 'Espresso & Cappuccino Machine',
        description: '15-bar Italian pump espresso machine with milk frother.',
        category: 'Kitchen',
        price: 299.00,
        itemType: 'PHYSICAL',
        isGroupGift: true,
        isMostWanted: true,
        imageUrl: '/images/sample-registry-espresso.jpg',
        imageAlt: 'Stainless steel espresso machine',
      },
      {
        name: 'Honeymoon Experience Fund',
        description: 'Help us fund romantic dinners, excursions, and relaxation on our honeymoon!',
        category: 'Honeymoon',
        price: 1500.00,
        itemType: 'CASH_FUND',
        isGroupGift: true,
        imageUrl: '/images/sample-registry-honeymoon.jpg',
        imageAlt: 'Honeymoon tropical beach setting',
      },
      {
        name: 'Crystal Wine Glasses (Set of 6)',
        description: 'Hand-blown crystal red wine glasses for special celebrations.',
        category: 'Dining',
        price: 85.00,
        itemType: 'PHYSICAL',
        imageUrl: '/images/sample-registry-wine.jpg',
        imageAlt: 'Crystal wine glasses',
      },
    ],
    guests: [
      {
        guestName: 'Mr. & Mrs. Robert Smith',
        code: 'SMITH2026',
        householdName: 'Smith Family',
        partyGroup: 'Family',
        partyTags: ['VIP', 'Family'],
        plusOnesAllowed: 0,
        seatTableName: 'Head Table',
        seatNumber: 1,
      },
      {
        guestName: 'Sarah Johnson',
        code: 'JOHNSON2026',
        householdName: 'Johnson Household',
        partyGroup: 'Friends',
        partyTags: ['Friends'],
        plusOnesAllowed: 1,
        seatTableName: 'Friends Table',
        seatNumber: 1,
      },
      {
        guestName: 'Uncle David & Aunt Clara',
        code: 'DAVID2026',
        householdName: 'Miller Family',
        partyGroup: 'Family',
        partyTags: ['Family'],
        plusOnesAllowed: 0,
        seatTableName: 'Family Table',
        seatNumber: 1,
      },
      {
        guestName: 'Alex Rivera',
        code: 'RIVERA2026',
        householdName: 'Rivera Household',
        partyGroup: 'Wedding Party',
        partyTags: ['Bridal Party'],
        plusOnesAllowed: 0,
        seatTableName: 'Head Table',
        seatNumber: 2,
      },
      {
        guestName: 'Jessica Davis',
        code: 'DAVIS2026',
        householdName: 'Davis Household',
        partyGroup: 'Wedding Party',
        partyTags: ['Bridal Party'],
        plusOnesAllowed: 0,
        seatTableName: 'Head Table',
        seatNumber: 3,
      },
    ],
    seatingTables: [
      { name: 'Head Table', shape: 'rectangular', capacity: 8, x: 200, y: 150 },
      { name: 'Family Table', shape: 'round', capacity: 8, x: 100, y: 350 },
      { name: 'Friends Table', shape: 'round', capacity: 8, x: 300, y: 350 },
    ],
    weddingParty: [
      {
        name: 'Jessica Davis',
        role: 'Maid of Honor',
        bio: 'Best friend since college and partner in every adventure.',
        side: 'BRIDE',
        order: 1,
      },
      {
        name: 'Alex Rivera',
        role: 'Best Man',
        bio: 'Brother and lifelong confidant.',
        side: 'GROOM',
        order: 2,
      },
      {
        name: 'Emily Smith',
        role: 'Bridesmaid',
        bio: 'Cousin and childhood companion.',
        side: 'BRIDE',
        order: 3,
      },
      {
        name: 'Marcus Vance',
        role: 'Groomsman',
        bio: 'College roommate and sports enthusiast.',
        side: 'GROOM',
        order: 4,
      },
    ],
    attractions: [
      {
        name: 'The Grand Hotel & Spa',
        description: 'Official wedding hotel block with discounted group rates for guests.',
        category: 'Stay',
        website: 'https://example.com/stay',
        directions: '100 Main St, Downtown',
        latitude: 41.8781,
        longitude: -87.6298,
        promoCode: 'WEDDING2026',
        roomRate: '$189/night',
      },
      {
        name: 'Downtown Bistro & Grill',
        description: 'Popular local restaurant for rehearsal dinner and casual dining.',
        category: 'Dining',
        website: 'https://example.com/dine',
        directions: '250 Culinary Ave',
        latitude: 41.8820,
        longitude: -87.6320,
      },
      {
        name: 'Scenic Botanical Gardens',
        description: 'Beautiful walking trails, conservatory, and quiet outdoor spots.',
        category: 'Activities',
        website: 'https://example.com/explore',
        directions: '500 Floral Way',
        latitude: 41.8850,
        longitude: -87.6350,
      },
    ],
  },
  destination: {
    id: 'destination',
    name: 'Destination Wedding',
    description: 'Resort and travel-inspired preset with beachside seating, excursion funds, and resort details.',
    registryItems: [
      {
        name: 'Hardside Spinner Luggage Set',
        description: 'Lightweight 3-piece expandable luggage set for honeymoons and future travels.',
        category: 'Travel',
        price: 280.00,
        itemType: 'PHYSICAL',
        isMostWanted: true,
        imageUrl: '/images/sample-registry-luggage.jpg',
        imageAlt: '3-piece spinner luggage set',
      },
      {
        name: 'Sunset Sail & Catamaran Cruise',
        description: 'Guided catamaran sunset cruise with dinner and drinks for two.',
        category: 'Excursions',
        price: 250.00,
        itemType: 'EXPERIENCE_FUND',
        isGroupGift: true,
        imageUrl: '/images/sample-registry-sail.jpg',
        imageAlt: 'Catamaran sailing at sunset',
      },
      {
        name: 'Resort Oceanfront Suite Fund',
        description: 'Help us upgrade to an oceanfront villa suite during our resort stay.',
        category: 'Stay',
        price: 1200.00,
        itemType: 'CASH_FUND',
        isGroupGift: true,
        isMostWanted: true,
        imageUrl: '/images/sample-registry-resort.jpg',
        imageAlt: 'Tropical beachfront villa resort',
      },
      {
        name: 'Snorkeling & Coral Reef Excursion',
        description: 'Half-day marine sanctuary snorkeling tour.',
        category: 'Excursions',
        price: 180.00,
        itemType: 'EXPERIENCE_FUND',
        imageUrl: '/images/sample-registry-snorkeling.jpg',
        imageAlt: 'Coral reef snorkeling underwater',
      },
    ],
    guests: [
      {
        guestName: 'Carlos & Maria Rodriguez',
        code: 'RODRIGUEZ2026',
        householdName: 'Rodriguez Family',
        partyGroup: 'Family',
        partyTags: ['Family'],
        plusOnesAllowed: 0,
        seatTableName: 'Sunset Terrace Cabana',
        seatNumber: 1,
      },
      {
        guestName: 'Samantha Taylor',
        code: 'TAYLOR2026',
        householdName: 'Taylor Household',
        partyGroup: 'Friends',
        partyTags: ['Friends'],
        plusOnesAllowed: 1,
        seatTableName: 'Beachside Pavilion Table A',
        seatNumber: 1,
      },
      {
        guestName: 'Jordan Lee',
        code: 'JORDAN2026',
        householdName: 'Lee Household',
        partyGroup: 'Wedding Party',
        partyTags: ['Bridal Party'],
        plusOnesAllowed: 0,
        seatTableName: 'Sunset Terrace Cabana',
        seatNumber: 2,
      },
    ],
    seatingTables: [
      { name: 'Sunset Terrace Cabana', shape: 'rectangular', capacity: 8, x: 200, y: 150 },
      { name: 'Beachside Pavilion Table A', shape: 'round', capacity: 8, x: 100, y: 350 },
      { name: 'Beachside Pavilion Table B', shape: 'round', capacity: 8, x: 300, y: 350 },
    ],
    weddingParty: [
      {
        name: 'Jordan Lee',
        role: 'Maid of Honor',
        bio: 'Island travel buddy and lifelong friend.',
        side: 'BRIDE',
        order: 1,
      },
      {
        name: 'Taylor Brooks',
        role: 'Best Man',
        bio: 'Surfing partner and high school friend.',
        side: 'GROOM',
        order: 2,
      },
    ],
    attractions: [
      {
        name: 'Oceanview Palms Resort & Spa',
        description: 'Beachfront paradise and wedding venue hotel block.',
        category: 'Stay',
        website: 'https://example.com/resort',
        directions: '1 Ocean Drive',
        latitude: 25.7617,
        longitude: -80.1918,
        promoCode: 'BEACH2026',
        roomRate: '$240/night',
      },
      {
        name: 'Seaside Fish Shack & Grill',
        description: 'Fresh local seafood right on the coastal boardwalk.',
        category: 'Dining',
        website: 'https://example.com/grill',
        directions: '12 Coastal Highway',
        latitude: 25.7650,
        longitude: -80.1950,
      },
    ],
  },
  romantic: {
    id: 'romantic',
    name: 'Garden Romantic',
    description: 'Charming, rustic garden setup featuring artisanal gifts, orchard seating, and vineyard attractions.',
    registryItems: [
      {
        name: 'Handcrafted Oak Serving Board',
        description: 'Artisanal solid oak charcuterie board with brass handles.',
        category: 'Home',
        price: 75.00,
        itemType: 'PHYSICAL',
        isMostWanted: true,
        imageUrl: '/images/sample-registry-board.jpg',
        imageAlt: 'Handcrafted wooden serving board',
      },
      {
        name: 'Vineyard Wine Tasting & Farmhouse Dinner',
        description: 'Private vineyard tour and multi-course wine pairing dinner.',
        category: 'Experiences',
        price: 200.00,
        itemType: 'EXPERIENCE_FUND',
        isGroupGift: true,
        imageUrl: '/images/sample-registry-vineyard.jpg',
        imageAlt: 'Vineyard wine tasting table',
      },
      {
        name: 'Teak Garden Lounge Chairs',
        description: 'Set of two weather-resistant teak lounge chairs for the patio.',
        category: 'Patio',
        price: 320.00,
        itemType: 'PHYSICAL',
        isGroupGift: true,
        isMostWanted: true,
        imageUrl: '/images/sample-registry-lounge.jpg',
        imageAlt: 'Teak garden chairs',
      },
      {
        name: 'Handcrafted Ceramic Dinner Set',
        description: 'Matte ceramic plates and bowls made by local artisans.',
        category: 'Dining',
        price: 160.00,
        itemType: 'PHYSICAL',
        imageUrl: '/images/sample-registry-ceramics.jpg',
        imageAlt: 'Handcrafted ceramic dish set',
      },
    ],
    guests: [
      {
        guestName: 'Grandma Rose & Grandpa Henry',
        code: 'GRANDPARENTS2026',
        householdName: 'Rose Household',
        partyGroup: 'Family',
        partyTags: ['Family', 'VIP'],
        plusOnesAllowed: 0,
        seatTableName: 'Oak Arbor Head Table',
        seatNumber: 1,
      },
      {
        guestName: 'Oliver & Claire Bennett',
        code: 'BENNETT2026',
        householdName: 'Bennett Family',
        partyGroup: 'Friends',
        partyTags: ['Friends'],
        plusOnesAllowed: 0,
        seatTableName: 'Willow Lawn Table',
        seatNumber: 1,
      },
      {
        guestName: 'Hannah Abbott',
        code: 'ABBOTT2026',
        householdName: 'Abbott Household',
        partyGroup: 'Wedding Party',
        partyTags: ['Bridal Party'],
        plusOnesAllowed: 0,
        seatTableName: 'Oak Arbor Head Table',
        seatNumber: 2,
      },
    ],
    seatingTables: [
      { name: 'Oak Arbor Head Table', shape: 'rectangular', capacity: 8, x: 200, y: 150 },
      { name: 'Willow Lawn Table', shape: 'round', capacity: 8, x: 120, y: 350 },
    ],
    weddingParty: [
      {
        name: 'Hannah Abbott',
        role: 'Maid of Honor',
        bio: 'Sister and garden design enthusiast.',
        side: 'BRIDE',
        order: 1,
      },
      {
        name: 'Ethan Wright',
        role: 'Best Man',
        bio: 'Brother and acoustic guitarist.',
        side: 'GROOM',
        order: 2,
      },
    ],
    attractions: [
      {
        name: 'Willow Creek Bed & Breakfast',
        description: 'Cozy country bed & breakfast tucked near the venue garden.',
        category: 'Stay',
        website: 'https://example.com/willow',
        directions: '45 Country Lane',
        latitude: 38.0000,
        longitude: -122.0000,
        promoCode: 'GARDEN2026',
        roomRate: '$165/night',
      },
      {
        name: 'Farmhouse Kitchen & Table',
        description: 'Organic farm-to-table dining with seasonal garden ingredients.',
        category: 'Dining',
        website: 'https://example.com/farmhouse',
        directions: '88 Valley Road',
        latitude: 38.0050,
        longitude: -122.0050,
      },
    ],
  },
};
