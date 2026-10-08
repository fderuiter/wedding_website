import { FAQNodeSchema, LogisticsNodeSchema, ScheduleNodeSchema, GenericNodeSchema, ContentNodeSchema, RawUpdateAppConfigSchema, AppConfigSchema, layoutTokenSchema } from '../schemas';
import { ContentNodeAdminService } from '../admin.service';

describe('Content Node Schema Validation', () => {
  describe('FAQNodeSchema', () => {
    it('accepts valid FAQ node payload', () => {
      const validFAQ = {
        id: 'faq-1',
        type: 'FAQ',
        tags: ['homepage', 'general'],
        data: {
          question: 'What is the dress code?',
          answer: 'Black tie optional.',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = FAQNodeSchema.safeParse(validFAQ);
      expect(result.success).toBe(true);
    });

    it('accepts FAQ node with empty/optional data fields', () => {
      const minimalFAQ = {
        id: 'faq-2',
        type: 'FAQ',
        tags: [],
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = FAQNodeSchema.safeParse(minimalFAQ);
      expect(result.success).toBe(true);
    });

    it('rejects FAQ node with mismatched type or invalid data structure', () => {
      const invalidTypeFAQ = {
        id: 'faq-3',
        type: 'Logistics',
        tags: ['faq'],
        data: { question: 'Q?' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(FAQNodeSchema.safeParse(invalidTypeFAQ).success).toBe(false);

      const invalidDataFAQ = {
        id: 'faq-4',
        type: 'FAQ',
        tags: ['faq'],
        data: 'not an object',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(FAQNodeSchema.safeParse(invalidDataFAQ).success).toBe(false);
    });
  });

  describe('LogisticsNodeSchema', () => {
    it('accepts valid Logistics node payload', () => {
      const validLogistics = {
        id: 'log-1',
        type: 'Logistics',
        tags: ['wedding-day'],
        data: {
          title: 'Ceremony & Reception',
          description: 'Join us at the main venue.',
          ceremonyTitle: 'Wedding Ceremony',
          ceremonyTime: '4:00 PM',
          receptionTitle: 'Evening Reception',
          receptionTime: '6:00 PM',
          receptionDetails: 'Dinner and drinks served.',
          receptionAttire: 'Formal',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = LogisticsNodeSchema.safeParse(validLogistics);
      expect(result.success).toBe(true);
    });

    it('allows additional custom keys via passthrough in Logistics data', () => {
      const passthroughLogistics = {
        id: 'log-2',
        type: 'Logistics',
        tags: ['hotel'],
        data: {
          title: 'Accommodations',
          hotelName: 'Grand Hotel',
          shuttleAvailable: true,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = LogisticsNodeSchema.safeParse(passthroughLogistics);
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data.data as any).hotelName).toBe('Grand Hotel');
      }
    });

    it('rejects Logistics node with incorrect type or invalid data', () => {
      const invalidType = {
        id: 'log-3',
        type: 'FAQ',
        tags: [],
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(LogisticsNodeSchema.safeParse(invalidType).success).toBe(false);

      const invalidTags = {
        id: 'log-4',
        type: 'Logistics',
        tags: 'not-an-array',
        data: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(LogisticsNodeSchema.safeParse(invalidTags).success).toBe(false);
    });
  });

  describe('ScheduleNodeSchema', () => {
    it('accepts structured schedule node with start and end ISO timestamps, category tags, location, and attire rules', () => {
      const validScheduleNode = {
        id: 'sched-1',
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Rehearsal Dinner',
          startTime: '2026-06-19T18:00:00.000Z',
          endTime: '2026-06-19T21:00:00.000Z',
          categoryTags: ['Rehearsal', 'VIP'],
          category: 'Rehearsal',
          locationName: 'The Grand Ballroom',
          attireRules: 'Smart Casual',
          description: 'Dinner for wedding party and family.',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = ScheduleNodeSchema.safeParse(validScheduleNode);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data.title).toBe('Rehearsal Dinner');
        expect(result.data.data.categoryTags).toEqual(['Rehearsal', 'VIP']);
      }
    });

    it('rejects schedule node with non-ISO timestamps', () => {
      const invalidScheduleNode = {
        id: 'sched-2',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Ceremony',
          startTime: '3 PM',
          endTime: '2026-06-20T16:00:00Z',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = ScheduleNodeSchema.safeParse(invalidScheduleNode);
      expect(result.success).toBe(false);
    });

    it('rejects schedule node when endTime is before startTime', () => {
      const reversedScheduleNode = {
        id: 'sched-3',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Reception',
          startTime: '2026-06-20T18:00:00.000Z',
          endTime: '2026-06-20T12:00:00.000Z',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = ScheduleNodeSchema.safeParse(reversedScheduleNode);
      expect(result.success).toBe(false);
    });

    it('accepts schedule node with startTime and omitted endTime', () => {
      const openEndedNode = {
        id: 'sched-4',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Welcome Toast',
          startTime: '2026-06-20T17:00:00.000Z',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = ScheduleNodeSchema.safeParse(openEndedNode);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data.title).toBe('Welcome Toast');
        expect(result.data.data.endTime).toBeUndefined();
      }
    });

    it('accepts content nodes with ISO string createdAt/updatedAt dates from JSON payloads', () => {
      const jsonNode = {
        id: 'sched-5',
        type: 'Schedule',
        tags: ['Schedule'],
        data: {
          title: 'Late Night Snack',
          startTime: '2026-06-20T23:00:00.000Z',
          endTime: '',
        },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };

      const result = ScheduleNodeSchema.safeParse(jsonNode);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.createdAt).toBeInstanceOf(Date);
        expect(result.data.updatedAt).toBeInstanceOf(Date);
      }
    });
  });

  describe('GenericNodeSchema', () => {
    it('accepts custom generic node variant structure', () => {
      const validGeneric = {
        id: 'gen-1',
        type: 'AnnouncementCard',
        tags: ['news', 'homepage'],
        data: {
          headline: 'Welcome to our wedding website!',
          body: 'We cannot wait to celebrate with you.',
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = GenericNodeSchema.safeParse(validGeneric);
      expect(result.success).toBe(true);
    });

    it('rejects generic node with missing system attributes', () => {
      const missingTags = {
        id: 'gen-2',
        type: 'CustomCard',
        data: { message: 'hello' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      expect(GenericNodeSchema.safeParse(missingTags).success).toBe(false);
    });
  });

  describe('ContentNodeSchema (Union)', () => {
    it('parses FAQ, Logistics, and Generic nodes successfully', () => {
      const faqNode = {
        id: '1',
        type: 'FAQ',
        tags: ['faq'],
        data: { question: 'Q', answer: 'A' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const logisticsNode = {
        id: '2',
        type: 'Logistics',
        tags: ['log'],
        data: { title: 'L' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const genericNode = {
        id: '3',
        type: 'Photo',
        tags: ['photo'],
        data: { url: 'pic.jpg' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(ContentNodeSchema.safeParse(faqNode).success).toBe(true);
      expect(ContentNodeSchema.safeParse(logisticsNode).success).toBe(true);
      expect(ContentNodeSchema.safeParse(genericNode).success).toBe(true);
    });
  });

  describe('ContentNodeAdminService Input Validation', () => {
    let adminService: ContentNodeAdminService;

    beforeEach(() => {
      adminService = new ContentNodeAdminService();
    });

    it('validates valid input payloads without id, createdAt, or updatedAt', async () => {
      const validFAQInput = {
        type: 'FAQ',
        tags: ['general'],
        data: { question: 'Parking?', answer: 'Free parking on site.' },
      };

      const validLogisticsInput = {
        type: 'Logistics',
        tags: ['schedule'],
        data: { ceremonyTitle: 'Ceremony', ceremonyTime: '3 PM' },
      };

      const validGenericInput = {
        type: 'CustomBanner',
        tags: ['banner'],
        data: { bannerText: 'Welcome' },
      };

      await expect(adminService['validate'](validFAQInput)).resolves.not.toThrow();
      await expect(adminService['validate'](validLogisticsInput)).resolves.not.toThrow();
      await expect(adminService['validate'](validGenericInput)).resolves.not.toThrow();
    });

    it('rejects invalid input payloads and throws clear validation error', async () => {
      const invalidInput = {
        type: 'FAQ',
        tags: 'invalid-tags-string',
        data: 'invalid-data',
      };

      await expect(adminService['validate'](invalidInput)).rejects.toThrow(/Validation Error/);
    });
  });

  describe('Layout Token & AppConfig Schema Validation', () => {
    it('validates valid CSS length units in layoutTokenSchema', () => {
      expect(layoutTokenSchema.safeParse('64rem').success).toBe(true);
      expect(layoutTokenSchema.safeParse('1.5rem').success).toBe(true);
      expect(layoutTokenSchema.safeParse('20px').success).toBe(true);
      expect(layoutTokenSchema.safeParse('100%').success).toBe(true);
      expect(layoutTokenSchema.safeParse('2.5em').success).toBe(true);
      expect(layoutTokenSchema.safeParse('80ch').success).toBe(true);
      expect(layoutTokenSchema.safeParse('0.5rem').success).toBe(true);
    });

    it('rejects invalid CSS length units or malicious values in layoutTokenSchema', () => {
      expect(layoutTokenSchema.safeParse('invalid').success).toBe(false);
      expect(layoutTokenSchema.safeParse('20').success).toBe(false);
      expect(layoutTokenSchema.safeParse('100vh').success).toBe(false);
      expect(layoutTokenSchema.safeParse('10px; color: red;').success).toBe(false);
      expect(layoutTokenSchema.safeParse('</style>').success).toBe(false);
    });

    it('accepts optional layout scale properties in RawUpdateAppConfigSchema', () => {
      const basePayload = {
        venueName: 'Venue',
        venueAddress: '123 St',
        venueCity: 'City',
        venueState: 'ST',
        venueZip: '12345',
        latitude: 0,
        longitude: 0,
        storyText: 'Story',
        venueDescription: 'Desc',
        travelAdvice: 'Advice',
        heroTitle: 'Hero',
        heroSubtitle: 'Sub',
        seoTitle: 'SEO',
        seoDescription: 'Desc',
        faviconUrl: '',
        ogImageUrl: '',
        seoKeywords: '',
        baseUrl: 'https://example.com',
        weddingDate: '2026-12-31',
      };

      const result = RawUpdateAppConfigSchema.safeParse({
        ...basePayload,
        layoutContainerMaxWidth: '80rem',
        layoutGridGap: '2rem',
        layoutCardPadding: '2.5rem',
        layoutBorderRadius: '0.75rem',
      });

      expect(result.success).toBe(true);
    });

    it('populates default layout scale properties in AppConfigSchema', () => {
      const minimalAppConfig = {
        id: 'cfg-1',
        weddingDate: new Date(),
        baseUrl: 'https://example.com',
        venueName: 'Venue',
        venueAddress: '123 St',
        venueCity: 'City',
        venueState: 'ST',
        venueZip: '12345',
        latitude: 0,
        longitude: 0,
        storyText: 'Story',
        venueDescription: 'Desc',
        travelAdvice: 'Advice',
        heroTitle: 'Hero',
        heroSubtitle: 'Sub',
        seoTitle: 'SEO',
        seoDescription: 'Desc',
        faviconUrl: '',
        ogImageUrl: '',
        seoKeywords: '',
        features: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const result = AppConfigSchema.safeParse(minimalAppConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.layoutContainerMaxWidth).toBe('64rem');
        expect(result.data.layoutGridGap).toBe('1.5rem');
        expect(result.data.layoutCardPadding).toBe('2.2rem' ? result.data.layoutCardPadding : '2rem');
        expect(result.data.layoutCardPadding).toBe('2rem');
        expect(result.data.layoutBorderRadius).toBe('1rem');
      }
    });
  });
});
