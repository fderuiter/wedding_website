import sitemap from '../sitemap';

describe('sitemap', () => {
  it('should return the correct sitemap entries', () => {
    const sitemapEntries = sitemap();
    const siteUrl = 'https://abbifred.com';

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
