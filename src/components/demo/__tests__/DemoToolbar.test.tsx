import { useLayoutEffect, useState } from 'react';
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
import { resetDemoState } from '@/lib/demo/demoStore';
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

function renderDemoShell(isStaticExport = true) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RootLayoutClient config={baseConfig} isStaticExport={isStaticExport}>
            <DemoConsumerProbe />
          </RootLayoutClient>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('DemoToolbar & DemoProvider', () => {
  beforeEach(() => {
    mockPathname = '/';
    mockPush.mockReset();
    window.localStorage.clear();
    resetDemoState();
  });

  it('does not render DemoToolbar when isStaticExport is false (standalone server mode)', () => {
    renderDemoShell(false);
    expect(screen.queryByTestId('demo-toolbar')).not.toBeInTheDocument();
    expect(screen.getByTestId('probe-persona')).toHaveTextContent('none');
  });

  it('renders DemoToolbar with Invited Guest active by default and persists visitor selections across remounts', () => {
    const { unmount } = renderDemoShell(true);

    expect(screen.getByTestId('demo-toolbar')).toBeInTheDocument();
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
    expect(screen.getByTestId('demo-toolbar-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('probe-archetype')).toHaveTextContent('destination');

    // Expand toolbar again
    fireEvent.click(screen.getByTestId('demo-toolbar-toggle'));
    expect(screen.getByTestId('demo-archetype-select')).toHaveValue('destination');
  });

  it('switches to Couple Admin to unlock Dashboard links and checkAdminClient(), and returns to Invited Guest on Navbar Logout', async () => {
    renderDemoShell(true);

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

    fireEvent.click(screen.getByTestId('demo-persona-setup'));
    expect(screen.getByTestId('demo-persona-setup')).toHaveAttribute('aria-pressed', 'true');

    // Step 1: Unlock wizard
    expect(screen.getByLabelText(/Admin Password/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Admin Password/i), {
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

  it('switches live across all 3 wedding archetypes and all 5 visual theme presets', () => {
    renderDemoShell(true);

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

  it('resets local overrides, persona, archetype, and theme preset when clicking Reset Demo', () => {
    window.localStorage.setItem('setup_wizard_draft', JSON.stringify({ step: 4 }));
    window.localStorage.setItem('isAdminLoggedIn', 'true');

    renderDemoShell(true);

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
    fireEvent.click(screen.getByTestId('demo-sample-code-button'));
    expect(writeTextMock).toHaveBeenCalledWith('SMITH2026');
  });

  it('has zero axe accessibility violations in light and dark modes', async () => {
    const { container } = renderDemoShell(true);
    const lightResults = await axe(container);
    expect(lightResults).toHaveNoViolations();

    document.documentElement.classList.add('dark');
    const darkResults = await axe(container);
    expect(darkResults).toHaveNoViolations();
    document.documentElement.classList.remove('dark');
  });

  it('intercepts child useLayoutEffect fetch calls synchronously on cold start before parent effects commit', async () => {
    const originalFetch = window.fetch;
    const networkFallback = jest.fn(async () => new Response('network-leak', { status: 500 }));
    window.fetch = networkFallback as typeof window.fetch;

    function ColdStartChild() {
      const [city, setCity] = useState('loading');
      useLayoutEffect(() => {
        void window
          .fetch('/api/weather')
          .then((res) => res.json())
          .then((payload: { venue?: { city?: string } }) => {
            setCity(payload.venue?.city || 'missing');
          });
      }, []);
      return <div data-testid="cold-start-weather">{city}</div>;
    }

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ToastProvider>
              <RootLayoutClient isStaticExport={true} config={baseConfig}>
                <ColdStartChild />
              </RootLayoutClient>
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('cold-start-weather')).toHaveTextContent('Minneapolis');
      });
      expect(networkFallback).not.toHaveBeenCalled();
    } finally {
      window.fetch = originalFetch;
    }
  });
});
