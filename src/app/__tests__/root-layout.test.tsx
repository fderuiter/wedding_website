import React from 'react';
import RootLayout from '../layout';
import { cookies } from 'next/headers';

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
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

  it('defaults to dark class when theme_mode cookie is missing or system', async () => {
    mockCookies.mockResolvedValue({
      get: () => undefined,
    });

    const jsx = await RootLayout({ children: <div>Child Content</div> });
    expect(jsx.type).toBe('html');
    expect(jsx.props.className).toContain('dark');
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
});
