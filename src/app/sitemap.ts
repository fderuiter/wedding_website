import { MetadataRoute } from 'next';

type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

/**
 * Interface representing a single entry in the sitemap.
 */
interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency: ChangeFrequency;
  priority: number;
}

/**
 * @function sitemap
 * @description Generates the sitemap.xml for the application.
 * This function returns a list of URLs that should be indexed by search engines,
 * along with their modification date, change frequency, and priority.
 *
 * @returns {MetadataRoute.Sitemap} The sitemap data.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = 'https://abbifred.com';

  // Static pages
  const staticPages: SitemapEntry[] = [
    {
      url: `${siteUrl}/`,
      lastModified: new Date(),
      changeFrequency: 'yearly',
      priority: 1,
    },
    {
      url: `${siteUrl}/project-info`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${siteUrl}/heart`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
  ];

  // In a real application, you would also fetch dynamic routes from a database
  // For example, if you had a blog:
  // const posts = await db.post.findMany();
  // const postUrls = posts.map(post => ({
  //   url: `${siteUrl}/blog/${post.slug}`,
  //   lastModified: post.updatedAt,
  // }));

  return [
    ...staticPages,
    // ...postUrls,
  ];
}
