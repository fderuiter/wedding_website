import { prisma } from './prisma';
import { AppConfigSchema, PublicAppConfigDTO } from '../features/content/schemas';
import type { AppConfigDTO } from '../features/content/schemas';
import { coordinateSchema } from '../utils/validation';

export type PublicAppConfig = PublicAppConfigDTO;

type LocalAppConfig = Omit<AppConfigDTO, 'latitude' | 'longitude'> & {
  latitude: string | number;
  longitude: string | number;
};

const fallbackAppConfig: LocalAppConfig = {
  id: 'global',
  brideName: 'Abbigayle',
  groomName: 'Frederick',
  weddingDate: new Date('2026-06-20T16:00:00.000Z'),
  baseUrl: 'https://abbifred.com',
  venueName: 'Plummer House',
  venueAddress: '1091 Plummer Ln SW',
  venueCity: 'Rochester',
  venueState: 'MN',
  venueZip: '55902',
  latitude: 44.0079,
  longitude: -92.4938,
  storyText: '',
  venueDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN.',
  travelAdvice: '',
  heroTitle: '',
  heroSubtitle: '',
  seoTitle: '',
  seoDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.',
  faviconUrl: '/assets/favicon.png',
  ogImageUrl: '/images/sunset-embrace.jpg',
  seoKeywords: "{{brideName}} and {{groomName}}'s wedding, wedding website, {{venueName}} wedding, {{venueCity}} {{venueState}} wedding, {{brideName}} and {{groomName}} registry, wedding details, wedding ceremony, wedding reception",
  // Toggles to conditionally render the countdown and add-to-calendar widgets on the layout
  showCountdown: true, 
  showAddToCalendar: true,
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Produce a public-safe view of the application configuration.
 *
 * @param config - The full `AppConfig` object
 * @returns The same configuration
 */
export function toPublicAppConfig(config: AppConfigDTO): PublicAppConfig {
  return config;
}

/**
 * Ensures baseline Logistics and FAQ content nodes exist in the database by creating default entries when none are present.
 *
 * Creates two default Logistics nodes and three default FAQ nodes when the corresponding contentNode count is zero.
 */
async function bootstrapLogisticsNodes() {
  const logisticsCount = await prisma.contentNode.count({
    where: { type: 'Logistics' }
  });

  if (logisticsCount === 0) {
    const defaultNodes = [
      {
        type: 'Logistics',
        tags: ['Homepage', 'accommodations'],
        data: {
          title: 'Accommodations in Rochester, MN',
          description: 'Rochester offers plenty of places to stay for our wedding weekend. We opted not to reserve a block so you can choose what fits your style and budget. Your favorite booking site will have the best deals for hotels in Rochester.'
        }
      },
      {
        type: 'Logistics',
        tags: ['Homepage', 'details'],
        data: {
          ceremonyTitle: 'Wedding Ceremony',
          ceremonyTime: '4:00 pm',
          receptionTitle: 'Wedding Reception',
          receptionTime: 'Buffet dinner began at 5:30 pm',
          receptionDetails: 'Cocktails with music if weather permitted',
          receptionAttire: 'Attire: Garden formal'
        }
      }
    ];

    for (const node of defaultNodes) {
      await prisma.contentNode.create({ data: node });
    }
  }

  const faqCount = await prisma.contentNode.count({
    where: { type: 'FAQ' }
  });

  if (faqCount === 0) {
    const defaultFaqs = [
      {
        type: 'FAQ',
        tags: ['Homepage'],
        data: { question: 'What is "Garden Formal"?', answer: 'It means look nice, but maybe don\'t wear stilettos unless you enjoy aerating the lawn.' }
      },
      {
        type: 'FAQ',
        tags: ['Homepage'],
        data: { question: 'Can I Bring My Kids?', answer: 'We adore your little ones, but this celebration is adults only. Treat it as a date night while we toast to the next chapter of our lives.' }
      },
      {
        type: 'FAQ',
        tags: ['Homepage'],
        data: { question: 'Is there parking available?', answer: 'Yes, there are 40 spots of parking available at the Plummer House.' }
      }
    ];

    for (const faq of defaultFaqs) {
      await prisma.contentNode.create({ data: faq });
    }
  }
}

/**
 * Load the global application configuration from the database and ensure baseline content nodes exist.
 *
 * If the `appConfig` row with id `"global"` does not exist, a new row is created with initial venue and SEO fields.
 * Also ensures default logistics and FAQ content nodes are present.
 *
 * @returns The effective `AppConfig` object where values from the database override the fallback defaults; if the database is unreachable, returns the predefined fallback configuration.
 */
export async function getAppConfig(): Promise<AppConfigDTO> {
  let dbConfig: AppConfigDTO | null = null;
  try {
    const rawDbConfig = await prisma.appConfig.findUnique({
      where: { id: 'global' },
    });

    if (!rawDbConfig) {
      dbConfig = AppConfigSchema.parse(await prisma.appConfig.create({
        data: { 
          id: 'global',
          venueName: 'Plummer House',
          venueAddress: '1091 Plummer Ln SW',
          venueCity: 'Rochester',
          venueState: 'MN',
          venueZip: '55902',
          latitude: 44.0079,
          longitude: -92.4938,
          venueDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN.',
          seoDescription: 'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.',
          faviconUrl: '/assets/favicon.png',
          ogImageUrl: '/images/sunset-embrace.jpg',
          seoKeywords: "{{brideName}} and {{groomName}}'s wedding, wedding website, {{venueName}} wedding, {{venueCity}} {{venueState}} wedding, {{brideName}} and {{groomName}} registry, wedding details, wedding ceremony, wedding reception",
        },
      }));
    } else {
      dbConfig = AppConfigSchema.parse(rawDbConfig);
    }

    await bootstrapLogisticsNodes();
  } catch (error) {
    console.warn('Database unreachable, using fallback config.');
  }

  const mergedConfig = dbConfig 
    ? { ...fallbackAppConfig, ...dbConfig }
    : fallbackAppConfig;

  return AppConfigSchema.parse({
    ...mergedConfig,
    latitude: coordinateSchema.parse(mergedConfig.latitude),
    longitude: coordinateSchema.parse(mergedConfig.longitude),
  });
}
