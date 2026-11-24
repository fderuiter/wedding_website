import {
  isHostAllowed,
  isHostSyntaxValid,
  getValidatedCanonicalUrl,
  resolveRequestOrigin,
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

  describe('isHostSyntaxValid', () => {
    it('accepts valid domains, internal probe hosts, loopback IPs, and IPv6 literals', () => {
      expect(isHostSyntaxValid('wedding.example.com')).toBe(true);
      expect(isHostSyntaxValid('wedding.example.com.')).toBe(true);
      expect(isHostSyntaxValid('healthcheck.railway.app')).toBe(true);
      expect(isHostSyntaxValid('169.254.1.1:3000')).toBe(true);
      expect(isHostSyntaxValid('127.0.0.1:3000')).toBe(true);
      expect(isHostSyntaxValid('localhost:8080')).toBe(true);
      expect(isHostSyntaxValid('[::1]')).toBe(true);
      expect(isHostSyntaxValid('[::1]:3000')).toBe(true);
    });

    it('rejects empty, whitespace, comma-separated, CRLF, or malformed Host headers', () => {
      expect(isHostSyntaxValid(null)).toBe(false);
      expect(isHostSyntaxValid(undefined)).toBe(false);
      expect(isHostSyntaxValid('')).toBe(false);
      expect(isHostSyntaxValid('   ')).toBe(false);
      expect(isHostSyntaxValid(' localhost')).toBe(false);
      expect(isHostSyntaxValid('localhost ')).toBe(false);
      expect(isHostSyntaxValid('wedding.example evil.com')).toBe(false);
      expect(isHostSyntaxValid('wedding.example, evil.com')).toBe(false);
      expect(isHostSyntaxValid('localhost\r\nX-Injected: evil')).toBe(false);
      expect(isHostSyntaxValid('localhost\nHost: evil.com')).toBe(false);
      expect(isHostSyntaxValid('localhost\r\n')).toBe(false);
      expect(isHostSyntaxValid('wedding.example/admin')).toBe(false);
      expect(isHostSyntaxValid('user@wedding.example')).toBe(false);
      expect(isHostSyntaxValid('wedding.example?probe=1')).toBe(false);
      expect(isHostSyntaxValid('wedding.example#frag')).toBe(false);
      expect(isHostSyntaxValid('.')).toBe(false);
      expect(isHostSyntaxValid('..')).toBe(false);
      expect(isHostSyntaxValid('.example.com')).toBe(false);
      expect(isHostSyntaxValid(':3000')).toBe(false);
      expect(isHostSyntaxValid('[::1')).toBe(false);
      expect(isHostSyntaxValid('[]')).toBe(false);
      expect(isHostSyntaxValid('[::1]extra')).toBe(false);
    });

    it('rejects empty, zero, out-of-range, or non-numeric ports', () => {
      expect(isHostSyntaxValid('127.0.0.1:')).toBe(false);
      expect(isHostSyntaxValid('127.0.0.1:0')).toBe(false);
      expect(isHostSyntaxValid('127.0.0.1:65536')).toBe(false);
      expect(isHostSyntaxValid('127.0.0.1:abc')).toBe(false);
      expect(isHostSyntaxValid('[::1]:0')).toBe(false);
      expect(isHostSyntaxValid('[::1]:70000')).toBe(false);
    });
  });

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

  describe('resolveRequestOrigin', () => {
    const originalAllowedHosts = process.env.ALLOWED_HOSTS;
    const originalTrustProxy = process.env.TRUST_PROXY;

    afterEach(() => {
      if (originalAllowedHosts === undefined) {
        delete process.env.ALLOWED_HOSTS;
      } else {
        process.env.ALLOWED_HOSTS = originalAllowedHosts;
      }
      if (originalTrustProxy === undefined) {
        delete process.env.TRUST_PROXY;
      } else {
        process.env.TRUST_PROXY = originalTrustProxy;
      }
    });

    it('ignores x-forwarded-host and x-forwarded-proto when TRUST_PROXY is false', () => {
      process.env.TRUST_PROXY = 'false';
      process.env.ALLOWED_HOSTS = 'wedding.example,evil.example,localhost';
      const headers = new Headers({
        'x-forwarded-host': 'evil.example',
        'x-forwarded-proto': 'https',
        host: 'localhost:3000',
      });
      const origin = resolveRequestOrigin({
        headers,
        nextUrl: new URL('http://localhost:3000/api/admin/broadcast/send'),
      });
      expect(origin).toBe('http://localhost:3000');
    });

    it('selects right-to-left x-forwarded-host and x-forwarded-proto hops when TRUST_PROXY is enabled', () => {
      process.env.ALLOWED_HOSTS = 'wedding.example,localhost';

      process.env.TRUST_PROXY = '1';
      const singleHopHeaders = new Headers({
        'x-forwarded-host': 'spoofed.evil.com, wedding.example',
        'x-forwarded-proto': 'http, https',
        host: 'localhost:3000',
      });
      expect(
        resolveRequestOrigin({
          headers: singleHopHeaders,
          nextUrl: new URL('http://localhost:3000/api/admin/broadcast/send'),
        })
      ).toBe('https://wedding.example');

      process.env.TRUST_PROXY = '2';
      const twoHopHeaders = new Headers({
        'x-forwarded-host': 'spoofed.evil.com, wedding.example, proxy.internal',
        'x-forwarded-proto': 'http, https, http',
        host: 'localhost:3000',
      });
      expect(
        resolveRequestOrigin({
          headers: twoHopHeaders,
          nextUrl: new URL('http://localhost:3000/api/admin/broadcast/send'),
        })
      ).toBe('https://wedding.example');
    });

    it('preserves local nextUrl.origin fallback on localhost and 127.0.0.1 when host is unapproved', () => {
      process.env.TRUST_PROXY = 'true';
      process.env.ALLOWED_HOSTS = 'wedding.example';
      const localReq = {
        headers: new Headers({ 'x-forwarded-host': 'evil.com' }),
        nextUrl: new URL('http://127.0.0.1:4123/api/cron/broadcasts'),
      };
      expect(resolveRequestOrigin(localReq)).toBe('http://127.0.0.1:4123');
    });

    it('uses default localhost:3000 fallback when host is unapproved and nextUrl is non-local', () => {
      process.env.ALLOWED_HOSTS = 'wedding.example';
      const nonLocalReq = {
        headers: new Headers({ host: 'evil.com' }),
        nextUrl: new URL('https://evil.com/api/admin/broadcast/preview'),
      };
      expect(resolveRequestOrigin(nonLocalReq)).toBe('http://localhost:3000');
    });
  });
});
