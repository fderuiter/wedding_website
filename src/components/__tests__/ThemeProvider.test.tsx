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
