import { cache } from 'react';
import { prisma } from './prisma';
import { AppConfigSchema, PublicAppConfigSchema, PublicAppConfigDTO, TypographyScaleSchema, SpacingScaleSchema, BorderTreatmentSchema, BrandDimensionsSchema } from '../features/content/schemas';
import type { AppConfigDTO } from '../features/content/schemas';
import { coordinateSchema } from '../utils/validation';
import { isHostAllowed } from '../utils/hostValidation';
import { evaluateRsvpCutoff, sanitizeRsvpClosedMessage } from '../utils/rsvpDeadline';
import { headers } from 'next/headers';

import { DEFAULT_MODULE_CONFIG, resolveModuleConfig } from './modules';
import {
  APP_CONFIG_SECRET_KEYS,
  hasNonEmptySecret as hasConfiguredSecret,
  sanitizeAppConfigForBackup,
  type AppConfigSecretKey,
} from './backupPersistence';
import { stripPresetDefaultTokens } from './theme/presets';

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
  contactEmail: '',
  photoAlbumUrl: '',
  faviconUrl: '/assets/favicon.png',
  ogImageUrl: '/images/placeholder.png',
  brandMonogram: undefined,
  brandLogoUrl: undefined,
  brandLogoAlt: undefined,
  heroImageUrl: undefined,
  heroImageAlt: undefined,
  brandWatermarkUrl: undefined,
  brandWatermarkAlt: undefined,
  badgeGraphicUrl: undefined,
  badgeGraphicAlt: undefined,
  seoKeywords: '',
  colorPrimary: '#B91C1C',
  colorSecondary: '#B45309',
  themePreset: 'classic',
  themeTokens: {},
  layoutContainerMaxWidth: '64rem',
  layoutGridGap: '1.5rem',
  layoutCardPadding: '2rem',
  layoutBorderRadius: '1rem',
  typographyScale: TypographyScaleSchema.parse({}),
  spacingScale: SpacingScaleSchema.parse({}),
  borderTreatment: BorderTreatmentSchema.parse({}),
  brandDimensions: BrandDimensionsSchema.parse({}),
  brandLogoWidth: '120px',
  brandLogoHeight: '40px',
  brandHeroHeight: '400px',
  brandWatermarkWidth: '200px',
  brandWatermarkOpacity: '0.1',
  brandBadgeSize: '48px',
  timezone: 'UTC',
  // Toggles to conditionally render the countdown and add-to-calendar widgets on the layout
  showCountdown: true,
  showAddToCalendar: true,
  rsvpOpen: true,
  rsvpDeadlineDate: '',
  rsvpGracePeriodHours: 0,
  rsvpClosedMessage: '',
  emailProvider: 'smtp',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: '',
  smtpSecure: false,
  resendApiKey: '',
  resendFrom: '',
  sendgridApiKey: '',
  sendgridFrom: '',
  smsProvider: 'none',
  twilioAccountSid: '',
  twilioAuthToken: '',
  twilioFromNumber: '',
  broadcastBatchSize: 50,
  broadcastBatchDelayMs: 500,
  shippingRecipientName: '',
  shippingAddressLine1: '',
  shippingAddressLine2: '',
  shippingCity: '',
  shippingState: '',
  shippingZip: '',
  shippingCountry: '',
  shippingPhone: '',
  shippingDeliveryNotes: '',
  defaultPaymentHandleType: '',
  defaultPaymentHandle: '',
  setupCompleted: true,
  modules: DEFAULT_MODULE_CONFIG,
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Static mock configuration for static HTML export (Layer 4 fallback).
 * Provides mock event logistics and initialized state for public static showcases.
 */
export const STATIC_MOCK_CONFIG: LocalAppConfig = {
  ...APP_DEFAULTS,
  id: 'global',
  partner1Name: 'Alex Morgan',
  partner2Name: 'Taylor Jordan',
  brideName: 'Alex Morgan',
  groomName: 'Taylor Jordan',
  weddingDate: new Date('2026-09-19T16:00:00.000Z'),
  baseUrl: 'https://example.com',
  venueName: 'The Glasshouse Estate',
  venueAddress: '123 Meadow Lane',
  venueCity: 'Minneapolis',
  venueState: 'MN',
  venueZip: '55401',
  latitude: 44.9778,
  longitude: -93.2650,
  storyText: 'Welcome to our wedding website! We are so excited to celebrate our special day with you.\n\nFrom the moment we met, we knew we had found a partner for all of life\'s adventures.',
  venueDescription: 'The Glasshouse Estate is nestled amidst scenic gardens and historic grounds.',
  travelAdvice: 'The venue is located 25 minutes from Minneapolis-Saint Paul International Airport (MSP).',
  heroTitle: 'Alex & Taylor',
  heroSubtitle: 'Celebrating our wedding',
  seoTitle: 'Alex & Taylor Wedding',
  seoDescription: 'Join Alex and Taylor for their wedding celebration at The Glasshouse Estate.',
  contactEmail: 'contact@example.com',
  colorPrimary: '#B91C1C',
  colorSecondary: '#B45309',
  themePreset: 'classic',
  timezone: 'America/Chicago',
  showCountdown: true,
  showAddToCalendar: true,
  rsvpOpen: true,
  rsvpDeadlineDate: '',
  rsvpGracePeriodHours: 0,
  rsvpClosedMessage: '',
  features: [
    { id: 'story', type: 'story', title: 'Our Story', visible: true },
    { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
    { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
    { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
    { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
    { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true },
  ],
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
 * Determine if the initial multi-step admin setup wizard has been completed.
 */
export function isSetupCompleted(config: AppConfigDTO | null | undefined): boolean {
  if (!isSiteInitialized(config)) return false;
  return config?.setupCompleted !== false;
}

/**
 * Extract site configuration overrides specified via environment variables (Layer 1 override).
 */
function getEnvConfigOverrides(): Partial<LocalAppConfig> {
  const overrides: Partial<LocalAppConfig> = {};

  if (process.env.SITE_BRIDE_NAME) {
    overrides.brideName = process.env.SITE_BRIDE_NAME;
    overrides.partner1Name = process.env.SITE_BRIDE_NAME;
  }
  if (process.env.SITE_GROOM_NAME) {
    overrides.groomName = process.env.SITE_GROOM_NAME;
    overrides.partner2Name = process.env.SITE_GROOM_NAME;
  }
  if (process.env.SITE_PARTNER1_NAME) {
    overrides.partner1Name = process.env.SITE_PARTNER1_NAME;
    overrides.brideName = process.env.SITE_PARTNER1_NAME;
  }
  if (process.env.SITE_PARTNER2_NAME) {
    overrides.partner2Name = process.env.SITE_PARTNER2_NAME;
    overrides.groomName = process.env.SITE_PARTNER2_NAME;
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
  if (process.env.SITE_THEME_TOKENS) {
    try {
      (overrides as any).themeTokens = JSON.parse(process.env.SITE_THEME_TOKENS);
    } catch {
      // Ignore malformed JSON in environment variable
    }
  }
  if (process.env.SITE_SHOW_COUNTDOWN !== undefined) {
    overrides.showCountdown = process.env.SITE_SHOW_COUNTDOWN.toLowerCase() === 'true';
  }
  if (process.env.SITE_SHOW_ADD_TO_CALENDAR !== undefined) {
    overrides.showAddToCalendar = process.env.SITE_SHOW_ADD_TO_CALENDAR.toLowerCase() === 'true';
  }
  if (process.env.SITE_SEO_TITLE !== undefined) overrides.seoTitle = process.env.SITE_SEO_TITLE;
  if (process.env.SITE_SEO_DESCRIPTION !== undefined) overrides.seoDescription = process.env.SITE_SEO_DESCRIPTION;
  if (process.env.SITE_BRAND_MONOGRAM !== undefined) overrides.brandMonogram = process.env.SITE_BRAND_MONOGRAM;
  if (process.env.SITE_BRAND_LOGO_URL !== undefined) overrides.brandLogoUrl = process.env.SITE_BRAND_LOGO_URL;
  if (process.env.SITE_BRAND_LOGO_ALT !== undefined) overrides.brandLogoAlt = process.env.SITE_BRAND_LOGO_ALT;
  if (process.env.SITE_HERO_IMAGE_URL !== undefined) overrides.heroImageUrl = process.env.SITE_HERO_IMAGE_URL;
  if (process.env.SITE_HERO_IMAGE_ALT !== undefined) overrides.heroImageAlt = process.env.SITE_HERO_IMAGE_ALT;
  if (process.env.SITE_BRAND_WATERMARK_URL !== undefined) overrides.brandWatermarkUrl = process.env.SITE_BRAND_WATERMARK_URL;
  if (process.env.SITE_BRAND_WATERMARK_ALT !== undefined) overrides.brandWatermarkAlt = process.env.SITE_BRAND_WATERMARK_ALT;
  if (process.env.SITE_BADGE_GRAPHIC_URL !== undefined) overrides.badgeGraphicUrl = process.env.SITE_BADGE_GRAPHIC_URL;
  if (process.env.SITE_BADGE_GRAPHIC_ALT !== undefined) overrides.badgeGraphicAlt = process.env.SITE_BADGE_GRAPHIC_ALT;
  if (process.env.SITE_CONTACT_EMAIL !== undefined) overrides.contactEmail = process.env.SITE_CONTACT_EMAIL;

  return overrides;
}

const PUBLIC_APP_CONFIG_KEYS = Object.keys(PublicAppConfigSchema.shape) as Array<keyof PublicAppConfigDTO>;

export interface AdminAppConfig extends PublicAppConfig {
  rsvpGracePeriodHours: number;
  emailProvider: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpFrom: string;
  smtpSecure: boolean;
  resendFrom: string;
  sendgridFrom: string;
  smsProvider: string;
  twilioAccountSid: string;
  twilioFromNumber: string;
  broadcastBatchSize: number;
  broadcastBatchDelayMs: number;
  shippingRecipientName: string;
  shippingAddressLine1: string;
  shippingAddressLine2: string;
  shippingCity: string;
  shippingState: string;
  shippingZip: string;
  shippingCountry: string;
  shippingPhone: string;
  shippingDeliveryNotes: string;
  defaultPaymentHandleType: string;
  defaultPaymentHandle: string;
  setupCompleted: boolean;
  hasSmtpPass: boolean;
  hasResendApiKey: boolean;
  hasSendgridApiKey: boolean;
  hasTwilioAuthToken: boolean;
}

/**
 * Produce a public-safe view of the application configuration by parsing
 * through the strict `PublicAppConfigSchema` allowlist plus `multisiteEnabled`.
 *
 * @param config - The full `AppConfig` object or raw config payload
 * @returns The allowlisted public configuration payload
 */
export function toPublicAppConfig<T extends AppConfigDTO | Record<string, any>>(config: T): PublicAppConfig {
  if (!config || typeof config !== 'object') {
    return config as PublicAppConfig;
  }

  const picked: Record<string, unknown> = {};
  for (const key of PUBLIC_APP_CONFIG_KEYS) {
    if (key in config && key !== 'multisiteEnabled' && key !== 'isRsvpOpen') {
      picked[key] = (config as Record<string, unknown>)[key];
    }
  }
  const rsvpEvaluation = evaluateRsvpCutoff(config as Record<string, any>);
  picked.multisiteEnabled = isMultisiteEnabled();
  picked.isRsvpOpen = rsvpEvaluation.isOpen;
  if (typeof picked.rsvpClosedMessage === 'string') {
    picked.rsvpClosedMessage = sanitizeRsvpClosedMessage(picked.rsvpClosedMessage);
  }

  const parsed = PublicAppConfigSchema.safeParse(picked);
  if (parsed.success) {
    return parsed.data;
  }

  const partialSanitized: Record<string, unknown> = {
    multisiteEnabled: isMultisiteEnabled(),
    isRsvpOpen: rsvpEvaluation.isOpen,
  };
  for (const key of PUBLIC_APP_CONFIG_KEYS) {
    if (key === 'multisiteEnabled' || key === 'isRsvpOpen' || !(key in picked)) continue;
    const fieldSchema = PublicAppConfigSchema.shape[key];
    const fieldResult = fieldSchema.safeParse(picked[key]);
    if (fieldResult.success) {
      partialSanitized[key] = fieldResult.data;
    } else if (picked[key] !== undefined) {
      partialSanitized[key] = picked[key];
    }
  }

  return partialSanitized as PublicAppConfig;
}

export { APP_CONFIG_SECRET_KEYS, sanitizeAppConfigForBackup, type AppConfigSecretKey };

/**
 * Produce a masked admin view of the application configuration that omits raw
 * messaging secrets while preserving non-secret delivery settings and boolean
 * secret presence flags.
 */
export function toAdminAppConfig<T extends AppConfigDTO | Record<string, any>>(config: T): AdminAppConfig {
  if (!config || typeof config !== 'object') {
    return config as AdminAppConfig;
  }

  const publicConfig = toPublicAppConfig(config);
  const raw = config as Record<string, any>;

  return {
    ...publicConfig,
    rsvpOpen: typeof raw.rsvpOpen === 'boolean' ? raw.rsvpOpen : true,
    rsvpGracePeriodHours: typeof raw.rsvpGracePeriodHours === 'number' ? raw.rsvpGracePeriodHours : 0,
    emailProvider: typeof raw.emailProvider === 'string' && raw.emailProvider ? raw.emailProvider : 'smtp',
    smtpHost: raw.smtpHost ?? '',
    smtpPort: typeof raw.smtpPort === 'number' ? raw.smtpPort : 587,
    smtpUser: raw.smtpUser ?? '',
    smtpFrom: raw.smtpFrom ?? '',
    smtpSecure: Boolean(raw.smtpSecure),
    resendFrom: raw.resendFrom ?? '',
    sendgridFrom: raw.sendgridFrom ?? '',
    smsProvider: typeof raw.smsProvider === 'string' && raw.smsProvider ? raw.smsProvider : 'none',
    twilioAccountSid: raw.twilioAccountSid ?? '',
    twilioFromNumber: raw.twilioFromNumber ?? '',
    broadcastBatchSize: typeof raw.broadcastBatchSize === 'number' ? raw.broadcastBatchSize : 50,
    broadcastBatchDelayMs: typeof raw.broadcastBatchDelayMs === 'number' ? raw.broadcastBatchDelayMs : 500,
    shippingRecipientName: raw.shippingRecipientName ?? '',
    shippingAddressLine1: raw.shippingAddressLine1 ?? '',
    shippingAddressLine2: raw.shippingAddressLine2 ?? '',
    shippingCity: raw.shippingCity ?? '',
    shippingState: raw.shippingState ?? '',
    shippingZip: raw.shippingZip ?? '',
    shippingCountry: raw.shippingCountry ?? '',
    shippingPhone: raw.shippingPhone ?? '',
    shippingDeliveryNotes: raw.shippingDeliveryNotes ?? '',
    defaultPaymentHandleType: raw.defaultPaymentHandleType ?? '',
    defaultPaymentHandle: raw.defaultPaymentHandle ?? '',
    setupCompleted: raw.setupCompleted !== false,
    hasSmtpPass: hasConfiguredSecret(raw.smtpPass),
    hasResendApiKey: hasConfiguredSecret(raw.resendApiKey),
    hasSendgridApiKey: hasConfiguredSecret(raw.sendgridApiKey),
    hasTwilioAuthToken: hasConfiguredSecret(raw.twilioAuthToken),
  };
}

async function getSubdomainFromHeaders(): Promise<string | null> {
  if (!isMultisiteEnabled()) {
    return null;
  }
  try {
    const headersList = await headers();
    const forwardedHost = headersList.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || headersList.get('host');
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
  } catch {
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
  const isStaticExport = process.env.STATIC_EXPORT === 'true' ||
                         process.env.STATIC_EXPORT === '1' ||
                         process.env.npm_lifecycle_event === 'build:export';

  let dbConfig: AppConfigDTO | null = null;
  const multisite = isMultisiteEnabled();

  if (isStaticExport) {
    dbConfig = AppConfigSchema.parse({
      ...STATIC_MOCK_CONFIG,
      latitude: coordinateSchema.parse(STATIC_MOCK_CONFIG.latitude),
      longitude: coordinateSchema.parse(STATIC_MOCK_CONFIG.longitude),
    });
  } else {
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
        dbConfig = AppConfigSchema.parse(await prisma.appConfig.upsert({
          where: { id: 'global' },
          update: {},
          create: { 
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
            contactEmail: '',
            photoAlbumUrl: '',
            faviconUrl: '/assets/favicon.png',
            ogImageUrl: '/images/placeholder.png',
            seoKeywords: '',
            colorPrimary: '#B91C1C',
            colorSecondary: '#B45309',
            themePreset: 'classic',
            themeTokens: {},
            modules: DEFAULT_MODULE_CONFIG,
            timezone: 'UTC',
            showCountdown: true,
            showAddToCalendar: true,
            rsvpOpen: true,
            rsvpDeadlineDate: '',
            rsvpGracePeriodHours: 0,
            rsvpClosedMessage: '',
          },
        }));
      } else {
        const rawModules =
          typeof (rawDbConfig as Record<string, unknown>).modules === 'object' &&
          (rawDbConfig as Record<string, unknown>).modules !== null &&
          !Array.isArray((rawDbConfig as Record<string, unknown>).modules)
            ? ((rawDbConfig as Record<string, unknown>).modules as Record<string, unknown>)
            : {};
        dbConfig = AppConfigSchema.parse({
          ...rawDbConfig,
          modules: {
            ...(typeof rawDbConfig.showCountdown === 'boolean' ? { countdown: rawDbConfig.showCountdown } : {}),
            ...(typeof rawDbConfig.showAddToCalendar === 'boolean' ? { addToCalendar: rawDbConfig.showAddToCalendar } : {}),
            ...rawModules,
          },
        });
      }

    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        console.error('Database connection failed during configuration load:', error);
      } else {
        console.warn('Database unreachable, using fallback config.');
      }
    }
  }

  const envOverrides = getEnvConfigOverrides();
  const activePreset = envOverrides.themePreset || dbConfig?.themePreset || APP_DEFAULTS.themePreset;
  const previousDbPreset = dbConfig?.themePreset;

  // Deterministic Precedence: Sparse DB Custom Overrides < Sparse Env Overrides
  // Preset defaults stay in presets.ts so changing presets never carries stale defaults forward
  const sparseDbTokens = stripPresetDefaultTokens(
    (dbConfig as any)?.themeTokens,
    activePreset,
    previousDbPreset && previousDbPreset !== activePreset ? previousDbPreset : undefined
  );
  const rawEnvTokens =
    (envOverrides as any)?.themeTokens && typeof (envOverrides as any).themeTokens === 'object'
      ? (envOverrides as any).themeTokens
      : {};
  const mergedThemeTokens = stripPresetDefaultTokens(
    {
      ...sparseDbTokens,
      ...rawEnvTokens,
    },
    activePreset
  );

  // Deterministic Precedence: Generic Defaults < DB Config < Env Overrides
  const baseModules = resolveModuleConfig((dbConfig as any)?.modules ?? APP_DEFAULTS.modules);
  const syncedEnvModules = {
    ...baseModules,
    ...(envOverrides.showCountdown !== undefined ? { countdown: envOverrides.showCountdown } : {}),
    ...(envOverrides.showAddToCalendar !== undefined ? { addToCalendar: envOverrides.showAddToCalendar } : {}),
  };
  const mergedConfig = {
    ...APP_DEFAULTS,
    ...(dbConfig || {}),
    ...envOverrides,
    modules: syncedEnvModules,
    themeTokens: mergedThemeTokens,
  };

  const partner1Name = mergedConfig.partner1Name || mergedConfig.brideName || '';
  const partner2Name = mergedConfig.partner2Name || mergedConfig.groomName || '';

  try {
    return AppConfigSchema.parse({
      ...mergedConfig,
      partner1Name,
      partner2Name,
      brideName: partner1Name,
      groomName: partner2Name,
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
