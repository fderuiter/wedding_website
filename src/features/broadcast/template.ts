import {
  CalendarEvent,
  createGoogleCalendarLink,
  createOutlookCalendarLink,
  createYahooCalendarLink,
} from '@/utils/calendar';
import { sanitizeUrl } from '@/utils/validationPrimitives';
import { BroadcastTemplateContext } from './types';

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const STATIONERY_CARD_DIRECTIVE_REGEX = /^\s*\[CARD:(save-the-date|formal-invitation)\]\s*/i;
const SAFE_HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const HTML_ENTITY_OR_SPECIAL_CHAR_REGEX = /&(?:amp|lt|gt|quot|#39|#x27);|[&<>"']/g;

type StationeryCardVariant = 'save-the-date' | 'formal-invitation';

export interface StationeryCardConfig {
  partner1Name?: string | null;
  partner2Name?: string | null;
  brideName?: string | null;
  groomName?: string | null;
  brandMonogram?: string | null;
  heroTitle?: string | null;
  colorPrimary?: string | null;
  colorSecondary?: string | null;
  themePrimary?: string | null;
  themeSecondary?: string | null;
  weddingDate?: Date | string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  venueCity?: string | null;
  venueState?: string | null;
  timezone?: string | null;
  baseUrl?: string | null;
  rsvpUrl?: string | null;
}

/**
 * Escapes HTML special characters (&, <, >, ", ') to prevent XSS in HTML email bodies.
 */
export function escapeHtmlEntities(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function escapePreservingStandardEntities(value: string): string {
  return value.replace(HTML_ENTITY_OR_SPECIAL_CHAR_REGEX, (match) =>
    match.length === 1 ? (HTML_ESCAPE_MAP[match] ?? match) : match
  );
}

function unescapeStandardEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'");
}

/**
 * Strips CR, LF, and angle brackets from rendered email subjects so plain-text subjects stay safe.
 */
export function sanitizeEmailSubject(subject: string): string {
  return subject.replace(/[\r\n<>]/g, '');
}

function sanitizeBaseOriginUrl(baseUrl: string | null | undefined): string {
  const sanitized = sanitizeUrl(baseUrl);
  if (!sanitized) {
    return '';
  }
  try {
    const parsed = new URL(sanitized);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname)
    ) {
      return sanitized.replace(/\/+$/, '');
    }
  } catch {
    return '';
  }
  return '';
}

/**
 * Constructs a personalized one-click guest RSVP & address portal URL matching InvitationQRPreviewModal.
 */
export function buildGuestRsvpUrl(
  baseUrl: string | null | undefined,
  code: string | null | undefined
): string {
  const normalizedBase = sanitizeBaseOriginUrl(baseUrl);
  const encodedCode = encodeURIComponent(code || '');
  return `${normalizedBase}/guest?code=${encodedCode}`;
}

export function parseStationeryCardDirective(
  body: string
): { variant: StationeryCardVariant; content: string } | null {
  if (!body) return null;
  const match = body.match(STATIONERY_CARD_DIRECTIVE_REGEX);
  if (!match) return null;
  const variant = match[1].toLowerCase() as StationeryCardVariant;
  const content = body.slice(match[0].length);
  return { variant, content };
}

export function isStationeryCardBody(body: string): boolean {
  return Boolean(body && STATIONERY_CARD_DIRECTIVE_REGEX.test(body));
}

export function stripStationeryCardDirective(body: string): string {
  if (!body) return '';
  return body.replace(STATIONERY_CARD_DIRECTIVE_REGEX, '');
}

function normalizeHexColor(candidate: string | null | undefined, fallback: string): string {
  const trimmed = (candidate || '').trim();
  if (!SAFE_HEX_COLOR_REGEX.test(trimmed)) {
    return fallback;
  }
  if (trimmed.length === 4) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return trimmed.toUpperCase();
}

function pickReadableButtonTextColor(hexBg: string): string {
  const normalized = normalizeHexColor(hexBg, '#9F1239');
  const r = parseInt(normalized.slice(1, 3), 16) / 255;
  const g = parseInt(normalized.slice(3, 5), 16) / 255;
  const b = parseInt(normalized.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.179 ? '#111827' : '#FFFFFF';
}

function resolveCoupleBranding(config?: StationeryCardConfig | null): {
  coupleNames: string;
  monogram: string;
} {
  const p1 = (config?.partner1Name || config?.brideName || '').trim();
  const p2 = (config?.partner2Name || config?.groomName || '').trim();
  const heroTitle = (config?.heroTitle || '').trim();

  const coupleNames =
    p1 && p2
      ? `${p1} & ${p2}`
      : p1 || p2 || heroTitle || 'Our Wedding Celebration';

  const explicitMonogram = (config?.brandMonogram || '').trim();
  const monogram =
    explicitMonogram ||
    (p1 && p2 ? `${p1.charAt(0).toUpperCase()} & ${p2.charAt(0).toUpperCase()}` : 'W');

  return { coupleNames, monogram };
}

function resolveWeddingDateParts(rawDate?: Date | string | null): {
  displayDate: string;
  isoDate: string;
} {
  if (!rawDate) {
    return { displayDate: '', isoDate: '2026-10-25' };
  }

  if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate.trim())) {
    const iso = rawDate.trim();
    const [year, month, day] = iso.split('-').map(Number);
    const utcDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    const display = utcDate.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    });
    return { displayDate: display, isoDate: iso };
  }

  const parsed = rawDate instanceof Date ? rawDate : new Date(rawDate);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    const display =
      typeof rawDate === 'string' && /^[A-Za-z]+ \d{1,2}, \d{4}$/.test(rawDate.trim())
        ? rawDate.trim()
        : parsed.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        });
    return { displayDate: display, isoDate: `${year}-${month}-${day}` };
  }

  return {
    displayDate: typeof rawDate === 'string' ? rawDate.trim() : '',
    isoDate: '2026-10-25',
  };
}

function extractCardRsvpUrl(
  content: string,
  config?: StationeryCardConfig | null
): { rsvpUrl: string; cleanedParagraphs: string[] } {
  const unescaped = unescapeStandardEntities(content);
  const urlMatch =
    unescaped.match(/https?:\/\/[^\s<>"']+/i) ||
    unescaped.match(/\/guest\?code=[^\s<>"']*/i);

  let rawCandidateUrl = '';
  if (urlMatch) {
    rawCandidateUrl = urlMatch[0].replace(/[.,;!?)]+$/, '');
  } else if (config?.rsvpUrl) {
    rawCandidateUrl = config.rsvpUrl.trim();
  } else if (config?.baseUrl) {
    const safeBase = sanitizeBaseOriginUrl(config.baseUrl);
    rawCandidateUrl = safeBase ? `${safeBase}/guest` : '/guest';
  } else {
    rawCandidateUrl = '/guest';
  }
  const rsvpUrl = sanitizeUrl(rawCandidateUrl) ?? '/guest';

  const normalized = content.replace(/\r\n?/g, '\n');
  const rawParagraphs = normalized
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const cleanedParagraphs = rawParagraphs.filter((paragraph) => {
    const plain = unescapeStandardEntities(paragraph).trim();
    if (
      plain === rsvpUrl ||
      (rawCandidateUrl && plain === rawCandidateUrl) ||
      plain === '{{rsvpUrl}}'
    ) {
      return false;
    }
    return true;
  });

  return {
    rsvpUrl,
    cleanedParagraphs: cleanedParagraphs.length > 0 ? cleanedParagraphs : rawParagraphs,
  };
}

export function renderStationeryCardHtml(
  variant: StationeryCardVariant,
  content: string,
  config?: StationeryCardConfig | null
): string {
  const primaryColor = normalizeHexColor(
    config?.colorPrimary ?? config?.themePrimary,
    '#9F1239'
  );
  const secondaryColor = normalizeHexColor(
    config?.colorSecondary ?? config?.themeSecondary,
    '#B45309'
  );
  const ctaTextColor = pickReadableButtonTextColor(primaryColor);
  const { coupleNames, monogram } = resolveCoupleBranding(config);
  const { displayDate, isoDate } = resolveWeddingDateParts(config?.weddingDate);

  const venueParts = [
    config?.venueName,
    config?.venueAddress,
    config?.venueCity,
    config?.venueState,
  ]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean);
  const venueDisplay = venueParts.join(', ');
  const venueHeadline = (config?.venueName || '').trim();
  const venueSubline = [config?.venueAddress, config?.venueCity, config?.venueState]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(', ');

  const { rsvpUrl, cleanedParagraphs } = extractCardRsvpUrl(content, config);

  const calendarEvent: CalendarEvent = {
    name: `${unescapeStandardEntities(coupleNames)} — Wedding Celebration`,
    startDate: isoDate,
    startTime: '16:00',
    endDate: isoDate,
    endTime: '22:00',
    timeZone: (config?.timezone || 'UTC').trim() || 'UTC',
    location: venueDisplay || venueHeadline || 'Wedding Venue',
    description: `Wedding celebration for ${unescapeStandardEntities(coupleNames)}. View details & RSVP: ${rsvpUrl}`,
  };

  const googleCalUrl = escapeHtmlEntities(createGoogleCalendarLink(calendarEvent));
  const outlookCalUrl = escapeHtmlEntities(createOutlookCalendarLink(calendarEvent));
  const yahooCalUrl = escapeHtmlEntities(createYahooCalendarLink(calendarEvent));

  const cardBadgeLabel =
    variant === 'save-the-date' ? 'Save the Date' : 'Formal Invitation';
  const ctaLabel =
    variant === 'save-the-date'
      ? 'View Wedding Website & RSVP'
      : 'RSVP & View Invitation';

  const safeCoupleNames = escapePreservingStandardEntities(coupleNames);
  const safeMonogram = escapePreservingStandardEntities(monogram);
  const safeDisplayDate = escapePreservingStandardEntities(displayDate);
  const safeVenueHeadline = escapePreservingStandardEntities(venueHeadline);
  const safeVenueSubline = escapePreservingStandardEntities(venueSubline);
  const sanitizedCardRsvpUrl = sanitizeUrl(rsvpUrl) ?? '/guest';
  const safeRsvpUrl = escapeHtmlEntities(sanitizedCardRsvpUrl);
  const safeCtaLabel = escapeHtmlEntities(ctaLabel);

  const renderedParagraphs = cleanedParagraphs
    .map((paragraph) => {
      const escaped = escapePreservingStandardEntities(paragraph).replace(/\n/g, '<br />');
      return `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#1f2937;">${escaped}</p>`;
    })
    .join('');

  const hasEventDetails = Boolean(safeDisplayDate || safeVenueHeadline || safeVenueSubline);
  const eventDetailsBlock = hasEventDetails
    ? `<div style="margin:20px 0;padding:16px 20px;background-color:#faf7f5;border-top:1px solid ${secondaryColor};border-bottom:1px solid ${secondaryColor};text-align:center;">` +
      (safeDisplayDate
        ? `<div style="font-size:16px;font-weight:700;color:#111827;letter-spacing:0.02em;">${safeDisplayDate}</div>`
        : '') +
      (safeVenueHeadline
        ? `<div style="margin-top:4px;font-size:14px;font-weight:600;color:#374151;">${safeVenueHeadline}</div>`
        : '') +
      (safeVenueSubline
        ? `<div style="margin-top:2px;font-size:13px;color:#4b5563;">${safeVenueSubline}</div>`
        : '') +
      '</div>'
    : '';

  return (
    `<div data-stationery-card="${variant}" style="background-color:#f8f5f2;padding:28px 16px;font-family:Georgia,'Times New Roman',serif;">` +
    `<div style="max-width:560px;margin:0 auto;background-color:#ffffff;border:2px solid ${primaryColor};border-radius:14px;padding:32px 28px;box-shadow:0 6px 20px rgba(17,24,39,0.08);">` +
    '<div style="text-align:center;margin-bottom:20px;">' +
    `<div style="display:inline-block;width:48px;height:48px;line-height:44px;border-radius:9999px;border:2px solid ${secondaryColor};color:#111827;font-weight:700;font-size:15px;margin-bottom:12px;">${safeMonogram}</div>` +
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#374151;margin-bottom:6px;">${cardBadgeLabel}</div>` +
    `<h2 style="margin:0;font-size:26px;line-height:1.25;font-weight:700;color:#111827;">${safeCoupleNames}</h2>` +
    '</div>' +
    eventDetailsBlock +
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:18px 0 22px 0;">${renderedParagraphs}</div>` +
    '<div style="text-align:center;margin:24px 0 20px 0;">' +
    `<a href="${safeRsvpUrl}" style="display:inline-block;padding:13px 28px;background-color:${primaryColor};color:${ctaTextColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:9999px;letter-spacing:0.03em;">${safeCtaLabel}</a>` +
    '</div>' +
    '<div style="border-top:1px solid #e5e7eb;padding-top:16px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;font-size:12px;color:#4b5563;">' +
    '<span style="font-weight:600;color:#374151;display:block;margin-bottom:6px;">Add to Calendar</span>' +
    `<a href="${googleCalUrl}" target="_blank" rel="noopener noreferrer" style="color:#1f2937;text-decoration:underline;font-weight:600;margin:0 6px;">Google Calendar</a>` +
    '&middot;' +
    `<a href="${outlookCalUrl}" target="_blank" rel="noopener noreferrer" style="color:#1f2937;text-decoration:underline;font-weight:600;margin:0 6px;">Outlook</a>` +
    '&middot;' +
    `<a href="${yahooCalUrl}" target="_blank" rel="noopener noreferrer" style="color:#1f2937;text-decoration:underline;font-weight:600;margin:0 6px;">Yahoo Calendar</a>` +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

/**
 * Replaces dynamic placeholders in a message template string.
 * Returns readable, unescaped strings by default (for live UI previews and SMS plain text)
 * and escapes HTML entities only when `options.escapeHtml` is explicitly enabled.
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
        const resolvedUrl = sanitizeUrl(String(context.rsvpUrl)) ?? '/guest';
        return shouldEscape ? escapeHtmlEntities(resolvedUrl) : resolvedUrl;
      }
      if (context.baseUrl !== undefined && context.baseUrl !== null) {
        const computedUrl = buildGuestRsvpUrl(
          String(context.baseUrl),
          context.invitationCode ?? context.code ?? ''
        );
        const safeComputedUrl = sanitizeUrl(computedUrl) ?? '/guest';
        return shouldEscape ? escapeHtmlEntities(safeComputedUrl) : safeComputedUrl;
      }
      return match;
    }
    if (trimmedKey === 'baseUrl') {
      if (context.baseUrl !== undefined && context.baseUrl !== null) {
        const safeBaseUrl = sanitizeBaseOriginUrl(String(context.baseUrl));
        return shouldEscape ? escapeHtmlEntities(safeBaseUrl) : safeBaseUrl;
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
  id:
    | 'save-the-date'
    | 'formal-invitation'
    | 'rsvp-reminder'
    | 'final-rsvp-call'
    | 'sub-event-update'
    | 'mailing-address-request';
  label: string;
  description: string;
  subject: string;
  emailBody: string;
  smsBody: string;
}

export const BROADCAST_STARTER_TEMPLATES: BroadcastStarterTemplate[] = [
  {
    id: 'save-the-date',
    label: 'Save the Date',
    description: 'Themed digital Save-the-Date stationery card with calendar links and RSVP portal button',
    subject: 'Save the Date for {{guestName}} — {{weddingDate}}',
    emailBody:
      '[CARD:save-the-date]\nDear {{guestName}},\n\nWe are joyfully celebrating our wedding on {{weddingDate}} at {{venueName}} and would be honored to have you with us! Please save our date and visit your personal wedding portal for event details and updates:\n\n{{rsvpUrl}}',
    smsBody:
      'Save the Date, {{guestName}}! Celebrate with us on {{weddingDate}} at {{venueName}}. View event details and RSVP here: {{rsvpUrl}}',
  },
  {
    id: 'formal-invitation',
    label: 'Formal Invitation',
    description: 'Themed digital Formal Invitation stationery card with event details, calendar links, and RSVP button',
    subject: 'Formal Wedding Invitation for {{guestName}}',
    emailBody:
      '[CARD:formal-invitation]\nDear {{guestName}},\n\nTogether with our families, we joyfully invite you to celebrate our marriage on {{weddingDate}} at {{venueName}}. Kindly confirm your attendance and meal preferences using your personal invitation link:\n\n{{rsvpUrl}}',
    smsBody:
      'Formal Invitation for {{guestName}}: Join us on {{weddingDate}} at {{venueName}}! Please submit your RSVP here: {{rsvpUrl}}',
  },
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
