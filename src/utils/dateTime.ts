/**
 * Stateless utilities for converting, validating, and formatting schedule timestamps.
 */

export function toDateTimeLocalValue(value?: string | Date | null): string {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocalValue(value?: string | null): string | null {
  if (!value || !value.trim()) return null;
  const date = new Date(value.trim());
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
  endTime?: string | Date | null
): string | null {
  const start = startTime ? (startTime instanceof Date ? startTime : new Date(startTime)) : null;
  const end = endTime ? (endTime instanceof Date ? endTime : new Date(endTime)) : null;

  const validStart = start && !Number.isNaN(start.getTime()) ? start : null;
  const validEnd = end && !Number.isNaN(end.getTime()) ? end : null;

  if (!validStart && !validEnd) return null;

  const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  const timeOnlyFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });

  if (validStart && validEnd) {
    const sameDay =
      validStart.getFullYear() === validEnd.getFullYear() &&
      validStart.getMonth() === validEnd.getMonth() &&
      validStart.getDate() === validEnd.getDate();

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
