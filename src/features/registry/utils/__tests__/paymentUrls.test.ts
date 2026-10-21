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

    it('formats Zelle payment URLs correctly', () => {
      expect(getPaymentUrl('Zelle', 'couple@example.com')).toBe('mailto:couple@example.com?subject=Wedding%20Gift%20via%20Zelle');
      expect(getPaymentUrl('Zelle', '(555) 123-4567')).toBe('tel:5551234567');
      expect(getPaymentUrl('Zelle', 'https://www.zellepay.com')).toBe('https://www.zellepay.com');
      expect(getPaymentUrl('Zelle', 'Zelle Account')).toBe('https://www.zellepay.com');
    });

    it('handles Custom and unlisted handle types', () => {
      expect(getPaymentUrl('Custom', 'https://example.com/pay')).toBe('https://example.com/pay');
      expect(getPaymentUrl('Custom', 'gift@example.com')).toBe('mailto:gift@example.com?subject=Wedding%20Gift');
      expect(getPaymentUrl('Custom', 'random-username')).toBeNull();
      expect(getPaymentUrl(null, 'https://example.com/pay')).toBe('https://example.com/pay');
    });
  });
});
