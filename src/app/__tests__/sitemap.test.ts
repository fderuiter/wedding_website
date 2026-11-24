import sitemap from '../sitemap';

const mockHeaders = jest.fn().mockImplementation(() => {
  throw new Error('Headers not available');
});

jest.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    baseUrl: 'http://localhost:3000',
  }),
}));

describe('sitemap', () => {
  beforeEach(() => {
    mockHeaders.mockReset();
    mockHeaders.mockImplementation(() => {
      throw new Error('Headers not available');
    });
  });

  it('should return the correct sitemap entries', async () => {
    const sitemapEntries = await sitemap();
    const siteUrl = 'http://localhost:3000';

    expect(sitemapEntries).toHaveLength(3);

    expect(sitemapEntries).toContainEqual({
      url: `${siteUrl}/`,
      lastModified: expect.any(Date),
      changeFrequency: 'yearly',
      priority: 1,
    });

    expect(sitemapEntries).toContainEqual({
      url: `${siteUrl}/project-info`,
      lastModified: expect.any(Date),
      changeFrequency: 'monthly',
      priority: 0.5,
    });

    expect(sitemapEntries).toContainEqual({
      url: `${siteUrl}/heart`,
      lastModified: expect.any(Date),
      changeFrequency: 'monthly',
      priority: 0.5,
    });
  });

  it('resolves canonical URL using host and proto headers when available', async () => {
    const originalAllowedHosts = process.env.ALLOWED_HOSTS;
    process.env.ALLOWED_HOSTS = 'canonical.example.com';
    try {
      mockHeaders.mockResolvedValueOnce({
        get: (header: string) => {
          if (header === 'host') return 'canonical.example.com';
          if (header === 'x-forwarded-proto') return 'https';
          return null;
        },
      });

      const sitemapEntries = await sitemap();
      expect(sitemapEntries[0].url).toBe('https://canonical.example.com/');
      expect(sitemapEntries[1].url).toBe('https://canonical.example.com/project-info');
      expect(sitemapEntries[2].url).toBe('https://canonical.example.com/heart');
    } finally {
      process.env.ALLOWED_HOSTS = originalAllowedHosts;
    }
  });

  it('ignores spoofed x-forwarded-host and x-forwarded-proto when TRUST_PROXY=false and honors trusted hops when TRUST_PROXY=1', async () => {
    const { env } = await import('@/env');
    const originalAllowedHosts = process.env.ALLOWED_HOSTS;
    const originalTrustProxy = env.TRUST_PROXY;
    process.env.ALLOWED_HOSTS = 'canonical.example.com, proxied.example.com';

    try {
      (env as { TRUST_PROXY: boolean | number }).TRUST_PROXY = false;
      mockHeaders.mockResolvedValueOnce({
        get: (header: string) => {
          if (header === 'host') return 'canonical.example.com';
          if (header === 'x-forwarded-host') return 'proxied.example.com';
          if (header === 'x-forwarded-proto') return 'http';
          return null;
        },
      });

      const untrustedEntries = await sitemap();
      expect(untrustedEntries[0].url).toBe('https://canonical.example.com/');

      (env as { TRUST_PROXY: boolean | number }).TRUST_PROXY = 1;
      mockHeaders.mockResolvedValueOnce({
        get: (header: string) => {
          if (header === 'host') return 'internal.local';
          if (header === 'x-forwarded-host') return 'spoofed.evil.org, proxied.example.com';
          if (header === 'x-forwarded-proto') return 'https, http';
          return null;
        },
      });

      const trustedEntries = await sitemap();
      expect(trustedEntries[0].url).toBe('http://proxied.example.com/');
    } finally {
      (env as { TRUST_PROXY: boolean | number }).TRUST_PROXY = originalTrustProxy;
      process.env.ALLOWED_HOSTS = originalAllowedHosts;
    }
  });

  it('skips headers and uses config baseUrl when isStaticExport is true', async () => {
    const originalStaticExport = process.env.STATIC_EXPORT;
    process.env.STATIC_EXPORT = 'true';
    try {
      const sitemapEntries = await sitemap();
      expect(sitemapEntries[0].url).toBe('http://localhost:3000/');
      expect(mockHeaders).not.toHaveBeenCalled();
    } finally {
      process.env.STATIC_EXPORT = originalStaticExport;
    }
  });
});

