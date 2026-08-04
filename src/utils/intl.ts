/**
 * Formats a numeric value as a currency string using Intl.NumberFormat.
 * @param value The amount to format.
 * @param currency The currency code (default: 'USD').
 * @param locale The locale (default: 'en-US' if no global configuration exists).
 * @returns Formatted currency string.
 */
export function formatCurrency(value: number | string, currency: string = 'USD', locale: string = 'en-US'): string {
  if (typeof value === 'string') {
    const num = Number(value);
    if (isNaN(num)) {
      return value;
    }
    value = num;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' },
  locale: string = 'en-US'
): string {
  if (date === 'Anonymous' || date === 'Masked') {
    return String(date);
  }
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    return String(date);
  }
  return new Intl.DateTimeFormat(locale, options).format(d);
}
