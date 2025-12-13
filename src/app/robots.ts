import { MetadataRoute } from 'next';

/**
 * @function robots
 * @description Generates the robots.txt file for the application.
 * This file tells search engine crawlers which pages they can or cannot request from your site.
 *
 * @returns {MetadataRoute.Robots} The robots configuration.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/admin/', '/api/'],
    },
    sitemap: 'https://abbifred.com/sitemap.xml',
  };
}
