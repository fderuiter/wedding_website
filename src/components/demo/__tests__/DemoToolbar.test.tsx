import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { axe } from 'jest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { STATIC_MOCK_CONFIG, toPublicAppConfig } from '@/lib/config';
import {
  getDemoState,
  resetDemoState,
} from '@/lib/demo/store';
import { DemoToolbar } from '../DemoToolbar';

const pushMock = jest.fn();
let mockPathname = '/';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

function renderToolbar(initialTheme: 'light' | 'dark' = 'light') {
  const queryClient = new QueryClient();
  const publicConfig = toPublicAppConfig(STATIC_MOCK_CONFIG);

  function StatefulHarness() {
    const [state, setState] = React.useState(() => getDemoState());
    React.useEffect(() => {
      const { subscribeDemoState } = jest.requireActual('@/lib/demo/store') as typeof import('@/lib/demo/store');
      return subscribeDemoState(setState);
    }, []);
    return <DemoToolbar demoState={state} />;
  }

  return render(
    <ThemeProvider config={publicConfig} initialThemeMode={initialTheme}>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <StatefulHarness />
        </QueryClientProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}

describe('DemoToolbar accessibility & interactive controls', () => {
  beforeEach(() => {
    pushMock.mockClear();
    mockPathname = '/';
    window.sessionStorage.clear();
    window.localStorage.clear();
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
    resetDemoState('classic');
  });

  it('passes WCAG 2.2 AA axe-core checks in light mode', async () => {
    document.documentElement.classList.remove('dark');
    document.documentElement.classList.add('light');
    const { container } = renderToolbar('light');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('passes WCAG 2.2 AA axe-core checks in dark mode', async () => {
    document.documentElement.classList.remove('light');
    document.documentElement.classList.add('dark');
    const { container } = renderToolbar('dark');
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('switches personas, toggles Setup Wizard preview, changes archetypes, collapses, and resets state', () => {
    renderToolbar('light');

    expect(screen.getByTestId('demo-toolbar-docs-link')).toHaveAttribute(
      'href',
      '/wedding_website/'
    );

    fireEvent.click(screen.getByTestId('demo-persona-registry'));
    expect(pushMock).toHaveBeenCalledWith('/registry');

    fireEvent.click(screen.getByTestId('demo-persona-heart'));
    expect(pushMock).toHaveBeenCalledWith('/heart');

    fireEvent.click(screen.getByTestId('demo-persona-admin'));
    expect(pushMock).toHaveBeenCalledWith('/admin/dashboard');
    expect(window.localStorage.getItem('isAdminLoggedIn')).toBe('true');

    fireEvent.click(screen.getByTestId('demo-persona-wizard'));
    expect(getDemoState().setupWizardPreview).toBe(true);
    expect(screen.getByTestId('demo-persona-wizard')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('demo-archetype-destination'));
    expect(getDemoState().activeArchetype).toBe('destination');
    expect(getDemoState().setupWizardPreview).toBe(false);

    fireEvent.click(screen.getByTestId('demo-reset-button'));
    expect(getDemoState().activeArchetype).toBe('classic');

    const collapseBtn = screen.getByTestId('demo-toolbar-collapse');
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(collapseBtn);
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'false');
  });
});
