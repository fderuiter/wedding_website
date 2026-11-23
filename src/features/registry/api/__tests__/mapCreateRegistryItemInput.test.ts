/** @jest-environment node */

import { RegistryItemBaseSchema } from '../../schemas';
import { mapCreateRegistryItemInput } from '../mapCreateRegistryItemInput';

describe('mapCreateRegistryItemInput', () => {
  it('normalizes default values across all 15 CreateRegistryItemInput fields', () => {
    const parsed = RegistryItemBaseSchema.parse({
      name: 'Ceramic Dinnerware Set',
      price: 180,
      category: 'Dining',
    });

    expect(mapCreateRegistryItemInput(parsed)).toEqual({
      itemType: 'PHYSICAL',
      paymentHandleType: undefined,
      paymentHandle: undefined,
      name: 'Ceramic Dinnerware Set',
      description: '',
      category: 'Dining',
      price: 180,
      imageUrl: '/images/placeholder.png',
      imageAlt: undefined,
      imageDecorative: undefined,
      vendorUrl: null,
      quantity: 1,
      isGroupGift: false,
      isMostWanted: false,
      displayOrder: 0,
    });
  });

  it('preserves explicit fund, media, payment handle, and ordering fields', () => {
    const parsed = RegistryItemBaseSchema.parse({
      itemType: 'CASH_FUND',
      paymentHandleType: 'Venmo',
      paymentHandle: '@wedding-fund',
      name: 'Honeymoon Flights',
      description: 'Round-trip tickets',
      category: 'Travel',
      price: 1200,
      imageUrl: 'https://example.com/flights.jpg',
      imageAlt: 'Airplane window',
      imageDecorative: false,
      vendorUrl: 'https://example.com/airline',
      quantity: 2,
      isGroupGift: true,
      isMostWanted: true,
      displayOrder: 4,
    });

    expect(mapCreateRegistryItemInput(parsed)).toEqual({
      itemType: 'CASH_FUND',
      paymentHandleType: 'Venmo',
      paymentHandle: '@wedding-fund',
      name: 'Honeymoon Flights',
      description: 'Round-trip tickets',
      category: 'Travel',
      price: 1200,
      imageUrl: 'https://example.com/flights.jpg',
      imageAlt: 'Airplane window',
      imageDecorative: false,
      vendorUrl: 'https://example.com/airline',
      quantity: 2,
      isGroupGift: true,
      isMostWanted: true,
      displayOrder: 4,
    });
  });
});
