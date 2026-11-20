import { MultiChannelMessagingProvider, formatEmailHtmlBody } from '../providers';

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

  it('keeps stored secrets in testConnection when password inputs are blank or whitespace', async () => {
    const resendProvider = new MultiChannelMessagingProvider({
      emailProvider: 'resend',
      resendApiKey: 're_stored_key',
    });
    expect(await resendProvider.testConnection({ type: 'email', provider: 'resend', resendApiKey: '' })).toEqual({
      success: true,
    });
    expect(await resendProvider.testConnection({ type: 'email', provider: 'resend', resendApiKey: '   ' })).toEqual({
      success: true,
    });

    const sendgridProvider = new MultiChannelMessagingProvider({
      emailProvider: 'sendgrid',
      sendgridApiKey: 'SG.stored_key',
    });
    expect(await sendgridProvider.testConnection({ type: 'email', provider: 'sendgrid', sendgridApiKey: '' })).toEqual({
      success: true,
    });

    const smtpProvider = new MultiChannelMessagingProvider({
      emailProvider: 'smtp',
      smtpHost: 'smtp.example.com',
      smtpUser: 'mailer@example.com',
      smtpPass: 'stored-smtp-pass',
    });
    expect(await smtpProvider.testConnection({ type: 'email', provider: 'smtp', smtpPass: '' })).toEqual({
      success: true,
    });

    const twilioProvider = new MultiChannelMessagingProvider({
      smsProvider: 'twilio',
      twilioAccountSid: 'AC12345',
      twilioAuthToken: 'stored-twilio-token',
    });
    expect(await twilioProvider.testConnection({ type: 'sms', twilioAuthToken: '' })).toEqual({
      success: true,
    });
  });

  describe('HTML email escaping and paragraph formatting', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('escapes unsafe HTML characters without double-escaping existing entities and converts paragraphs and line breaks', () => {
      const input =
        "Dear Sean O&#39;Connor &amp; Family,\n\nWe're thrilled for Sarah & Dan's ceremony <Main Hall>!\nShuttle departs at 4:30 PM.\r\n\r\nWarmly,\r\nThe Couple";

      const formatted = formatEmailHtmlBody(input);

      expect(formatted).toBe(
        '<p>Dear Sean O&#39;Connor &amp; Family,</p>' +
          '<p>We&#39;re thrilled for Sarah &amp; Dan&#39;s ceremony &lt;Main Hall&gt;!<br />Shuttle departs at 4:30 PM.</p>' +
          '<p>Warmly,<br />The Couple</p>'
      );
      expect(formatted).not.toContain('&amp;#39;');
      expect(formatted).not.toContain('&amp;amp;');
      expect(formatted).not.toContain('<Main Hall>');
    });

    it('sends escaped paragraph-formatted HTML in Resend and SendGrid email payloads', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        text: async () => '',
      });
      global.fetch = fetchMock as any;

      const rawBody =
        'Hi O\'Connor & Friends,\n\n Ceremony starts <4pm>!\nBring umbrella.';
      const expectedHtml =
        '<p>Hi O&#39;Connor &amp; Friends,</p><p> Ceremony starts &lt;4pm&gt;!<br />Bring umbrella.</p>';

      const resendProvider = new MultiChannelMessagingProvider({
        emailProvider: 'resend',
        resendApiKey: 're_test_123',
        resendFrom: 'hosts@wedding.example',
      });
      const resendRes = await resendProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'Schedule Update',
        body: rawBody,
      });
      expect(resendRes.success).toBe(true);
      const resendPayload = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(resendPayload.html).toBe(expectedHtml);

      const sendgridProvider = new MultiChannelMessagingProvider({
        emailProvider: 'sendgrid',
        sendgridApiKey: 'SG.test_123',
        sendgridFrom: 'hosts@wedding.example',
      });
      const sendgridRes = await sendgridProvider.sendEmail({
        to: 'guest@example.com',
        subject: 'Schedule Update',
        body: rawBody,
      });
      expect(sendgridRes.success).toBe(true);
      const sendgridPayload = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(sendgridPayload.content).toEqual([
        { type: 'text/html', value: expectedHtml },
      ]);
    });
  });
});
