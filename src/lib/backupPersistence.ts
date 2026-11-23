import { resolveModuleConfig } from './modules';

export const APP_CONFIG_SECRET_KEYS = [
  'smtpPass',
  'resendApiKey',
  'sendgridApiKey',
  'twilioAuthToken',
] as const;

export type AppConfigSecretKey = (typeof APP_CONFIG_SECRET_KEYS)[number];

const APP_CONFIG_BACKUP_KEYS = [
  'id',
  'partner1Name',
  'partner2Name',
  'brideName',
  'groomName',
  'subdomain',
  'weddingDate',
  'baseUrl',
  'venueName',
  'venueAddress',
  'venueCity',
  'venueState',
  'venueZip',
  'latitude',
  'longitude',
  'storyText',
  'venueDescription',
  'travelAdvice',
  'heroTitle',
  'heroSubtitle',
  'seoTitle',
  'seoDescription',
  'contactEmail',
  'photoAlbumUrl',
  'autoApproveGuestPhotos',
  'faviconUrl',
  'ogImageUrl',
  'brandMonogram',
  'brandLogoUrl',
  'brandLogoAlt',
  'heroImageUrl',
  'heroImageAlt',
  'brandWatermarkUrl',
  'brandWatermarkAlt',
  'badgeGraphicUrl',
  'badgeGraphicAlt',
  'seoKeywords',
  'colorPrimary',
  'colorSecondary',
  'themePreset',
  'themeTokens',
  'layoutContainerMaxWidth',
  'layoutGridGap',
  'layoutCardPadding',
  'layoutBorderRadius',
  'features',
  'modules',
  'timezone',
  'showCountdown',
  'showAddToCalendar',
  'rsvpOpen',
  'rsvpDeadlineDate',
  'rsvpGracePeriodHours',
  'rsvpClosedMessage',
  'emailProvider',
  'smtpHost',
  'smtpPort',
  'smtpUser',
  'smtpFrom',
  'smtpSecure',
  'resendFrom',
  'sendgridFrom',
  'smsProvider',
  'twilioAccountSid',
  'twilioFromNumber',
  'broadcastBatchSize',
  'broadcastBatchDelayMs',
  'shippingRecipientName',
  'shippingAddressLine1',
  'shippingAddressLine2',
  'shippingCity',
  'shippingState',
  'shippingZip',
  'shippingCountry',
  'shippingPhone',
  'shippingDeliveryNotes',
  'defaultPaymentHandleType',
  'defaultPaymentHandle',
  'createdAt',
  'updatedAt',
] as const;

export function hasNonEmptySecret(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function mergeAppConfigSecrets(
  incoming: Partial<Record<AppConfigSecretKey, unknown>>,
  existing?: Partial<Record<AppConfigSecretKey, unknown>> | null,
): Partial<Record<AppConfigSecretKey, string>> {
  const merged: Partial<Record<AppConfigSecretKey, string>> = {};
  for (const secretKey of APP_CONFIG_SECRET_KEYS) {
    const incomingSecret = incoming[secretKey];
    if (hasNonEmptySecret(incomingSecret)) {
      merged[secretKey] = incomingSecret;
    } else if (existing && hasNonEmptySecret(existing[secretKey])) {
      merged[secretKey] = existing[secretKey];
    }
  }
  return merged;
}

export function stripAppConfigSecrets<T extends Record<string, unknown>>(payload: T): T {
  if (!APP_CONFIG_SECRET_KEYS.some((secretKey) => secretKey in payload)) {
    return payload;
  }
  const copy: Record<string, unknown> = { ...payload };
  for (const secretKey of APP_CONFIG_SECRET_KEYS) {
    delete copy[secretKey];
  }
  return copy as T;
}

export function parseOptionalDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Sanitize an `AppConfig` database row or snapshot payload for backup export by
 * retaining only persisted non-secret database columns (excluding raw provider
 * credentials and virtual DTO keys).
 */
export function sanitizeAppConfigForBackup(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of APP_CONFIG_BACKUP_KEYS) {
    if (key in config && config[key] !== undefined) {
      if (key === 'modules') {
        const rawModules =
          config.modules && typeof config.modules === 'object' && !Array.isArray(config.modules)
            ? (config.modules as Record<string, unknown>)
            : {};
        sanitized.modules = resolveModuleConfig({
          ...(typeof config.showCountdown === 'boolean' && rawModules.countdown === undefined
            ? { countdown: config.showCountdown }
            : {}),
          ...(typeof config.showAddToCalendar === 'boolean' && rawModules.addToCalendar === undefined
            ? { addToCalendar: config.showAddToCalendar }
            : {}),
          ...rawModules,
        });
      } else {
        sanitized[key] = config[key];
      }
    }
  }
  return sanitized;
}

export function sanitizeSnapshotForBackup<T extends { entityType?: unknown; data?: unknown }>(
  snapshot: T,
): T {
  if (
    snapshot?.entityType === 'AppConfig' &&
    snapshot.data &&
    typeof snapshot.data === 'object' &&
    !Array.isArray(snapshot.data)
  ) {
    return {
      ...snapshot,
      data: sanitizeAppConfigForBackup(snapshot.data as Record<string, unknown>),
    };
  }
  return snapshot;
}
