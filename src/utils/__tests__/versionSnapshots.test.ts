import {
  maskSnapshotEmail,
  sanitizeDemoVersionData,
  shouldIncludeSnapshotData,
  toSnapshotSummaryData,
} from '../versionSnapshots';

describe('versionSnapshots helpers', () => {
  describe('shouldIncludeSnapshotData', () => {
    it('returns false when both includeData and entityId are omitted or blank', () => {
      expect(shouldIncludeSnapshotData(null, null)).toBe(false);
      expect(shouldIncludeSnapshotData('', '')).toBe(false);
      expect(shouldIncludeSnapshotData('   ', '   ')).toBe(false);
    });

    it('returns true when entityId is provided and includeData is omitted', () => {
      expect(shouldIncludeSnapshotData(null, 'global')).toBe(true);
      expect(shouldIncludeSnapshotData('', 'attr-1')).toBe(true);
    });

    it('honors explicit includeData=true/1 and includeData=false/0 flags', () => {
      expect(shouldIncludeSnapshotData('true', null)).toBe(true);
      expect(shouldIncludeSnapshotData('TRUE', '')).toBe(true);
      expect(shouldIncludeSnapshotData('1', undefined)).toBe(true);
      expect(shouldIncludeSnapshotData('false', 'global')).toBe(false);
      expect(shouldIncludeSnapshotData('FALSE', 'global')).toBe(false);
      expect(shouldIncludeSnapshotData('0', 'global')).toBe(false);
    });
  });

  describe('toSnapshotSummaryData', () => {
    it('returns { deleted: true } only when deleted is strictly boolean true on an object', () => {
      expect(toSnapshotSummaryData({ deleted: true, previous: { id: '1' } })).toEqual({
        deleted: true,
      });
      expect(toSnapshotSummaryData({ deleted: false, name: 'Item' })).toEqual({});
      expect(toSnapshotSummaryData({ deleted: 'true' })).toEqual({});
      expect(toSnapshotSummaryData(null)).toEqual({});
      expect(toSnapshotSummaryData(['deleted'])).toEqual({});
      expect(toSnapshotSummaryData({ action: 'DELETE' }, 'DELETE')).toEqual({
        deleted: true,
      });
      expect(toSnapshotSummaryData({}, 'UPDATE')).toEqual({});
    });
  });

  describe('maskSnapshotEmail', () => {
    it('masks short, standard, and invalid emails consistently', () => {
      expect(maskSnapshotEmail('john.doe@example.com')).toBe('j***e@example.com');
      expect(maskSnapshotEmail('ab@example.com')).toBe('a***@example.com');
      expect(maskSnapshotEmail('a@example.com')).toBe('a***@example.com');
      expect(maskSnapshotEmail('not-an-email')).toBe('[REDACTED]');
      expect(maskSnapshotEmail('@example.com')).toBe('[REDACTED]');
      expect(maskSnapshotEmail('')).toBe('');
    });
  });

  describe('sanitizeDemoVersionData', () => {
    it('strips non-public AppConfig credentials and masks nested personal identifiers', () => {
      const now = new Date('2026-06-20T00:00:00.000Z');
      const sanitized = sanitizeDemoVersionData(
        {
          id: 'global',
          partner1Name: 'Casey',
          contactEmail: 'hosts@example.org',
          smtpHost: 'smtp.example.org',
          smtpPass: 'secret',
          resendApiKey: 're_secret',
          sendgridApiKey: 'SG.secret',
          twilioAccountSid: 'AC_SECRET',
          twilioAuthToken: 'tw_secret',
          createdAt: now,
          nested: [
            {
              guestEmail: 'guest@example.org',
              phone: '555-0100',
              phoneNumber: '555-0101',
              shippingPhone: '555-0102',
              ssn: '123-45-6789',
            },
          ],
        },
        'AppConfig'
      ) as Record<string, unknown>;

      expect(sanitized.partner1Name).toBe('Casey');
      expect(sanitized.contactEmail).toBe('h***s@example.org');
      expect(sanitized.smtpHost).toBeUndefined();
      expect(sanitized.smtpPass).toBeUndefined();
      expect(sanitized.resendApiKey).toBeUndefined();
      expect(sanitized.sendgridApiKey).toBeUndefined();
      expect(sanitized.twilioAccountSid).toBeUndefined();
      expect(sanitized.twilioAuthToken).toBeUndefined();
      expect(sanitized.createdAt).toBe(now);
      expect(sanitized.nested).toEqual([
        {
          guestEmail: 'g***t@example.org',
          phone: '[REDACTED]',
          phoneNumber: '[REDACTED]',
          shippingPhone: '[REDACTED]',
          ssn: '[REDACTED]',
        },
      ]);
    });
  });
});
