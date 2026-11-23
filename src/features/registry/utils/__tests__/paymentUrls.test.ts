import { getPaymentUrl, sanitizePaymentHandle } from '../paymentUrls';

describe('paymentUrls utility', () => {
  describe('sanitizePaymentHandle', () => {
    it('returns empty string for null, undefined, or empty handles', () => {
      expect(sanitizePaymentHandle('Venmo', null)).toBe('');
      expect(sanitizePaymentHandle('Venmo', undefined)).toBe('');
      expect(sanitizePaymentHandle('Venmo', '   ')).toBe('');
    });

    it('sanitizes Venmo handles by removing leading @ and u/', () => {
      expect(sanitizePaymentHandle('Venmo', '@happy-couple')).toBe('happy-couple');
      expect(sanitizePaymentHandle('venmo', 'u/happy-couple')).toBe('happy-couple');
      expect(sanitizePaymentHandle('Venmo', 'happy-couple')).toBe('happy-couple');
    });

    it('sanitizes Cash App handles by removing leading $ and @', () => {
      expect(sanitizePaymentHandle('Cash App', '$happycouple')).toBe('happycouple');
      expect(sanitizePaymentHandle('cashapp', '@happycouple')).toBe('happycouple');
      expect(sanitizePaymentHandle('Cash App', 'happycouple')).toBe('happycouple');
    });

    it('sanitizes PayPal handles by removing leading @ and paypal.me/', () => {
      expect(sanitizePaymentHandle('PayPal', '@happycouple')).toBe('happycouple');
      expect(sanitizePaymentHandle('paypal', 'paypal.me/happycouple')).toBe('happycouple');
      expect(sanitizePaymentHandle('PayPal', 'happycouple')).toBe('happycouple');
    });

    it('preserves full URLs without modification', () => {
      expect(sanitizePaymentHandle('Venmo', 'https://venmo.com/u/happy-couple')).toBe('https://venmo.com/u/happy-couple');
      expect(sanitizePaymentHandle('Custom', 'https://example.com/pay')).toBe('https://example.com/pay');
    });
  });

  describe('getPaymentUrl', () => {
    it('returns null for null, undefined, empty, or whitespace handles', () => {
      expect(getPaymentUrl('Venmo', null)).toBeNull();
      expect(getPaymentUrl('Venmo', undefined)).toBeNull();
      expect(getPaymentUrl('Venmo', '')).toBeNull();
      expect(getPaymentUrl('Venmo', '   ')).toBeNull();
    });

    it('returns null for dangerous URL protocols (XSS prevention)', () => {
      expect(getPaymentUrl('Custom', 'javascript:alert(1)')).toBeNull();
      expect(getPaymentUrl('Custom', 'data:text/html,<script></script>')).toBeNull();
      expect(getPaymentUrl('Custom', 'vbscript:msgbox(1)')).toBeNull();
    });

    it('formats Venmo payment URLs correctly', () => {
      expect(getPaymentUrl('Venmo', '@happy-couple')).toBe('https://venmo.com/u/happy-couple');
      expect(getPaymentUrl('venmo', 'happy-couple')).toBe('https://venmo.com/u/happy-couple');
      expect(getPaymentUrl('Venmo', 'u/happy-couple')).toBe('https://venmo.com/u/happy-couple');
      expect(getPaymentUrl('Venmo', 'https://venmo.com/u/happy-couple')).toBe('https://venmo.com/u/happy-couple');
    });

    it('formats Cash App payment URLs correctly', () => {
      expect(getPaymentUrl('Cash App', '$happycouple')).toBe('https://cash.app/$happycouple');
      expect(getPaymentUrl('cashapp', 'happycouple')).toBe('https://cash.app/$happycouple');
      expect(getPaymentUrl('Cash App', 'https://cash.app/$happycouple')).toBe('https://cash.app/$happycouple');
    });

    it('formats PayPal payment URLs correctly', () => {
      expect(getPaymentUrl('PayPal', '@happycouple')).toBe('https://paypal.me/happycouple');
      expect(getPaymentUrl('paypal', 'paypal.me/happycouple')).toBe('https://paypal.me/happycouple');
      expect(getPaymentUrl('PayPal', 'happycouple')).toBe('https://paypal.me/happycouple');
      expect(getPaymentUrl('PayPal', 'https://paypal.me/happycouple')).toBe('https://paypal.me/happycouple');
    });

    it('returns null for Zelle handles so UI renders copy-handle instead of mailto/tel/QR links', () => {
      expect(getPaymentUrl('Zelle', 'couple@example.com')).toBeNull();
      expect(getPaymentUrl('Zelle', '(555) 123-4567')).toBeNull();
      expect(getPaymentUrl('Zelle', 'https://www.zellepay.com')).toBeNull();
      expect(getPaymentUrl('Zelle', 'Zelle Account')).toBeNull();
      expect(getPaymentUrl('zelle', 'couple@example.com', 100)).toBeNull();
    });

    it('appends positive entered amounts to Venmo, Cash App, and PayPal URLs while omitting non-positive amounts', () => {
      expect(getPaymentUrl('Venmo', '@happy-couple', 50)).toBe('https://venmo.com/u/happy-couple?txn=pay&amount=50');
      expect(getPaymentUrl('Venmo', '@happy-couple', 75.5)).toBe('https://venmo.com/u/happy-couple?txn=pay&amount=75.50');
      expect(getPaymentUrl('Venmo', '@happy-couple', 0)).toBe('https://venmo.com/u/happy-couple');
      expect(getPaymentUrl('Venmo', '@happy-couple', -25)).toBe('https://venmo.com/u/happy-couple');
      expect(getPaymentUrl('Venmo', '@happy-couple', Number.NaN)).toBe('https://venmo.com/u/happy-couple');

      expect(getPaymentUrl('Cash App', '$happycouple', 50)).toBe('https://cash.app/$happycouple/50');
      expect(getPaymentUrl('Cash App', '$happycouple', 75.5)).toBe('https://cash.app/$happycouple/75.50');
      expect(getPaymentUrl('Cash App', '$happycouple', 0)).toBe('https://cash.app/$happycouple');

      expect(getPaymentUrl('PayPal', '@happycouple', 50)).toBe('https://paypal.me/happycouple/50');
      expect(getPaymentUrl('PayPal', '@happycouple', 75.5)).toBe('https://paypal.me/happycouple/75.50');
      expect(getPaymentUrl('PayPal', '@happycouple', 0)).toBe('https://paypal.me/happycouple');
    });

    it('handles Custom and unlisted handle types', () => {
      expect(getPaymentUrl('Custom', 'https://example.com/pay')).toBe('https://example.com/pay');
      expect(getPaymentUrl('Custom', 'gift@example.com')).toBe('mailto:gift@example.com?subject=Wedding%20Gift');
      expect(getPaymentUrl('Custom', 'random-username')).toBeNull();
      expect(getPaymentUrl(null, 'https://example.com/pay')).toBe('https://example.com/pay');
    });
  });
});
