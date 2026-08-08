import { DatabaseBackupSchema } from '../backupValidation';

describe('DatabaseBackupSchema Validation Tests', () => {
  const getValidBackup = () => ({
    appConfig: [
      {
        id: 'global',
        brideName: 'Alice',
        groomName: 'Bob',
        weddingDate: new Date('2026-06-20T00:00:00.000Z'),
        baseUrl: 'https://wedding.example.com',
        venueName: 'Garden',
        venueAddress: '123 Flower St',
        venueCity: 'Chicago',
        venueState: 'IL',
        venueZip: '60601',
        latitude: 41.8781,
        longitude: -87.6298,
        storyText: 'Our story...',
        venueDescription: 'Beautiful venue...',
        travelAdvice: 'Fly in...',
        heroTitle: 'Welcome',
        heroSubtitle: 'Alice and Bob',
        seoTitle: 'Wedding',
        seoDescription: 'Alice & Bob Wedding',
        faviconUrl: '/favicon.png',
        ogImageUrl: '/images/og.jpg',
        seoKeywords: 'wedding, alice, bob',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    contentNode: [],
    weddingPartyMember: [
      {
        id: 'member-1',
        name: 'Jane Doe',
        role: 'Maid of Honor',
        bio: 'Jane is Alice\'s sister.',
        photoId: 'photo-1',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    attraction: [],
    registryItem: [
      {
        id: 'item-1',
        name: 'Stand Mixer',
        description: 'A kitchen classic mixer.',
        category: 'Kitchen',
        price: 349.99,
        imageId: 'image-1',
        quantity: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    contributor: [],
  });

  test('valid backup parses successfully', () => {
    const backup = getValidBackup();
    expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
  });

  describe('Registry Item Validations', () => {
    test('price of zero fails validation', () => {
      const backup = getValidBackup();
      backup.registryItem[0].price = 0;
      expect(() => DatabaseBackupSchema.parse(backup)).toThrow();
    });

    test('negative price fails validation', () => {
      const backup = getValidBackup();
      backup.registryItem[0].price = -10;
      expect(() => DatabaseBackupSchema.parse(backup)).toThrow();
    });

    test('quantity of zero fails validation', () => {
      const backup = getValidBackup();
      backup.registryItem[0].quantity = 0;
      expect(() => DatabaseBackupSchema.parse(backup)).toThrow();
    });

    test('negative quantity fails validation', () => {
      const backup = getValidBackup();
      backup.registryItem[0].quantity = -5;
      expect(() => DatabaseBackupSchema.parse(backup)).toThrow();
    });

    test('description exceeding 2000 characters is rejected', () => {
      const backup = getValidBackup();
      backup.registryItem[0].description = 'a'.repeat(2001);
      expect(() => DatabaseBackupSchema.parse(backup)).toThrow();
    });

    test('description of exactly 2000 characters is accepted', () => {
      const backup = getValidBackup();
      backup.registryItem[0].description = 'a'.repeat(2000);
      expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
    });
  });

  describe('App Configuration Validations', () => {
    test('invalid baseUrl URL format is rejected', () => {
      const backup = getValidBackup();
      backup.appConfig[0].baseUrl = 'not-a-valid-url';
      expect(() => DatabaseBackupSchema.parse(backup)).toThrow();
    });

    test('valid baseUrl URL format is accepted', () => {
      const backup = getValidBackup();
      backup.appConfig[0].baseUrl = 'https://valid.example.com';
      expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
    });

    test('empty baseUrl is accepted', () => {
      const backup = getValidBackup();
      backup.appConfig[0].baseUrl = '';
      expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
    });

    test('invalid faviconUrl prefix is rejected', () => {
      const backup = getValidBackup();
      backup.appConfig[0].faviconUrl = 'invalid_path/favicon.ico';
      expect(() => DatabaseBackupSchema.parse(backup)).toThrow();
    });

    test('valid faviconUrl starting with / is accepted', () => {
      const backup = getValidBackup();
      backup.appConfig[0].faviconUrl = '/assets/favicon.ico';
      expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
    });

    test('valid faviconUrl starting with http is accepted', () => {
      const backup = getValidBackup();
      backup.appConfig[0].faviconUrl = 'https://example.com/favicon.ico';
      expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
    });

    test('invalid ogImageUrl prefix is rejected', () => {
      const backup = getValidBackup();
      backup.appConfig[0].ogImageUrl = 'invalid_image.jpg';
      expect(() => DatabaseBackupSchema.parse(backup)).toThrow();
    });

    test('valid ogImageUrl starting with / is accepted', () => {
      const backup = getValidBackup();
      backup.appConfig[0].ogImageUrl = '/images/og.jpg';
      expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
    });

    test('valid ogImageUrl starting with http is accepted', () => {
      const backup = getValidBackup();
      backup.appConfig[0].ogImageUrl = 'https://example.com/og.jpg';
      expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
    });
  });

  describe('Wedding Party Member Validations', () => {
    test('bio lengths exceeding 5000 characters import successfully', () => {
      const backup = getValidBackup();
      backup.weddingPartyMember[0].bio = 'b'.repeat(6000);
      expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
    });
  });
});
