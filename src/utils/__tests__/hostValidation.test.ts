import {
  getAllowedHosts,
  isHostAllowed,
  getValidatedCanonicalUrl,
} from '../hostValidation';

describe('Host Validation Utility', () => {
  const defaultAllowedHosts = [
    'localhost',
    '127.0.0.1',
    '*.localhost',
    'abbifred.com',
    '*.abbifred.com',
    'wedding.example.com',
  ];

  describe('getAllowedHosts', () => {
    it('returns parsed allowed hosts from process/env', () => {
      const hosts = getAllowedHosts();
      expect(Array.isArray(hosts)).toBe(true);
      expect(hosts.length).toBeGreaterThan(0);
    });
  });

  describe('isHostAllowed', () => {
    it('allows exact domain matches', () => {
      expect(isHostAllowed('abbifred.com', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('wedding.example.com', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('localhost', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('127.0.0.1', defaultAllowedHosts)).toBe(true);
    });

    it('allows hosts with valid port numbers', () => {
      expect(isHostAllowed('localhost:3000', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('127.0.0.1:8080', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('abbifred.com:443', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('tenant.abbifred.com:8443', defaultAllowedHosts)).toBe(true);
    });

    it('allows valid tenant subdomains matching wildcard pattern', () => {
      expect(isHostAllowed('tenant1.abbifred.com', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('staging.tenant.abbifred.com', defaultAllowedHosts)).toBe(true);
      expect(isHostAllowed('couple.localhost', defaultAllowedHosts)).toBe(true);
    });

    it('rejects non-whitelisted host headers', () => {
      expect(isHostAllowed('evil.com', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('attacker.org', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('untrusted-domain.net', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('example.com', defaultAllowedHosts)).toBe(false);
    });

    it('rejects domain prefix spoofing attempts', () => {
      // evil-abbifred.com should NOT match *.abbifred.com or abbifred.com
      expect(isHostAllowed('evil-abbifred.com', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('fakeabbifred.com', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('abbifred.com.evil.com', defaultAllowedHosts)).toBe(false);
    });

    it('rejects header injection attempts containing CRLF or invalid characters', () => {
      expect(isHostAllowed('localhost\r\nX-Injected: evil', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('localhost\nHost: evil.com', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('abbifred.com/admin', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('user@abbifred.com', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('abbifred.com evil.com', defaultAllowedHosts)).toBe(false);
    });

    it('rejects multiple comma-separated hosts in single Host header', () => {
      expect(isHostAllowed('abbifred.com, evil.com', defaultAllowedHosts)).toBe(false);
    });

    it('rejects null, undefined, empty or whitespace strings', () => {
      expect(isHostAllowed(null, defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed(undefined, defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('', defaultAllowedHosts)).toBe(false);
      expect(isHostAllowed('   ', defaultAllowedHosts)).toBe(false);
    });

    it('enforces port restrictions if rule includes explicit port', () => {
      const explicitPortHosts = ['localhost:3000', 'abbifred.com:8443'];
      expect(isHostAllowed('localhost:3000', explicitPortHosts)).toBe(true);
      expect(isHostAllowed('localhost:8080', explicitPortHosts)).toBe(false);
      expect(isHostAllowed('abbifred.com:8443', explicitPortHosts)).toBe(true);
      expect(isHostAllowed('abbifred.com:443', explicitPortHosts)).toBe(false);
    });
  });

  describe('getValidatedCanonicalUrl', () => {
    it('returns canonical URL using validated host for whitelisted host header', () => {
      const url = getValidatedCanonicalUrl('tenant1.abbifred.com', 'https', 'https://abbifred.com');
      expect(url).toBe('https://tenant1.abbifred.com');
    });

    it('uses http for local hosts by default', () => {
      const url = getValidatedCanonicalUrl('localhost:3000', null, 'http://localhost:3000');
      expect(url).toBe('http://localhost:3000');
    });

    it('falls back to default fallback URL for unapproved or spoofed host header', () => {
      const fallback = 'https://abbifred.com';
      const url = getValidatedCanonicalUrl('evil.com', 'https', fallback);
      expect(url).toBe(fallback);
    });
  });
});
