import { maskRegistryItem, sanitizeRegistryItem, sanitizeRegistryItems } from '../lib/masking';

describe('Registry Payload Masking and Sanitization', () => {
  const sampleItem = {
    id: 'item-1',
    name: 'Fancy Kitchen Knife',
    price: 150,
    purchased: true,
    purchaserName: 'John Doe',
    contributors: [
      {
        id: 'contrib-1',
        name: 'Jane Smith',
        amount: 50,
        email: 'jane.smith@example.com',
        date: '2026-08-04T12:00:00.000Z',
        message: 'Enjoy cooking dinner together!',
        thankYouStatus: 'Draft',
        thankYouNote: 'Dear Jane, thank you so much for the knife contribution!',
        coverFee: true,
        feeAmount: 1.75,
        transactionTimestamp: '2026-08-04T12:00:05.000Z',
        invitationCodeId: 'inv-secret-1',
        stripePaymentIntentId: 'pi_secret_111',
        stripeChargeId: 'ch_secret_111',
      },
      {
        id: 'contrib-2',
        name: 'Bob Jones',
        amount: 100,
        email: 'bob.jones@example.com',
        date: '2026-08-04T13:00:00.000Z',
        message: 'Happy wedding day!',
        thankYouStatus: 'Sent',
        thankYouSentAt: '2026-08-10T09:00:00.000Z',
        thankYouNote: 'Dear Bob, we appreciate your generous gift!',
        coverFee: false,
        feeAmount: 0,
        transactionTimestamp: '2026-08-04T13:00:02.000Z',
        invitationCodeId: 'inv-secret-2',
        stripePaymentIntentId: 'pi_secret_222',
        stripeChargeId: 'ch_secret_222',
      },
    ],
  };

  test('maskRegistryItem enforces strict contributor allowlist and strips emails, notes, thank-you drafts, fees, timestamps, invitation codes, and Stripe IDs', () => {
    const masked = maskRegistryItem(sampleItem);

    expect(masked.id).toBe('item-1');
    expect(masked.name).toBe('Fancy Kitchen Knife');
    expect(masked.price).toBe(150);
    expect(masked.purchased).toBe(true);
    expect(masked.purchaserName).toBe('Anonymous');

    expect(masked.contributors).toHaveLength(2);
    for (const contributor of masked.contributors) {
      expect(contributor).toEqual({
        name: 'Anonymous',
        amount: 'Anonymous',
        date: 'Anonymous',
      });
      expect(Object.keys(contributor)).toEqual(['name', 'amount', 'date']);
      expect(contributor).not.toHaveProperty('email');
      expect(contributor).not.toHaveProperty('message');
      expect(contributor).not.toHaveProperty('thankYouNote');
      expect(contributor).not.toHaveProperty('feeAmount');
      expect(contributor).not.toHaveProperty('transactionTimestamp');
      expect(contributor).not.toHaveProperty('invitationCodeId');
      expect(contributor).not.toHaveProperty('stripePaymentIntentId');
      expect(contributor).not.toHaveProperty('stripeChargeId');
    }

    const serialized = JSON.stringify(masked);
    expect(serialized).not.toContain('jane.smith@example.com');
    expect(serialized).not.toContain('Enjoy cooking dinner together!');
    expect(serialized).not.toContain('Dear Jane');
    expect(serialized).not.toContain('inv-secret-1');
    expect(serialized).not.toContain('pi_secret_111');
    expect(serialized).not.toContain('ch_secret_111');
  });

  test('sanitizeRegistryItem preserves contributor metadata for admins while stripping emails', () => {
    const sanitized = sanitizeRegistryItem(sampleItem);

    expect(sanitized.id).toBe('item-1');
    expect(sanitized.purchaserName).toBe('John Doe');

    expect(sanitized.contributors).toHaveLength(2);
    expect(sanitized.contributors[0]).toEqual({
      id: 'contrib-1',
      name: 'Jane Smith',
      amount: 50,
      date: '2026-08-04T12:00:00.000Z',
      message: 'Enjoy cooking dinner together!',
      thankYouStatus: 'Draft',
      thankYouNote: 'Dear Jane, thank you so much for the knife contribution!',
      coverFee: true,
      feeAmount: 1.75,
      transactionTimestamp: '2026-08-04T12:00:05.000Z',
      invitationCodeId: 'inv-secret-1',
      stripePaymentIntentId: 'pi_secret_111',
      stripeChargeId: 'ch_secret_111',
    });
    expect(sanitized.contributors[0]).not.toHaveProperty('email');
    expect(sanitized.contributors[1]).toEqual({
      id: 'contrib-2',
      name: 'Bob Jones',
      amount: 100,
      date: '2026-08-04T13:00:00.000Z',
      message: 'Happy wedding day!',
      thankYouStatus: 'Sent',
      thankYouSentAt: '2026-08-10T09:00:00.000Z',
      thankYouNote: 'Dear Bob, we appreciate your generous gift!',
      coverFee: false,
      feeAmount: 0,
      transactionTimestamp: '2026-08-04T13:00:02.000Z',
      invitationCodeId: 'inv-secret-2',
      stripePaymentIntentId: 'pi_secret_222',
      stripeChargeId: 'ch_secret_222',
    });
    expect(sanitized.contributors[1]).not.toHaveProperty('email');
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
});
