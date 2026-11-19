import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { UpdateAppConfigSchema } from '@/features/content';
import { getAppConfig } from '@/lib/config';
import { generateMetadata as generateHomeMetadata } from '@/app/page';
import AdminSettingsPage from '../settings/page';
import HistoryTimelinePage from '../history/page';
import AdminDashboardPage from '../page';
import { formatBackupDiagnosticPath, formatEntitySectionLabel } from '@/utils/adminLabels';
import { createMockRegistryItem } from '@/testing/factories/registryFactory';
import { createMockMedia } from '@/testing/factories/mediaFactory';
import { apiClient as adminApiClient } from '@/features/admin';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn(),
  };
});

jest.mock('@/components/admin/OnboardingChecklist', () => ({
  OnboardingChecklist: () => <div data-testid="mock-onboarding" />,
}));

jest.mock('@/components/admin/AdminPreviewLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/hooks/admin/useAdminBroadcast', () => ({
  useAdminBroadcast: () => ({
    history: [],
    loadingHistory: false,
    retryBroadcast: jest.fn(),
    retrying: false,
    cancelScheduledBroadcast: jest.fn(),
    cancelling: false,
    testConnection: jest.fn(),
    testingConnection: false,
  }),
}));

jest.mock('@/features/admin', () => {
  const actual = jest.requireActual('@/features/admin');
  return {
    ...actual,
    apiClient: {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    },
  };
});

const baseValidPayload = {
  partner1Name: 'Jordan',
  partner2Name: 'Casey',
  brideName: 'StaleOldBride',
  groomName: 'StaleOldGroom',
  weddingDate: '2026-10-10',
  baseUrl: 'https://wedding.example.com',
  venueName: 'Harbor Glasshouse',
  venueAddress: '100 Waterfront Way',
  venueCity: 'Seattle',
  venueState: 'WA',
  venueZip: '98101',
  latitude: 47.6062,
  longitude: -122.3321,
  storyText: 'Our story',
  venueDescription: 'Waterfront venue',
  travelAdvice: 'Light rail available',
  heroTitle: 'Jordan & Casey',
  heroSubtitle: 'October 2026',
  seoTitle: 'Jordan & Casey Wedding',
  seoDescription: 'Celebrate with Jordan & Casey',
  contactEmail: 'hosts@wedding.example.com',
  faviconUrl: '/assets/favicon.png',
  ogImageUrl: '/images/placeholder.png',
  seoKeywords: '{{partner1Name}} and {{partner2Name}} wedding',
  colorPrimary: '#B91C1C',
  colorSecondary: '#B45309',
  themePreset: 'classic',
  themeTokens: {},
  timezone: 'America/Los_Angeles',
};

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{ui}</ToastProvider>
    </QueryClientProvider>
  );
}

describe('Partner Name Synchronization, Guided Overrides & Plain Admin Labels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('synchronizes brideName and groomName aliases in UpdateAppConfigSchema when partner names change', () => {
    const parsed = UpdateAppConfigSchema.parse(baseValidPayload);
    expect(parsed.partner1Name).toBe('Jordan');
    expect(parsed.partner2Name).toBe('Casey');
    expect(parsed.brideName).toBe('Jordan');
    expect(parsed.groomName).toBe('Casey');

    // Legacy fallback when partner1Name and partner2Name are omitted
    const { partner1Name: _p1, partner2Name: _p2, ...legacyOnly } = baseValidPayload;
    void _p1;
    void _p2;
    const legacyParsed = UpdateAppConfigSchema.parse({
      ...legacyOnly,
      brideName: 'LegacyOne',
      groomName: 'LegacyTwo',
    });
    expect(legacyParsed.partner1Name).toBe('LegacyOne');
    expect(legacyParsed.partner2Name).toBe('LegacyTwo');
    expect(legacyParsed.brideName).toBe('LegacyOne');
    expect(legacyParsed.groomName).toBe('LegacyTwo');
  });

  it('generates homepage OpenGraph, Twitter, and JSON-LD Event titles from partner1Name and partner2Name', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      ...baseValidPayload,
      partner1Name: 'Avery',
      partner2Name: 'Quinn',
      brideName: '',
      groomName: '',
      seoTitle: '',
      seoDescription: '',
      weddingDate: new Date('2026-10-10T18:00:00.000Z'),
    });

    const meta = await generateHomeMetadata();
    expect(meta.openGraph?.title).toBe("Avery & Quinn's Wedding");
    expect(meta.twitter?.title).toBe("Avery & Quinn's Wedding");
    expect(meta.description).toBe(
      'Join Avery and Quinn for their wedding celebration at Harbor Glasshouse.'
    );

    const jsonLdRaw = (meta.other as Record<string, string>)['application/ld+json'];
    const jsonLd = JSON.parse(jsonLdRaw);
    expect(jsonLd.name).toBe("Avery & Quinn's Wedding");
  });

  it('refreshes profile switcher labels and saves guided theme overrides in Site Settings', async () => {
    const mockFetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => body,
        });
      }
      if (url.includes('list=true')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => [
            { ...baseValidPayload, id: 'global', multisiteEnabled: true },
            {
              ...baseValidPayload,
              id: 'staging-1',
              subdomain: 'preview',
              partner1Name: 'Sam',
              partner2Name: 'Riley',
              brideName: 'OldBride',
              groomName: 'OldGroom',
              multisiteEnabled: true,
            },
          ],
        });
      }
      if (url.includes('id=staging-1')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            ...baseValidPayload,
            id: 'staging-1',
            subdomain: 'preview',
            partner1Name: 'Sam',
            partner2Name: 'Riley',
            brideName: 'OldBride',
            groomName: 'OldGroom',
            multisiteEnabled: true,
            themeTokens: { '--print-bg': '#ffffff' },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          ...baseValidPayload,
          id: 'global',
          partner1Name: 'Jordan',
          partner2Name: 'Casey',
          multisiteEnabled: true,
          themeTokens: { '--print-bg': '#ffffff' },
        }),
      });
    });
    (global.fetch as unknown) = mockFetch;
    (window.fetch as unknown) = mockFetch;

    renderWithQuery(<AdminSettingsPage />);

    const profileSelect = await screen.findByLabelText(/Active Branding Profile/i);
    expect(profileSelect).toHaveTextContent('Sam & Riley (subdomain: preview)');
    expect(profileSelect).not.toHaveTextContent('OldBride');

    fireEvent.change(profileSelect, { target: { value: 'staging-1' } });

    const p1Input = await screen.findByDisplayValue('Sam');
    fireEvent.change(p1Input, { target: { value: 'Rowan' } });
    expect(await screen.findByLabelText(/Active Branding Profile/i)).toHaveTextContent(
      'Rowan & Riley (subdomain: preview)'
    );

    // Add a guided theme override row and save
    fireEvent.click(screen.getByRole('button', { name: /\+ Add Theme Override/i }));
    const nameInputs = screen.getAllByLabelText('Override Name');
    const valueInputs = screen.getAllByLabelText('Override Value');
    fireEvent.change(nameInputs[nameInputs.length - 1], { target: { value: '--btn-radius' } });
    fireEvent.change(valueInputs[valueInputs.length - 1], { target: { value: '0.75rem' } });

    fireEvent.click(screen.getByRole('button', { name: /save settings|save changes|save/i }));

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(([, opts]) => opts?.method === 'PUT');
      expect(putCall).toBeDefined();
      const savedBody = JSON.parse(String(putCall?.[1]?.body));
      expect(savedBody.partner1Name).toBe('Rowan');
      expect(savedBody.brideName).toBe('Rowan');
      expect(savedBody.themeTokens['--btn-radius']).toBe('0.75rem');
      expect(savedBody.themeTokens['--print-bg']).toBe('#ffffff');
    });
  });

  it('displays plain section names in History table with zero raw Prisma entityType identifiers', async () => {
    (adminApiClient.get as jest.Mock).mockResolvedValueOnce([
      { id: 'v1', entityType: 'AppConfig', author: 'Admin', createdAt: '2026-10-01T12:00:00Z', data: {} },
      { id: 'v2', entityType: 'ContentNode', author: 'Admin', createdAt: '2026-10-01T12:05:00Z', data: {} },
      { id: 'v3', entityType: 'WeddingPartyMember', author: 'Admin', createdAt: '2026-10-01T12:10:00Z', data: {} },
      { id: 'v4', entityType: 'RegistryItem', author: 'Admin', createdAt: '2026-10-01T12:15:00Z', data: {} },
      { id: 'v5', entityType: 'InvitationCode', author: 'Admin', createdAt: '2026-10-01T12:20:00Z', data: {} },
    ]);

    renderWithQuery(<HistoryTimelinePage />);

    expect(await screen.findByText('Site Settings')).toBeInTheDocument();
    expect(screen.getByText('Website Content')).toBeInTheDocument();
    expect(screen.getByText('Wedding Party')).toBeInTheDocument();
    expect(screen.getByText('Registry Items')).toBeInTheDocument();
    expect(screen.getByText('Guest Invitations')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Section' })).toBeInTheDocument();
    expect(screen.queryByText('Entity Type')).not.toBeInTheDocument();
    expect(screen.queryByText('AppConfig')).not.toBeInTheDocument();
    expect(screen.queryByText('ContentNode')).not.toBeInTheDocument();
    expect(screen.queryByText('WeddingPartyMember')).not.toBeInTheDocument();
  });

  it('translates backup diagnostic paths and renders dashboard payment warning without literal backticks', async () => {
    expect(formatEntitySectionLabel('AppConfig')).toBe('Site Settings');
    expect(formatBackupDiagnosticPath('registryItem.0.price')).toBe('Registry Items (Entry 1) — Price');
    expect(formatBackupDiagnosticPath('appConfig.0.baseUrl')).toBe('Site Settings (Entry 1) — Website URL');
    expect(formatBackupDiagnosticPath('contentNode.1.data.startTime')).toBe('Website Content (Entry 2) — Start Time');
    expect(formatBackupDiagnosticPath('root')).toBe('Backup File');

    const unconfiguredFund = createMockRegistryItem({
      id: 'fund-unconfigured-1',
      name: 'Honeymoon Getaway Fund',
      isGroupGift: true,
      itemType: 'CASH_FUND',
      paymentHandle: null,
      purchased: false,
      image: createMockMedia({ url: '/images/placeholder.png', altText: 'Honeymoon' }),
    });

    (adminApiClient.get as jest.Mock).mockImplementation(async (url: string) => {
      if (url.includes('/api/registry/capabilities')) {
        return { cardCheckoutEnabled: false, publishableKey: null };
      }
      return [unconfiguredFund];
    });
    const mockFetch = jest.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/registry/capabilities')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ cardCheckoutEnabled: false, publishableKey: null }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [unconfiguredFund],
      });
    });
    (global.fetch as unknown) = mockFetch;
    (window.fetch as unknown) = mockFetch;

    renderWithQuery(<AdminDashboardPage />);

    const warningBanner = await screen.findByTestId('admin-dashboard-unconfigured-funds-warning');
    expect(warningBanner).toHaveTextContent('Honeymoon Getaway Fund');
    expect(warningBanner.textContent).not.toContain('`');
    expect(warningBanner.textContent).not.toContain('STRIPE_SECRET_KEY');
  });
});
