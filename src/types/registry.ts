/**
 * @interface Contributor
 * @description Defines the structure for a contributor to a group gift.
 * @property {string} name - The name of the contributor.
 * @property {number} amount - The amount contributed.
 * @property {string} date - The date of the contribution (ISO string format).
 */
export interface Contributor {
  name: string;
  amount: number;
  date: string; // Or Date object
}

/**
 * @interface RegistryItem
 * @description Defines the structure for a wedding registry item.
 * This corresponds to the `RegistryItem` model in the Prisma schema.
 * @property {string} id - The unique identifier for the item (UUID).
 * @property {string} name - The name of the item.
 * @property {string} description - A description of the item.
 * @property {string} category - The category the item belongs to.
 * @property {number} price - The total price of the item.
 * @property {string} image - The URL of the item's image.
 * @property {string | null} vendorUrl - An optional URL to the product page on a vendor's website.
 * @property {number} quantity - The desired quantity of the item.
 * @property {boolean} isGroupGift - A flag indicating if the item can be contributed to as a group.
 * @property {boolean} purchased - A flag indicating if the item is fully claimed or funded.
 * @property {string | null} [purchaserName] - The name of the person who claimed the item (for non-group gifts).
 * @property {number} amountContributed - The total amount that has been contributed towards the item (for group gifts).
 * @property {Contributor[]} contributors - An array of contributors for a group gift.
 */
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
