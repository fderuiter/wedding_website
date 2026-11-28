/**
 * Shared venue wall-clock date & ceremony start-time conversion utilities.
 *
 * Bridges `<input type="date">` (`YYYY-MM-DD`), `<input type="time">` (`HH:MM`),
 * and IANA venue timezone identifiers (`config.timezone`) with UTC `Date` instants,
 * while healing legacy `T00:00:00.000Z` UTC-midnight records without schema migrations.
 */

export const DEFAULT_CEREMONY_TIME = '16:00';

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_24H_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const LEGACY_UTC_MIDNIGHT_STRING_REGEX =
  /^\d{4}-\d{2}-\d{2}T00:00(?::00(?:\.0{1,6})?)?(?:Z|[+-]00:?00)$/i;

interface ZonedDateTimeParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

/**
 * Resolves a safe IANA timezone identifier, falling back to `fallback` (default `'UTC'`)
 * when omitted, blank, or unrecognized by ICU.
 */
export function resolveVenueTimezone(
  timeZone?: string | null,
  fallback: string = 'UTC',
): string {
  if (!timeZone || typeof timeZone !== 'string') return fallback;
  const trimmed = timeZone.trim();
  if (!trimmed) return fallback;
  if (trimmed === 'UTC' || trimmed === 'GMT') return trimmed;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return trimmed;
  } catch {
    return fallback;
  }
}

/**
 * Validates that a string is a real calendar date in `YYYY-MM-DD` format.
 */
export function isValidDateOnly(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false;
  const match = DATE_ONLY_REGEX.exec(value.trim());
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(probe.getTime()) &&
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * Validates that a string is a 24-hour `HH:MM` wall-clock time (`00:00`–`23:59`).
 */
export function isValidCeremonyTime(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false;
  return TIME_24H_REGEX.test(value.trim());
}

/**
 * Normalizes an optional ceremony time string (`HH:MM`), defaulting unset or blank inputs
 * to `DEFAULT_CEREMONY_TIME` (`'16:00'`).
 */
export function normalizeCeremonyTime(
  value?: string | null,
  fallback: string = DEFAULT_CEREMONY_TIME,
): string {
  if (!value || typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return TIME_24H_REGEX.test(trimmed) ? trimmed : fallback;
}

function isLegacyUtcMidnightDate(date: Date): boolean {
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  );
}

function getZonedDateTimeParts(
  date: Date,
  validTimeZone: string,
): ZonedDateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      lookup[part.type] = part.value;
    }
  }

  const rawHour = lookup.hour || '00';
  const normalizedHour = rawHour === '24' ? '00' : rawHour.padStart(2, '0');

  return {
    year: (lookup.year || '1970').padStart(4, '0'),
    month: (lookup.month || '01').padStart(2, '0'),
    day: (lookup.day || '01').padStart(2, '0'),
    hour: normalizedHour,
    minute: (lookup.minute || '00').padStart(2, '0'),
    second: (lookup.second || '00').padStart(2, '0'),
  };
}

function getOffsetMinutesAtInstant(instant: Date, validTimeZone: string): number {
  const parts = getZonedDateTimeParts(instant, validTimeZone);
  const wallUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const instantSecondsMs = Math.trunc(instant.getTime() / 1000) * 1000;
  return Math.round((wallUtcMs - instantSecondsMs) / 60000);
}

/**
 * Converts a local `YYYY-MM-DD` date and `HH:MM` ceremony start time in `timeZone`
 * into its exact UTC `Date` instant using DST-safe iterative offset convergence.
 */
export function resolveVenueDateTimeInstant(
  dateStr: string,
  timeStr?: string | null,
  timeZone?: string | null,
): Date | null {
  if (!isValidDateOnly(dateStr)) return null;
  const dateMatch = DATE_ONLY_REGEX.exec(dateStr.trim());
  if (!dateMatch) return null;

  const resolvedTime = normalizeCeremonyTime(timeStr, DEFAULT_CEREMONY_TIME);
  const timeMatch = TIME_24H_REGEX.exec(resolvedTime);
  if (!timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  const targetWallUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (Number.isNaN(targetWallUtcMs)) return null;

  const validTimeZone = resolveVenueTimezone(timeZone);

  const offset0 = getOffsetMinutesAtInstant(
    new Date(targetWallUtcMs),
    validTimeZone,
  );
  const candidate1Ms = targetWallUtcMs - offset0 * 60000;
  const offset1 = getOffsetMinutesAtInstant(
    new Date(candidate1Ms),
    validTimeZone,
  );
  let finalMs = targetWallUtcMs - offset1 * 60000;

  const candidateInstant = new Date(finalMs);
  if (isLegacyUtcMidnightDate(candidateInstant)) {
    // Disambiguate an explicit wall-clock ceremony instant that coincides with 00:00:00.000Z
    // (e.g. 17:00 PDT in America/Los_Angeles) from unhealed legacy date-only UTC-midnight rows.
    finalMs += 1;
  }

  return new Date(finalMs);
}

/**
 * Normalizes a wedding date input (`YYYY-MM-DD`, ISO string, or `Date`) into a venue-zoned
 * UTC `Date` instant, healing date-only strings and legacy `T00:00:00.000Z` timestamps
 * to `16:00` (or `explicitCeremonyTime` when provided) in `timeZone`.
 */
export function normalizeVenueWeddingDate(
  value: Date | string | number | null | undefined,
  timeZone?: string | null,
  explicitCeremonyTime?: string | null,
): Date | null {
  if (value === null || value === undefined || value === '') return null;

  const validTimeZone = resolveVenueTimezone(timeZone);
  const hasExplicitTime =
    typeof explicitCeremonyTime === 'string' &&
    isValidCeremonyTime(explicitCeremonyTime);
  const targetTime = hasExplicitTime
    ? explicitCeremonyTime!.trim()
    : DEFAULT_CEREMONY_TIME;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (DATE_ONLY_REGEX.test(trimmed)) {
      return resolveVenueDateTimeInstant(trimmed, targetTime, validTimeZone);
    }

    if (LEGACY_UTC_MIDNIGHT_STRING_REGEX.test(trimmed)) {
      const utcDateOnly = trimmed.slice(0, 10);
      return resolveVenueDateTimeInstant(utcDateOnly, targetTime, validTimeZone);
    }

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;

    if (hasExplicitTime) {
      const parts = getZonedDateTimeParts(parsed, validTimeZone);
      return resolveVenueDateTimeInstant(
        `${parts.year}-${parts.month}-${parts.day}`,
        targetTime,
        validTimeZone,
      );
    }

    if (isLegacyUtcMidnightDate(parsed)) {
      return new Date(parsed.getTime() + 1);
    }

    return parsed;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;

    if (isLegacyUtcMidnightDate(value)) {
      const utcDateOnly = value.toISOString().slice(0, 10);
      return resolveVenueDateTimeInstant(utcDateOnly, targetTime, validTimeZone);
    }

    if (hasExplicitTime) {
      const parts = getZonedDateTimeParts(value, validTimeZone);
      return resolveVenueDateTimeInstant(
        `${parts.year}-${parts.month}-${parts.day}`,
        targetTime,
        validTimeZone,
      );
    }

    return new Date(value.getTime());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(value);
    return normalizeVenueWeddingDate(parsed, validTimeZone, explicitCeremonyTime);
  }

  return null;
}

/**
 * Extracts venue-localized `{ date: 'YYYY-MM-DD', time: 'HH:MM' }` fields for hydrating
 * admin `<input type="date">` and `<input type="time">` controls without UTC string slicing.
 */
export function extractVenueDateAndTime(
  value: Date | string | null | undefined,
  timeZone?: string | null,
): { date: string; time: string } {
  if (value === null || value === undefined || value === '') {
    return { date: '', time: DEFAULT_CEREMONY_TIME };
  }

  const validTimeZone = resolveVenueTimezone(timeZone);
  const normalized = normalizeVenueWeddingDate(value, validTimeZone);
  if (!normalized) {
    return { date: '', time: DEFAULT_CEREMONY_TIME };
  }

  const parts = getZonedDateTimeParts(normalized, validTimeZone);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/**
 * Formats a wedding date in `timeZone` (healing legacy `T00:00:00.000Z` records first).
 * Returns `''` when `value` is empty or invalid.
 */
export function formatVenueWeddingDate(
  value: Date | string | null | undefined,
  timeZone?: string | null,
  options: Intl.DateTimeFormatOptions = {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  },
): string {
  const validTimeZone = resolveVenueTimezone(timeZone);
  const normalized = normalizeVenueWeddingDate(value, validTimeZone);
  if (!normalized) return '';

  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: validTimeZone,
  }).format(normalized);
}

/**
 * Builds a live human-readable confirmation string for admin date/time/timezone controls,
 * e.g. `"Sunday, June 20, 2027 at 4:00 PM CDT (America/Chicago)"`.
 */
export function formatVenueCeremonyConfirmation(
  dateStr?: string | null,
  timeStr?: string | null,
  timeZone?: string | null,
): string | null {
  if (!dateStr || !isValidDateOnly(dateStr)) return null;

  const validTimeZone = resolveVenueTimezone(timeZone, 'America/Chicago');
  const resolvedTime = normalizeCeremonyTime(timeStr, DEFAULT_CEREMONY_TIME);
  const instant = resolveVenueDateTimeInstant(
    dateStr.trim(),
    resolvedTime,
    validTimeZone,
  );
  if (!instant) return null;

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: validTimeZone,
  }).format(instant);

  const formattedTime = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: validTimeZone,
  }).format(instant);

  const tzSuffix =
    validTimeZone === 'UTC' || validTimeZone === 'GMT'
      ? ''
      : ` (${validTimeZone})`;

  return `${formattedDate} at ${formattedTime}${tzSuffix}`;
}

/**
 * Subtracts `days` from a `YYYY-MM-DD` calendar date string using pure UTC calendar
 * arithmetic so venue timezone offsets are never applied a second time.
 */
export function subtractCalendarDays(
  dateOnlyStr: string,
  days: number,
): string {
  const match = DATE_ONLY_REGEX.exec(dateOnlyStr.trim());
  if (!match) return dateOnlyStr;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const shifted = new Date(Date.UTC(year, month - 1, day - days));

  const y = String(shifted.getUTCFullYear()).padStart(4, '0');
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
