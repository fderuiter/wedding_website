import React from 'react';
import { render, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ThemeProvider, useTheme } from '../ThemeProvider';

// Helper component to display theme values
function TestComponent() {
  const theme = useTheme();
  return (
    <div>
      <span data-testid="theme-primary">{theme.themePrimary}</span>
      <span data-testid="theme-secondary">{theme.themeSecondary}</span>
    </div>
  );
}

describe('ThemeProvider Sanitization', () => {
  it('renders successfully with default values', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(getByTestId('theme-primary')).toHaveTextContent('#B91C1C');
    expect(getByTestId('theme-secondary')).toHaveTextContent('#B45309');
  });

  it('sanitizes malicious colors passed as prop config', () => {
    const maliciousConfig = {
      colorPrimary: '</style><script>alert("xss")</script>',
      colorSecondary: 'red; background: url(javascript:alert(1))',
    };

    const { getByTestId } = render(
      <ThemeProvider config={maliciousConfig}>
        <TestComponent />
      </ThemeProvider>
    );

    // Should sanitize and fall back to defaults
    expect(getByTestId('theme-primary')).toHaveTextContent('#B91C1C');
    expect(getByTestId('theme-secondary')).toHaveTextContent('#B45309');
  });

  it('accepts and renders valid hex colors passed as prop config', () => {
    const validConfig = {
      colorPrimary: '#123456',
      colorSecondary: '#abcdef',
    };

    const { getByTestId } = render(
      <ThemeProvider config={validConfig}>
        <TestComponent />
      </ThemeProvider>
    );

    expect(getByTestId('theme-primary')).toHaveTextContent('#123456');
    expect(getByTestId('theme-secondary')).toHaveTextContent('#abcdef');
  });

  it('sanitizes malicious colors received via window message', () => {
    // Mock parent window to simulate being in an iframe
    const originalParent = window.parent;
    Object.defineProperty(window, 'parent', { writable: true, value: {} });

    const { getByTestId } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    // Send a message with malicious config
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'DRAFT_UPDATE',
            draftType: 'config',
            draftData: {
              colorPrimary: '"><img src=x onerror=alert(1)>',
              colorSecondary: '; color: blue;',
            },
          },
        })
      );
    });

    // Should fall back to default colors
    expect(getByTestId('theme-primary')).toHaveTextContent('#B91C1C');
    expect(getByTestId('theme-secondary')).toHaveTextContent('#B45309');

    // Clean up mock
    Object.defineProperty(window, 'parent', { writable: true, value: originalParent });
  });

  it('accepts valid hex colors received via window message', () => {
    const originalParent = window.parent;
    Object.defineProperty(window, 'parent', { writable: true, value: {} });

    const { getByTestId } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'DRAFT_UPDATE',
            draftType: 'config',
            draftData: {
              colorPrimary: '#333333',
              colorSecondary: '#666666',
            },
          },
        })
      );
    });

    expect(getByTestId('theme-primary')).toHaveTextContent('#333333');
    expect(getByTestId('theme-secondary')).toHaveTextContent('#666666');

    Object.defineProperty(window, 'parent', { writable: true, value: originalParent });
  });
});

describe('ThemeProvider Fault Tolerance', () => {
  let originalGetComputedStyle: typeof window.getComputedStyle;

  beforeAll(() => {
    originalGetComputedStyle = window.getComputedStyle;
  });

  afterEach(() => {
    window.getComputedStyle = originalGetComputedStyle;
  });

  it('handles missing document style capabilities (getComputedStyle returns null)', () => {
    // Mock getComputedStyle to return null (e.g. inside a hidden iframe display: none)
    window.getComputedStyle = () => null as unknown as CSSStyleDeclaration;

    const { getByTestId } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(getByTestId('theme-primary')).toHaveTextContent('#B91C1C');
    expect(getByTestId('theme-secondary')).toHaveTextContent('#B45309');
  });

  it('handles getComputedStyle throwing an error (non-standard environments)', () => {
    // Mock getComputedStyle to throw an error
    window.getComputedStyle = () => {
      throw new Error('SecurityError: Blocked from accessing styles');
    };

    const { getByTestId } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(getByTestId('theme-primary')).toHaveTextContent('#B91C1C');
    expect(getByTestId('theme-secondary')).toHaveTextContent('#B45309');
  });

  it('supplies default theme colors when computed style values are empty strings', () => {
    // Mock getComputedStyle to return empty values for variables
    window.getComputedStyle = () => ({
      getPropertyValue: (_prop: string) => ''
    }) as unknown as CSSStyleDeclaration;

    const { getByTestId } = render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(getByTestId('theme-primary')).toHaveTextContent('#B91C1C');
    expect(getByTestId('theme-secondary')).toHaveTextContent('#B45309');
  });
});

function ThemeModeTestComponent() {
  const { themeMode, mode, setThemeMode, resolvedTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-mode">{themeMode}</span>
      <span data-testid="mode-alias">{mode}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button data-testid="set-light" onClick={() => setThemeMode('light')}>Set Light</button>
      <button data-testid="set-dark" onClick={() => setThemeMode('dark')}>Set Dark</button>
      <button data-testid="set-system" onClick={() => setThemeMode('system')}>Set System</button>
    </div>
  );
}

describe('ThemeProvider Theme Mode Hydration & Synchronization', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'theme_mode=; path=/; max-age=0';
    document.documentElement.className = '';
  });

  it('provides default themeMode as system and resolvedTheme as dark', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <ThemeModeTestComponent />
      </ThemeProvider>
    );

    expect(getByTestId('theme-mode')).toHaveTextContent('system');
    expect(getByTestId('mode-alias')).toHaveTextContent('system');
    expect(getByTestId('resolved-theme')).toHaveTextContent('dark');
  });

  it('respects initialThemeMode prop', () => {
    const { getByTestId } = render(
      <ThemeProvider initialThemeMode="light">
        <ThemeModeTestComponent />
      </ThemeProvider>
    );

    expect(getByTestId('theme-mode')).toHaveTextContent('light');
    expect(getByTestId('resolved-theme')).toHaveTextContent('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('updates themeMode, resolvedTheme, localStorage, cookies, and html class on setThemeMode', () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <ThemeModeTestComponent />
      </ThemeProvider>
    );

    act(() => {
      getByTestId('set-light').click();
    });

    expect(getByTestId('theme-mode')).toHaveTextContent('light');
    expect(getByTestId('resolved-theme')).toHaveTextContent('light');
    expect(localStorage.getItem('theme_mode')).toBe('light');
    expect(document.cookie).toContain('theme_mode=light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      getByTestId('set-dark').click();
    });

    expect(getByTestId('theme-mode')).toHaveTextContent('dark');
    expect(getByTestId('resolved-theme')).toHaveTextContent('dark');
    expect(localStorage.getItem('theme_mode')).toBe('dark');
    expect(document.cookie).toContain('theme_mode=dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('listens to matchMedia changes when themeMode is system', () => {
    let mediaListener: ((e: any) => void) | null = null;
    const matchMediaMock = jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn((_event, handler) => {
        mediaListener = handler;
      }),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    window.matchMedia = matchMediaMock;

    const { getByTestId } = render(
      <ThemeProvider initialThemeMode="system">
        <ThemeModeTestComponent />
      </ThemeProvider>
    );

    expect(getByTestId('theme-mode')).toHaveTextContent('system');

    if (mediaListener) {
      act(() => {
        (mediaListener as any)({ matches: true } as MediaQueryListEvent);
      });
      expect(getByTestId('resolved-theme')).toHaveTextContent('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    }
  });
});

