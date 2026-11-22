import { resolveModuleConfig } from './modules';

export const APP_CONFIG_SECRET_KEYS = [
  'smtpPass',
  'resendApiKey',
  'sendgridApiKey',
  'twilioAuthToken',
] as const;

export const APP_CONFIG_BACKUP_KEYS = [
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

/**
 * Sanitize an `AppConfig` database row or snapshot payload for backup export or
 * version history persistence by retaining only persisted non-secret database
 * columns (excluding raw provider credentials and virtual DTO keys).
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
          config.modules &&
          typeof config.modules === 'object' &&
          !Array.isArray(config.modules)
            ? (config.modules as Record<string, unknown>)
            : {};
        sanitized.modules = resolveModuleConfig({
          ...(typeof config.showCountdown === 'boolean' &&
          rawModules.countdown === undefined
            ? { countdown: config.showCountdown }
            : {}),
          ...(typeof config.showAddToCalendar === 'boolean' &&
          rawModules.addToCalendar === undefined
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
