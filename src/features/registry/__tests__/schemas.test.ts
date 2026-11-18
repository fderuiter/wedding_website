import {
  BatchImportInvitationCodesSchema,
  ContributionSchema,
  InvitationCodeSchema,
  PaymentIntentRequestSchema,
  PublicAddressCollectSchema,
  RegistryItemBaseSchema,
} from '../schemas';

describe('Registry Zod v4 Schema Validation', () => {
  it('trims surrounding whitespace before validating emails across registry schemas', () => {
    const contribution = ContributionSchema.safeParse({
      itemId: 'item-1',
      name: 'Alex Guest',
      email: '  alex@example.com  ',
      amount: 50,
    });
    expect(contribution.success).toBe(true);
    if (contribution.success) {
      expect(contribution.data.email).toBe('alex@example.com');
    }

    const paymentIntent = PaymentIntentRequestSchema.safeParse({
      itemId: 'item-1',
      amount: 50,
      email: '  alex@example.com  ',
    });
    expect(paymentIntent.success).toBe(true);
    if (paymentIntent.success) {
      expect(paymentIntent.data.email).toBe('alex@example.com');
    }

    const invite = InvitationCodeSchema.safeParse({
      id: 'inv-1',
      code: 'INVITE1',
      guestName: 'Alex Guest',
      email: '  alex@example.com  ',
    });
    expect(invite.success).toBe(true);
    if (invite.success) {
      expect(invite.data.email).toBe('alex@example.com');
    }

    const batchImport = BatchImportInvitationCodesSchema.safeParse({
      records: [{ guestName: 'Alex Guest', email: '  alex@example.com  ' }],
    });
    expect(batchImport.success).toBe(true);
    if (batchImport.success) {
      expect(batchImport.data.records[0].email).toBe('alex@example.com');
    }

    const publicCollect = PublicAddressCollectSchema.safeParse({
      guestName: 'Alex Guest',
      email: '  alex@example.com  ',
    });
    expect(publicCollect.success).toBe(true);
    if (publicCollect.success) {
      expect(publicCollect.data.email).toBe('alex@example.com');
    }
  });

  it('rejects whitespace-only or malformed emails while allowing empty strings and null', () => {
    const whitespaceOnly = PublicAddressCollectSchema.safeParse({
      guestName: 'Alex Guest',
      email: '   ',
    });
    expect(whitespaceOnly.success).toBe(false);
    if (!whitespaceOnly.success) {
      expect(whitespaceOnly.error.issues[0].message).toBe('Invalid email address.');
    }

    expect(PublicAddressCollectSchema.safeParse({ guestName: 'Alex Guest', email: '' }).success).toBe(true);
    expect(PublicAddressCollectSchema.safeParse({ guestName: 'Alex Guest', email: null }).success).toBe(true);
  });

  it('extends media association fields on RegistryItemBaseSchema', () => {
    const parsed = RegistryItemBaseSchema.safeParse({
      name: 'Espresso Machine',
      price: 299,
      category: 'Kitchen',
      imageId: 'media-1',
      imageUrl: 'https://example.com/espresso.jpg',
      imageAlt: 'Espresso Machine',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.imageId).toBe('media-1');
      expect(parsed.data.imageUrl).toBe('https://example.com/espresso.jpg');
    }
  });
});
