import { prisma } from './prisma';
import type { AppConfig } from '@prisma/client';

export type PublicAppConfig = Omit<AppConfig, 'adminPassword'>;

const fallbackAppConfig: AppConfig = {
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
  venueDescription:
    'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN.',
  travelAdvice: '',
  heroTitle: '',
  heroSubtitle: '',
  seoTitle: '',
  seoDescription:
    'Join Abbigayle and Frederick for their wedding celebration at the historic Plummer House in Rochester, MN. Find all the details about the ceremony, reception, registry, and our story.',
  adminPassword: '',
  themePrimary: '#000000',
  themeSecondary: '#ffffff',
  themeAccent: '#d4af37',
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

export function toPublicAppConfig(config: AppConfig): PublicAppConfig {
  const { adminPassword, ...publicConfig } = config;
  return publicConfig;
}

export async function getAppConfig() {
  try {
    let config = await prisma.appConfig.findUnique({
      where: { id: 'global' },
    });

    if (!config) {
      config = await prisma.appConfig.create({
        data: { id: 'global' },
      });
    }
    return {
      ...fallbackAppConfig,
      ...config,
    };
  } catch (error) {
    console.warn("Database unreachable, using fallback config.");
    return fallbackAppConfig;
  }
}
