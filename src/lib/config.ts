import { cache } from 'react';
import { prisma } from './prisma';
import { getActiveContextRequest, getOrLoadRequestAppConfig } from './requestContext';
import {
  AppConfigSchema,
  FeatureSchema,
  PublicAppConfigSchema,
  TypographyScaleSchema,
  SpacingScaleSchema,
  BorderTreatmentSchema,
  BrandDimensionsSchema,
  cssTokenKeyRegex,
  isValidCssTokenValue,
} from '@/features/content';
import type { AppConfigDTO, PublicAppConfigDTO } from '@/features/content';
import { coordinateSchema } from '../utils/validation';
import { resolveRequestSubdomain } from '../utils/hostValidation';
import {
  evaluateRsvpCutoff,
  sanitizeRsvpClosedMessage,
} from '../utils/rsvpDeadline';
import { normalizeVenueWeddingDate } from '../utils/venueDateTime';
import { isOutboundMessagingActive } from '../utils/guestSignInRecovery';
import { headers } from 'next/headers';

import { DEFAULT_MODULE_CONFIG, resolveModuleConfig } from './modules';
import {
  hasNonEmptySecret as hasConfiguredSecret,
  sanitizeAppConfigForBackup,
} from './backupPersistence';
import { stripPresetDefaultTokens } from './theme/presets';
import { buildArchetypeSeedData } from './sampleData/builder';

export function isMultisiteEnabled(): boolean {
  return (
    process.env.MULTISITE_ENABLED === 'true' ||
    process.env.MULTISITE_ENABLED === '1'
  );
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
  autoApproveGuestPhotos: false,
  guestPhotoQrTokenVersion: 1,
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
  typographyScale: TypographyScaleSchema ? TypographyScaleSchema.parse({}) : { fontSizeXs: '0.75rem', fontSizeSm: '0.875rem', fontSizeBase: '1rem', fontSizeLg: '1.125rem', fontSizeXl: '1.25rem', fontSize2xl: '1.5rem', fontWeightNormal: '400', fontWeightMedium: '500', fontWeightBold: '700', lineHeightTight: '1.25', lineHeightNormal: '1.5', lineHeightRelaxed: '1.75' },
  spacingScale: SpacingScaleSchema ? SpacingScaleSchema.parse({}) : { spacingXs: '0.25rem', spacingSm: '0.5rem', spacingMd: '1rem', spacingLg: '1.5rem', spacingXl: '2rem', spacing2xl: '3rem', containerMaxWidth: '64rem', gridGap: '1.5rem', cardPadding: '2rem' },
  borderTreatment: BorderTreatmentSchema ? BorderTreatmentSchema.parse({}) : { borderRadiusSm: '0.25rem', borderRadiusMd: '0.5rem', borderRadiusLg: '1rem', borderRadiusFull: '9999px', borderWidthThin: '1px', borderWidthMedium: '2px', borderWidthThick: '4px', borderStyleDefault: 'solid' },
  brandDimensions: BrandDimensionsSchema ? BrandDimensionsSchema.parse({}) : { logoWidth: '120px', logoHeight: '40px', heroHeight: '400px', watermarkWidth: '200px', watermarkOpacity: '0.1', badgeSize: '48px' },
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
  registryGiftAccessTier: 'PASSCODE_GUESTS',
  shippingDisclosureTier: 'PASSCODE_GUESTS',
  maxPendingReservations: 5,
  setupCompleted: true,
  modules: DEFAULT_MODULE_CONFIG,
  features: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * Static mock configuration for static HTML export (Layer 4 fallback).
 * Driven from the shared pure archetype seed builder (`classic` preset).
 */
const DEFAULT_CLASSIC_SEED_CONFIG = buildArchetypeSeedData('classic').config;

export const STATIC_MOCK_CONFIG: LocalAppConfig = {
  ...APP_DEFAULTS,
  ...DEFAULT_CLASSIC_SEED_CONFIG,
  id: 'global',
};

/**
 * Determine if the application configuration has been initialized with custom details.
 */
export function isSiteInitialized(
  config: AppConfigDTO | null | undefined,
): boolean {
  if (process.env.E2E_TEST === 'true') return true;
  if (!config) return false;
  const p1 = config.partner1Name || config.brideName;
  const p2 = config.partner2Name || config.groomName;
  if (!p1 || !p2 || !config.baseUrl) return false;
  if (
    (p1 === 'Partner 1' && p2 === 'Partner 2') ||
    (p1 === 'Abbigayle' && p2 === 'Frederick')
  )
    return false;
  if (config.baseUrl.includes('wedding.example')) return false;
  return true;
}

function readNonEmptySiteEnv(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

  const siteBrideName = readNonEmptySiteEnv(process.env.SITE_BRIDE_NAME);
  if (siteBrideName !== undefined) {
    overrides.brideName = siteBrideName;
    overrides.partner1Name = siteBrideName;
  }
  const siteGroomName = readNonEmptySiteEnv(process.env.SITE_GROOM_NAME);
  if (siteGroomName !== undefined) {
    overrides.groomName = siteGroomName;
    overrides.partner2Name = siteGroomName;
  }
  const sitePartner1Name = readNonEmptySiteEnv(process.env.SITE_PARTNER1_NAME);
  if (sitePartner1Name !== undefined) {
    overrides.partner1Name = sitePartner1Name;
    overrides.brideName = sitePartner1Name;
  }
  const sitePartner2Name = readNonEmptySiteEnv(process.env.SITE_PARTNER2_NAME);
  if (sitePartner2Name !== undefined) {
    overrides.partner2Name = sitePartner2Name;
    overrides.groomName = sitePartner2Name;
  }

  const siteWeddingDate = readNonEmptySiteEnv(process.env.SITE_WEDDING_DATE);
  if (siteWeddingDate !== undefined) {
    const provisionalTimezone =
      readNonEmptySiteEnv(process.env.SITE_TIMEZONE) ?? APP_DEFAULTS.timezone;
    overrides.weddingDate =
      normalizeVenueWeddingDate(siteWeddingDate, provisionalTimezone) ??
      new Date(siteWeddingDate);
  }

  const siteBaseUrl = readNonEmptySiteEnv(process.env.SITE_BASE_URL);
  if (siteBaseUrl !== undefined) overrides.baseUrl = siteBaseUrl;

  const siteVenueName = readNonEmptySiteEnv(process.env.SITE_VENUE_NAME);
  if (siteVenueName !== undefined) overrides.venueName = siteVenueName;

  const siteVenueAddress = readNonEmptySiteEnv(process.env.SITE_VENUE_ADDRESS);
  if (siteVenueAddress !== undefined) overrides.venueAddress = siteVenueAddress;

  const siteVenueCity = readNonEmptySiteEnv(process.env.SITE_VENUE_CITY);
  if (siteVenueCity !== undefined) overrides.venueCity = siteVenueCity;

  const siteVenueState = readNonEmptySiteEnv(process.env.SITE_VENUE_STATE);
  if (siteVenueState !== undefined) overrides.venueState = siteVenueState;

  const siteVenueZip = readNonEmptySiteEnv(process.env.SITE_VENUE_ZIP);
  if (siteVenueZip !== undefined) overrides.venueZip = siteVenueZip;

  const siteLatitude = readNonEmptySiteEnv(process.env.SITE_LATITUDE);
  if (siteLatitude !== undefined) {
    const parsed = parseFloat(siteLatitude);
    overrides.latitude = isNaN(parsed) ? (siteLatitude as any) : parsed;
  }

  const siteLongitude = readNonEmptySiteEnv(process.env.SITE_LONGITUDE);
  if (siteLongitude !== undefined) {
    const parsed = parseFloat(siteLongitude);
    overrides.longitude = isNaN(parsed) ? (siteLongitude as any) : parsed;
  }

  const siteTimezone = readNonEmptySiteEnv(process.env.SITE_TIMEZONE);
  if (siteTimezone !== undefined) overrides.timezone = siteTimezone;

  const siteColorPrimary = readNonEmptySiteEnv(process.env.SITE_COLOR_PRIMARY);
  if (siteColorPrimary !== undefined) overrides.colorPrimary = siteColorPrimary;

  const siteColorSecondary = readNonEmptySiteEnv(
    process.env.SITE_COLOR_SECONDARY,
  );
  if (siteColorSecondary !== undefined)
    overrides.colorSecondary = siteColorSecondary;

  const siteThemePreset = readNonEmptySiteEnv(process.env.SITE_THEME_PRESET);
  if (siteThemePreset !== undefined)
    overrides.themePreset = siteThemePreset as any;

  const siteThemeTokens = readNonEmptySiteEnv(process.env.SITE_THEME_TOKENS);
  if (siteThemeTokens !== undefined) {
    try {
      (overrides as any).themeTokens = JSON.parse(siteThemeTokens);
    } catch {
      // Ignore malformed JSON in environment variable
    }
  }

  const siteShowCountdown = readNonEmptySiteEnv(
    process.env.SITE_SHOW_COUNTDOWN,
  );
  if (siteShowCountdown !== undefined) {
    overrides.showCountdown = siteShowCountdown.toLowerCase() === 'true';
  }

  const siteShowAddToCalendar = readNonEmptySiteEnv(
    process.env.SITE_SHOW_ADD_TO_CALENDAR,
  );
  if (siteShowAddToCalendar !== undefined) {
    overrides.showAddToCalendar =
      siteShowAddToCalendar.toLowerCase() === 'true';
  }

  const siteSeoTitle = readNonEmptySiteEnv(process.env.SITE_SEO_TITLE);
  if (siteSeoTitle !== undefined) overrides.seoTitle = siteSeoTitle;

  const siteSeoDescription = readNonEmptySiteEnv(
    process.env.SITE_SEO_DESCRIPTION,
  );
  if (siteSeoDescription !== undefined)
    overrides.seoDescription = siteSeoDescription;

  const siteBrandMonogram = readNonEmptySiteEnv(
    process.env.SITE_BRAND_MONOGRAM,
  );
  if (siteBrandMonogram !== undefined)
    overrides.brandMonogram = siteBrandMonogram;

  const siteBrandLogoUrl = readNonEmptySiteEnv(process.env.SITE_BRAND_LOGO_URL);
  if (siteBrandLogoUrl !== undefined) overrides.brandLogoUrl = siteBrandLogoUrl;

  const siteBrandLogoAlt = readNonEmptySiteEnv(process.env.SITE_BRAND_LOGO_ALT);
  if (siteBrandLogoAlt !== undefined) overrides.brandLogoAlt = siteBrandLogoAlt;

  const siteHeroImageUrl = readNonEmptySiteEnv(process.env.SITE_HERO_IMAGE_URL);
  if (siteHeroImageUrl !== undefined) overrides.heroImageUrl = siteHeroImageUrl;

  const siteHeroImageAlt = readNonEmptySiteEnv(process.env.SITE_HERO_IMAGE_ALT);
  if (siteHeroImageAlt !== undefined) overrides.heroImageAlt = siteHeroImageAlt;

  const siteBrandWatermarkUrl = readNonEmptySiteEnv(
    process.env.SITE_BRAND_WATERMARK_URL,
  );
  if (siteBrandWatermarkUrl !== undefined)
    overrides.brandWatermarkUrl = siteBrandWatermarkUrl;

  const siteBrandWatermarkAlt = readNonEmptySiteEnv(
    process.env.SITE_BRAND_WATERMARK_ALT,
  );
  if (siteBrandWatermarkAlt !== undefined)
    overrides.brandWatermarkAlt = siteBrandWatermarkAlt;

  const siteBadgeGraphicUrl = readNonEmptySiteEnv(
    process.env.SITE_BADGE_GRAPHIC_URL,
  );
  if (siteBadgeGraphicUrl !== undefined)
    overrides.badgeGraphicUrl = siteBadgeGraphicUrl;

  const siteBadgeGraphicAlt = readNonEmptySiteEnv(
    process.env.SITE_BADGE_GRAPHIC_ALT,
  );
  if (siteBadgeGraphicAlt !== undefined)
    overrides.badgeGraphicAlt = siteBadgeGraphicAlt;

  const siteContactEmail = readNonEmptySiteEnv(process.env.SITE_CONTACT_EMAIL);
  if (siteContactEmail !== undefined) overrides.contactEmail = siteContactEmail;

  return overrides;
}

const PUBLIC_APP_CONFIG_KEYS = Object.keys(
  PublicAppConfigSchema?.shape ?? {},
) as Array<keyof PublicAppConfigDTO>;

export interface AdminAppConfig extends PublicAppConfig {
  autoApproveGuestPhotos: boolean;
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
  registryGiftAccessTier: 'PASSCODE_GUESTS' | 'INVITED_HOUSEHOLDS';
  shippingDisclosureTier: 'PASSCODE_GUESTS' | 'INVITED_HOUSEHOLDS' | 'POST_CLAIM_ONLY';
  maxPendingReservations: number;
  setupCompleted: boolean;
  hasSmtpPass: boolean;
  hasResendApiKey: boolean;
  hasSendgridApiKey: boolean;
  hasTwilioAuthToken: boolean;
}

function redactHiddenFeatures<T>(features: T): T {
  let candidate: unknown = features;
  const wasString = typeof features === 'string';
  if (wasString) {
    try {
      candidate = JSON.parse(features);
    } catch {
      return features;
    }
  }

  if (!Array.isArray(candidate)) {
    return features;
  }

  const redacted = candidate.map((entry) => {
    if (entry && typeof entry === 'object' && (entry as { visible?: unknown }).visible === false) {
      return {
        ...(entry as Record<string, unknown>),
        title: '',
        content: '',
        visible: false,
      };
    }
    return entry;
  });

  return (wasString ? JSON.stringify(redacted) : redacted) as T;
}

function resolveRawFeatures(
  rawFeatures: unknown,
  fallback: PublicAppConfig['features']
): PublicAppConfig['features'] {
  const parsed = PublicAppConfigSchema.shape.features.safeParse(rawFeatures);
  return parsed.success ? parsed.data : fallback;
}

/**
 * Produce a public-safe view of the application configuration by parsing
 * through the strict `PublicAppConfigSchema` allowlist plus `multisiteEnabled`.
 * Hidden sections (`visible === false`) retain placeholder entries with cleared
 * `title` and `content` so hidden copy is withheld without restoring defaults.
 *
 * @param config - The full `AppConfig` object or raw config payload
 * @returns The allowlisted public configuration payload
 */
export function toPublicAppConfig<T extends AppConfigDTO | Record<string, any>>(
  config: T,
): PublicAppConfig {
  if (!config || typeof config !== 'object') {
    return config as PublicAppConfig;
  }

  const picked: Record<string, unknown> = {};
  for (const key of PUBLIC_APP_CONFIG_KEYS) {
    if (
      key in config &&
      key !== 'multisiteEnabled' &&
      key !== 'isRsvpOpen' &&
      key !== 'isMessagingActive'
    ) {
      picked[key] = (config as Record<string, unknown>)[key];
    }
  }
  const rsvpEvaluation = evaluateRsvpCutoff(config as Record<string, any>);
  const messagingActive =
    typeof (config as Record<string, unknown>).isMessagingActive === 'boolean'
      ? Boolean((config as Record<string, unknown>).isMessagingActive)
      : isOutboundMessagingActive(config as Record<string, any>);
  picked.multisiteEnabled = isMultisiteEnabled();
  picked.isRsvpOpen = rsvpEvaluation.isOpen;
  picked.isMessagingActive = messagingActive;
  if (typeof picked.rsvpClosedMessage === 'string') {
    picked.rsvpClosedMessage = sanitizeRsvpClosedMessage(
      picked.rsvpClosedMessage,
    );
  }

  const parsed = PublicAppConfigSchema.safeParse(picked);
  if (parsed.success) {
    return {
      ...parsed.data,
      features: redactHiddenFeatures(parsed.data.features),
    };
  }

  const partialSanitized: Record<string, unknown> = {
    multisiteEnabled: isMultisiteEnabled(),
    isRsvpOpen: rsvpEvaluation.isOpen,
    isMessagingActive: messagingActive,
  };
  for (const key of PUBLIC_APP_CONFIG_KEYS) {
    if (
      key === 'multisiteEnabled' ||
      key === 'isRsvpOpen' ||
      key === 'isMessagingActive' ||
      !(key in picked)
    )
      continue;
    const fieldSchema = PublicAppConfigSchema.shape[key];
    const fieldResult = fieldSchema.safeParse(picked[key]);
    if (fieldResult.success) {
      partialSanitized[key] = key === 'features' ? redactHiddenFeatures(fieldResult.data) : fieldResult.data;
    } else if (picked[key] !== undefined) {
      partialSanitized[key] = key === 'features' ? redactHiddenFeatures(picked[key]) : picked[key];
    }
  }

  return partialSanitized as PublicAppConfig;
}

/**
 * Produce a layout-safe configuration view for unauthenticated requests by
 * clearing couple names, `weddingDate`, SEO strings (`seoTitle`, `seoDescription`,
 * `seoKeywords`), host `contactEmail`, `brandMonogram`, descriptive image alt text
 * (`brandLogoAlt`, `heroImageAlt`, `brandWatermarkAlt`, `badgeGraphicAlt`), RSVP
 * deadline copy (`rsvpDeadlineDate`, `rsvpClosedMessage`), and gated event details
 * (`photoAlbumUrl`, venue location fields, `storyText`, `travelAdvice`, hero text,
 * and `features`) while preserving theme tokens, `modules`, `timezone`, and boolean
 * RSVP state.
 *
 * @param config - The full `AppConfig` object or raw config payload
 * @returns The redacted configuration payload safe for unauthenticated layouts
 */
export function toUnauthenticatedAppConfig<T extends AppConfigDTO | Record<string, any>>(
  config: T,
): PublicAppConfig {
  if (!config || typeof config !== 'object') {
    return config as PublicAppConfig;
  }

  const publicConfig = toPublicAppConfig(config);

  return {
    ...publicConfig,
    partner1Name: '',
    partner2Name: '',
    brideName: '',
    groomName: '',
    weddingDate: '' as unknown as Date,
    seoTitle: '',
    seoDescription: '',
    seoKeywords: '',
    contactEmail: '',
    brandMonogram: '',
    brandLogoAlt: '',
    heroImageAlt: '',
    brandWatermarkAlt: '',
    badgeGraphicAlt: '',
    rsvpDeadlineDate: '',
    rsvpClosedMessage: '',
    photoAlbumUrl: '',
    venueName: '',
    venueAddress: '',
    venueCity: '',
    venueState: '',
    venueZip: '',
    latitude: 0,
    longitude: 0,
    venueDescription: '',
    storyText: '',
    travelAdvice: '',
    heroTitle: '',
    heroSubtitle: '',
    features: [],
  };
}

export { sanitizeAppConfigForBackup };

/**
 * Produce a masked admin view of the application configuration that omits raw
 * messaging secrets while preserving non-secret delivery settings and boolean
 * secret presence flags.
 */
export function toAdminAppConfig<T extends AppConfigDTO | Record<string, any>>(
  config: T,
): AdminAppConfig {
  if (!config || typeof config !== 'object') {
    return config as AdminAppConfig;
  }

  const publicConfig = toPublicAppConfig(config);
  const raw = config as Record<string, any>;

  return {
    ...publicConfig,
    autoApproveGuestPhotos: Boolean(raw.autoApproveGuestPhotos),
    features: resolveRawFeatures(raw.features, publicConfig.features),
    rsvpOpen: typeof raw.rsvpOpen === 'boolean' ? raw.rsvpOpen : true,
    rsvpGracePeriodHours:
      typeof raw.rsvpGracePeriodHours === 'number'
        ? raw.rsvpGracePeriodHours
        : 0,
    emailProvider:
      typeof raw.emailProvider === 'string' && raw.emailProvider
        ? raw.emailProvider
        : 'smtp',
    smtpHost: raw.smtpHost ?? '',
    smtpPort: typeof raw.smtpPort === 'number' ? raw.smtpPort : 587,
    smtpUser: raw.smtpUser ?? '',
    smtpFrom: raw.smtpFrom ?? '',
    smtpSecure: Boolean(raw.smtpSecure),
    resendFrom: raw.resendFrom ?? '',
    sendgridFrom: raw.sendgridFrom ?? '',
    smsProvider:
      typeof raw.smsProvider === 'string' && raw.smsProvider
        ? raw.smsProvider
        : 'none',
    twilioAccountSid: raw.twilioAccountSid ?? '',
    twilioFromNumber: raw.twilioFromNumber ?? '',
    broadcastBatchSize:
      typeof raw.broadcastBatchSize === 'number' ? raw.broadcastBatchSize : 50,
    broadcastBatchDelayMs:
      typeof raw.broadcastBatchDelayMs === 'number'
        ? raw.broadcastBatchDelayMs
        : 500,
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
    registryGiftAccessTier:
      raw.registryGiftAccessTier === 'INVITED_HOUSEHOLDS'
        ? 'INVITED_HOUSEHOLDS'
        : 'PASSCODE_GUESTS',
    shippingDisclosureTier:
      raw.shippingDisclosureTier === 'INVITED_HOUSEHOLDS' ||
      raw.shippingDisclosureTier === 'POST_CLAIM_ONLY'
        ? raw.shippingDisclosureTier
        : 'PASSCODE_GUESTS',
    maxPendingReservations:
      typeof raw.maxPendingReservations === 'number' &&
      Number.isInteger(raw.maxPendingReservations) &&
      raw.maxPendingReservations >= 1 &&
      raw.maxPendingReservations <= 100
        ? raw.maxPendingReservations
        : 5,
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
    return resolveRequestSubdomain(headersList);
  } catch {
    const activeRequest = getActiveContextRequest();
    if (activeRequest?.headers) {
      return resolveRequestSubdomain(activeRequest.headers, activeRequest.nextUrl?.host);
    }
    return null;
  }
}

const SPECIAL_DB_NORMALIZED_KEYS = new Set<string>([
  'id',
  'modules',
  'themeTokens',
  'features',
  'weddingDate',
  'createdAt',
  'updatedAt',
  'latitude',
  'longitude',
  'timezone',
]);

function normalizeRawDbConfig(raw: Record<string, unknown>): Record<string, unknown> {
  const definedEntries: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value !== undefined) {
      definedEntries[key] = value;
    }
  }

  if (
    'id' in definedEntries &&
    (typeof definedEntries.id !== 'string' || !definedEntries.id.trim())
  ) {
    definedEntries.id = APP_DEFAULTS.id;
  }

  let parsedThemeTokens = definedEntries.themeTokens;
  if (typeof parsedThemeTokens === 'string') {
    try {
      const decoded = JSON.parse(parsedThemeTokens);
      parsedThemeTokens =
        decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? decoded : {};
    } catch {
      parsedThemeTokens = {};
    }
  }

  const sanitizedThemeTokens: Record<string, string> = {};
  if (
    parsedThemeTokens &&
    typeof parsedThemeTokens === 'object' &&
    !Array.isArray(parsedThemeTokens)
  ) {
    for (const [tokenKey, tokenVal] of Object.entries(parsedThemeTokens)) {
      if (
        cssTokenKeyRegex.test(tokenKey) &&
        typeof tokenVal === 'string' &&
        isValidCssTokenValue(tokenVal)
      ) {
        sanitizedThemeTokens[tokenKey] = tokenVal;
      }
    }
  }

  if ('features' in definedEntries) {
    let rawFeatures = definedEntries.features;
    if (typeof rawFeatures === 'string') {
      try {
        rawFeatures = JSON.parse(rawFeatures);
      } catch {
        rawFeatures = [];
      }
    }
    definedEntries.features = Array.isArray(rawFeatures)
      ? rawFeatures.flatMap((item) => {
        const parsedFeature = FeatureSchema.safeParse(item);
        return parsedFeature.success ? [parsedFeature.data] : [];
      })
      : APP_DEFAULTS.features;
  }

  for (const dateKey of ['weddingDate', 'createdAt', 'updatedAt'] as const) {
    if (dateKey in definedEntries) {
      const rawDate = definedEntries[dateKey];
      const parsedDate =
        rawDate instanceof Date
          ? rawDate
          : typeof rawDate === 'string' || typeof rawDate === 'number'
            ? new Date(rawDate)
            : null;
      definedEntries[dateKey] =
        parsedDate && !Number.isNaN(parsedDate.getTime())
          ? parsedDate
          : APP_DEFAULTS[dateKey];
    }
  }

  for (const coordKey of ['latitude', 'longitude'] as const) {
    if (coordKey in definedEntries) {
      const parsedCoord = coordinateSchema.safeParse(definedEntries[coordKey]);
      definedEntries[coordKey] =
        parsedCoord.success && Number.isFinite(parsedCoord.data)
          ? parsedCoord.data
          : APP_DEFAULTS[coordKey];
    }
  }

  const shapeRecord = AppConfigSchema.shape as unknown as Record<
    string,
    { safeParse: (_val: unknown) => { success: boolean; data?: unknown } }
  >;
  const defaultsRecord = APP_DEFAULTS as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(definedEntries)) {
    if (SPECIAL_DB_NORMALIZED_KEYS.has(key)) {
      continue;
    }
    const fieldSchema = shapeRecord[key];
    if (!fieldSchema) {
      continue;
    }
    const parsedField = fieldSchema.safeParse(value);
    if (parsedField.success) {
      definedEntries[key] = parsedField.data;
    } else {
      const fallback = defaultsRecord[key];
      if (fallback === undefined) {
        delete definedEntries[key];
      } else {
        definedEntries[key] = fallback;
      }
    }
  }

  const rawModules: Record<string, boolean> = {};
  if (
    typeof definedEntries.modules === 'object' &&
    definedEntries.modules !== null &&
    !Array.isArray(definedEntries.modules)
  ) {
    for (const [modKey, modVal] of Object.entries(definedEntries.modules)) {
      if (typeof modVal === 'boolean') {
        rawModules[modKey] = modVal;
      }
    }
  }

  return {
    ...definedEntries,
    timezone:
      typeof definedEntries.timezone === 'string' && definedEntries.timezone.trim()
        ? definedEntries.timezone
        : 'America/Chicago',
    themeTokens: sanitizedThemeTokens,
    modules: {
      ...(typeof definedEntries.showCountdown === 'boolean'
        ? { countdown: definedEntries.showCountdown }
        : {}),
      ...(typeof definedEntries.showAddToCalendar === 'boolean'
        ? { addToCalendar: definedEntries.showAddToCalendar }
        : {}),
      ...rawModules,
    },
  };
}

async function resolveAppConfig(idOrSubdomain?: string): Promise<AppConfigDTO> {
  const isStaticExport =
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export';

  let dbConfig: Record<string, unknown> | null = null;
  const multisite = isMultisiteEnabled();

  if (isStaticExport) {
    dbConfig = normalizeRawDbConfig(STATIC_MOCK_CONFIG as unknown as Record<string, unknown>);
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
        const upsertedConfig = await prisma.appConfig.upsert({
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
        });
        dbConfig =
          upsertedConfig && typeof upsertedConfig === 'object'
            ? normalizeRawDbConfig(upsertedConfig as unknown as Record<string, unknown>)
            : null;
      } else {
        dbConfig = normalizeRawDbConfig(rawDbConfig as unknown as Record<string, unknown>);
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'production') {
        console.error(
          'Database connection failed during configuration load:',
          error,
        );
      } else {
        console.warn('Database unreachable, using fallback config.');
      }
    }
  }

  const envOverrides = getEnvConfigOverrides();
  const dbThemePreset =
    typeof dbConfig?.themePreset === 'string'
      ? (dbConfig.themePreset as AppConfigDTO['themePreset'])
      : undefined;
  const activePreset = envOverrides.themePreset || dbThemePreset || APP_DEFAULTS.themePreset;
  const previousDbPreset = dbThemePreset;

  // Deterministic Precedence: Sparse DB Custom Overrides < Sparse Env Overrides
  // Preset defaults stay in presets.ts so changing presets never carries stale defaults forward
  const sparseDbTokens = stripPresetDefaultTokens(
    (dbConfig as any)?.themeTokens,
    activePreset,
    previousDbPreset && previousDbPreset !== activePreset
      ? previousDbPreset
      : undefined,
  );
  const rawEnvTokens: Record<string, unknown> =
    envOverrides.themeTokens &&
    typeof envOverrides.themeTokens === 'object' &&
    !Array.isArray(envOverrides.themeTokens)
      ? (envOverrides.themeTokens as Record<string, unknown>)
      : {};
  const invalidEnvTokenEntries: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(rawEnvTokens)) {
    if (!key.startsWith('--') || typeof val !== 'string') {
      invalidEnvTokenEntries[key] = val;
    }
  }
  const mergedThemeTokens = {
    ...stripPresetDefaultTokens(
      {
        ...sparseDbTokens,
        ...rawEnvTokens,
      },
      activePreset,
    ),
    ...invalidEnvTokenEntries,
  };

  // Deterministic Precedence: Generic Defaults < DB Config < Env Overrides
  const baseModules = resolveModuleConfig(
    (dbConfig as any)?.modules ?? APP_DEFAULTS.modules,
  );
  const syncedEnvModules = {
    ...baseModules,
    ...(envOverrides.showCountdown !== undefined
      ? { countdown: envOverrides.showCountdown }
      : {}),
    ...(envOverrides.showAddToCalendar !== undefined
      ? { addToCalendar: envOverrides.showAddToCalendar }
      : {}),
  };
  const mergedConfig = {
    ...APP_DEFAULTS,
    ...(dbConfig || {}),
    ...envOverrides,
    modules: syncedEnvModules,
    themeTokens: mergedThemeTokens,
  };

  const rawSiteWeddingDate = readNonEmptySiteEnv(process.env.SITE_WEDDING_DATE);
  const resolvedWeddingDate =
    rawSiteWeddingDate !== undefined
      ? (normalizeVenueWeddingDate(
        rawSiteWeddingDate,
        mergedConfig.timezone,
      ) ?? new Date(rawSiteWeddingDate))
      : (normalizeVenueWeddingDate(
        mergedConfig.weddingDate,
        mergedConfig.timezone,
      ) ?? mergedConfig.weddingDate);

  const partner1Name =
    (typeof mergedConfig.partner1Name === 'string' && mergedConfig.partner1Name) ||
    (typeof mergedConfig.brideName === 'string' && mergedConfig.brideName) ||
    '';
  const partner2Name =
    (typeof mergedConfig.partner2Name === 'string' && mergedConfig.partner2Name) ||
    (typeof mergedConfig.groomName === 'string' && mergedConfig.groomName) ||
    '';

  try {
    return AppConfigSchema.parse({
      ...mergedConfig,
      weddingDate: resolvedWeddingDate,
      partner1Name,
      partner2Name,
      brideName: partner1Name,
      groomName: partner2Name,
      latitude: coordinateSchema.parse(mergedConfig.latitude),
      longitude: coordinateSchema.parse(mergedConfig.longitude),
    });
  } catch (err: any) {
    if (process.env.NODE_ENV === 'production') {
      console.error(
        '❌ Production Configuration Schema Validation Failed:',
        err,
      );
      throw new Error(
        `Production Configuration Validation Failure: ${err.message || String(err)}`,
      );
    }
    throw err;
  }
}

const getReactCachedAppConfig = cache(resolveAppConfig);

/**
 * Load the application configuration following deterministic precedence:
 * Level 1: Environment Variable Overrides (`SITE_*` env vars)
 * Level 2: Database Configuration (`AppConfig` row from DB)
 * Level 3: Application Generic Defaults (`APP_DEFAULTS`)
 *
 * @param idOrSubdomain - Profile ID or Subdomain identifier
 * @returns The resolved and validated AppConfigDTO
 */
export async function getAppConfig(idOrSubdomain?: string): Promise<AppConfigDTO> {
  const cacheKey = idOrSubdomain ?? '__default__';
  const requestScoped = getOrLoadRequestAppConfig(cacheKey, () => resolveAppConfig(idOrSubdomain));
  if (requestScoped) {
    return requestScoped;
  }
  return getReactCachedAppConfig(idOrSubdomain);
}
