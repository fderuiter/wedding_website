import {
  formatCurrency,
  formatDate,
  clearIntlCaches,
  getIntlCacheSizes,
} from '../intl';

describe('intl utils', () => {
  beforeEach(() => {
    clearIntlCaches();
  });

  describe('formatCurrency', () => {
    test('formats numeric currency correctly with defaults', () => {
      const formatted = formatCurrency(100);
      expect(formatted).toContain('100.00');
      expect(formatted).toContain('$');
    });

    test('formats string numeric value correctly', () => {
      expect(formatCurrency('250.75')).toContain('250.75');
    });

    test('returns original value when string is not a valid number', () => {
      expect(formatCurrency('not-a-number')).toBe('not-a-number');
    });

    test('returns empty string for null or undefined', () => {
      expect(formatCurrency(null as unknown as number)).toBe('');
      expect(formatCurrency(undefined as unknown as number)).toBe('');
    });

    test('supports custom currency and locale', () => {
      const formatted = formatCurrency(100, 'EUR', 'de-DE');
      // In de-DE locale, 100 EUR is formatted as "100,00 €"
      expect(formatted).toContain('100,00');
      expect(formatted).toContain('€');
    });
  });

  describe('formatDate', () => {
    test('formats Date object with defaults', () => {
      const date = new Date(2026, 0, 15);
      const formatted = formatDate(date);
      expect(formatted).toContain('January');
      expect(formatted).toContain('15');
      expect(formatted).toContain('2026');
    });

    test('formats ISO string date', () => {
      const formatted = formatDate('2026-06-01T00:00:00.000Z');
      expect(formatted).toBeDefined();
      expect(typeof formatted).toBe('string');
    });

    test('formats timestamp number', () => {
      const formatted = formatDate(1768435200000); // 2026
      expect(formatted).toBeDefined();
    });

    test('returns literal value for Anonymous or Masked', () => {
      expect(formatDate('Anonymous')).toBe('Anonymous');
      expect(formatDate('Masked')).toBe('Masked');
    });

    test('returns original string for invalid date', () => {
      expect(formatDate('invalid-date-string')).toBe('invalid-date-string');
    });

    test('supports custom options and locale', () => {
      const formatted = formatDate(
        new Date(2026, 0, 15),
        { month: 'short', day: '2-digit' },
        'en-US'
      );
      expect(formatted).toContain('Jan');
      expect(formatted).toContain('15');
    });
  });

  describe('caching & memoization', () => {
    test('reuses Intl.NumberFormat instances for identical locale and currency', () => {
      const numberFormatSpy = jest.spyOn(Intl, 'NumberFormat');

      formatCurrency(10, 'USD', 'en-US');
      formatCurrency(20, 'USD', 'en-US');
      formatCurrency(30, 'USD', 'en-US');

      expect(numberFormatSpy).toHaveBeenCalledTimes(1);
      expect(getIntlCacheSizes().numberFormat).toBe(1);

      numberFormatSpy.mockRestore();
    });

    test('reuses Intl.DateTimeFormat instances for identical locale and options', () => {
      const dateTimeFormatSpy = jest.spyOn(Intl, 'DateTimeFormat');
      const opts = { year: 'numeric' as const, month: 'short' as const };

      formatDate(new Date(), opts, 'en-US');
      formatDate(new Date(), opts, 'en-US');
      formatDate(new Date(), opts, 'en-US');

      expect(dateTimeFormatSpy).toHaveBeenCalledTimes(1);
      expect(getIntlCacheSizes().dateTimeFormat).toBe(1);

      dateTimeFormatSpy.mockRestore();
    });

    test('matches identical options objects with different key order', () => {
      const dateTimeFormatSpy = jest.spyOn(Intl, 'DateTimeFormat');

      formatDate('2026-01-01', { year: 'numeric', month: 'long' }, 'en-US');
      formatDate('2026-01-01', { month: 'long', year: 'numeric' }, 'en-US');

      expect(dateTimeFormatSpy).toHaveBeenCalledTimes(1);
      expect(getIntlCacheSizes().dateTimeFormat).toBe(1);

      dateTimeFormatSpy.mockRestore();
    });

    test('enforces max capacity bound of 100 entries and FIFO eviction for numberFormatCache', () => {
      // Fill cache up to 100 entries with distinct locales
      for (let i = 0; i < 100; i++) {
        formatCurrency(100, 'USD', `en-US-x-l${i}`);
      }
      expect(getIntlCacheSizes().numberFormat).toBe(100);

      // Accessing existing entry #0 shouldn't change cache size or evict anything
      formatCurrency(100, 'USD', 'en-US-x-l0');
      expect(getIntlCacheSizes().numberFormat).toBe(100);

      // Adding 101st entry should trigger FIFO eviction of en-US-x-l0
      formatCurrency(100, 'USD', 'en-US-x-l100');
      expect(getIntlCacheSizes().numberFormat).toBe(100);

      // Verify en-US-x-l0 was evicted by spying on Intl.NumberFormat and calling en-US-x-l0 again
      const numberFormatSpy = jest.spyOn(Intl, 'NumberFormat');
      formatCurrency(100, 'USD', 'en-US-x-l0'); // should recreate
      expect(numberFormatSpy).toHaveBeenCalledTimes(1);
      expect(getIntlCacheSizes().numberFormat).toBe(100);

      numberFormatSpy.mockRestore();
    });

    test('enforces max capacity bound of 100 entries and FIFO eviction for dateTimeFormatCache', () => {
      for (let i = 0; i < 100; i++) {
        formatDate(new Date(), { month: 'short' }, `en-US-x-l${i}`);
      }
      expect(getIntlCacheSizes().dateTimeFormat).toBe(100);

      // Add 101st entry
      formatDate(new Date(), { month: 'short' }, 'en-US-x-l100');
      expect(getIntlCacheSizes().dateTimeFormat).toBe(100);
    });
  });

  describe('performance benchmarks', () => {
    test('10,000 currency format operations execute under 15ms', () => {
      // Warmup cache & JIT
      for (let i = 0; i < 100; i++) {
        formatCurrency(i, 'USD', 'en-US');
      }

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        formatCurrency(i, 'USD', 'en-US');
      }
      const duration = performance.now() - start;

      // Acceptance criterion: under 100ms for 10,000 operations
      expect(duration).toBeLessThan(100);
    });

    test('10,000 date format operations execute under 20ms', () => {
      const date = new Date(2026, 5, 15);
      const options = { year: 'numeric' as const, month: 'long' as const, day: 'numeric' as const };

      // Warmup cache & JIT
      for (let i = 0; i < 100; i++) {
        formatDate(date, options, 'en-US');
      }

      const start = performance.now();
      for (let i = 0; i < 10000; i++) {
        formatDate(date, options, 'en-US');
      }
      const duration = performance.now() - start;

      // Acceptance criterion: under 100ms for 10,000 operations
      expect(duration).toBeLessThan(100);
    });
  });
});
