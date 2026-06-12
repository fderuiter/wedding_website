import { prisma } from './prisma';
import type { AppConfig } from '@prisma/client';
import { coordinateSchema } from '../utils/validation';

export type PublicAppConfig = Omit<AppConfig, 'adminPassword'>;

export type LocalAppConfig = Omit<AppConfig, 'latitude' | 'longitude'> & {
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
  adminPassword: '',
  themePrimary: '#000000',
  themeSecondary: '#ffffff',
  themeAccent: '#d4af37',
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Produce a public-safe view of the application configuration.
 *
 * @param config - The full `AppConfig` object
 * @returns The same configuration with the `adminPassword` field removed
 */
export function toPublicAppConfig(config: AppConfig): PublicAppConfig {
  const { adminPassword, ...publicConfig } = config;
  return publicConfig;
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
export async function getAppConfig(): Promise<AppConfig> {
  let dbConfig: AppConfig | null = null;
  try {
    dbConfig = await prisma.appConfig.findUnique({
      where: { id: 'global' },
    });

    if (!dbConfig) {
      dbConfig = await prisma.appConfig.create({
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
      });
    }

    await bootstrapLogisticsNodes();
  } catch (error) {
    console.warn("Database unreachable, using fallback config.");
  }

  // Define environment overrides mapping
  const envOverrides: Partial<LocalAppConfig> = {};
  if (process.env.NEXT_PUBLIC_BRIDE_NAME || process.env.BRIDE_NAME) envOverrides.brideName = process.env.NEXT_PUBLIC_BRIDE_NAME || process.env.BRIDE_NAME;
  if (process.env.NEXT_PUBLIC_GROOM_NAME || process.env.GROOM_NAME) envOverrides.groomName = process.env.NEXT_PUBLIC_GROOM_NAME || process.env.GROOM_NAME;
  if (process.env.WEDDING_DATE) {
    const parsedDate = new Date(process.env.WEDDING_DATE);
    if (!isNaN(parsedDate.getTime())) {
      envOverrides.weddingDate = parsedDate;
    }
  }
  if (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL) envOverrides.baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL;
  if (process.env.NEXT_PUBLIC_VENUE_NAME || process.env.VENUE_NAME) envOverrides.venueName = process.env.NEXT_PUBLIC_VENUE_NAME || process.env.VENUE_NAME;
  if (process.env.NEXT_PUBLIC_THEME_PRIMARY || process.env.THEME_PRIMARY) envOverrides.themePrimary = process.env.NEXT_PUBLIC_THEME_PRIMARY || process.env.THEME_PRIMARY;
  if (process.env.NEXT_PUBLIC_THEME_SECONDARY || process.env.THEME_SECONDARY) envOverrides.themeSecondary = process.env.NEXT_PUBLIC_THEME_SECONDARY || process.env.THEME_SECONDARY;
  if (process.env.NEXT_PUBLIC_THEME_ACCENT || process.env.THEME_ACCENT) envOverrides.themeAccent = process.env.NEXT_PUBLIC_THEME_ACCENT || process.env.THEME_ACCENT;

  const mergedConfig = {
    ...fallbackAppConfig,
    ...(dbConfig || {}),
    ...envOverrides,
  };

  // Guarantee all properties have fallbacks if falsy
  const setupFields = ['brideName', 'groomName', 'baseUrl'];
  const finalConfig = Object.fromEntries(
    Object.entries(mergedConfig).map(([k, v]) => {
      // Only replace null or undefined with fallback
      if (v === null || v === undefined) {
        return [k, (fallbackAppConfig as any)[k]];
      }
      // Preserve empty strings for setup detection fields
      if (v === '' && setupFields.includes(k)) {
        return [k, ''];
      }
      // Replace other empty strings with fallback
      if (v === '') {
        return [k, (fallbackAppConfig as any)[k]];
      }
      return [k, v];
    })
  ) as LocalAppConfig;

  return {
    ...finalConfig,
    latitude: coordinateSchema.parse(finalConfig.latitude),
    longitude: coordinateSchema.parse(finalConfig.longitude),
  } as AppConfig;
}
