const DEMO_REDACTED_APP_CONFIG_KEYS = new Set<string>([
  'autoApproveGuestPhotos',
  'guestPhotoQrTokenVersion',
  'rsvpOpen',
  'rsvpGracePeriodHours',
  'emailProvider',
  'smtpHost',
  'smtpPort',
  'smtpUser',
  'smtpPass',
  'smtpFrom',
  'smtpSecure',
  'resendApiKey',
  'resendFrom',
  'sendgridApiKey',
  'sendgridFrom',
  'smsProvider',
  'twilioAccountSid',
  'twilioAuthToken',
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
  'registryGiftAccessTier',
  'shippingDisclosureTier',
  'maxPendingReservations',
  'setupCompleted',
  'hasSmtpPass',
  'hasResendApiKey',
  'hasSendgridApiKey',
  'hasTwilioAuthToken',
]);

export function shouldIncludeSnapshotData(
  rawIncludeData: string | null | undefined,
  entityId: string | null | undefined
): boolean {
  const normalizedFlag =
    typeof rawIncludeData === 'string' ? rawIncludeData.trim().toLowerCase() : '';
  if (normalizedFlag === 'true' || normalizedFlag === '1') {
    return true;
  }
  if (normalizedFlag === 'false' || normalizedFlag === '0') {
    return false;
  }
  return Boolean(typeof entityId === 'string' && entityId.trim().length > 0);
}

function isDeletedSnapshotPayload(value: unknown, action?: string): boolean {
  if (typeof action === 'string' && action.trim().toUpperCase() === 'DELETE') {
    return true;
  }
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (value as { deleted?: unknown }).deleted === true
  );
}

export function toSnapshotSummaryData(
  value: unknown,
  action?: string
): { deleted: true } | Record<string, never> {
  return isDeletedSnapshotPayload(value, action) ? { deleted: true } : {};
}

export function maskSnapshotEmail(email: string): string {
  if (!email || typeof email !== 'string') return email;
  if (!email.includes('@')) return '[REDACTED]';
  const [local, domain] = email.split('@');
  if (!local) return '[REDACTED]';
  if (local.length <= 2) {
    return `${local[0] || ''}***@${domain}`;
  }
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

export function sanitizeDemoVersionData(
  value: unknown,
  entityType?: string
): unknown {
  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDemoVersionData(item, entityType));
  }

  const record = value as Record<string, unknown>;
  const nestedEntityType = entityType === 'AppConfig' ? undefined : entityType;
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(record)) {
    if (entityType === 'AppConfig' && DEMO_REDACTED_APP_CONFIG_KEYS.has(key)) {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('email') && typeof val === 'string' && val.length > 0) {
      out[key] = maskSnapshotEmail(val);
    } else if (
      (lowerKey === 'ssn' ||
        lowerKey === 'phone' ||
        lowerKey === 'phonenumber' ||
        lowerKey === 'shippingphone') &&
      typeof val === 'string' &&
      val.length > 0
    ) {
      out[key] = '[REDACTED]';
    } else if (val && typeof val === 'object') {
      out[key] = sanitizeDemoVersionData(val, nestedEntityType);
    } else {
      out[key] = val;
    }
  }

  return out;
}
