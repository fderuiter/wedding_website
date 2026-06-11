import { generateMetadata } from '../metadata';
import { getAppConfig } from '@/lib/config';

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    brideName: 'TestBride',
    groomName: 'TestGroom',
    venueName: 'Test Venue',
    venueCity: 'TestCity',
    venueState: 'TS',
    baseUrl: 'https://testsite.com'
  })
}));

describe('generateMetadata', () => {
  it('generates expected metadata based on config', async () => {
    const metadata = await generateMetadata();
    const title = typeof metadata.title === 'object' && metadata.title !== null ? metadata.title.default : metadata.title;
    expect(title).toBe("TestBride & TestGroom's Wedding");
    expect(metadata.description).toBe(
      'Join TestBride and TestGroom for their wedding celebration at the historic Test Venue in TestCity, TS. Find all the details about the ceremony, reception, registry, and our story.'
    );
    expect(metadata.icons).toEqual({
      icon: '/assets/favicon.png',
      shortcut: '/assets/favicon.png',
      apple: '/assets/favicon.png',
    });
    expect(metadata.openGraph).toEqual({
      type: 'website',
      url: 'https://testsite.com',
      title: "TestBride & TestGroom's Wedding",
      description: 'Join TestBride and TestGroom for their wedding celebration at the historic Test Venue in TestCity, TS. Find all the details about the ceremony, reception, registry, and our story.',
      images: [
        {
          url: 'https://testsite.com/images/sunset-embrace.jpg',
          width: 1024,
          height: 1024,
          alt: 'A photo of TestBride and TestGroom embracing.',
        },
      ],
      locale: 'en_US',
      siteName: "TestBride & TestGroom's Wedding",
    });
    expect(metadata.twitter).toEqual({
      card: 'summary_large_image',
      title: "TestBride & TestGroom's Wedding",
      description: 'Join TestBride and TestGroom for their wedding celebration at the historic Test Venue in TestCity, TS. Find all the details about the ceremony, reception, registry, and our story.',
      images: ['https://testsite.com/images/sunset-embrace.jpg'],
    });
    expect(metadata.metadataBase?.href).toBe('https://testsite.com/');
  });
});

