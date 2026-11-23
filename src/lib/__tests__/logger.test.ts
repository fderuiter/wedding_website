/** @jest-environment node */

import { APP_CONFIG_SECRET_KEYS } from '../backupPersistence';
import { logger } from '../logger';

describe('logger redaction', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redacts all APP_CONFIG_SECRET_KEYS (smtpPass, resendApiKey, sendgridApiKey, twilioAuthToken) while preserving non-secret delivery fields', () => {
    const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

    const payload: Record<string, unknown> = {
      smtpHost: 'smtp.mailgun.org',
      smtpPort: 587,
      smtpUser: 'mailer@wedding.example',
      resendFrom: 'invites@wedding.example',
      sendgridFrom: 'invites@wedding.example',
      twilioAccountSid: 'AC1234567890',
    };

    for (const secretKey of APP_CONFIG_SECRET_KEYS) {
      payload[secretKey] = `raw-secret-for-${secretKey}`;
    }

    logger.info('Loaded provider config', payload);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [, loggedPayload] = infoSpy.mock.calls[0] as [string, Record<string, unknown>];

    for (const secretKey of APP_CONFIG_SECRET_KEYS) {
      expect(loggedPayload[secretKey]).toBe('[REDACTED]');
    }

    expect(loggedPayload.smtpHost).toBe('smtp.mailgun.org');
    expect(loggedPayload.smtpPort).toBe(587);
    expect(loggedPayload.smtpUser).toBe('mailer@wedding.example');
    expect(loggedPayload.twilioAccountSid).toBe('AC1234567890');
  });

  it('redacts S3 env keys (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY) and *AccessKey* / *ApiKey variants across nested objects and arrays', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    logger.error('Storage and API failure', {
      env: {
        S3_BUCKET: 'wedding-uploads',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE',
        S3_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
      clients: [
        {
          accessKey: 'raw-access-key',
          accessKeyId: 'raw-access-key-id',
          secretAccessKey: 'raw-secret-access-key',
          apiKey: 'raw-generic-api-key',
          SMTP_PASS: 'raw-env-smtp-pass',
        },
      ],
      dbError: new Error('Connection failed for postgresql://wedding:supersecret@localhost:5432/wedding'),
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [, logged] = errorSpy.mock.calls[0] as [string, Record<string, any>];

    expect(logged.env.S3_BUCKET).toBe('wedding-uploads');
    expect(logged.env.S3_REGION).toBe('us-east-1');
    expect(logged.env.S3_ACCESS_KEY_ID).toBe('[REDACTED]');
    expect(logged.env.S3_SECRET_ACCESS_KEY).toBe('[REDACTED]');

    expect(logged.clients[0]).toEqual({
      accessKey: '[REDACTED]',
      accessKeyId: '[REDACTED]',
      secretAccessKey: '[REDACTED]',
      apiKey: '[REDACTED]',
      SMTP_PASS: '[REDACTED]',
    });

    expect(logged.dbError).toBeInstanceOf(Error);
    expect(logged.dbError.message).toContain('[REDACTED]@localhost:5432/wedding');
    expect(logged.dbError.message).not.toContain('supersecret');
  });
});
