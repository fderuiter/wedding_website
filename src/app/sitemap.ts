import { MetadataRoute } from 'next';
import { getAppConfig } from '@/lib/config';

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
 * @returns {Promise<MetadataRoute.Sitemap>} The sitemap data.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let siteUrl = 'http://localhost:3000';
  try {
    const config = await getAppConfig();
    if (config.baseUrl) {
      siteUrl = config.baseUrl;
    }
  } catch (err) {
    console.error('Could not load config for sitemap', err);
  }

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

  return [
    ...staticPages,
  ];
}
