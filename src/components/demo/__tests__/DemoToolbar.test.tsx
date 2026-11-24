import { useEffect, useLayoutEffect, useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';
import { getServerExportTokens, THEME_PRESET_KEYS } from '@/lib/theme/presets';
import { ToastProvider } from '@/components/ui/ToastProvider';
import RootLayoutClient from '@/components/layout/RootLayoutClient';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { checkAdminClient } from '@/core/auth/auth.client';
import { isDemoRuntimeActive, resetDemoState } from '@/lib/demo/demoStore';
import { APP_DEFAULTS } from '@/lib/config';
import { PublicAppConfigSchema } from '@/features/content';

expect.extend(toHaveNoViolations);

let mockPathname = '/';
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock('@/components/ui/GlobalRadialGlow', () => ({
  GlobalRadialGlow: () => <div data-testid="global-glow" />,
}));

const baseConfig = PublicAppConfigSchema.strip().parse({
  ...APP_DEFAULTS,
  latitude: 0,
  longitude: 0,
  partner1Name: 'Alex',
  partner2Name: 'Taylor',
  weddingDate: new Date('2026-10-18T16:00:00Z'),
  venueName: 'The Grand Conservatory',
  venueCity: 'Chicago',
  venueState: 'IL',
  timezone: 'America/Chicago',
  baseUrl: 'https://alexandtaylor2026.wedding',
  contactEmail: 'hello@alexandtaylor2026.wedding',
  colorPrimary: '#9f1239',
  colorSecondary: '#fff1f2',
  themePreset: 'classic',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
});

function DemoConsumerProbe() {
  const demo = useOptionalDemo();
  const { themePreset, themePrimary } = useTheme();
  return (
    <div data-testid="demo-probe">
      <span data-testid="probe-persona">{demo?.persona ?? 'none'}</span>
      <span data-testid="probe-archetype">{demo?.archetype ?? 'none'}</span>
      <span data-testid="probe-theme">{themePreset}</span>
      <span data-testid="probe-primary">{themePrimary}</span>
      <span data-testid="probe-first-item">
        {demo?.activeDataset.registryItems[0]?.name ?? 'none'}
      </span>
      <span data-testid="probe-first-party">
        {demo?.activeDataset.weddingParty[0]?.name ?? 'none'}
      </span>
      <span data-testid="probe-first-attraction">
        {demo?.activeDataset.attractions[0]?.name ?? 'none'}
      </span>
      <span data-testid="probe-first-table">
        {demo?.activeDataset.seatingTables[0]?.name ?? 'none'}
      </span>
      <span data-testid="probe-first-code">
        {demo?.activeDataset.guests[0]?.code ?? 'none'}
      </span>
    </div>
  );
}

function ChildMountFetchProbe() {
  const [cardEnabled, setCardEnabled] = useState<string>('pending');

  useEffect(() => {
    let active = true;
    void fetch('/api/registry/capabilities')
      .then((res) => res.json())
      .then((payload: { cardCheckoutEnabled?: boolean }) => {
        if (active) {
          setCardEnabled(String(Boolean(payload.cardCheckoutEnabled)));
        }
      })
      .catch(() => {
        if (active) {
          setCardEnabled('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return <div data-testid="child-mount-caps">{cardEnabled}</div>;
}

function ColdStartWeatherChild() {
  const [forecastCount, setForecastCount] = useState<string>('pending');

  useLayoutEffect(() => {
    let active = true;
    void fetch('/api/weather')
      .then((res) => res.json())
      .then((payload: { daily?: { time?: string[] } }) => {
        if (active) {
          setForecastCount(String(payload.daily?.time?.length ?? 0));
        }
      })
      .catch(() => {
        if (active) {
          setForecastCount('error');
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return <div data-testid="cold-start-weather-days">{forecastCount}</div>;
}

function renderDemoShell(isStaticExport = true, extraChild?: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RootLayoutClient config={baseConfig} isStaticExport={isStaticExport}>
            <DemoConsumerProbe />
            {extraChild}
          </RootLayoutClient>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('DemoToolbar & DemoProvider', () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

  beforeEach(() => {
    mockPathname = '/';
    mockPush.mockReset();
    window.localStorage.clear();
    resetDemoState();
    delete process.env.NEXT_PUBLIC_BASE_PATH;
  });

  afterEach(() => {
    if (originalBasePath === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    }
  });

  it('does not render DemoToolbar or activate demo runtime when isStaticExport is false (standalone server mode)', async () => {
    renderDemoShell(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('demo-toolbar')).not.toBeInTheDocument();
    expect(screen.queryByTestId('demo-showcase-links')).not.toBeInTheDocument();
    expect(screen.getByTestId('probe-persona')).toHaveTextContent('none');
    expect(isDemoRuntimeActive()).toBe(false);
  });

  it('installs the demo fetch interceptor before child useEffect hooks call /api/* when isStaticExport is true', async () => {
    const originalFetch = window.fetch;
    const uninterceptedCapabilitiesCalls: string[] = [];
    window.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/registry/capabilities')) {
        uninterceptedCapabilitiesCalls.push(url);
      }
      return new Response(JSON.stringify({ cardCheckoutEnabled: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof window.fetch;

    try {
      renderDemoShell(true, <ChildMountFetchProbe />);
      await waitFor(() => {
        expect(screen.getByTestId('child-mount-caps')).toHaveTextContent('true');
      });
      expect(uninterceptedCapabilitiesCalls).toHaveLength(0);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('intercepts child useLayoutEffect /api/weather requests synchronously on cold start before ActiveDemoProvider effects run', async () => {
    const originalFetch = window.fetch;
    const leakedNetworkCalls: string[] = [];
    window.fetch = jest.fn(async (input: RequestInfo | URL) => {
      leakedNetworkCalls.push(String(input));
      return new Response(JSON.stringify({ error: 'network leaked' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof window.fetch;

    try {
      renderDemoShell(true, <ColdStartWeatherChild />);
      await waitFor(() => {
        expect(screen.getByTestId('cold-start-weather-days')).toHaveTextContent('1');
      });
      expect(leakedNetworkCalls).toHaveLength(0);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('renders subpath-safe showcase links to /, /api/, and /storybook/ in both expanded and collapsed toolbar states', async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
    const { unmount } = renderDemoShell(true);

    const assertShowcaseLinks = (expectedPrefix: string) => {
      const docsLink = screen.getByTestId('demo-link-docs');
      const apiLink = screen.getByTestId('demo-link-api');
      const storybookLink = screen.getByTestId('demo-link-storybook');

      expect(docsLink).toHaveAttribute('href', `${expectedPrefix}/`);
      expect(docsLink).toHaveAttribute('data-static-demo-bypass', 'true');
      expect(apiLink).toHaveAttribute('href', `${expectedPrefix}/api/`);
      expect(apiLink).toHaveAttribute('data-static-demo-bypass', 'true');
      expect(storybookLink).toHaveAttribute('href', `${expectedPrefix}/storybook/`);
      expect(storybookLink).toHaveAttribute('data-static-demo-bypass', 'true');
      expect(storybookLink).toHaveAttribute('target', '_blank');
      expect(storybookLink).toHaveAttribute('rel', 'noopener noreferrer');
    };

    // Expanded state on repository subpath
    const toggleBtn = await screen.findByTestId('demo-toolbar-toggle');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    assertShowcaseLinks('/wedding_website');

    // Collapsed state on repository subpath
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    assertShowcaseLinks('/wedding_website');

    unmount();
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    renderDemoShell(true);
    await screen.findByTestId('demo-toolbar-toggle');
    assertShowcaseLinks('');
  });

  it('renders DemoToolbar with Invited Guest active by default and persists visitor selections across remounts', async () => {
    const { unmount } = renderDemoShell(true);

    expect(await screen.findByTestId('demo-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('demo-persona-guest')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('demo-persona-admin')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('demo-persona-setup')).toHaveAttribute('aria-pressed', 'false');

    // Switch archetype and collapse toolbar
    fireEvent.change(screen.getByTestId('demo-archetype-select'), {
      target: { value: 'destination' },
    });
    const toggleBtn = screen.getByTestId('demo-toolbar-toggle');
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    unmount();

    // Remount on another route and confirm persistence
    mockPathname = '/registry';
    renderDemoShell(true);
    expect(await screen.findByTestId('demo-toolbar-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    expect(screen.getByTestId('probe-archetype')).toHaveTextContent('destination');

    // Expand toolbar again
    fireEvent.click(screen.getByTestId('demo-toolbar-toggle'));
    expect(screen.getByTestId('demo-archetype-select')).toHaveValue('destination');
  });

  it('switches to Couple Admin to unlock Dashboard links and checkAdminClient(), and returns to Invited Guest on Navbar Logout', async () => {
    renderDemoShell(true);
    expect(await screen.findByTestId('demo-toolbar')).toBeInTheDocument();

    expect(await checkAdminClient()).toBe(false);
    expect(screen.queryByRole('link', { name: /^Dashboard$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('demo-persona-admin'));

    expect(screen.getByTestId('demo-persona-admin')).toHaveAttribute('aria-pressed', 'true');
    expect(await checkAdminClient()).toBe(true);
    expect(screen.getAllByRole('link', { name: /^Dashboard$/i })[0]).toHaveAttribute(
      'href',
      '/admin/dashboard'
    );

    const logoutButtons = screen.getAllByRole('button', { name: /Logout/i });
    fireEvent.click(logoutButtons[0]);

    await waitFor(async () => {
      expect(screen.getByTestId('demo-persona-guest')).toHaveAttribute('aria-pressed', 'true');
      expect(await checkAdminClient()).toBe(false);
    });
  });

  it('switches to First-Run Setup and walks through all 5 SetupWizard steps locally without server requests', async () => {
    const fetchSpy = jest.spyOn(window, 'fetch');
    renderDemoShell(true);
    expect(await screen.findByTestId('demo-toolbar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('demo-persona-setup'));
    expect(screen.getByTestId('demo-persona-setup')).toHaveAttribute('aria-pressed', 'true');

    // Step 1: Unlock wizard (SetupWizard is dynamically imported on demand)
    const passwordInput = await screen.findByLabelText(/Admin Password/i);
    expect(passwordInput).toBeInTheDocument();
    fireEvent.change(passwordInput, {
      target: { value: 'demo-showcase-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Continue$/i }));

    // Step 2: The Essentials
    expect(await screen.findByText(/Step 2: The Essentials/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Partner 1$/i), {
      target: { value: 'Jordan' },
    });
    fireEvent.change(screen.getByLabelText(/^Partner 2$/i), {
      target: { value: 'Casey' },
    });
    fireEvent.change(screen.getByLabelText(/Site URL/i), {
      target: { value: 'https://jordanandcasey2026.wedding' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Next Step$/i }));

    // Step 3: Sample Data Selection
    expect(await screen.findByText(/Step 3: Sample Data Selection/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Populate Sample Data & Continue/i }));

    // Step 4: Guest List Import
    expect(await screen.findByText(/Step 4: Guest List Import/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Skip for Now/i }));

    // Step 5: Complete Setup
    expect(await screen.findByText(/Step 5: Complete Setup/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Go to Admin Dashboard/i }));

    expect(screen.getByTestId('demo-persona-admin')).toHaveAttribute('aria-pressed', 'true');
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');

    // Confirm zero calls to /api/admin/setup were sent
    const setupCalls = fetchSpy.mock.calls.filter(([input]) =>
      String(input).includes('/api/admin/setup')
    );
    expect(setupCalls).toHaveLength(0);
    fetchSpy.mockRestore();
  });

  it('switches live across all 3 wedding archetypes and all 5 visual theme presets', async () => {
    renderDemoShell(true);
    expect(await screen.findByTestId('demo-toolbar')).toBeInTheDocument();

    // Classic defaults
    expect(screen.getByTestId('probe-first-item')).toHaveTextContent('KitchenAid Stand Mixer');
    expect(screen.getByTestId('probe-first-code')).toHaveTextContent('SMITH2026');

    // Destination archetype
    fireEvent.change(screen.getByTestId('demo-archetype-select'), {
      target: { value: 'destination' },
    });
    expect(screen.getByTestId('probe-first-item')).toHaveTextContent('Hardside Spinner Luggage Set');
    expect(screen.getByTestId('probe-first-party')).toHaveTextContent('Jordan Lee');
    expect(screen.getByTestId('probe-first-attraction')).toHaveTextContent(
      'Oceanview Palms Resort & Spa'
    );
    expect(screen.getByTestId('probe-first-table')).toHaveTextContent('Sunset Terrace Cabana');
    expect(screen.getByTestId('probe-first-code')).toHaveTextContent('RODRIGUEZ2026');

    // Romantic archetype
    fireEvent.change(screen.getByTestId('demo-archetype-select'), {
      target: { value: 'romantic' },
    });
    expect(screen.getByTestId('probe-first-item')).toHaveTextContent('Handcrafted Oak Serving Board');
    expect(screen.getByTestId('probe-first-code')).toHaveTextContent('GRANDPARENTS2026');

    // Switch through all 5 theme presets
    for (const preset of THEME_PRESET_KEYS) {
      const expectedPrimary = getServerExportTokens(preset).colorPrimary;
      fireEvent.change(screen.getByTestId('demo-theme-preset-select'), {
        target: { value: preset },
      });
      expect(screen.getByTestId('probe-theme')).toHaveTextContent(preset);
      expect(screen.getByTestId('probe-primary')).toHaveTextContent(expectedPrimary);
    }
  });

  it('resets local overrides, persona, archetype, and theme preset when clicking Reset Demo', async () => {
    window.localStorage.setItem('setup_wizard_draft', JSON.stringify({ step: 4 }));
    window.localStorage.setItem('isAdminLoggedIn', 'true');

    renderDemoShell(true);
    expect(await screen.findByTestId('demo-toolbar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('demo-persona-admin'));
    fireEvent.change(screen.getByTestId('demo-archetype-select'), {
      target: { value: 'romantic' },
    });
    fireEvent.change(screen.getByTestId('demo-theme-preset-select'), {
      target: { value: 'editorial' },
    });

    fireEvent.click(screen.getByTestId('demo-reset-button'));

    expect(screen.getByTestId('demo-persona-guest')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('probe-archetype')).toHaveTextContent('classic');
    expect(screen.getByTestId('probe-theme')).toHaveTextContent('classic');
    expect(window.localStorage.getItem('setup_wizard_draft')).toBeNull();
    expect(window.localStorage.getItem('isAdminLoggedIn')).toBeNull();
  });

  it('renders nothing when demo mode is disabled and copies sample invite code when enabled', async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });

    const disabledView = renderDemoShell(false);
    expect(screen.queryByTestId('demo-toolbar')).not.toBeInTheDocument();
    disabledView.unmount();

    renderDemoShell(true);
    fireEvent.click(await screen.findByTestId('demo-sample-code-button'));
    expect(writeTextMock).toHaveBeenCalledWith('SMITH2026');
  });

  it('has zero axe accessibility violations in light and dark modes', async () => {
    const { container } = renderDemoShell(true);
    expect(await screen.findByTestId('demo-toolbar')).toBeInTheDocument();
    const lightResults = await axe(container);
    expect(lightResults).toHaveNoViolations();

    document.documentElement.classList.add('dark');
    const darkResults = await axe(container);
    expect(darkResults).toHaveNoViolations();
    document.documentElement.classList.remove('dark');
  });

  it('resolves the parent Docs Portal link across root and GitHub Pages subpath base paths', async () => {
    const prevBase = process.env.NEXT_PUBLIC_BASE_PATH;
    try {
      process.env.NEXT_PUBLIC_BASE_PATH = '/wedding_website/demo';
      const { unmount } = renderDemoShell(true);
      expect(await screen.findByTestId('demo-portal-link')).toHaveAttribute(
        'href',
        '/wedding_website/'
      );
      expect(document.documentElement.dataset.staticDemo).toBe('true');
      unmount();
      expect(document.documentElement.dataset.staticDemo).toBeUndefined();
    } finally {
      if (prevBase === undefined) {
        delete process.env.NEXT_PUBLIC_BASE_PATH;
      } else {
        process.env.NEXT_PUBLIC_BASE_PATH = prevBase;
      }
    }
  });
});
