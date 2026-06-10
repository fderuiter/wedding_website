import sitemap from '../sitemap';
import { getAppConfig } from '@/lib/config';

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    baseUrl: 'http://localhost:3000',
  }),
}));

describe('sitemap', () => {
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
});
