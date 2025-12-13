import sitemap from '../sitemap';

describe('sitemap', () => {
  it('should return the correct sitemap entries', () => {
    const sitemapEntries = sitemap();
    const siteUrl = 'https://abbifred.com';

    expect(sitemapEntries).toHaveLength(5);

    expect(sitemapEntries).toContainEqual({
      url: `${siteUrl}/`,
      lastModified: expect.any(Date),
      changeFrequency: 'weekly',
      priority: 1,
    });

    expect(sitemapEntries).toContainEqual({
      url: `${siteUrl}/registry`,
      lastModified: expect.any(Date),
      changeFrequency: 'weekly',
      priority: 0.8,
    });

    expect(sitemapEntries).toContainEqual({
      url: `${siteUrl}/photos`,
      lastModified: expect.any(Date),
      changeFrequency: 'monthly',
      priority: 0.8,
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
