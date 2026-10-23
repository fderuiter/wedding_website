import { BroadcastTemplateContext } from './types';

/**
 * Replaces dynamic placeholders in a message template string.
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
  context: BroadcastTemplateContext
): string {
  if (!template) return '';

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const trimmedKey = key.trim();
    if (trimmedKey === 'code' || trimmedKey === 'invitationCode') {
      return context.invitationCode || '';
    }
    if (trimmedKey in context && context[trimmedKey] !== undefined && context[trimmedKey] !== null) {
      return String(context[trimmedKey]);
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
