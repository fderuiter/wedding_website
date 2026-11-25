import {
  PRODUCTION_PUBLIC_TRUST_PROXY_ERROR,
  getProductionTrustProxyError,
  hasNonLocalAllowedHosts,
  isExplicitTrustProxyHopCount,
  isLocalOrInternalHostname,
  isValidTrustProxyInput,
  parseTrustProxyValue,
} from '@/lib/trustProxyPolicy';

describe('trustProxyPolicy', () => {
  describe('isLocalOrInternalHostname', () => {
    it('classifies loopback, *.localhost, and single-label internal container hosts as local/internal', () => {
      for (const host of [
        'localhost',
        'LOCALHOST.',
        '127.0.0.1',
        '0.0.0.0',
        '[::1]',
        '::1',
        'couple.localhost',
        'staging.couple.localhost',
        'app',
        'db',
        'wedding_website-app-1',
      ]) {
        expect(isLocalOrInternalHostname(host)).toBe(true);
      }
    });

    it('classifies multi-label domains and non-loopback IPv6 literals as non-local', () => {
      for (const host of [
        '',
        '   ',
        'wedding.example',
        'sub.wedding.example.com',
        '203.0.113.10',
        '[2001:db8::1]',
      ]) {
        expect(isLocalOrInternalHostname(host)).toBe(false);
      }
    });
  });

  describe('hasNonLocalAllowedHosts', () => {
    it('returns false for omitted, empty, loopback-only, wildcard-localhost, and internal Compose host lists', () => {
      expect(hasNonLocalAllowedHosts(undefined)).toBe(false);
      expect(hasNonLocalAllowedHosts('')).toBe(false);
      expect(
        hasNonLocalAllowedHosts(
          '"localhost:3000, 127.0.0.1:3000, [::1]:3000, *.localhost, app, db, 0.0.0.0"'
        )
      ).toBe(false);
    });

    it('returns true when any entry targets a public domain, wildcard domain, or non-loopback IP', () => {
      expect(hasNonLocalAllowedHosts('localhost,wedding.example.com')).toBe(true);
      expect(hasNonLocalAllowedHosts("'*.run.app,localhost'")).toBe(true);
      expect(hasNonLocalAllowedHosts('.wedding.example:8443')).toBe(true);
      expect(hasNonLocalAllowedHosts('[2001:db8::1]:443')).toBe(true);
    });
  });

  describe('parseTrustProxyValue, isValidTrustProxyInput, and isExplicitTrustProxyHopCount', () => {
    it('preserves numeric 0 as 0 (falsy for Boolean checks) while distinguishing booleans', () => {
      expect(parseTrustProxyValue(0)).toBe(0);
      expect(parseTrustProxyValue('0')).toBe(0);
      expect(parseTrustProxyValue('"0"')).toBe(0);
      expect(Boolean(parseTrustProxyValue('0'))).toBe(false);

      expect(parseTrustProxyValue('1')).toBe(1);
      expect(parseTrustProxyValue("'2'")).toBe(2);
      expect(parseTrustProxyValue('true')).toBe(true);
      expect(parseTrustProxyValue('false')).toBe(false);
      expect(parseTrustProxyValue('')).toBe(false);
      expect(parseTrustProxyValue(undefined)).toBe(false);
    });

    it('accepts only explicit non-negative integer hop counts in isExplicitTrustProxyHopCount', () => {
      for (const explicit of [0, 1, 2, '0', '1', '2', '"1"', "'0'"]) {
        expect(isExplicitTrustProxyHopCount(explicit)).toBe(true);
        expect(isValidTrustProxyInput(explicit)).toBe(true);
      }

      for (const ambiguous of [undefined, null, '', true, false, 'true', 'false']) {
        expect(isExplicitTrustProxyHopCount(ambiguous)).toBe(false);
        expect(isValidTrustProxyInput(ambiguous)).toBe(true);
      }

      for (const invalid of [-1, 1.5, '-1', '1.5', 'yes', 'proxy']) {
        expect(isExplicitTrustProxyHopCount(invalid)).toBe(false);
        expect(isValidTrustProxyInput(invalid)).toBe(false);
      }
    });
  });

  describe('getProductionTrustProxyError', () => {
    it('requires explicit integer hop counts only in non-build, non-E2E production with non-local ALLOWED_HOSTS', () => {
      expect(
        getProductionTrustProxyError({
          isProduction: true,
          allowedHosts: 'wedding.example.com,localhost',
          rawTrustProxy: undefined,
        })
      ).toBe(PRODUCTION_PUBLIC_TRUST_PROXY_ERROR);

      expect(
        getProductionTrustProxyError({
          isProduction: true,
          allowedHosts: 'wedding.example.com,localhost',
          parsedTrustProxy: true,
        })
      ).toBe(PRODUCTION_PUBLIC_TRUST_PROXY_ERROR);

      expect(
        getProductionTrustProxyError({
          isProduction: true,
          allowedHosts: 'wedding.example.com,localhost',
          parsedTrustProxy: false,
        })
      ).toBe(PRODUCTION_PUBLIC_TRUST_PROXY_ERROR);

      for (const hops of [0, 1, 2]) {
        expect(
          getProductionTrustProxyError({
            isProduction: true,
            allowedHosts: 'wedding.example.com,localhost',
            parsedTrustProxy: hops,
          })
        ).toBeNull();
      }

      expect(
        getProductionTrustProxyError({
          isProduction: true,
          allowedHosts: 'localhost,127.0.0.1,*.localhost,app',
          parsedTrustProxy: false,
        })
      ).toBeNull();

      expect(
        getProductionTrustProxyError({
          isProduction: true,
          isBuildTime: true,
          allowedHosts: 'wedding.example.com',
          parsedTrustProxy: false,
        })
      ).toBeNull();

      expect(
        getProductionTrustProxyError({
          isProduction: true,
          isE2ETestMode: true,
          allowedHosts: 'wedding.example.com',
          parsedTrustProxy: false,
        })
      ).toBeNull();

      expect(
        getProductionTrustProxyError({
          isProduction: false,
          allowedHosts: 'wedding.example.com',
          parsedTrustProxy: false,
        })
      ).toBeNull();
    });
  });
});
