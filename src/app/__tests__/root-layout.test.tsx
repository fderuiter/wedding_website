import React from 'react';
import RootLayout from '../layout';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { GUEST_INVITE_COOKIE, signGuestInviteSessionToken } from '@/core/auth/guestInviteSession';
import { GUEST_COOKIE, signGuestToken } from '@/core/auth/guest.server';
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

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({ partner1Name: 'Alice', partner2Name: 'Bob' }),
  toPublicAppConfig: jest.fn().mockReturnValue({ partner1Name: 'Alice', partner2Name: 'Bob' }),
  isSiteInitialized: jest.fn().mockReturnValue(true),
}));

jest.mock('@/components/layout/RootLayoutClient', () => {
  return function MockRootLayoutClient({ children }: { children: React.ReactNode }) {
    return <div data-testid="root-layout-client">{children}</div>;
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
});
