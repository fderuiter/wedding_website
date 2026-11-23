import React from 'react';
import RootLayout from '../layout';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { GUEST_INVITE_COOKIE, signGuestInviteSessionToken } from '@/core/auth/guestInviteSession';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
import { ADMIN_COOKIE, signAdminToken } from '@/core/auth/auth.server';
import { prisma } from '@/lib/prisma';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    const error = new Error('NEXT_REDIRECT') as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    getAppConfig: jest.fn().mockResolvedValue({ partner1Name: 'Alice', partner2Name: 'Bob' }),
    toPublicAppConfig: jest.fn((cfg) => actual.toPublicAppConfig(cfg)),
    toUnauthenticatedAppConfig: jest.fn((cfg) => actual.toUnauthenticatedAppConfig(cfg)),
    isSiteInitialized: jest.fn().mockReturnValue(true),
  };
});

jest.mock('@/components/layout/RootLayoutClient', () => {
  return function MockRootLayoutClient({
    children,
    config,
  }: {
    children: React.ReactNode;
    config?: unknown;
  }) {
    return (
      <div data-testid="root-layout-client" data-config={JSON.stringify(config)}>
        {children}
      </div>
    );
  };
});

describe('RootLayout Server Component Cookie Hydration', () => {
  const mockCookies = cookies as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies light class when theme_mode cookie is light', async () => {
    mockCookies.mockResolvedValue({
      get: (name: string) => (name === 'theme_mode' ? { value: 'light' } : undefined),
    });

    const jsx = await RootLayout({ children: <div>Child Content</div> });
    expect(jsx.type).toBe('html');
    expect(jsx.props.className).toContain('light');
    expect(jsx.props.className).not.toContain('dark');
  });

  it('applies dark class when theme_mode cookie is dark', async () => {
    mockCookies.mockResolvedValue({
      get: (name: string) => (name === 'theme_mode' ? { value: 'dark' } : undefined),
    });

    const jsx = await RootLayout({ children: <div>Child Content</div> });
    expect(jsx.type).toBe('html');
    expect(jsx.props.className).toContain('dark');
    expect(jsx.props.className).not.toContain('light');
  });

  it('does not force dark class on SSR when theme_mode cookie is missing or system', async () => {
    mockCookies.mockResolvedValue({
      get: () => undefined,
    });

    const jsx = await RootLayout({ children: <div>Child Content</div> });
    expect(jsx.type).toBe('html');
    expect(jsx.props.className).not.toContain('dark');
  });

  it('evaluates saved storage, cookies, and OS media queries in order in pre-paint themeScript', async () => {
    mockCookies.mockResolvedValue({
      get: () => undefined,
    });

    const jsx = await RootLayout({ children: <div>Child Content</div> });
    const head = jsx.props.children[0];
    const scriptEl = React.Children.toArray(head.props.children).find(
      (child): child is React.ReactElement<{ dangerouslySetInnerHTML: { __html: string } }> =>
        React.isValidElement(child) && child.type === 'script'
    );
    expect(scriptEl).toBeDefined();
    const scriptCode = scriptEl!.props.dangerouslySetInnerHTML.__html;

    const prevMatchMedia = window.matchMedia;
    try {
      // 1. Light OS, no storage, no cookie -> light
      localStorage.clear();
      document.cookie = 'theme_mode=; path=/; max-age=0';
      document.documentElement.className = '';
      window.matchMedia = jest.fn().mockReturnValue({ matches: false });
      new Function(scriptCode)();
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);

      // 2. Dark OS, no storage, no cookie -> dark
      document.documentElement.className = '';
      window.matchMedia = jest.fn().mockReturnValue({ matches: true });
      new Function(scriptCode)();
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      // 3. Cookie overrides OS media query when localStorage is empty
      document.documentElement.className = '';
      document.cookie = 'theme_mode=light; path=/';
      window.matchMedia = jest.fn().mockReturnValue({ matches: true });
      new Function(scriptCode)();
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(document.documentElement.classList.contains('dark')).toBe(false);

      // 4. Saved localStorage overrides cookie and OS media query
      document.documentElement.className = '';
      localStorage.setItem('theme_mode', 'dark');
      document.cookie = 'theme_mode=light; path=/';
      window.matchMedia = jest.fn().mockReturnValue({ matches: false });
      new Function(scriptCode)();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('light')).toBe(false);
    } finally {
      localStorage.clear();
      document.cookie = 'theme_mode=; path=/; max-age=0';
      document.documentElement.className = '';
      window.matchMedia = prevMatchMedia;
    }
  });

  it('wraps SetupWizard inside ThemeProvider when site is uninitialized and supports STATIC_EXPORT without cookies', async () => {
    const configMod = await import('@/lib/config');
    (configMod.isSiteInitialized as jest.Mock).mockReturnValueOnce(false);
    const prevStaticExport = process.env.STATIC_EXPORT;
    process.env.STATIC_EXPORT = 'true';

    try {
      const jsx = await RootLayout({ children: <div>Child Content</div> });
      expect(mockCookies).not.toHaveBeenCalled();

      const body = jsx.props.children[1];
      const themeProviderEl = React.Children.toArray(body.props.children).find(
        (child): child is React.ReactElement<{ hasServerStylesheet?: boolean; children?: React.ReactNode }> =>
          React.isValidElement(child) &&
          (child.props as { hasServerStylesheet?: boolean }).hasServerStylesheet === true
      );
      expect(themeProviderEl).toBeDefined();
      const innerChild = themeProviderEl!.props.children as React.ReactElement;
      expect(React.isValidElement(innerChild)).toBe(true);
      expect(typeof innerChild.type === 'function' && innerChild.type.name).toBe('SetupWizard');
    } finally {
      if (prevStaticExport === undefined) {
        delete process.env.STATIC_EXPORT;
      } else {
        process.env.STATIC_EXPORT = prevStaticExport;
      }
    }
  });

  it('renders complete server stylesheet in head with dynamic-theme-style id and WCAG contrast tokens', async () => {
    mockCookies.mockResolvedValue({
      get: () => undefined,
    });

    const jsx = await RootLayout({ children: <div>Child Content</div> });
    const head = jsx.props.children[0];
    expect(head.type).toBe('head');

    // Find style element in head
    const styleEl = React.Children.toArray(head.props.children).find(
      (child): child is React.ReactElement<{ id?: string; dangerouslySetInnerHTML: { __html: string } }> =>
        React.isValidElement(child) && child.type === 'style' && (child.props as { id?: string }).id === 'dynamic-theme-style'
    );

    expect(styleEl).toBeDefined();
    const serverCss = styleEl!.props.dangerouslySetInnerHTML.__html;

    // Check complete token sets: root, light, dark, and container selectors
    expect(serverCss).toContain(':root {');
    expect(serverCss).toContain('--color-primary:');
    expect(serverCss).toContain('--color-primary-text:');
    expect(serverCss).toContain('html:not(.dark),');
    expect(serverCss).toContain('.dark {');
    expect(serverCss).toContain('.bg-white,');

    // Check body has ThemeProvider configured with hasServerStylesheet
    const body = jsx.props.children[1];
    expect(body.type).toBe('body');
    const themeProviderEl = React.Children.toArray(body.props.children).find(
      (child): child is React.ReactElement<{ hasServerStylesheet?: boolean }> =>
        React.isValidElement(child) &&
        (typeof child.type === 'function' && child.type.name === 'ThemeProvider' || (child.props as { hasServerStylesheet?: boolean }).hasServerStylesheet !== undefined)
    );

    expect(themeProviderEl).toBeDefined();
    expect(themeProviderEl!.props.hasServerStylesheet).toBe(true);
  });

  describe('Revoked Guest Invitation SSR Guard', () => {
    const mockHeaders = headers as unknown as jest.Mock;
    const mockRedirect = redirect as unknown as jest.Mock;
    const prismaWithInvite = prisma as unknown as {
      invitationCode?: {
        findUnique?: jest.Mock;
      };
    };
    let originalInvitationCode: typeof prismaWithInvite.invitationCode;
    let mockFindUnique: jest.Mock;

    beforeEach(() => {
      originalInvitationCode = prismaWithInvite.invitationCode;
      mockFindUnique = jest.fn();
      prismaWithInvite.invitationCode = {
        findUnique: mockFindUnique,
      };
    });

    afterEach(() => {
      prismaWithInvite.invitationCode = originalInvitationCode;
    });

    it('redirects with 303 digest to /guest/login when guest_invite_session is deleted or rotated and fallback cookies are absent', async () => {
      mockFindUnique.mockResolvedValue(null);
      const revokedToken = await signGuestInviteSessionToken({
        code: 'REVOKEME1',
        guestName: 'Former Guest',
      });

      mockCookies.mockResolvedValue({
        get: (name: string) => (name === GUEST_INVITE_COOKIE ? { value: revokedToken } : undefined),
      });
      mockHeaders.mockResolvedValue({
        get: (name: string) => {
          if (name === 'x-guest-gated-page') return '1';
          if (name === 'x-guest-callback-url') return '/photos';
          return null;
        },
      });

      let caughtError: (Error & { digest?: string }) | null = null;
      try {
        await RootLayout({ children: <div>Photos Content</div> });
      } catch (err) {
        caughtError = err as Error & { digest?: string };
      }

      expect(mockRedirect).toHaveBeenCalledWith('/guest/login?callbackUrl=%2Fphotos');
      expect(caughtError?.digest).toBe('NEXT_REDIRECT;replace;/guest/login?callbackUrl=%2Fphotos;303;');
    });

    it('does not redirect when caller also holds a valid guest_auth cookie', async () => {
      mockFindUnique.mockResolvedValue(null);
      const revokedToken = await signGuestInviteSessionToken({
        code: 'REVOKEME1',
        guestName: 'Former Guest',
      });
      const validGuestToken = await signGuestToken({
        guest: true,
        exp: Date.now() + 60_000,
      });

      mockCookies.mockResolvedValue({
        get: (name: string) => {
          if (name === GUEST_INVITE_COOKIE) return { value: revokedToken };
          if (name === GUEST_COOKIE) return { value: validGuestToken };
          return undefined;
        },
      });
      mockHeaders.mockResolvedValue({
        get: (name: string) => (name === 'x-guest-gated-page' ? '1' : null),
      });

      const jsx = await RootLayout({ children: <div>Guest Content</div> });
      expect(jsx.type).toBe('html');
      expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('does not redirect on excluded /guest/login route even when holding a revoked guest_invite_session', async () => {
      mockFindUnique.mockResolvedValue(null);
      const revokedToken = await signGuestInviteSessionToken({
        code: 'REVOKEME1',
        guestName: 'Former Guest',
      });

      mockCookies.mockResolvedValue({
        get: (name: string) => (name === GUEST_INVITE_COOKIE ? { value: revokedToken } : undefined),
      });
      mockHeaders.mockResolvedValue({
        get: (name: string) => {
          if (name === 'x-guest-gated-page') return '0';
          if (name === 'x-guest-callback-url') return '/guest/login';
          return null;
        },
      });

      const jsx = await RootLayout({ children: <div>Login Form</div> });
      expect(jsx.type).toBe('html');
      expect(mockRedirect).not.toHaveBeenCalled();
    });
  });

  describe('Layout Config Authentication Gating', () => {
    const mockHeaders = headers as unknown as jest.Mock;
    const prismaWithInvite = prisma as unknown as {
      invitationCode?: {
        findUnique?: jest.Mock;
      };
    };
    let originalInvitationCode: typeof prismaWithInvite.invitationCode;
    let mockFindUnique: jest.Mock;

    const fullRawConfig = {
      id: 'global',
      partner1Name: 'Alice',
      partner2Name: 'Bob',
      brideName: 'Alice',
      groomName: 'Bob',
      weddingDate: new Date('2026-06-20T16:00:00.000Z'),
      baseUrl: 'https://wedding.example',
      venueName: 'Private Estate',
      venueAddress: '99 Secret Garden Way',
      venueCity: 'Napa',
      venueState: 'CA',
      venueZip: '94558',
      latitude: 38.2975,
      longitude: -122.2869,
      venueDescription: 'Enter via private west gate',
      storyText: 'Private love story details',
      travelAdvice: 'Shuttle departs from private terminal',
      heroTitle: 'Welcome to Napa',
      heroSubtitle: 'Private Estate Weekend',
      photoAlbumUrl: 'https://photos.example.invalid/album-secret',
      seoTitle: 'Alice & Bob',
      seoDescription: 'Wedding celebration',
      seoKeywords: 'wedding',
      faviconUrl: '/assets/favicon.png',
      ogImageUrl: '/images/placeholder.png',
      contactEmail: 'hosts@wedding.example',
      timezone: 'America/Los_Angeles',
      rsvpOpen: true,
      rsvpDeadlineDate: '2099-05-01',
      rsvpClosedMessage: 'RSVPs are closed.',
      colorPrimary: '#991B1B',
      colorSecondary: '#B45309',
      features: [
        {
          id: 'venue',
          type: 'venue',
          title: 'Estate Directions',
          content: 'Gate code 1234',
          visible: true,
        },
        {
          id: 'hidden-draft',
          type: 'custom',
          title: 'Hidden Section Title',
          content: 'Hidden Section Secret Copy',
          visible: false,
        },
      ],
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    function extractThemeProviderConfig(jsx: Awaited<ReturnType<typeof RootLayout>>) {
      const body = jsx.props.children[1] as React.ReactElement<{ children?: React.ReactNode }>;
      const themeProviderEl = React.Children.toArray(body.props.children).find(
        (child): child is React.ReactElement<{ config: Record<string, any>; hasServerStylesheet?: boolean }> =>
          React.isValidElement(child) &&
          (child.props as { hasServerStylesheet?: boolean }).hasServerStylesheet === true
      );
      expect(themeProviderEl).toBeDefined();
      return themeProviderEl!.props.config;
    }

    beforeEach(async () => {
      originalInvitationCode = prismaWithInvite.invitationCode;
      mockFindUnique = jest.fn();
      prismaWithInvite.invitationCode = {
        findUnique: mockFindUnique,
      };
      const configMod = await import('@/lib/config');
      (configMod.getAppConfig as jest.Mock).mockResolvedValue(fullRawConfig);
      mockHeaders.mockResolvedValue({
        get: (name: string) => {
          if (name === 'x-guest-gated-page') return '0';
          if (name === 'x-guest-callback-url') return '/guest/login';
          return null;
        },
      });
    });

    afterEach(() => {
      prismaWithInvite.invitationCode = originalInvitationCode;
    });

    it('passes redacted toUnauthenticatedAppConfig to layout client components for unauthenticated requests', async () => {
      const configMod = await import('@/lib/config');
      mockCookies.mockResolvedValue({
        get: () => undefined,
      });

      const jsx = await RootLayout({ children: <div>Login</div> });
      const passedConfig = extractThemeProviderConfig(jsx);

      expect(configMod.toUnauthenticatedAppConfig).toHaveBeenCalledWith(fullRawConfig);
      expect(passedConfig.photoAlbumUrl).toBe('');
      expect(passedConfig.venueName).toBe('');
      expect(passedConfig.venueAddress).toBe('');
      expect(passedConfig.travelAdvice).toBe('');
      expect(passedConfig.storyText).toBe('');
      expect(passedConfig.heroTitle).toBe('');
      expect(passedConfig.heroSubtitle).toBe('');
      expect(passedConfig.features).toEqual([]);
      expect(passedConfig.partner1Name).toBe('Alice');
      expect(passedConfig.contactEmail).toBe('hosts@wedding.example');
      expect(passedConfig.colorPrimary).toBe('#991B1B');
    });

    it('withholds gated config on /guest/login when caller holds a revoked or sample guest_invite_session cookie', async () => {
      const revokedToken = await signGuestInviteSessionToken({
        code: 'REVOKED99',
        guestName: 'Revoked Guest',
      });
      mockFindUnique.mockResolvedValueOnce(null);
      mockCookies.mockResolvedValue({
        get: (name: string) => (name === GUEST_INVITE_COOKIE ? { value: revokedToken } : undefined),
      });

      const revokedJsx = await RootLayout({ children: <div>Login</div> });
      const revokedConfig = extractThemeProviderConfig(revokedJsx);
      expect(revokedConfig.photoAlbumUrl).toBe('');
      expect(revokedConfig.venueAddress).toBe('');
      expect(revokedConfig.features).toEqual([]);

      const sampleToken = await signGuestInviteSessionToken({
        code: 'SAMPLE99',
        guestName: 'Sample Guest',
      });
      mockFindUnique.mockResolvedValueOnce({
        id: 'sample-id',
        code: 'SAMPLE99',
        isSample: true,
      });
      mockCookies.mockResolvedValue({
        get: (name: string) => (name === GUEST_INVITE_COOKIE ? { value: sampleToken } : undefined),
      });

      const sampleJsx = await RootLayout({ children: <div>Login</div> });
      const sampleConfig = extractThemeProviderConfig(sampleJsx);
      expect(sampleConfig.photoAlbumUrl).toBe('');
      expect(sampleConfig.venueAddress).toBe('');
      expect(sampleConfig.features).toEqual([]);
    });

    it('passes toPublicAppConfig (with hidden sections still redacted) when authenticated via active guest_invite_session, guest_auth, or admin_auth', async () => {
      // 1. Active non-sample guest_invite_session
      const activeInviteToken = await signGuestInviteSessionToken({
        code: 'ACTIVE2026',
        guestName: 'Invited Guest',
      });
      mockFindUnique.mockResolvedValueOnce({
        id: 'inv-active',
        code: 'ACTIVE2026',
        isSample: false,
      });
      mockCookies.mockResolvedValue({
        get: (name: string) => (name === GUEST_INVITE_COOKIE ? { value: activeInviteToken } : undefined),
      });

      const inviteJsx = await RootLayout({ children: <div>Home</div> });
      const inviteConfig = extractThemeProviderConfig(inviteJsx);
      expect(inviteConfig.photoAlbumUrl).toBe('https://photos.example.invalid/album-secret');
      expect(inviteConfig.venueAddress).toBe('99 Secret Garden Way');
      expect(inviteConfig.travelAdvice).toBe('Shuttle departs from private terminal');
      expect(inviteConfig.features).toEqual([
        {
          id: 'venue',
          type: 'venue',
          title: 'Estate Directions',
          content: 'Gate code 1234',
          visible: true,
        },
        {
          id: 'hidden-draft',
          type: 'custom',
          title: '',
          content: '',
          visible: false,
        },
      ]);

      // 2. Valid guest_auth token
      const guestToken = await signGuestToken({
        guest: true,
        exp: Date.now() + 60_000,
      });
      mockCookies.mockResolvedValue({
        get: (name: string) => (name === GUEST_COOKIE ? { value: guestToken } : undefined),
      });

      const guestJsx = await RootLayout({ children: <div>Home</div> });
      const guestConfig = extractThemeProviderConfig(guestJsx);
      expect(guestConfig.venueAddress).toBe('99 Secret Garden Way');
      expect(guestConfig.features[1]).toEqual({
        id: 'hidden-draft',
        type: 'custom',
        title: '',
        content: '',
        visible: false,
      });

      // 3. Valid admin_auth token
      const adminToken = await signAdminToken({
        isAdmin: true,
        iat: Date.now(),
        exp: Date.now() + 60_000,
      });
      mockCookies.mockResolvedValue({
        get: (name: string) => (name === ADMIN_COOKIE ? { value: adminToken } : undefined),
      });

      const adminJsx = await RootLayout({ children: <div>Dashboard</div> });
      const adminConfig = extractThemeProviderConfig(adminJsx);
      expect(adminConfig.venueAddress).toBe('99 Secret Garden Way');
      expect(adminConfig.photoAlbumUrl).toBe('https://photos.example.invalid/album-secret');
    });
  });
});
