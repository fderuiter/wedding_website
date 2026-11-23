import {
  APP_CONFIG_SECRET_KEYS,
  hasNonEmptySecret,
  mergeAppConfigSecrets,
  parseOptionalDate,
  sanitizeAppConfigForBackup,
  sanitizeSnapshotForBackup,
  stripAppConfigSecrets,
} from '../backupPersistence';

describe('backupPersistence helpers', () => {
  it('checks non-empty secret values', () => {
    expect(hasNonEmptySecret('secret-value')).toBe(true);
    expect(hasNonEmptySecret('   ')).toBe(false);
    expect(hasNonEmptySecret('')).toBe(false);
    expect(hasNonEmptySecret(null)).toBe(false);
    expect(hasNonEmptySecret(undefined)).toBe(false);
  });

  it('merges incoming non-empty secrets ahead of existing secrets and ignores blank values', () => {
    const merged = mergeAppConfigSecrets(
      { smtpPass: 'incoming-smtp', resendApiKey: '   ', sendgridApiKey: undefined },
      {
        smtpPass: 'existing-smtp',
        resendApiKey: 'existing-resend',
        sendgridApiKey: '',
        twilioAuthToken: 'existing-twilio',
      },
    );

    expect(merged).toEqual({
      smtpPass: 'incoming-smtp',
      resendApiKey: 'existing-resend',
      twilioAuthToken: 'existing-twilio',
    });
  });

  it('strips AppConfig secret keys cleanly without mutating payloads lacking secrets', () => {
    const cleanPayload = { partner1Name: 'Alex', partner2Name: 'Taylor' };
    expect(stripAppConfigSecrets(cleanPayload)).toBe(cleanPayload);

    const payloadWithSecrets = {
      ...cleanPayload,
      smtpPass: 'smtp-secret',
      twilioAuthToken: '',
    };
    const stripped = stripAppConfigSecrets(payloadWithSecrets);
    expect(stripped).toEqual(cleanPayload);
    for (const secretKey of APP_CONFIG_SECRET_KEYS) {
      expect(secretKey in stripped).toBe(false);
    }
    expect(payloadWithSecrets.smtpPass).toBe('smtp-secret');

    const softDeletedWithSecrets = {
      deleted: true,
      previous: {
        ...cleanPayload,
        resendApiKey: 'resend-secret',
      },
    };
    const strippedSoftDeleted = stripAppConfigSecrets(softDeletedWithSecrets);
    expect(strippedSoftDeleted).toEqual({
      deleted: true,
      previous: cleanPayload,
    });
    expect(softDeletedWithSecrets.previous.resendApiKey).toBe('resend-secret');
  });

  it('parses optional dates across nullish, Date, ISO string, numeric, invalid, and object inputs', () => {
    const now = new Date('2026-09-19T16:00:00.000Z');
    expect(parseOptionalDate(null)).toBeNull();
    expect(parseOptionalDate(undefined)).toBeNull();
    expect(parseOptionalDate('')).toBeNull();
    expect(parseOptionalDate(now)).toBe(now);
    expect(parseOptionalDate(new Date('invalid-date'))).toBeNull();
    expect(parseOptionalDate('2026-09-19T16:00:00.000Z')?.toISOString()).toBe(
      '2026-09-19T16:00:00.000Z',
    );
    expect(parseOptionalDate(now.getTime())?.toISOString()).toBe('2026-09-19T16:00:00.000Z');
    expect(parseOptionalDate('not-a-valid-date')).toBeNull();
    expect(parseOptionalDate({})).toBeNull();
  });

  it('sanitizes AppConfig rows and AppConfig SnapshotVersion records for backup', () => {
    expect(sanitizeAppConfigForBackup(null)).toEqual({});
    expect(sanitizeAppConfigForBackup(undefined)).toEqual({});
    expect(sanitizeAppConfigForBackup([] as unknown as Record<string, unknown>)).toEqual({});

    const nonAppConfigSnap = {
      id: 'snap-media',
      entityType: 'Media',
      data: { url: '/images/photo.jpg', smtpPass: 'untouched-non-appconfig' },
    };
    expect(sanitizeSnapshotForBackup(nonAppConfigSnap)).toBe(nonAppConfigSnap);

    const appConfigSnap = {
      id: 'snap-cfg',
      entityType: 'AppConfig',
      data: {
        id: 'global',
        partner1Name: 'Alex',
        smtpPass: 'redact-me',
        multisiteEnabled: true,
        showCountdown: false,
        showAddToCalendar: true,
        modules: {},
      },
    };
    const sanitized = sanitizeSnapshotForBackup(appConfigSnap);
    expect(sanitized).toEqual({
      id: 'snap-cfg',
      entityType: 'AppConfig',
      data: expect.objectContaining({
        id: 'global',
        partner1Name: 'Alex',
        showCountdown: false,
        showAddToCalendar: true,
        modules: expect.objectContaining({
          countdown: false,
          addToCalendar: true,
        }),
      }),
    });
    expect((sanitized.data as Record<string, unknown>).smtpPass).toBeUndefined();
    expect((sanitized.data as Record<string, unknown>).multisiteEnabled).toBeUndefined();
  });
});
