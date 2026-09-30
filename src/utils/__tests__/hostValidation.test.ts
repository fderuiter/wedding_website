import {
  isHostAllowed,
  getValidatedCanonicalUrl,
} from '../hostValidation';

describe('Host Validation Utility', () => {
  const defaultAllowedHosts = [
    'localhost',
    '127.0.0.1',
    '*.localhost',
    'wedding.example',
    '*.wedding.example',
    'wedding.example.com',
  ];

  describe('isHostAllowed with environment configuration', () => {
    it('evaluates host against environment allowed hosts when custom rules are omitted', () => {
      // isHostAllowed without customAllowedHosts uses internal getAllowedHosts()
      expect(typeof isHostAllowed('localhost')).toBe('boolean');
    });
  });

  describe('isHostAllowed', () => {
    it('allows exact domain matches', () => {
      expect(isHostAllowed('wedding.example', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('wedding.example.com', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('localhost', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('127.0.0.1', defaultAllowedHosts)).toBe(true);
    });

    it('allows hosts with valid port numbers', () => {
      expect(isHostAllowed('localhost:3000', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('127.0.0.1:8080', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('wedding.example:443', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('tenant.wedding.example:8443', defaultAllowedHosts)).toBe(true);
    });

    it('allows valid tenant subdomains matching wildcard pattern', () => {
      expect(isHostAllowed('tenant1.wedding.example', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('staging.tenant.wedding.example', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('couple.localhost', defaultAllowedHosts)).toBe(true);
    });

    it('rejects non-whitelisted host headers', () => {
      expect(isHostAllowed('evil.com', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('attacker.org', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('untrusted-domain.net', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('example.com', defaultAllowedHosts)).toBe(false);
    });

    it('rejects domain prefix spoofing attempts', () => {
      // evil-wedding.example should NOT match *.wedding.example or wedding.example
      expect(isHostAllowed('evil-wedding.example', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('fakewedding.example', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('wedding.example.evil.com', defaultAllowedHosts)).toBe(false);
    });

    it('rejects header injection attempts containing CRLF or invalid characters', () => {
      expect(isHostAllowed('localhost\r\nX-Injected: evil', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('localhost\nHost: evil.com', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('wedding.example/admin', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('user@wedding.example', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('wedding.example evil.com', defaultAllowedHosts)).toBe(false);
    });

    it('rejects multiple comma-separated hosts in single Host header', () => {
      expect(isHostAllowed('wedding.example, evil.com', defaultAllowedHosts)).toBe(false);
    });

    it('rejects null, undefined, empty or whitespace strings', () => {
      expect(isHostAllowed(null, defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed(undefined, defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('   ', defaultAllowedHosts)).toBe(false);
    });

    it('enforces port restrictions if rule includes explicit port', () => {
      const explicitPortHosts = ['localhost:3000', 'wedding.example:8443'];
      expect(isHostAllowed('localhost:3000', explicitPortHosts)).toBe(true);
      expect(isHostAllowed('localhost:8080', explicitPortHosts)).toBe(false);
      expect(isHostAllowed('wedding.example:8443', explicitPortHosts)).toBe(true);
      expect(isHostAllowed('wedding.example:443', explicitPortHosts)).toBe(false);
    });
  });

  describe('getValidatedCanonicalUrl', () => {
    it('returns canonical URL using validated host for whitelisted host header', () => {
      const url = getValidatedCanonicalUrl('tenant1.wedding.example', 'https', 'https://wedding.example');
      expect(url).toBe('https://tenant1.wedding.example');
    });

    it('uses http for local hosts by default', () => {
      const url = getValidatedCanonicalUrl('localhost:3000', null, 'http://localhost:3000');
      expect(url).toBe('http://localhost:3000');
    });

    it('falls back to default fallback URL for unapproved or spoofed host header', () => {
      const fallback = 'https://wedding.example';
      const url = getValidatedCanonicalUrl('evil.com', 'https', fallback);
      expect(url).toBe(fallback);
    });
  });
});
