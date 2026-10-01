import { prisma } from './prisma';
import { AppConfigSchema, PublicAppConfigDTO } from '../features/content/schemas';
import type { AppConfigDTO } from '../features/content/schemas';
import { coordinateSchema } from '../utils/validation';
import { isHostAllowed } from '../utils/hostValidation';
import { headers } from 'next/headers';

export function isMultisiteEnabled(): boolean {
  return process.env.MULTISITE_ENABLED === 'true' || process.env.MULTISITE_ENABLED === '1';
}

export type PublicAppConfig = PublicAppConfigDTO;

type LocalAppConfig = Omit<AppConfigDTO, 'latitude' | 'longitude'> & {
  latitude: string | number;
  longitude: string | number;
};

const fallbackAppConfig: LocalAppConfig = {
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
  timezone: 'UTC',
  // Toggles to conditionally render the countdown and add-to-calendar widgets on the layout
  showCountdown: true, 
  showAddToCalendar: true,
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Determine if the application configuration has been initialized with custom details.
 */
export function isSiteInitialized(config: AppConfigDTO | null | undefined): boolean {
  if (!config) return false;
  const p1 = config.partner1Name || config.brideName;
  const p2 = config.partner2Name || config.groomName;
  if (!p1 || !p2 || !config.baseUrl) return false;
  if (p1 === 'Abbigayle' && p2 === 'Frederick') return false;
  if (config.baseUrl.includes('abbifred.com')) return false;
  return true;
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

/**
 * Load the global application configuration from the database and ensure baseline content nodes exist.
 *
 * If the `appConfig` row with id `"global"` does not exist, a new row is created with initial venue and SEO fields.
 * Also ensures default logistics and FAQ content nodes are present.
 *
 * @returns The effective `AppConfig` object where values from the database override the fallback defaults; if the database is unreachable, returns the predefined fallback configuration.
 */
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
 * Load the application configuration from the database and ensure baseline content nodes exist.
 *
 * If a subdomain is active, attempts to resolve the subdomain's specific configuration.
 * Gracefully falls back to "global" configuration if none found.
 * Also ensures default logistics and FAQ content nodes are present.
 *
 * @returns The effective `AppConfig` object where values from the database override the fallback defaults; if the database is unreachable, returns the predefined fallback configuration.
 */
export async function getAppConfig(idOrSubdomain?: string): Promise<AppConfigDTO> {
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
    console.warn('Database unreachable, using fallback config.');
  }

  const mergedConfig = dbConfig 
    ? { ...fallbackAppConfig, ...dbConfig }
    : fallbackAppConfig;

  const partner1Name = mergedConfig.partner1Name || mergedConfig.brideName || '';
  const partner2Name = mergedConfig.partner2Name || mergedConfig.groomName || '';

  return AppConfigSchema.parse({
    ...mergedConfig,
    partner1Name,
    partner2Name,
    brideName: mergedConfig.brideName ?? partner1Name,
    groomName: mergedConfig.groomName ?? partner2Name,
    latitude: coordinateSchema.parse(mergedConfig.latitude),
    longitude: coordinateSchema.parse(mergedConfig.longitude),
  });
}
