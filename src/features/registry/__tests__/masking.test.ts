import {
  maskContributor,
  maskRegistryItem,
  sanitizeContributor,
  sanitizeRegistryItem,
  sanitizeRegistryItems,
} from '../lib/masking';

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

  test('sanitizeRegistryItems handles arrays and single objects correctly', () => {
    const sanitizedList = sanitizeRegistryItems([sampleItem]);
    expect(Array.isArray(sanitizedList)).toBe(true);
    expect(sanitizedList[0].purchaserName).toBe('John Doe');

    const sanitizedSingle = sanitizeRegistryItems(sampleItem);
    expect(Array.isArray(sanitizedSingle)).toBe(false);
    expect(sanitizedSingle.purchaserName).toBe('John Doe');
  });

  test('maskRegistryItem excludes CANCELLED and REFUNDED rows and strips PII, tracking, and internal fields', () => {
    const mixedItem = {
      id: 'item-lifecycle',
      name: 'Stand Mixer',
      price: 300,
      purchased: false,
      purchaserName: 'Reserved Guest',
      contributors: [
        {
          id: 'c-reserved',
          name: 'Reserved Guest',
          email: 'reserved@example.com',
          amount: 100,
          status: 'RESERVED',
          message: 'Private note',
          trackingNumber: '1Z99999',
          date: '2026-08-04T12:00:00.000Z',
        },
        {
          id: 'c-confirmed',
          name: 'Confirmed Guest',
          email: 'confirmed@example.com',
          amount: 100,
          status: 'CONFIRMED',
          stripeChargeId: 'ch_secret_123',
          date: '2026-08-04T13:00:00.000Z',
        },
        {
          id: 'c-cancelled',
          name: 'Cancelled Guest',
          email: 'cancelled@example.com',
          amount: 100,
          status: 'CANCELLED',
          date: '2026-08-04T14:00:00.000Z',
        },
        {
          id: 'c-refunded',
          name: 'Refunded Guest',
          email: 'refunded@example.com',
          amount: 100,
          status: 'REFUNDED',
          refundedAmount: 100,
          date: '2026-08-04T15:00:00.000Z',
        },
      ],
    };

    const masked = maskRegistryItem(mixedItem);
    expect(masked.purchaserName).toBe('Anonymous');
    expect(masked.contributors).toHaveLength(2);
    for (const entry of masked.contributors) {
      expect(entry).toEqual({
        name: 'Anonymous',
        amount: 'Anonymous',
        date: 'Anonymous',
      });
    }
  });

  test('sanitizeContributor and maskContributor strip contributor postal address and email timestamp fields', () => {
    const rawContributor = {
      id: 'c-pii-1',
      name: 'Taylor Donor',
      email: 'taylor@example.com',
      addressLine1: '100 Secret Lane',
      addressLine2: 'Suite 4',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
      country: 'USA',
      thankYouEmailSentAt: '2026-08-05T12:00:00.000Z',
      confirmationEmailSentAt: '2026-08-04T12:05:00.000Z',
      alertEmailSentAt: '2026-08-04T12:05:01.000Z',
      reminderEmailSentAt: '2026-08-06T12:00:00.000Z',
      invitationCodeId: 'inv-secret',
      invitationCode: { id: 'inv-secret', code: 'SECRET', addressLine1: '100 Secret Lane' },
      amount: 125,
      date: '2026-08-04T12:00:00.000Z',
    };

    const sanitized = sanitizeContributor(rawContributor);
    expect(sanitized.name).toBe('Taylor Donor');
    expect(sanitized.amount).toBe(125);
    expect(sanitized.email).toBeUndefined();
    expect(sanitized.addressLine1).toBeUndefined();
    expect(sanitized.addressLine2).toBeUndefined();
    expect(sanitized.city).toBeUndefined();
    expect(sanitized.state).toBeUndefined();
    expect(sanitized.zipCode).toBeUndefined();
    expect(sanitized.country).toBeUndefined();
    expect(sanitized.thankYouEmailSentAt).toBeUndefined();
    expect(sanitized.invitationCode).toBeUndefined();
    expect(sanitized.invitationCodeId).toBeUndefined();

    const masked = maskContributor(rawContributor);
    expect(masked).toEqual({
      name: 'Anonymous',
      amount: 'Anonymous',
      date: 'Anonymous',
    });
  });
});
