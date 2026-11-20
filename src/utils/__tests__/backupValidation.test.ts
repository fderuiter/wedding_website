import { DatabaseBackupSchema } from '../backupValidation';

describe('DatabaseBackupSchema Validation Tests', () => {
  const getValidBackup = () => ({
    appConfig: [
      {
        id: 'global',
        partner1Name: 'Alice',
        partner2Name: 'Bob',
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

    test('rejects local AppConfig URLs containing parent traversal, double slashes, backslashes, or null bytes', () => {
      const badUrls = [
        '/../canary-outside-public.svg',
        '/%2e%2e/canary-outside-public.svg',
        '//evil.example.com/og.svg',
        '/images//og.svg',
        '/images\\og.svg',
        '/images/%5cog.svg',
        '/images/og.svg\0.png',
        '/images/og.svg%00.png',
      ];

      for (const badUrl of badUrls) {
        const backupOg = getValidBackup();
        backupOg.appConfig[0].ogImageUrl = badUrl;
        expect(() => DatabaseBackupSchema.parse(backupOg)).toThrow();

        const backupFavicon = getValidBackup();
        backupFavicon.appConfig[0].faviconUrl = badUrl;
        expect(() => DatabaseBackupSchema.parse(backupFavicon)).toThrow();
      }
    });
  });

  describe('Media and ContentNode Path Guard Validations', () => {
    test('rejects media items with traversal, encoded traversal, backslashes, double slashes, or null bytes', () => {
      const badUrls = [
        '/../canary-outside-public.txt',
        '/%2e%2e/canary-outside-public.txt',
        '//evil.example.com/p.jpg',
        '/uploads\\p.jpg',
        '/uploads/p.jpg\0',
      ];

      for (const badUrl of badUrls) {
        const backup: Record<string, unknown> = getValidBackup();
        backup.media = [
          {
            id: 'media-bad',
            url: badUrl,
            altText: 'Bad',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        expect(() => DatabaseBackupSchema.parse(backup)).toThrow();
      }
    });

    test('rejects Photo ContentNodes with traversal or percent-encoded traversal URLs while accepting valid Photo nodes', () => {
      const validBackup: Record<string, unknown> = getValidBackup();
      validBackup.contentNode = [
        {
          id: 'photo-valid',
          type: 'Photo',
          tags: ['gallery'],
          data: { url: '/uploads/photos/guest.jpg', status: 'APPROVED', isVisible: true },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      expect(() => DatabaseBackupSchema.parse(validBackup)).not.toThrow();

      for (const badUrl of ['/../canary-outside-public.txt', '/%2e%2e/canary-outside-public.txt', '/uploads\\evil.jpg', '/uploads/evil.jpg\0']) {
        const invalidBackup: Record<string, unknown> = getValidBackup();
        invalidBackup.contentNode = [
          {
            id: 'photo-bad',
            type: 'Photo',
            tags: ['gallery'],
            data: { url: badUrl, status: 'PENDING', isVisible: false },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];
        expect(() => DatabaseBackupSchema.parse(invalidBackup)).toThrow();
      }
    });
  });

  describe('Wedding Party Member Validations', () => {
    test('bio lengths exceeding 5000 characters import successfully', () => {
      const backup = getValidBackup();
      backup.weddingPartyMember[0].bio = 'b'.repeat(6000);
      expect(() => DatabaseBackupSchema.parse(backup)).not.toThrow();
    });
  });

  describe('RSVP Deadline & Lock Backup Compatibility', () => {
    test('legacy backups without RSVP cutoff fields parse cleanly without locking RSVPs', () => {
      const legacyBackup = getValidBackup();
      const parsed = DatabaseBackupSchema.parse(legacyBackup);
      expect(parsed.appConfig?.[0].rsvpOpen).toBeUndefined();
      expect(parsed.appConfig?.[0].rsvpDeadlineDate).toBeUndefined();
    });

    test('modern backups with valid RSVP cutoff, grace window, lock, and sanitized message parse cleanly', () => {
      const backup: any = getValidBackup();
      backup.appConfig[0].rsvpOpen = false;
      backup.appConfig[0].rsvpDeadlineDate = '2026-08-15';
      backup.appConfig[0].rsvpGracePeriodHours = 48;
      backup.appConfig[0].rsvpClosedMessage = '<b>RSVPs closed</b> — email us!';

      const parsed = DatabaseBackupSchema.parse(backup);
      expect(parsed.appConfig?.[0].rsvpOpen).toBe(false);
      expect(parsed.appConfig?.[0].rsvpDeadlineDate).toBe('2026-08-15');
      expect(parsed.appConfig?.[0].rsvpGracePeriodHours).toBe(48);
      expect(parsed.appConfig?.[0].rsvpClosedMessage).toBe('RSVPs closed — email us!');
    });

    test('rejects invalid grace period hours or invalid cutoff calendar dates in backups', () => {
      const badGrace: any = getValidBackup();
      badGrace.appConfig[0].rsvpGracePeriodHours = 15;
      expect(() => DatabaseBackupSchema.parse(badGrace)).toThrow();

      const badDate: any = getValidBackup();
      badDate.appConfig[0].rsvpDeadlineDate = '2026-02-30';
      expect(() => DatabaseBackupSchema.parse(badDate)).toThrow();
    });
  });
});
