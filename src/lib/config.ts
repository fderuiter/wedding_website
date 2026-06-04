import { prisma } from './prisma';
import type { AppConfig } from '@prisma/client';

export type PublicAppConfig = Omit<AppConfig, 'adminPassword'>;

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
    return config;
  } catch (error) {
    console.warn("Database unreachable, using default empty state.");
    return {
      id: 'global',
      brideName: '',
      groomName: '',
      weddingDate: new Date(),
      baseUrl: '',
      venueName: '',
      venueAddress: '',
      venueCity: '',
      venueState: '',
      venueZip: '',
      latitude: 0.0,
      longitude: 0.0,
      storyText: '',
      venueDescription: '',
      travelAdvice: '',
      heroTitle: '',
      heroSubtitle: '',
      seoTitle: '',
      seoDescription: '',
      adminPassword: '',
      themePrimary: '#f43f5e',
      themeSecondary: '#fbbf24',
      themeAccent: '#e11d48',
      features: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;
  }
}

