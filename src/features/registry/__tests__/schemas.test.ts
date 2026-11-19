import {
  BatchImportInvitationCodesSchema,
  ContributionSchema,
  InvitationCodeSchema,
  PaymentIntentRequestSchema,
  PublicAddressCollectSchema,
  RegistryItemBaseSchema,
  RegistryQuerySchema,
} from '../schemas';
import {
  REGISTRY_DEFAULT_PAGE_LIMIT,
  REGISTRY_MAX_CATALOG_LIMIT,
} from '@/utils/registryPagination';

describe('Registry Zod v4 Schema Validation', () => {
  it('enforces bounded 500-item catalog limit while retaining default limit of 20 on RegistryQuerySchema', () => {
    const defaultParsed = RegistryQuerySchema.safeParse({});
    expect(defaultParsed.success).toBe(true);
    if (defaultParsed.success) {
      expect(defaultParsed.data.page).toBe(1);
      expect(defaultParsed.data.limit).toBe(REGISTRY_DEFAULT_PAGE_LIMIT);
    }

    const maxParsed = RegistryQuerySchema.safeParse({
      page: '1',
      limit: String(REGISTRY_MAX_CATALOG_LIMIT),
    });
    expect(maxParsed.success).toBe(true);
    if (maxParsed.success) {
      expect(maxParsed.data.limit).toBe(500);
    }

    const exceededParsed = RegistryQuerySchema.safeParse({
      limit: String(REGISTRY_MAX_CATALOG_LIMIT + 1),
    });
    expect(exceededParsed.success).toBe(false);
    if (!exceededParsed.success) {
      expect(exceededParsed.error.issues[0].message).toBe('Limit cannot exceed 500.');
    }
  });
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
