import { FAQNodeSchema, LogisticsNodeSchema, GenericNodeSchema, ContentNodeSchema } from '../schemas';
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
});
