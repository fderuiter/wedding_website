import { generateMetadata } from '../metadata';


jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    partner1Name: 'TestBride',
    partner2Name: 'TestGroom',
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
      'Join TestBride and TestGroom for their wedding celebration at Test Venue in TestCity, TS.'
    );
    expect(metadata.publisher).toBe('TestBride & TestGroom');
    expect(metadata.icons).toEqual({
      icon: '/assets/favicon.png',
      shortcut: '/assets/favicon.png',
      apple: '/assets/favicon.png',
    });
    expect(metadata.openGraph).toEqual({
      type: 'website',
      url: 'https://testsite.com',
      title: "TestBride & TestGroom's Wedding",
      description: 'Join TestBride and TestGroom for their wedding celebration at Test Venue in TestCity, TS.',
      images: [
        {
          url: 'https://testsite.com/images/placeholder.png',
          width: 1024,
          height: 1024,
          alt: "A photo for TestBride and TestGroom's wedding.",
        },
      ],
      locale: 'en_US',
      siteName: "TestBride & TestGroom's Wedding",
    });
    expect(metadata.twitter).toEqual({
      card: 'summary_large_image',
      title: "TestBride & TestGroom's Wedding",
      description: 'Join TestBride and TestGroom for their wedding celebration at Test Venue in TestCity, TS.',
      images: ['https://testsite.com/images/placeholder.png'],
    });
    expect(metadata.metadataBase?.href).toBe('https://testsite.com/');
  });
});

