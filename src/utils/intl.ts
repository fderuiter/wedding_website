const MAX_CACHE_SIZE = 100;

type NumberFormatFn = (value: number | bigint) => string;
type DateTimeFormatFn = (date?: Date | number) => string;

const numberFormatCache = new Map<string, Intl.NumberFormat>();
const numberFormatFnCache = new Map<string, NumberFormatFn>();

const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatFnCache = new Map<string, DateTimeFormatFn>();

let optionsLocaleCache = new WeakMap<
  object,
  Map<string, DateTimeFormatFn>
>();

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
};

function serializeOptions(options: Intl.DateTimeFormatOptions): string {
  if (!options || typeof options !== 'object') {
    return String(options);
  }
  const keys = Object.keys(options).sort();
  let str = '';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const val = (options as Record<string, unknown>)[k];
    if (val !== undefined) {
      str += `${k}:${val};`;
    }
  }
  return str;
}

function getNumberFormatFn(
  locale: string,
  currency: string
): NumberFormatFn {
  const key = `${locale}:${currency}`;
  let formatFn = numberFormatFnCache.get(key);
  if (!formatFn) {
    if (numberFormatCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = numberFormatCache.keys().next().value;
      if (oldestKey !== undefined) {
        numberFormatCache.delete(oldestKey);
        numberFormatFnCache.delete(oldestKey);
      }
    }
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatFn = formatter.format.bind(formatter);
    numberFormatCache.set(key, formatter);
    numberFormatFnCache.set(key, formatFn);
  }
  return formatFn;
}

function getDateTimeFormatFn(
  locale: string,
  options: Intl.DateTimeFormatOptions
): DateTimeFormatFn {
  if (options && typeof options === 'object') {
    const localeMap = optionsLocaleCache.get(options);
    if (localeMap) {
      const existing = localeMap.get(locale);
      if (existing) {
        return existing;
      }
    }
  }

  const serialized = serializeOptions(options);
  const key = `${locale}:${serialized}`;
  let formatFn = dateTimeFormatFnCache.get(key);
  if (!formatFn) {
    if (dateTimeFormatCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = dateTimeFormatCache.keys().next().value;
      if (oldestKey !== undefined) {
        dateTimeFormatCache.delete(oldestKey);
        dateTimeFormatFnCache.delete(oldestKey);
      }
    }
    const formatter = new Intl.DateTimeFormat(locale, options);
    formatFn = formatter.format.bind(formatter);
    dateTimeFormatCache.set(key, formatter);
    dateTimeFormatFnCache.set(key, formatFn);
  }

  if (options && typeof options === 'object') {
    let localeMap = optionsLocaleCache.get(options);
    if (!localeMap) {
      localeMap = new Map<string, DateTimeFormatFn>();
      optionsLocaleCache.set(options, localeMap);
    }
    localeMap.set(locale, formatFn);
  }

  return formatFn;
}

/**
 * Formats a numeric value as a currency string using Intl.NumberFormat.
 * @param value The amount to format.
 * @param currency The currency code (default: 'USD').
 * @param locale The locale (default: 'en-US' if no global configuration exists).
 * @returns Formatted currency string.
 */
export function formatCurrency(
  value: number | string,
  currency: string = 'USD',
  locale: string = 'en-US'
): string {
  if (typeof value === 'string') {
    const num = Number(value);
    if (num !== num) {
      return value;
    }
    value = num;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return getNumberFormatFn(locale, currency)(value);
}

/**
 * Formats a Date object or date string to a localized date string using Intl.DateTimeFormat.
 * @param date The Date object, ISO date string, or timestamp.
 * @param options Additional Intl.DateTimeFormatOptions.
 * @param locale The locale (default: 'en-US').
 * @returns Formatted date string.
 */
export function formatDate(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTIONS,
  locale: string = 'en-US'
): string {
  if (date === 'Anonymous' || date === 'Masked') {
    return String(date);
  }
  const d = date instanceof Date ? date : new Date(date);
  const time = d.getTime();
  if (time !== time) {
    return String(date);
  }
  return getDateTimeFormatFn(locale, options)(d);
}

/**
 * Clears the internal Intl caches. Useful for test isolation.
 */
export function clearIntlCaches(): void {
  numberFormatCache.clear();
  numberFormatFnCache.clear();
  dateTimeFormatCache.clear();
  dateTimeFormatFnCache.clear();
  optionsLocaleCache = new WeakMap();
}

/**
 * Returns current cache sizes. Useful for testing capacity enforcement.
 */
export function getIntlCacheSizes(): { numberFormat: number; dateTimeFormat: number } {
  return {
    numberFormat: numberFormatCache.size,
    dateTimeFormat: dateTimeFormatCache.size,
  };
}
