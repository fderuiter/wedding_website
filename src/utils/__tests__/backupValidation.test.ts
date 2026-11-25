import fs from 'node:fs';
import path from 'node:path';
import {
  BackupAppConfigSchema,
  BackupContributorSchema,
  DatabaseBackupSchema,
  reviveDates,
} from '../backupValidation';
import {
  APP_CONFIG_BACKUP_KEYS,
  APP_CONFIG_SECRET_KEYS,
  sanitizeAppConfigForBackup,
} from '@/lib/backupPersistence';
import {
  AppConfigSchema,
  translateAppConfigSnapshot,
} from '@/features/content';
import { translateContributorSnapshot } from '@/features/registry';

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
        bio: "Jane is Alice's sister.",
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

    test('preserves all 9 module flags, normalizes groupGifting dependency, and strips legacy guestPasscode in appConfig backups', () => {
      const backup: any = getValidBackup();
      backup.appConfig[0].modules = {
        registry: false,
        groupGifting: true,
        guestPasscode: false,
        weather: false,
        weddingParty: true,
        attractions: false,
        gallery: false,
        countdown: false,
        addToCalendar: true,
        interactive3D: false,
      };
      backup.appConfig[0].showCountdown = false;
      backup.appConfig[0].showAddToCalendar = true;

      const parsed = DatabaseBackupSchema.parse(backup);
      expect(parsed.appConfig[0].modules).toEqual({
        registry: false,
        groupGifting: false,
        weather: false,
        weddingParty: true,
        attractions: false,
        gallery: false,
        countdown: false,
        addToCalendar: true,
        interactive3D: false,
      });
      expect(parsed.appConfig[0].showCountdown).toBe(false);
      expect(parsed.appConfig[0].showAddToCalendar).toBe(true);
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
          data: {
            url: '/uploads/photos/guest.jpg',
            status: 'APPROVED',
            isVisible: true,
          },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      expect(() => DatabaseBackupSchema.parse(validBackup)).not.toThrow();

      for (const badUrl of [
        '/../canary-outside-public.txt',
        '/%2e%2e/canary-outside-public.txt',
        '/uploads\\evil.jpg',
        '/uploads/evil.jpg\0',
      ]) {
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
      expect(parsed.appConfig?.[0].rsvpClosedMessage).toBe(
        'RSVPs closed — email us!',
      );
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

  describe('Nullable Outbound Messaging Delivery Columns', () => {
    const NULLABLE_DELIVERY_KEYS = [
      'smtpHost',
      'smtpPort',
      'smtpUser',
      'smtpFrom',
      'smtpSecure',
      'resendFrom',
      'sendgridFrom',
      'smsProvider',
      'twilioAccountSid',
      'twilioFromNumber',
    ] as const;

    test('accepts null values across all 10 SQL-nullable outbound messaging columns during pre-flight and revived backup parsing', () => {
      const backup: Record<string, any> = getValidBackup();
      for (const key of NULLABLE_DELIVERY_KEYS) {
        backup.appConfig[0][key] = null;
      }

      const serialized = JSON.stringify(backup);
      const revived = reviveDates(JSON.parse(serialized));
      const parsed = DatabaseBackupSchema.parse(revived);

      for (const key of NULLABLE_DELIVERY_KEYS) {
        expect(parsed.appConfig[0][key]).toBeNull();
      }
    });
  });

  describe('Contributor Lifecycle & Refund Backup Compatibility', () => {
    test('accepts legacy contributors without status/refundedAmount and modern contributors with lifecycle fields', () => {
      const backup: any = getValidBackup();
      backup.contributor = [
        {
          id: 'legacy-contrib-1',
          name: 'Legacy Donor',
          amount: 100,
          date: new Date('2026-06-01T00:00:00.000Z'),
          createdAt: new Date('2026-06-01T00:00:00.000Z'),
          updatedAt: new Date('2026-06-01T00:00:00.000Z'),
          registryItemId: 'item-1',
        },
        {
          id: 'modern-contrib-2',
          name: 'Modern Donor',
          email: 'modern@example.com',
          amount: 150,
          refundedAmount: 25,
          status: 'RESERVED',
          reminderEmailSentAt: new Date('2026-06-05T00:00:00.000Z'),
          date: new Date('2026-06-02T00:00:00.000Z'),
          createdAt: new Date('2026-06-02T00:00:00.000Z'),
          updatedAt: new Date('2026-06-05T00:00:00.000Z'),
          registryItemId: 'item-1',
        },
      ];

      const parsed = DatabaseBackupSchema.parse(backup);
      expect(parsed.contributor).toHaveLength(2);
      expect(parsed.contributor?.[1].status).toBe('RESERVED');
      expect(parsed.contributor?.[1].refundedAmount).toBe(25);
    });

    test('rejects unknown contributor status or negative refundedAmount in backups', () => {
      const badStatusBackup: any = getValidBackup();
      badStatusBackup.contributor = [
        {
          id: 'bad-status',
          name: 'Guest',
          amount: 50,
          status: 'EXPIRED_INVALID',
          date: new Date(),
        },
      ];
      expect(() => DatabaseBackupSchema.parse(badStatusBackup)).toThrow();

      const negativeRefundBackup: any = getValidBackup();
      negativeRefundBackup.contributor = [
        {
          id: 'bad-refund',
          name: 'Guest',
          amount: 50,
          refundedAmount: -10,
          status: 'CONFIRMED',
          date: new Date(),
        },
      ];
      expect(() => DatabaseBackupSchema.parse(negativeRefundBackup)).toThrow();
    });

    test('validates contributor postal address and thankYouEmailSentAt fields in backups', () => {
      const backup: any = getValidBackup();
      backup.contributor = [
        {
          id: 'addressed-contrib-1',
          name: 'Addressed Donor',
          email: 'donor@example.com',
          addressLine1: '742 Evergreen Terrace',
          addressLine2: 'Apt 2',
          city: 'Springfield',
          state: 'IL',
          zipCode: '62704',
          country: 'USA',
          thankYouStatus: 'Sent',
          thankYouSentAt: new Date('2026-06-12T00:00:00.000Z'),
          thankYouEmailSentAt: new Date('2026-06-12T00:00:00.000Z'),
          amount: 120,
          date: new Date('2026-06-10T00:00:00.000Z'),
          createdAt: new Date('2026-06-10T00:00:00.000Z'),
          updatedAt: new Date('2026-06-12T00:00:00.000Z'),
          registryItemId: 'item-1',
        },
      ];

      const parsed = DatabaseBackupSchema.parse(backup);
      expect(parsed.contributor?.[0].addressLine1).toBe('742 Evergreen Terrace');
      expect(parsed.contributor?.[0].city).toBe('Springfield');
      expect(parsed.contributor?.[0].thankYouEmailSentAt).toBeInstanceOf(Date);
    });
  });

  describe('Prisma Schema Parity Guards (AppConfig & Contributor)', () => {
    interface ParsedPrismaField {
      name: string;
      type: string;
      nullable: boolean;
    }

    function parsePrismaScalarFields(modelName: string): ParsedPrismaField[] {
      const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
      const schemaSource = fs.readFileSync(schemaPath, 'utf8');
      const modelRegex = new RegExp(
        `model\\s+${modelName}\\s*\\{([\\s\\S]*?)\\n\\}`,
        'm',
      );
      const match = schemaSource.match(modelRegex);
      if (!match) {
        throw new Error(`Model ${modelName} not found in prisma/schema.prisma`);
      }

      const scalarTypes = new Set([
        'String',
        'Int',
        'Float',
        'Boolean',
        'DateTime',
        'Json',
      ]);
      const fields: ParsedPrismaField[] = [];

      for (const rawLine of match[1].split('\n')) {
        const line = rawLine.replace(/\/\/.*$/, '').trim();
        if (!line || line.startsWith('@@')) continue;
        const tokens = line.split(/\s+/);
        if (tokens.length < 2) continue;
        const [fieldName, rawType] = tokens;
        const nullable = rawType.endsWith('?');
        const cleanType = rawType.replace(/[?\[\]]/g, '');
        if (!scalarTypes.has(cleanType)) continue;
        fields.push({ name: fieldName, type: cleanType, nullable });
      }
      return fields;
    }

    test('APP_CONFIG_BACKUP_KEYS + APP_CONFIG_SECRET_KEYS match prisma/schema.prisma AppConfig 1:1', () => {
      const prismaFields = parsePrismaScalarFields('AppConfig');
      const prismaNames = prismaFields.map((f) => f.name).sort();
      const combinedKeys = [
        ...APP_CONFIG_BACKUP_KEYS,
        ...APP_CONFIG_SECRET_KEYS,
      ].sort();

      expect(APP_CONFIG_BACKUP_KEYS).toHaveLength(83);
      expect(APP_CONFIG_SECRET_KEYS).toHaveLength(4);
      expect(combinedKeys).toEqual(prismaNames);

      const overlap = APP_CONFIG_BACKUP_KEYS.filter((k) =>
        (APP_CONFIG_SECRET_KEYS as readonly string[]).includes(k),
      );
      expect(overlap).toEqual([]);
    });

    test('sanitizeAppConfigForBackup retains all 82 non-secret columns and strips secrets and virtual DTO keys', () => {
      const fullParsedDto = AppConfigSchema.parse({
        id: 'global',
        subdomain: 'couple',
        multisiteEnabled: true,
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        brideName: 'Alex',
        groomName: 'Taylor',
        weddingDate: new Date('2026-06-20T00:00:00.000Z'),
        baseUrl: 'https://wedding.example.com',
        venueName: 'Garden',
        venueAddress: '123 Main',
        venueCity: 'Chicago',
        venueState: 'IL',
        venueZip: '60601',
        latitude: 41.88,
        longitude: -87.63,
        storyText: 'Story',
        venueDescription: 'Venue',
        travelAdvice: 'Travel',
        heroTitle: 'Hero',
        heroSubtitle: 'Sub',
        seoTitle: 'SEO',
        seoDescription: 'Desc',
        faviconUrl: '/favicon.png',
        ogImageUrl: '/og.jpg',
        brandMonogram: 'A&T',
        brandLogoUrl: '/logo.svg',
        brandLogoAlt: 'Logo',
        heroImageUrl: '/hero.jpg',
        heroImageAlt: 'Hero alt',
        brandWatermarkUrl: '/wm.svg',
        brandWatermarkAlt: 'WM alt',
        badgeGraphicUrl: '/badge.svg',
        badgeGraphicAlt: 'Badge alt',
        seoKeywords: 'keywords',
        isRsvpOpen: true,
        smtpPass: 'secret-smtp',
        resendApiKey: 'secret-resend',
        sendgridApiKey: 'secret-sendgrid',
        twilioAuthToken: 'secret-twilio',
        features: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const sanitized = sanitizeAppConfigForBackup(
        fullParsedDto as unknown as Record<string, unknown>,
      );
      expect(Object.keys(sanitized).sort()).toEqual(
        [...APP_CONFIG_BACKUP_KEYS].sort(),
      );
      for (const secretKey of APP_CONFIG_SECRET_KEYS) {
        expect(sanitized[secretKey]).toBeUndefined();
      }
      for (const virtualKey of [
        'multisiteEnabled',
        'isRsvpOpen',
        'typographyScale',
        'spacingScale',
        'borderTreatment',
        'brandDimensions',
        'brandLogoWidth',
        'brandLogoHeight',
        'brandHeroHeight',
        'brandWatermarkWidth',
        'brandWatermarkOpacity',
        'brandBadgeSize',
        'fontHeading',
        'fontBody',
        'fontMono',
      ]) {
        expect(sanitized[virtualKey]).toBeUndefined();
      }
    });

    test('BackupAppConfigSchema and BackupContributorSchema match Prisma columns and SQL nullability', () => {
      const appConfigFields = parsePrismaScalarFields('AppConfig');
      expect(Object.keys(BackupAppConfigSchema.shape).sort()).toEqual(
        appConfigFields.map((f) => f.name).sort(),
      );

      for (const field of appConfigFields) {
        if (field.nullable) {
          const schemaField =
            BackupAppConfigSchema.shape[
              field.name as keyof typeof BackupAppConfigSchema.shape
            ];
          const res = schemaField.safeParse(null);
          expect({
            model: 'AppConfig',
            field: field.name,
            success: res.success,
          }).toEqual({
            model: 'AppConfig',
            field: field.name,
            success: true,
          });
        }
      }

      const contributorFields = parsePrismaScalarFields('Contributor');
      expect(Object.keys(BackupContributorSchema.shape).sort()).toEqual(
        contributorFields.map((f) => f.name).sort(),
      );

      for (const field of contributorFields) {
        if (field.nullable) {
          const schemaField =
            BackupContributorSchema.shape[
              field.name as keyof typeof BackupContributorSchema.shape
            ];
          const res = schemaField.safeParse(null);
          expect({
            model: 'Contributor',
            field: field.name,
            success: res.success,
          }).toEqual({
            model: 'Contributor',
            field: field.name,
            success: true,
          });
        }
      }
    });

    test('translateAppConfigSnapshot and translateContributorSnapshot cover every mutable Prisma column and keep omitted fields undefined on update', () => {
      const appConfigFields = parsePrismaScalarFields('AppConfig');
      const expectedMutableNonSecretAppConfig = appConfigFields
        .map((f) => f.name)
        .filter(
          (name) =>
            !['id', 'createdAt', 'updatedAt'].includes(name) &&
            !(APP_CONFIG_SECRET_KEYS as readonly string[]).includes(name),
        )
        .sort();

      const emptyAppTranslated = translateAppConfigSnapshot({}, 'global');
      expect(emptyAppTranslated).not.toBeNull();
      expect(Object.keys(emptyAppTranslated!.update)).toEqual([]);
      expect(
        Object.keys(emptyAppTranslated!.create)
          .filter((k) => k !== 'id')
          .sort(),
      ).toEqual(expectedMutableNonSecretAppConfig);

      const populatedSnapshot: Record<string, unknown> = {};
      for (const col of expectedMutableNonSecretAppConfig) {
        if (col === 'latitude' || col === 'longitude') {
          populatedSnapshot[col] = 12.34;
        } else if (col === 'weddingDate') {
          populatedSnapshot[col] = '2026-06-20T00:00:00.000Z';
        } else if (
          col === 'autoApproveGuestPhotos' ||
          col === 'showCountdown' ||
          col === 'showAddToCalendar' ||
          col === 'rsvpOpen' ||
          col === 'setupCompleted' ||
          col === 'smtpSecure'
        ) {
          populatedSnapshot[col] = true;
        } else if (
          col === 'guestPhotoQrTokenVersion' ||
          col === 'adminTokenVersion' ||
          col === 'rsvpGracePeriodHours' ||
          col === 'smtpPort' ||
          col === 'broadcastBatchSize' ||
          col === 'broadcastBatchDelayMs'
        ) {
          populatedSnapshot[col] = 24;
        } else if (col === 'features') {
          populatedSnapshot[col] = [];
        } else if (col === 'modules' || col === 'themeTokens') {
          populatedSnapshot[col] = {};
        } else if (col === 'rsvpDeadlineDate') {
          populatedSnapshot[col] = '2026-08-15';
        } else {
          populatedSnapshot[col] = 'val';
        }
      }
      for (const secretKey of APP_CONFIG_SECRET_KEYS) {
        populatedSnapshot[secretKey] = 'non-empty-secret';
      }

      const fullAppTranslated = translateAppConfigSnapshot(
        populatedSnapshot,
        'global',
      );
      expect(Object.keys(fullAppTranslated!.update).sort()).toEqual(
        [
          ...expectedMutableNonSecretAppConfig,
          ...APP_CONFIG_SECRET_KEYS,
        ].sort(),
      );

      const contributorFields = parsePrismaScalarFields('Contributor');
      const expectedMutableContributor = contributorFields
        .map((f) => f.name)
        .filter((name) => !['id', 'createdAt', 'updatedAt'].includes(name))
        .sort();

      const emptyContributorTranslated = translateContributorSnapshot(
        {},
        { entityId: 'contrib-1' },
      );
      expect(emptyContributorTranslated).not.toBeNull();
      expect(Object.keys(emptyContributorTranslated!.update)).toEqual([]);
      expect(
        Object.keys(emptyContributorTranslated!.create)
          .filter((k) => k !== 'id')
          .sort(),
      ).toEqual(expectedMutableContributor);
    });

    test('client-reachable backup validation and key modules do not import server-only modules', () => {
      for (const relFile of [
        'src/lib/backupPersistence.ts',
        'src/utils/backupValidation.ts',
      ]) {
        const content = fs.readFileSync(
          path.resolve(process.cwd(), relFile),
          'utf8',
        );
        expect(content).not.toMatch(
          /from\s+['"](\.\/prisma|@\/lib\/prisma|@prisma\/client|next\/headers)['"]/,
        );
      }
    });
  });
});
