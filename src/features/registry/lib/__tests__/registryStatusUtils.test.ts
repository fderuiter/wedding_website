import { getRegistryItemStatus } from '../registryStatusUtils';
import { RegistryItem } from '@/types/registry';

describe('getRegistryItemStatus', () => {
  const baseItem: RegistryItem = {
    id: '1',
    name: 'Generic Item',
    description: 'desc',
    category: 'General',
    price: 100,
    image: '/image.jpg',
    vendorUrl: null,
    quantity: 1,
    isGroupGift: false,
    purchased: false,
    amountContributed: 0,
    contributors: [],
  };

  it('returns "available" when item not purchased', () => {
    const status = getRegistryItemStatus(baseItem);
    expect(status).toBe('available');
  });

  it('returns "claimed" for purchased single items', () => {
    const status = getRegistryItemStatus({ ...baseItem, purchased: true });
    expect(status).toBe('claimed');
  });

  it('returns "fullyFunded" for purchased group gifts', () => {
    const status = getRegistryItemStatus({ ...baseItem, purchased: true, isGroupGift: true });
    expect(status).toBe('fullyFunded');
  });
});
