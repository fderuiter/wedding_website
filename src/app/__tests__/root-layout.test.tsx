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
});
