import { MetadataRoute } from 'next';

type ChangeFrequency = 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';

interface SitemapEntry {
  url: string;
  lastModified: Date;
  changeFrequency: ChangeFrequency;
  priority: number;
}

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
      url: `${siteUrl}/registry`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
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
