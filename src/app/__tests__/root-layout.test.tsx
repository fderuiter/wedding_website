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

  it('renders full preset tokens and dark mode selectors inside a single <style id="dynamic-theme-style"> tag in <head>', async () => {
    mockCookies.mockResolvedValue({
      get: () => undefined,
    });

    const jsx = await RootLayout({ children: <div>Child Content</div> });
    const head = jsx.props.children.find((child: any) => child && child.type === 'head');
    expect(head).toBeDefined();

    const styleTag = head.props.children.find(
      (child: any) => child && child.type === 'style' && child.props.id === 'dynamic-theme-style'
    );
    expect(styleTag).toBeDefined();

    const cssText = styleTag.props.dangerouslySetInnerHTML.__html;
    expect(cssText).toContain(':root {');
    expect(cssText).toContain('--color-primary:');
    expect(cssText).toContain('--btn-radius:');
    expect(cssText).toContain('--dialog-bg:');
    expect(cssText).toContain('html:not(.dark)');
    expect(cssText).toContain('.dark {');
  });
});
