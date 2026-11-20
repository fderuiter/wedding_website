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
 * Replaces dynamic placeholders in a message template string.
 * Returns readable, unescaped strings by default (for live UI previews and SMS plain text)
 * and escapes HTML entities only when `options.escapeHtml` is explicitly enabled.
 * Supports:
 * - {{guestName}}
 * - {{invitationCode}} or {{code}}
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
  { placeholder: '{{householdName}}', label: 'Household Name', description: 'Family or party household' },
  { placeholder: '{{weddingDate}}', label: 'Wedding Date', description: 'Date of the wedding event' },
  { placeholder: '{{venueName}}', label: 'Venue Name', description: 'Name of the wedding venue' },
];
