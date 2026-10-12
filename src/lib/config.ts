import { cache } from 'react';
import { prisma } from './prisma';
import { AppConfigSchema, PublicAppConfigDTO } from '../features/content/schemas';
import type { AppConfigDTO } from '../features/content/schemas';
import { coordinateSchema } from '../utils/validation';
import { isHostAllowed } from '../utils/hostValidation';
import { headers } from 'next/headers';

import { DEFAULT_MODULE_CONFIG } from './modules';

export function isMultisiteEnabled(): boolean {
  return process.env.MULTISITE_ENABLED === 'true' || process.env.MULTISITE_ENABLED === '1';
}

export type PublicAppConfig = PublicAppConfigDTO;

type LocalAppConfig = Omit<AppConfigDTO, 'latitude' | 'longitude'> & {
  latitude: string | number;
  longitude: string | number;
};

/**
 * Generic application defaults (Layer 4).
 * Generic technical defaults only; no personal wedding content.
 */
export const APP_DEFAULTS: LocalAppConfig = {
  id: 'global',
  partner1Name: '',
  partner2Name: '',
  brideName: '',
  groomName: '',
  weddingDate: new Date('2026-06-20T16:00:00.000Z'),
  baseUrl: '',
  venueName: '',
  venueAddress: '',
  venueCity: '',
  venueState: '',
  venueZip: '',
  latitude: 0,
  longitude: 0,
  storyText: '',
  venueDescription: '',
  travelAdvice: '',
  heroTitle: '',
  heroSubtitle: '',
  seoTitle: '',
  seoDescription: '',
  faviconUrl: '/assets/favicon.png',
  ogImageUrl: '/images/placeholder.png',
  seoKeywords: '',
  colorPrimary: '#B91C1C',
  colorSecondary: '#B45309',
  themePreset: 'classic',
  layoutContainerMaxWidth: '64rem',
  layoutGridGap: '1.5rem',
  layoutCardPadding: '2rem',
  layoutBorderRadius: '1rem',
  timezone: 'UTC',
  // Toggles to conditionally render the countdown and add-to-calendar widgets on the layout
  showCountdown: true,
  showAddToCalendar: true,
  modules: DEFAULT_MODULE_CONFIG,
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Determine if the application configuration has been initialized with custom details.
 */
export function isSiteInitialized(config: AppConfigDTO | null | undefined): boolean {
  if (process.env.E2E_TEST === 'true') return true;
  if (!config) return false;
  const p1 = config.partner1Name || config.brideName;
  const p2 = config.partner2Name || config.groomName;
  if (!p1 || !p2 || !config.baseUrl) return false;
  if ((p1 === 'Partner 1' && p2 === 'Partner 2') || (p1 === 'Abbigayle' && p2 === 'Frederick')) return false;
  if (config.baseUrl.includes('wedding.example')) return false;
  return true;
}

/**
 * Extract site configuration overrides specified via environment variables (Layer 1 override).
 */
export function getEnvConfigOverrides(): Partial<LocalAppConfig> {
  const overrides: Partial<LocalAppConfig> = {};

  if (process.env.SITE_PARTNER1_NAME) overrides.partner1Name = process.env.SITE_PARTNER1_NAME;
  if (process.env.SITE_PARTNER2_NAME) overrides.partner2Name = process.env.SITE_PARTNER2_NAME;
  if (process.env.SITE_BRIDE_NAME) {
    overrides.brideName = process.env.SITE_BRIDE_NAME;
    overrides.partner1Name = process.env.SITE_BRIDE_NAME;
  }
  if (process.env.SITE_GROOM_NAME) {
    overrides.groomName = process.env.SITE_GROOM_NAME;
    overrides.partner2Name = process.env.SITE_GROOM_NAME;
  }
  if (process.env.SITE_WEDDING_DATE !== undefined) {
    overrides.weddingDate = new Date(process.env.SITE_WEDDING_DATE);
  }
  if (process.env.SITE_BASE_URL !== undefined) overrides.baseUrl = process.env.SITE_BASE_URL;
  if (process.env.SITE_VENUE_NAME) overrides.venueName = process.env.SITE_VENUE_NAME;
  if (process.env.SITE_VENUE_ADDRESS !== undefined) overrides.venueAddress = process.env.SITE_VENUE_ADDRESS;
  if (process.env.SITE_VENUE_CITY !== undefined) overrides.venueCity = process.env.SITE_VENUE_CITY;
  if (process.env.SITE_VENUE_STATE !== undefined) overrides.venueState = process.env.SITE_VENUE_STATE;
  if (process.env.SITE_VENUE_ZIP !== undefined) overrides.venueZip = process.env.SITE_VENUE_ZIP;
  if (process.env.SITE_LATITUDE !== undefined) {
    const parsed = parseFloat(process.env.SITE_LATITUDE);
    overrides.latitude = isNaN(parsed) ? (process.env.SITE_LATITUDE as any) : parsed;
  }
  if (process.env.SITE_LONGITUDE !== undefined) {
    const parsed = parseFloat(process.env.SITE_LONGITUDE);
    overrides.longitude = isNaN(parsed) ? (process.env.SITE_LONGITUDE as any) : parsed;
  }
  if (process.env.SITE_TIMEZONE) overrides.timezone = process.env.SITE_TIMEZONE;
  if (process.env.SITE_COLOR_PRIMARY) overrides.colorPrimary = process.env.SITE_COLOR_PRIMARY;
  if (process.env.SITE_COLOR_SECONDARY) overrides.colorSecondary = process.env.SITE_COLOR_SECONDARY;
  if (process.env.SITE_THEME_PRESET) overrides.themePreset = process.env.SITE_THEME_PRESET as any;
  if (process.env.SITE_SHOW_COUNTDOWN !== undefined) {
    overrides.showCountdown = process.env.SITE_SHOW_COUNTDOWN.toLowerCase() === 'true';
  }
  if (process.env.SITE_SHOW_ADD_TO_CALENDAR !== undefined) {
    overrides.showAddToCalendar = process.env.SITE_SHOW_ADD_TO_CALENDAR.toLowerCase() === 'true';
  }
  if (process.env.SITE_SEO_TITLE !== undefined) overrides.seoTitle = process.env.SITE_SEO_TITLE;
  if (process.env.SITE_SEO_DESCRIPTION !== undefined) overrides.seoDescription = process.env.SITE_SEO_DESCRIPTION;

  return overrides;
}

/**
 * Produce a public-safe view of the application configuration by stripping
 * sensitive setup properties and credentials from the returned configuration payload.
 *
 * @param config - The full `AppConfig` object or raw config payload
 * @returns The sanitized configuration payload
 */
export function toPublicAppConfig<T extends AppConfigDTO | Record<string, any>>(config: T): PublicAppConfig {
  if (!config || typeof config !== 'object') {
    return config as PublicAppConfig;
  }

  const sanitized = {
    ...config,
    multisiteEnabled: isMultisiteEnabled(),
  };

  const sensitivePatterns = [
    'password',
    'secret',
    'credential',
    'token',
    'apikey',
    'apisecret',
    'privatekey',
    'smtppassword',
    'dbpassword',
    'adminpassword',
    'clientsecret',
    'authsecret',
    'jwtsecret',
    'accesskey',
    'secretkey',
    'databaseurl',
    'guestpasscode',
  ];

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === 'seokeywords') continue;

    if (sensitivePatterns.some((pattern) => lowerKey.includes(pattern))) {
      delete (sanitized as any)[key];
    }
  }

  return sanitized as PublicAppConfig;
}

/**
 * Ensures baseline Logistics and FAQ content nodes exist in the database if configured.
 * Fresh installations start with a clean slate for content nodes.
 */
async function bootstrapLogisticsNodes() {
  // Unconfigured template start: no automatic personal defaults created.
}

async function getSubdomainFromHeaders(): Promise<string | null> {
  if (!isMultisiteEnabled()) {
    return null;
  }
  try {
    const headersList = await headers();
    const host = headersList.get('host');
    if (!host || !isHostAllowed(host)) return null;
    
    const cleanHost = host.split(':')[0];
    if (cleanHost === 'localhost' || cleanHost === '127.0.0.1') {
      return null;
    }
    
    const parts = cleanHost.split('.');
    if (cleanHost.endsWith('.localhost')) {
      return parts[0];
    }
    
    if (parts.length >= 3) {
      const sub = parts[0];
      if (sub.toLowerCase() === 'www') return null;
      return sub;
    }
    
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Load the application configuration following deterministic precedence:
 * Level 1: Environment Variable Overrides (`SITE_*` env vars)
 * Level 2: Database Configuration (`AppConfig` row from DB)
 * Level 3: Application Generic Defaults (`APP_DEFAULTS`)
 *
 * @param idOrSubdomain - Profile ID or Subdomain identifier
 * @returns The resolved and validated AppConfigDTO
 */
export const getAppConfig = cache(async function getAppConfig(idOrSubdomain?: string): Promise<AppConfigDTO> {
  let dbConfig: AppConfigDTO | null = null;
  const multisite = isMultisiteEnabled();

  try {
    let rawDbConfig = null;
    if (multisite && idOrSubdomain && idOrSubdomain !== 'global') {
      rawDbConfig = await prisma.appConfig.findUnique({
        where: { id: idOrSubdomain },
      });
      if (!rawDbConfig) {
        rawDbConfig = await prisma.appConfig.findFirst({
          where: { subdomain: idOrSubdomain },
        });
      }
    } else if (multisite) {
      const subdomain = await getSubdomainFromHeaders();
      if (subdomain) {
        rawDbConfig = await prisma.appConfig.findFirst({
          where: { subdomain },
        });
      }
    }

    if (!rawDbConfig) {
      rawDbConfig = await prisma.appConfig.findUnique({
        where: { id: 'global' },
      });
    }

    if (!rawDbConfig) {
      dbConfig = AppConfigSchema.parse(await prisma.appConfig.create({
        data: { 
          id: 'global',
          partner1Name: '',
          partner2Name: '',
          brideName: '',
          groomName: '',
          baseUrl: '',
          venueName: '',
          venueAddress: '',
          venueCity: '',
          venueState: '',
          venueZip: '',
          latitude: 0,
          longitude: 0,
          venueDescription: '',
          seoDescription: '',
          faviconUrl: '/assets/favicon.png',
          ogImageUrl: '/images/placeholder.png',
          seoKeywords: '',
          colorPrimary: '#B91C1C',
          colorSecondary: '#B45309',
          themePreset: 'classic',
          timezone: 'UTC',
          showCountdown: true,
          showAddToCalendar: true,
        },
      }));
    } else {
      dbConfig = AppConfigSchema.parse(rawDbConfig);
    }

    await bootstrapLogisticsNodes();
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      console.error('Database connection failed during configuration load:', error);
    } else {
      console.warn('Database unreachable, using fallback config.');
    }
  }

  const envOverrides = getEnvConfigOverrides();

  // Deterministic Precedence: Generic Defaults < DB Config < Env Overrides
  const mergedConfig = {
    ...APP_DEFAULTS,
    ...(dbConfig || {}),
    ...envOverrides,
  };

  const partner1Name = mergedConfig.partner1Name || mergedConfig.brideName || '';
  const partner2Name = mergedConfig.partner2Name || mergedConfig.groomName || '';

  try {
    return AppConfigSchema.parse({
      ...mergedConfig,
      partner1Name,
      partner2Name,
      brideName: mergedConfig.brideName ?? partner1Name,
      groomName: mergedConfig.groomName ?? partner2Name,
      latitude: coordinateSchema.parse(mergedConfig.latitude),
      longitude: coordinateSchema.parse(mergedConfig.longitude),
    });
  } catch (err: any) {
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ Production Configuration Schema Validation Failed:', err);
      throw new Error(`Production Configuration Validation Failure: ${err.message || String(err)}`);
    }
    throw err;
  }
});
