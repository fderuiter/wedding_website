import { MultiChannelMessagingProvider } from '../providers';

describe('MultiChannelMessagingProvider', () => {
  it('returns failure when recipient email is missing', async () => {
    const provider = new MultiChannelMessagingProvider({ emailProvider: 'smtp' });
    const result = await provider.sendEmail({ to: '', subject: 'Test', body: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing');
  });

  it('returns failure when recipient phone is missing', async () => {
    const provider = new MultiChannelMessagingProvider({ smsProvider: 'twilio' });
    const result = await provider.sendSms({ to: '', body: 'Test SMS' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('missing');
  });

  it('simulates SMTP dispatch successfully when configured', async () => {
    const provider = new MultiChannelMessagingProvider({
      emailProvider: 'smtp',
      smtpHost: 'smtp.example.com',
    });
    const result = await provider.sendEmail({
      to: 'guest@example.com',
      subject: 'Welcome',
      body: 'Hello guest',
    });
    expect(result.success).toBe(true);
  });

  it('validates Resend API key presence', async () => {
    const provider = new MultiChannelMessagingProvider({
      emailProvider: 'resend',
      resendApiKey: '',
    });
    const result = await provider.sendEmail({
      to: 'guest@example.com',
      subject: 'Welcome',
      body: 'Hello',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Resend API Key is missing');
  });

  it('tests email connection successfully', async () => {
    const provider = new MultiChannelMessagingProvider({ emailProvider: 'smtp', smtpHost: 'smtp.example.com' });
    const res = await provider.testConnection({ type: 'email', provider: 'smtp', smtpHost: 'smtp.example.com' });
    expect(res.success).toBe(true);
  });

  it('tests sms connection error when Twilio credentials missing', async () => {
    const provider = new MultiChannelMessagingProvider({});
    const res = await provider.testConnection({ type: 'sms' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Twilio Account SID');
  });
});
