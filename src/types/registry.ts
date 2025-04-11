export interface Contributor {
  name: string;
  amount: number;
  date: string; // Or Date object
}

export interface RegistryItem {
  id: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image: string;
  vendorUrl: string | null;
  quantity: number;
  isGroupGift: boolean;
  purchased: boolean; // True if fully claimed/funded
  purchaserName?: string | null; // Name of the person who claimed it (if not group gift)
  amountContributed: number;
  contributors: Contributor[];
}
