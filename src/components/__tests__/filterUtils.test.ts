import { filterRegistryItems } from '../filterUtils';
import { RegistryItem } from '@/types/registry';

describe('filterRegistryItems', () => {
  const items: RegistryItem[] = [
    {
      id: '1',
      name: 'Toaster',
      description: 'Kitchen appliance',
      category: 'Kitchen',
      price: 25,
      image: '/toaster.jpg',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      purchased: false,
      amountContributed: 0,
      contributors: [],
    },
    {
      id: '2',
      name: 'Vacuum',
      description: 'Home cleaning',
      category: 'Home',
      price: 150,
      image: '/vacuum.jpg',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      purchased: false,
      amountContributed: 0,
      contributors: [],
    },
    {
      id: '3',
      name: 'Luggage',
      description: 'Travel gear',
      category: 'Travel',
      price: 300,
      image: '/luggage.jpg',
      vendorUrl: null,
      quantity: 1,
      isGroupGift: true,
      purchased: false,
      amountContributed: 0,
      contributors: [],
    },
  ];

  it('filters items by category', () => {
    const result = filterRegistryItems(items, ['Kitchen'], [0, 1000]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters items by price range', () => {
    const result = filterRegistryItems(items, [], [100, 200]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('filters items by category and price range', () => {
    const result = filterRegistryItems(items, ['Travel'], [200, 400]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('3');
  });
});
