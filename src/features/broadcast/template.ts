import { BroadcastTemplateContext } from './types';

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtmlEntities(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

/**
 * Strips CR, LF, and angle brackets from rendered email subjects so plain-text subjects stay safe.
 */
export function sanitizeEmailSubject(subject: string): string {
  return subject.replace(/[\r\n<>]/g, '');
}

/**
 * Constructs a personalized one-click guest RSVP & address portal URL matching InvitationQRPreviewModal.
 */
export function buildGuestRsvpUrl(
  baseUrl: string | null | undefined,
  code: string | null | undefined
): string {
  const normalizedBase = (baseUrl || '').trim().replace(/\/+$/, '');
  const encodedCode = encodeURIComponent(code || '');
  return `${normalizedBase}/guest?code=${encodedCode}`;
}

/**
 * Replaces dynamic placeholders in a message template string.
 * Supports:
 * - {{guestName}}
 * - {{invitationCode}} or {{code}}
 * - {{rsvpUrl}}
 * - {{householdName}}
 * - {{weddingDate}}
 * - {{venueName}}
 * - {{plusOneName}}
 * - {{dietaryNotes}}
 */
export function renderBroadcastTemplate(
  template: string,
  context: BroadcastTemplateContext,
  options?: { escapeHtml?: boolean }
): string {
  if (!template) return '';

  const shouldEscape = Boolean(options?.escapeHtml);

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (trimmedKey === 'code' || trimmedKey === 'invitationCode') {
      const codeVal = context.invitationCode ? String(context.invitationCode) : '';
      return shouldEscape ? escapeHtmlEntities(codeVal) : codeVal;
    }
    if (trimmedKey === 'rsvpUrl') {
      if (context.rsvpUrl !== undefined && context.rsvpUrl !== null) {
        const resolvedUrl = String(context.rsvpUrl);
        return shouldEscape ? escapeHtmlEntities(resolvedUrl) : resolvedUrl;
      }
      if (context.baseUrl !== undefined && context.baseUrl !== null) {
        const computedUrl = buildGuestRsvpUrl(
          String(context.baseUrl),
          context.invitationCode ?? context.code ?? ''
        );
        return shouldEscape ? escapeHtmlEntities(computedUrl) : computedUrl;
      }
      return match;
    }
    if (trimmedKey in context && context[trimmedKey] !== undefined && context[trimmedKey] !== null) {
      const resolved = String(context[trimmedKey]);
      return shouldEscape ? escapeHtmlEntities(resolved) : resolved;
    }
    return match;
  });
}

/**
 * Returns available template placeholders with descriptions for UI assistance.
 */
export const AVAILABLE_TEMPLATE_PLACEHOLDERS = [
  { placeholder: '{{guestName}}', label: 'Guest Name', description: 'Full name of the invited guest' },
  { placeholder: '{{invitationCode}}', label: 'Invitation Code', description: 'Unique RSVP code' },
  { placeholder: '{{rsvpUrl}}', label: 'RSVP Link', description: 'Personalized one-click RSVP & guest portal URL' },
  { placeholder: '{{householdName}}', label: 'Household Name', description: 'Family or party household' },
  { placeholder: '{{weddingDate}}', label: 'Wedding Date', description: 'Date of the wedding event' },
  { placeholder: '{{venueName}}', label: 'Venue Name', description: 'Name of the wedding venue' },
];

export interface BroadcastStarterTemplate {
  id: 'rsvp-reminder' | 'final-rsvp-call' | 'sub-event-update' | 'mailing-address-request';
  label: string;
  description: string;
  subject: string;
  emailBody: string;
  smsBody: string;
}

export const BROADCAST_STARTER_TEMPLATES: BroadcastStarterTemplate[] = [
  {
    id: 'rsvp-reminder',
    label: 'RSVP Reminder',
    description: 'Friendly reminder inviting pending guests to submit their RSVP',
    subject: 'RSVP Reminder for {{guestName}}',
    emailBody:
      'Hi {{guestName}},\n\nWe are so excited to celebrate our wedding with you on {{weddingDate}} at {{venueName}}! Whenever you have a moment, please confirm your RSVP using your personal one-click link:\n\n{{rsvpUrl}}\n\nWarmly,\nYour Hosts',
    smsBody:
      'Hi {{guestName}}! Friendly reminder to submit your wedding RSVP for {{weddingDate}} using your personal link: {{rsvpUrl}}',
  },
  {
    id: 'final-rsvp-call',
    label: 'Final RSVP Call',
    description: 'Last-call message before finalizing catering and seating counts',
    subject: 'Final RSVP Call for {{guestName}}',
    emailBody:
      'Hi {{guestName}},\n\nWe are finalizing our guest headcount and seating chart for {{weddingDate}}. Please let us know if you can join us by completing your RSVP today:\n\n{{rsvpUrl}}\n\nThank you so much!',
    smsBody:
      'Final RSVP Call: Hi {{guestName}}, we are finalizing headcounts! Please submit your RSVP today: {{rsvpUrl}}',
  },
  {
    id: 'sub-event-update',
    label: 'Sub-Event Update',
    description: 'Schedule or logistics update for a rehearsal dinner, welcome party, or brunch',
    subject: 'Event Schedule Update for {{guestName}}',
    emailBody:
      'Hi {{guestName}},\n\nWe have an update regarding an upcoming wedding event on your schedule. View your latest personalized schedule and confirm your event RSVP here:\n\n{{rsvpUrl}}\n\nWe cannot wait to celebrate together!',
    smsBody:
      'Wedding Event Update for {{guestName}}: View your updated schedule and event RSVP details here: {{rsvpUrl}}',
  },
  {
    id: 'mailing-address-request',
    label: 'Mailing Address Request',
    description: 'Request current street addresses for physical invitations or thank-you cards',
    subject: 'Mailing Address Request for {{guestName}}',
    emailBody:
      'Hi {{guestName}},\n\nWe are preparing our wedding mailings and would love to confirm your current mailing address. Please enter or verify your address in one click using your personal portal link:\n\n{{rsvpUrl}}\n\nThank you!',
    smsBody:
      'Hi {{guestName}}! Could you confirm your mailing address for our wedding mailings? Update it in one click here: {{rsvpUrl}}',
  },
];
