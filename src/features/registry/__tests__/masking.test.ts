import { maskRegistryItem, maskRegistryItems, sanitizeRegistryItem, sanitizeRegistryItems } from '../lib/masking';

describe('Registry Payload Masking and Sanitization', () => {
  const sampleItem = {
    id: 'item-1',
    name: 'Fancy Kitchen Knife',
    price: 150,
    purchased: true,
    purchaserName: 'John Doe',
    contributors: [
      {
        name: 'Jane Smith',
        amount: 50,
        email: 'jane.smith@example.com',
        date: '2026-08-04T12:00:00.000Z',
      },
      {
        name: 'Bob Jones',
        amount: 100,
        email: 'bob.jones@example.com',
        date: '2026-08-04T13:00:00.000Z',
      },
    ],
  };

  test('maskRegistryItem replaces contributor names, amounts, dates, and purchaser name with Anonymous, and entirely strips emails', () => {
    const masked = maskRegistryItem(sampleItem);

    expect(masked.id).toBe('item-1');
    expect(masked.name).toBe('Fancy Kitchen Knife');
    expect(masked.price).toBe(150);
    expect(masked.purchased).toBe(true);
    expect(masked.purchaserName).toBe('Anonymous');

    expect(masked.contributors).toHaveLength(2);
    expect(masked.contributors[0]).toEqual({
      name: 'Anonymous',
      amount: 'Anonymous',
      date: 'Anonymous',
    });
    expect(masked.contributors[1]).toEqual({
      name: 'Anonymous',
      amount: 'Anonymous',
      date: 'Anonymous',
    });
  });

  test('sanitizeRegistryItem preserves contributor names, amounts, and dates, but entirely strips emails', () => {
    const sanitized = sanitizeRegistryItem(sampleItem);

    expect(sanitized.id).toBe('item-1');
    expect(sanitized.purchaserName).toBe('John Doe');

    expect(sanitized.contributors).toHaveLength(2);
    expect(sanitized.contributors[0]).toEqual({
      name: 'Jane Smith',
      amount: 50,
      date: '2026-08-04T12:00:00.000Z',
    });
    expect(sanitized.contributors[1]).toEqual({
      name: 'Bob Jones',
      amount: 100,
      date: '2026-08-04T13:00:00.000Z',
    });
  });

  test('maskRegistryItems handles arrays and single objects correctly', () => {
    const maskedList = maskRegistryItems([sampleItem]);
    expect(Array.isArray(maskedList)).toBe(true);
    expect(maskedList[0].purchaserName).toBe('Anonymous');

    const maskedSingle = maskRegistryItems(sampleItem);
    expect(Array.isArray(maskedSingle)).toBe(false);
    expect(maskedSingle.purchaserName).toBe('Anonymous');
  });

  test('sanitizeRegistryItems handles arrays and single objects correctly', () => {
    const sanitizedList = sanitizeRegistryItems([sampleItem]);
    expect(Array.isArray(sanitizedList)).toBe(true);
    expect(sanitizedList[0].purchaserName).toBe('John Doe');

    const sanitizedSingle = sanitizeRegistryItems(sampleItem);
    expect(Array.isArray(sanitizedSingle)).toBe(false);
    expect(sanitizedSingle.purchaserName).toBe('John Doe');
  });
});
