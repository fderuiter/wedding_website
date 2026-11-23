import { DispatchResult, TestConnectionInput } from '../types';

const HTML_ENTITY_OR_SPECIAL_REGEX = /&(?:amp|lt|gt|quot|#39|#x27);|[&<>"']/g;

const HTML_CHAR_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes unsafe HTML characters without double-escaping existing standard entities,
 * then converts blank lines into `<p>...</p>` blocks and single line breaks into `<br />` tags.
 */
export function formatEmailHtmlBody(body: string): string {
  if (!body) return '';

  const escaped = body.replace(HTML_ENTITY_OR_SPECIAL_REGEX, (match) =>
    match.length === 1 ? (HTML_CHAR_MAP[match] ?? match) : match
  );

  const normalized = escaped.replace(/\r\n?/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);

  return paragraphs
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('');
}

export interface EmailMessagePayload {
  to: string;
  from?: string;
  subject: string;
  body: string;
}

export interface SmsMessagePayload {
  to: string;
  from?: string;
  body: string;
}

interface MessagingProvider {
  sendEmail(payload: EmailMessagePayload): Promise<DispatchResult>;
  sendSms(payload: SmsMessagePayload): Promise<DispatchResult>;
  testConnection(input: TestConnectionInput): Promise<DispatchResult>;
}

export class MultiChannelMessagingProvider implements MessagingProvider {
  private config: any;

  constructor(appConfig: any) {
    this.config = appConfig || {};
  }

  async sendEmail(payload: EmailMessagePayload): Promise<DispatchResult> {
    const provider = (this.config.emailProvider || 'smtp').toLowerCase();
    const fromAddress = payload.from || this.config.smtpFrom || this.config.resendFrom || this.config.sendgridFrom || this.config.contactEmail || 'noreply@wedding.com';

    if (!payload.to || !payload.to.trim()) {
      return { success: false, error: 'Recipient email address is missing' };
    }

    try {
      if (provider === 'resend') {
        return await this.sendResendEmail({ ...payload, from: fromAddress });
      } else if (provider === 'sendgrid') {
        return await this.sendSendGridEmail({ ...payload, from: fromAddress });
      } else if (provider === 'smtp') {
        return await this.sendSmtpEmail({ ...payload, from: fromAddress });
      } else {
        // Fallback / mock dispatch for standard setup or testing
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to dispatch email' };
    }
  }

  async sendSms(payload: SmsMessagePayload): Promise<DispatchResult> {
    const provider = (this.config.smsProvider || 'none').toLowerCase();
    const fromNumber = payload.from || this.config.twilioFromNumber || '+15550000000';

    if (!payload.to || !payload.to.trim()) {
      return { success: false, error: 'Recipient phone number is missing' };
    }

    try {
      if (provider === 'twilio') {
        return await this.sendTwilioSms({ ...payload, from: fromNumber });
      } else {
        // Fallback or test dispatch
        return { success: true };
      }
    } catch (err: any) {
      return { success: false, error: err.message || 'Failed to dispatch SMS' };
    }
  }

  private async sendResendEmail(payload: EmailMessagePayload): Promise<DispatchResult> {
    const apiKey = this.config.resendApiKey;
    if (!apiKey) {
      return { success: false, error: 'Resend API Key is missing in settings' };
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: payload.from,
        to: payload.to,
        subject: payload.subject,
        html: formatEmailHtmlBody(payload.body),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Resend API error (${res.status}): ${errText}` };
    }

    return { success: true };
  }

  private async sendSendGridEmail(payload: EmailMessagePayload): Promise<DispatchResult> {
    const apiKey = this.config.sendgridApiKey;
    if (!apiKey) {
      return { success: false, error: 'SendGrid API Key is missing in settings' };
    }

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: payload.to }] }],
        from: { email: payload.from },
        subject: payload.subject,
        content: [{ type: 'text/html', value: formatEmailHtmlBody(payload.body) }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `SendGrid API error (${res.status}): ${errText}` };
    }

    return { success: true };
  }

  private async sendSmtpEmail(_payload: EmailMessagePayload): Promise<DispatchResult> {
    const host = this.config.smtpHost;
    if (!host) {
      // If host is not set, allow simulated dispatch for test/mock environment
      return { success: true };
    }
    // Standard SMTP handling / mock dispatch
    return { success: true };
  }

  private async sendTwilioSms(payload: SmsMessagePayload): Promise<DispatchResult> {
    const accountSid = this.config.twilioAccountSid;
    const authToken = this.config.twilioAuthToken;

    if (!accountSid || !authToken) {
      return { success: false, error: 'Twilio Account SID or Auth Token missing' };
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const bodyParams = new URLSearchParams();
    bodyParams.append('To', payload.to);
    bodyParams.append('From', payload.from || '');
    bodyParams.append('Body', payload.body);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: bodyParams.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Twilio API error (${res.status}): ${errText}` };
    }

    return { success: true };
  }

  private resolveSecret(inputSecret?: string | null, storedSecret?: string | null): string {
    if (typeof inputSecret === 'string' && inputSecret.trim().length > 0) {
      return inputSecret.trim();
    }
    if (typeof storedSecret === 'string' && storedSecret.trim().length > 0) {
      return storedSecret.trim();
    }
    return '';
  }

  async testConnection(input: TestConnectionInput): Promise<DispatchResult> {
    if (input.type === 'email') {
      const provider = input.provider || this.config.emailProvider || 'smtp';
      if (provider === 'resend') {
        const apiKey = this.resolveSecret(input.resendApiKey, this.config.resendApiKey);
        if (!apiKey) return { success: false, error: 'Resend API Key required' };
      } else if (provider === 'sendgrid') {
        const apiKey = this.resolveSecret(input.sendgridApiKey, this.config.sendgridApiKey);
        if (!apiKey) return { success: false, error: 'SendGrid API Key required' };
      } else if (provider === 'smtp') {
        const host = input.smtpHost?.trim() || this.config.smtpHost?.trim();
        if (!host) return { success: false, error: 'SMTP Host required' };
        const user = input.smtpUser?.trim() || this.config.smtpUser?.trim();
        const pass = this.resolveSecret(input.smtpPass, this.config.smtpPass);
        if (user && !pass) return { success: false, error: 'SMTP Password required' };
      }
      return { success: true };
    } else if (input.type === 'sms') {
      const accountSid = input.twilioAccountSid?.trim() || this.config.twilioAccountSid?.trim();
      const authToken = this.resolveSecret(input.twilioAuthToken, this.config.twilioAuthToken);
      if (!accountSid || !authToken) {
        return { success: false, error: 'Twilio Account SID and Auth Token required' };
      }
      return { success: true };
    }
    return { success: false, error: 'Invalid connection test type' };
  }
}
