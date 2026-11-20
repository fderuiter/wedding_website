export const RSVP_GRACE_PERIOD_HOURS_OPTIONS = [0, 12, 24, 48, 72, 168] as const;

export type RsvpGracePeriodHours = (typeof RSVP_GRACE_PERIOD_HOURS_OPTIONS)[number];

export const DEFAULT_RSVP_CLOSED_MESSAGE =
  'Online RSVPs are now closed. Please contact the hosts directly if your plans or dietary needs have changed.';

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Sanitizes custom RSVP closing messages by iteratively stripping control characters,
 * HTML tags, dangerous URI schemes (`javascript:`, `data:`, `vbscript:`), and angle brackets.
 */
export function sanitizeRsvpClosedMessage(value?: string | null, maxLength = 500): string {
  if (!value || typeof value !== 'string') return '';

  let sanitized = value
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, '');

  let previous: string;
  do {
    previous = sanitized;
    sanitized = sanitized.replace(/<\/?[a-zA-Z!?][^<>@]*>/g, '');
  } while (sanitized !== previous);

  do {
    previous = sanitized;
    sanitized = sanitized.replace(/\b(?:javascript|data|vbscript)\s*:/gi, '');
  } while (sanitized !== previous);

  return sanitized
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLength);
}

/**
 * Validates that a string is a real calendar date in `YYYY-MM-DD` format.
 */
export function isValidRsvpDeadlineDate(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false;
  const match = DATE_ONLY_REGEX.exec(value.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Validates whether a number is one of the allowed grace-period hour presets.
 */
export function isValidRsvpGracePeriodHours(value: unknown): value is RsvpGracePeriodHours {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    (RSVP_GRACE_PERIOD_HOURS_OPTIONS as readonly number[]).includes(value)
  );
}

/**
 * Resolves a safe IANA timezone identifier, falling back to `UTC` if invalid or omitted.
 */
export function resolveValidTimezone(timeZone?: string | null): string {
  if (!timeZone || typeof timeZone !== 'string') return 'UTC';
  const trimmed = timeZone.trim();
  if (!trimmed) return 'UTC';
  if (trimmed === 'UTC' || trimmed === 'GMT') return trimmed;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return trimmed;
  } catch {
    return 'UTC';
  }
}

/**
 * Formats a `YYYY-MM-DD` cutoff date as a human-readable date string (e.g. `August 15, 2026`)
 * anchored at UTC noon so local/server timezones never shift the calendar day.
 */
export function formatRsvpDeadlineDate(dateStr?: string | null): string | null {
  if (!dateStr || !isValidRsvpDeadlineDate(dateStr)) return null;
  const match = DATE_ONLY_REGEX.exec(dateStr.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));

  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utcNoon);
}

/**
 * Computes the exact UTC epoch timestamp (in milliseconds) for midnight at the end of
 * `dateStr` (`00:00:00.000` of the following calendar day) in the venue's IANA timezone.
 */
export function getVenueMidnightCutoffUtcMs(
  dateStr?: string | null,
  timeZone?: string | null
): number | null {
  if (!dateStr || !isValidRsvpDeadlineDate(dateStr)) return null;
  const match = DATE_ONLY_REGEX.exec(dateStr.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const safeTz = resolveValidTimezone(timeZone);

  // Midnight closing `YYYY-MM-DD` corresponds to 00:00:00.000 of the next calendar day in `safeTz`
  const nextDayUtc = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0, 0));
  const targetYear = nextDayUtc.getUTCFullYear();
  const targetMonth = nextDayUtc.getUTCMonth() + 1;
  const targetDay = nextDayUtc.getUTCDate();
  const targetLocalAsUtcMs = Date.UTC(targetYear, targetMonth - 1, targetDay, 0, 0, 0, 0);

  if (safeTz === 'UTC' || safeTz === 'GMT') {
    return targetLocalAsUtcMs;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  let guessMs = targetLocalAsUtcMs;
  for (let i = 0; i < 3; i += 1) {
    const parts = formatter.formatToParts(new Date(guessMs));
    const partMap: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        partMap[part.type] = Number(part.value);
      }
    }
    const localHour = partMap.hour === 24 ? 0 : (partMap.hour ?? 0);
    const localAsUtcMs = Date.UTC(
      partMap.year,
      (partMap.month ?? 1) - 1,
      partMap.day ?? 1,
      localHour,
      partMap.minute ?? 0,
      partMap.second ?? 0,
      0
    );
    const offsetMs = localAsUtcMs - guessMs;
    const nextGuessMs = targetLocalAsUtcMs - offsetMs;
    if (nextGuessMs === guessMs) break;
    guessMs = nextGuessMs;
  }

  return guessMs;
}

export interface RsvpCutoffConfigInput {
  rsvpOpen?: boolean | null;
  rsvpDeadlineDate?: string | null;
  rsvpGracePeriodHours?: number | null;
  rsvpClosedMessage?: string | null;
  timezone?: string | null;
}

export interface RsvpCutoffEvaluation {
  isOpen: boolean;
  isManuallyLocked: boolean;
  isPastDeadline: boolean;
  isInGraceWindow: boolean;
  deadlineDate: string | null;
  formattedDeadline: string | null;
  timezone: string;
  closedMessage: string;
}

/**
 * Evaluates whether online RSVPs are currently open using the server clock (`now`),
 * manual open toggle (`rsvpOpen`), global cutoff date (`rsvpDeadlineDate`) in the
 * venue's IANA timezone, and silent grace period (`rsvpGracePeriodHours`).
 */
export function evaluateRsvpCutoff(
  config?: RsvpCutoffConfigInput | null,
  now: Date = new Date()
): RsvpCutoffEvaluation {
  const isManuallyLocked = config?.rsvpOpen === false;
  const timezone = resolveValidTimezone(config?.timezone);
  const rawDeadline = typeof config?.rsvpDeadlineDate === 'string' ? config.rsvpDeadlineDate.trim() : '';
  const deadlineDate = isValidRsvpDeadlineDate(rawDeadline) ? rawDeadline : null;
  const formattedDeadline = formatRsvpDeadlineDate(deadlineDate);

  const sanitizedCustomMessage = sanitizeRsvpClosedMessage(config?.rsvpClosedMessage);
  const closedMessage = sanitizedCustomMessage || DEFAULT_RSVP_CLOSED_MESSAGE;

  const graceHours = isValidRsvpGracePeriodHours(config?.rsvpGracePeriodHours)
    ? config.rsvpGracePeriodHours
    : 0;

  const midnightCutoffMs = deadlineDate ? getVenueMidnightCutoffUtcMs(deadlineDate, timezone) : null;
  const nowMs = now.getTime();

  let isPastDeadline = false;
  let isInGraceWindow = false;
  let isPastGraceWindow = false;

  if (midnightCutoffMs !== null) {
    const effectiveCloseMs = midnightCutoffMs + graceHours * 3_600_000;
    isPastDeadline = nowMs >= midnightCutoffMs;
    isPastGraceWindow = nowMs >= effectiveCloseMs;
    isInGraceWindow = !isManuallyLocked && isPastDeadline && !isPastGraceWindow;
  }

  const isOpen = !isManuallyLocked && !isPastGraceWindow;

  return {
    isOpen,
    isManuallyLocked,
    isPastDeadline,
    isInGraceWindow,
    deadlineDate,
    formattedDeadline,
    timezone,
    closedMessage,
  };
}
