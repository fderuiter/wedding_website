import { createPageMetadata, generateMetadata, generateViewport } from '../metadata';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';

const mockHeaders = jest.fn().mockImplementation(() => {
  throw new Error('Headers not available');
});

jest.mock('next/headers', () => ({
  headers: () => mockHeaders(),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/core/auth/guest.server', () => ({
  isGuestRequest: jest.fn(),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn(),
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn().mockResolvedValue({
      partner1Name: 'TestBride',
      partner2Name: 'TestGroom',
      brideName: 'TestBride',
      groomName: 'TestGroom',
      venueName: 'Test Venue',
      venueCity: 'TestCity',
      venueState: 'TS',
      seoKeywords: 'TestBride, TestGroom, Test Venue',
      baseUrl: 'https://testsite.com',
      colorPrimary: '#B91C1C',
    }),
  };
});

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockIsGuestRequest = isGuestRequest as jest.MockedFunction<typeof isGuestRequest>;
const mockGetGuestInviteSession = getGuestInviteSession as jest.MockedFunction<
  typeof getGuestInviteSession
>;

describe('generateMetadata', () => {
  beforeEach(() => {
    mockIsAdminRequest.mockResolvedValue(false);
    mockIsGuestRequest.mockResolvedValue(true);
    mockGetGuestInviteSession.mockResolvedValue(null);
  });

  it('generates expected metadata based on config when authenticated', async () => {
    const metadata = await generateMetadata();
    const title =
      typeof metadata.title === 'object' && metadata.title !== null && 'default' in metadata.title
        ? metadata.title.default
        : metadata.title;
    expect(title).toBe("TestBride & TestGroom's Wedding");
    expect(metadata.description).toBe(
      'Join TestBride and TestGroom for their wedding celebration at Test Venue in TestCity, TS.'
    );
    expect(metadata.publisher).toBe('TestBride & TestGroom');
    expect(metadata.robots).toBeUndefined();
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
          url: 'https://testsite.com/api/og',
          width: 1200,
          height: 630,
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
      images: ['https://testsite.com/api/og'],
    });
    expect((metadata.metadataBase as URL | null | undefined)?.href).toBe('https://testsite.com/');
  });

  it('outputs redacted metadata with noindex, nofollow robots directives when unauthenticated', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    mockIsGuestRequest.mockResolvedValue(false);
    mockGetGuestInviteSession.mockResolvedValue(null);

    const { getAppConfig } = jest.requireMock('@/lib/config') as {
      getAppConfig: jest.Mock;
    };
    getAppConfig.mockResolvedValueOnce({
      partner1Name: 'SecretBride',
      partner2Name: 'SecretGroom',
      brideName: 'SecretBride',
      groomName: 'SecretGroom',
      venueName: 'Hidden Manor',
      venueCity: 'SecretTown',
      venueState: 'CA',
      seoTitle: 'SecretBride & SecretGroom Private Estate',
      seoDescription: 'Gate code 9999 at Hidden Manor',
      seoKeywords: 'SecretBride, SecretGroom, Hidden Manor',
      ogImageUrl: '/uploads/private-couple-photo.jpg',
      brandLogoAlt: 'SecretBride & SecretGroom Crest',
      baseUrl: 'https://testsite.com',
      colorPrimary: '#B91C1C',
    });

    const metadata = await generateMetadata();
    expect(metadata.title).toEqual({
      default: 'Wedding Website',
      template: '%s | Wedding Website',
    });
    expect(metadata.description).toBe('Welcome to our wedding website.');
    expect(metadata.keywords).toEqual([]);
    expect(metadata.robots).toEqual({
      index: false,
      follow: false,
    });
    expect(metadata.openGraph).toEqual({
      type: 'website',
      url: 'https://testsite.com',
      title: 'Wedding Website',
      description: 'Welcome to our wedding website.',
      images: [
        {
          url: 'https://testsite.com/api/og',
          width: 1200,
          height: 630,
          alt: 'Wedding website cover photo.',
        },
      ],
      locale: 'en_US',
      siteName: 'Wedding Website',
    });
    expect(metadata.twitter).toEqual({
      card: 'summary_large_image',
      title: 'Wedding Website',
      description: 'Welcome to our wedding website.',
      images: ['https://testsite.com/api/og'],
    });

    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain('SecretBride');
    expect(serialized).not.toContain('SecretGroom');
    expect(serialized).not.toContain('Hidden Manor');
    expect(serialized).not.toContain('SecretTown');
    expect(serialized).not.toContain('private-couple-photo.jpg');
  });

  it('preserves full showcase metadata during STATIC_EXPORT=true builds without session cookies', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    mockIsGuestRequest.mockResolvedValue(false);
    mockGetGuestInviteSession.mockResolvedValue(null);

    const prevStaticExport = process.env.STATIC_EXPORT;
    process.env.STATIC_EXPORT = 'true';
    try {
      const metadata = await generateMetadata();
      const title =
        typeof metadata.title === 'object' && metadata.title !== null && 'default' in metadata.title
          ? metadata.title.default
          : metadata.title;
      expect(title).toBe("TestBride & TestGroom's Wedding");
      expect(metadata.robots).toBeUndefined();
    } finally {
      if (prevStaticExport === undefined) {
        delete process.env.STATIC_EXPORT;
      } else {
        process.env.STATIC_EXPORT = prevStaticExport;
      }
    }
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

      const metadata = await generateMetadata();
      expect(metadata.openGraph?.url).toBe('https://canonical.example.com');
      expect((metadata.metadataBase as URL | null | undefined)?.href).toBe('https://canonical.example.com/');
    } finally {
      process.env.ALLOWED_HOSTS = originalAllowedHosts;
    }
  });

  it('prefixes favicon icons and relative ogImageUrl when NEXT_PUBLIC_BASE_PATH is configured', async () => {
    const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
    const { getAppConfig } = jest.requireMock('@/lib/config') as {
      getAppConfig: jest.Mock;
    };
    getAppConfig.mockResolvedValueOnce({
      partner1Name: 'TestBride',
      partner2Name: 'TestGroom',
      venueName: 'Test Venue',
      venueCity: 'TestCity',
      venueState: 'TS',
      baseUrl: 'https://testsite.com',
      faviconUrl: '/assets/favicon.png',
      ogImageUrl: '/images/sunset-embrace.jpg',
      colorPrimary: '#B91C1C',
    });

    try {
      const metadata = await generateMetadata();
      expect(metadata.icons).toEqual({
        icon: '/wedding_website/demo/assets/favicon.png',
        shortcut: '/wedding_website/demo/assets/favicon.png',
        apple: '/wedding_website/demo/assets/favicon.png',
      });
      expect(metadata.openGraph?.images).toEqual([
        {
          url: 'https://testsite.com/wedding_website/demo/images/sunset-embrace.jpg',
          width: 1024,
          height: 1024,
          alt: "A photo for TestBride and TestGroom's wedding.",
        },
      ]);
      expect(metadata.twitter).toEqual(
        expect.objectContaining({
          images: ['https://testsite.com/wedding_website/demo/images/sunset-embrace.jpg'],
        })
      );
    } finally {
      if (originalBasePath === undefined) {
        delete process.env.NEXT_PUBLIC_BASE_PATH;
      } else {
        process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
      }
    }
  });
});

describe('generateViewport', () => {
  it('populates themeColor from primary theme color config', async () => {
    const viewport = await generateViewport();
    expect(viewport.themeColor).toBe('#B91C1C');
  });
});

describe('createPageMetadata', () => {
  it('returns title-only metadata when optional fields are omitted', () => {
    expect(createPageMetadata({ title: 'Gift Registry' })).toEqual({
      title: 'Gift Registry',
    });
  });

  it('includes description and canonical URL when provided', () => {
    expect(
      createPageMetadata({
        title: 'About This Project',
        description: 'Project architecture overview.',
        canonical: '/project-info',
      })
    ).toEqual({
      title: 'About This Project',
      description: 'Project architecture overview.',
      alternates: {
        canonical: '/project-info',
      },
    });
  });

  it('adds robots noindex and nofollow directives when noIndex is true', () => {
    expect(
      createPageMetadata({
        title: 'Admin Login',
        description: 'Sign in to the admin panel.',
        noIndex: true,
      })
    ).toEqual({
      title: 'Admin Login',
      description: 'Sign in to the admin panel.',
      robots: {
        index: false,
        follow: false,
      },
    });
  });
});


