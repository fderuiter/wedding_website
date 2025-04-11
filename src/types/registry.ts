export interface Contribution {
  id: string;
  itemId: string;
  contributorName: string;
  contributorContact: string;
  amount: number;
  date: string;
}

export interface RegistryItem {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  category: string;
  vendorUrl?: string;
  isGroupGift: boolean;
  purchased: boolean;
  purchaserName?: string;
  amountContributed: number;
  contributions: Contribution[];
}

export type ItemCategory = 'Kitchen' | 'Travel' | 'Home' | 'Honeymoon' | 'Other';
