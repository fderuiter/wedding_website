/**
 * Stateless utilities for converting, validating, and formatting schedule timestamps.
 */

interface ZonedWallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function isValidIanaTimeZone(timeZone?: string | null): timeZone is string {
  if (!timeZone || typeof timeZone !== 'string' || !timeZone.trim()) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

function getZonedWallParts(date: Date, timeZone: string): ZonedWallClockParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const getNum = (type: string): number => {
    const val = parts.find((p) => p.type === type)?.value;
    return val ? Number.parseInt(val, 10) : 0;
  };

  const rawHour = getNum('hour');
  return {
    year: getNum('year'),
    month: getNum('month'),
    day: getNum('day'),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: getNum('minute'),
    second: getNum('second'),
  };
}

export function toDateTimeLocalValue(
  value?: string | Date | null,
  timeZone?: string | null
): string {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');

  if (isValidIanaTimeZone(timeZone)) {
    const parts = getZonedWallParts(date, timeZone.trim());
    return `${String(parts.year).padStart(4, '0')}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
  }

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(
  value?: string | null,
  timeZone?: string | null
): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();

  const localMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (localMatch && isValidIanaTimeZone(timeZone)) {
    const year = Number.parseInt(localMatch[1], 10);
    const month = Number.parseInt(localMatch[2], 10);
    const day = Number.parseInt(localMatch[3], 10);
    const hour = Number.parseInt(localMatch[4], 10);
    const minute = Number.parseInt(localMatch[5], 10);
    const second = localMatch[6] ? Number.parseInt(localMatch[6], 10) : 0;

    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour < 0 ||
      hour > 23 ||
      minute < 0 ||
      minute > 59 ||
      second < 0 ||
      second > 59
    ) {
      return null;
    }

    const calendarCheck = new Date(Date.UTC(year, month - 1, day));
    if (
      calendarCheck.getUTCFullYear() !== year ||
      calendarCheck.getUTCMonth() !== month - 1 ||
      calendarCheck.getUTCDate() !== day
    ) {
      return null;
    }

    const tz = timeZone.trim();
    const targetUtcLike = Date.UTC(year, month - 1, day, hour, minute, second);
    let guessMs = targetUtcLike;

    for (let i = 0; i < 3; i++) {
      const rendered = getZonedWallParts(new Date(guessMs), tz);
      const renderedUtcLike = Date.UTC(
        rendered.year,
        rendered.month - 1,
        rendered.day,
        rendered.hour,
        rendered.minute,
        rendered.second
      );
      const diff = targetUtcLike - renderedUtcLike;
      if (diff === 0) break;
      guessMs += diff;
    }

    return new Date(guessMs).toISOString();
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isEndTimeBeforeStartTime(
  startTime?: string | Date | null,
  endTime?: string | Date | null
): boolean {
  if (!startTime || !endTime) return false;
  const startStr = typeof startTime === 'string' ? startTime.trim() : startTime;
  const endStr = typeof endTime === 'string' ? endTime.trim() : endTime;
  if (!startStr || !endStr) return false;

  const startMs = (startStr instanceof Date ? startStr : new Date(startStr)).getTime();
  const endMs = (endStr instanceof Date ? endStr : new Date(endStr)).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;

  return endMs < startMs;
}

export function formatSubEventSchedule(
  startTime?: string | Date | null,
  endTime?: string | Date | null,
  timeZone?: string | null
): string | null {
  const tz = isValidIanaTimeZone(timeZone) ? timeZone.trim() : undefined;

  const parseValue = (raw?: string | Date | null): Date | null => {
    if (!raw) return null;
    if (raw instanceof Date) {
      return Number.isNaN(raw.getTime()) ? null : raw;
    }
    if (tz && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw.trim())) {
      const converted = fromDateTimeLocalValue(raw, tz);
      if (converted) {
        const d = new Date(converted);
        return Number.isNaN(d.getTime()) ? null : d;
      }
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const validStart = parseValue(startTime);
  const validEnd = parseValue(endTime);

  if (!validStart && !validEnd) return null;

  const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });

  const timeOnlyFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(tz ? { timeZone: tz } : {}),
  });

  if (validStart && validEnd) {
    let sameDay: boolean;
    if (tz) {
      const startParts = getZonedWallParts(validStart, tz);
      const endParts = getZonedWallParts(validEnd, tz);
      sameDay =
        startParts.year === endParts.year &&
        startParts.month === endParts.month &&
        startParts.day === endParts.day;
    } else {
      sameDay =
        validStart.getFullYear() === validEnd.getFullYear() &&
        validStart.getMonth() === validEnd.getMonth() &&
        validStart.getDate() === validEnd.getDate();
    }

    if (sameDay) {
      return `${dateTimeFmt.format(validStart)} – ${timeOnlyFmt.format(validEnd)}`;
    }
    return `${dateTimeFmt.format(validStart)} – ${dateTimeFmt.format(validEnd)}`;
  }

  if (validStart) {
    return dateTimeFmt.format(validStart);
  }

  return `Until ${dateTimeFmt.format(validEnd!)}`;
}

export function formatFriendlyTimezone(
  timeZone?: string | null,
  referenceDate: Date = new Date()
): string {
  const raw = typeof timeZone === 'string' && timeZone.trim() ? timeZone.trim() : 'America/Chicago';
  const upper = raw.toUpperCase();
  if (upper === 'UTC' || upper === 'ETC/UTC' || upper === 'GMT' || upper === 'ETC/GMT') {
    return 'Coordinated Universal Time (UTC)';
  }

  if (!isValidIanaTimeZone(raw)) {
    return raw;
  }

  const ref = Number.isNaN(referenceDate.getTime()) ? new Date() : referenceDate;

  const extractTzName = (style: 'longGeneric' | 'shortGeneric' | 'short'): string => {
    try {
      const part = new Intl.DateTimeFormat('en-US', {
        timeZone: raw,
        timeZoneName: style,
      })
        .formatToParts(ref)
        .find((p) => p.type === 'timeZoneName')?.value;
      return part ? part.trim() : '';
    } catch {
      return '';
    }
  };

  const longGeneric = extractTzName('longGeneric') || raw;
  const shortGeneric = extractTzName('shortGeneric');
  const shortSpecific = extractTzName('short');

  let abbr = '';
  if (
    shortGeneric &&
    !shortGeneric.includes(' ') &&
    shortGeneric.length <= 6 &&
    shortGeneric !== longGeneric
  ) {
    abbr = shortGeneric;
  } else if (shortSpecific && shortSpecific !== longGeneric) {
    abbr = shortSpecific;
  }

  return abbr ? `${longGeneric} (${abbr})` : longGeneric;
}
