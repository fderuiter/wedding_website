import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { redirect } from 'next/navigation';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => new Headers()),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn((url: string) => {
    const error = new Error('NEXT_REDIRECT') as Error & { digest?: string };
    error.digest = `NEXT_REDIRECT;replace;${url};307;`;
    throw error;
  }),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(true),
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn(),
  };
});

const mockSetupWizard = jest.fn((_props: { initialSavedConfig?: unknown }) => (
  <div data-testid="setup-wizard-mock">Setup Wizard Mounted</div>
));

jest.mock('@/components/setup/SetupWizard', () => ({
  __esModule: true,
  default: (props: { initialSavedConfig?: unknown }) => mockSetupWizard(props),
}));

import AdminSetupPage from '../page';

describe('AdminSetupPage (/admin/setup)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (isAdminRequest as jest.Mock).mockResolvedValue(true);
  });

  it('redirects unauthenticated callers to /admin/login with HTTP 303 without Edge middleware', async () => {
    (isAdminRequest as jest.Mock).mockResolvedValueOnce(false);

    let caughtError: (Error & { digest?: string }) | null = null;
    try {
      await AdminSetupPage();
    } catch (err) {
      caughtError = err as Error & { digest?: string };
    }

    expect(redirect).toHaveBeenCalledWith('/admin/login');
    expect(caughtError?.digest).toBe('NEXT_REDIRECT;replace;/admin/login;303;');
    expect(getAppConfig).not.toHaveBeenCalled();
  });

  it('mounts SetupWizard without auth redirect during STATIC_EXPORT builds', async () => {
    const prevStaticExport = process.env.STATIC_EXPORT;
    process.env.STATIC_EXPORT = 'true';
    (isAdminRequest as jest.Mock).mockResolvedValue(false);

    try {
      const element = await AdminSetupPage();
      render(element);
      expect(screen.getByTestId('setup-wizard-mock')).toBeInTheDocument();
      expect(redirect).not.toHaveBeenCalled();
    } finally {
      if (prevStaticExport === undefined) {
        delete process.env.STATIC_EXPORT;
      } else {
        process.env.STATIC_EXPORT = prevStaticExport;
      }
    }
  });

  it('redirects to /admin/dashboard when setupCompleted is true on an initialized site', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      id: 'global',
      partner1Name: 'Alex',
      partner2Name: 'Sam',
      brideName: 'Alex',
      groomName: 'Sam',
      baseUrl: 'https://alexandsam.example.org',
      weddingDate: new Date('2027-06-20T16:00:00.000Z'),
      setupCompleted: true,
    });

    await expect(AdminSetupPage()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('mounts SetupWizard with hydrated initialSavedConfig when setupCompleted is false', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      id: 'global',
      partner1Name: 'Alex',
      partner2Name: 'Sam',
      brideName: 'Alex',
      groomName: 'Sam',
      baseUrl: 'https://alexandsam.example.org',
      weddingDate: new Date('2027-06-20T16:00:00.000Z'),
      timezone: 'America/Chicago',
      venueName: 'TBD',
      venueCity: 'Minneapolis',
      venueState: 'MN',
      venueAddress: '200 S 2nd St',
      venueZip: '55401',
      latitude: 44.9799,
      longitude: -93.2638,
      contactEmail: 'hosts@alexandsam.example.org',
      themePreset: 'romantic',
      colorPrimary: '#be123c',
      colorSecondary: '#14532d',
      setupCompleted: false,
    });

    const element = await AdminSetupPage();
    render(element);

    expect(screen.getByTestId('setup-wizard-mock')).toBeInTheDocument();
    expect(mockSetupWizard).toHaveBeenCalledWith({
      initialSavedConfig: {
        step: 3,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
        weddingDate: '2027-06-20',
        timezone: 'America/Chicago',
        baseUrl: 'https://alexandsam.example.org',
        venueName: '',
        venueAddress: '200 S 2nd St',
        venueCity: 'Minneapolis',
        venueState: 'MN',
        venueZip: '55401',
        latitude: 44.9799,
        longitude: -93.2638,
        contactEmail: 'hosts@alexandsam.example.org',
        themePreset: 'romantic',
        colorPrimary: '#be123c',
        colorSecondary: '#14532d',
      },
    });
  });

  it('strips placeholder TBD and 00000 venue fields when hydrating initialSavedConfig', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      id: 'global',
      partner1Name: 'Alex',
      partner2Name: 'Sam',
      brideName: 'Alex',
      groomName: 'Sam',
      baseUrl: 'https://alexandsam.example.org',
      weddingDate: new Date('2027-06-20T16:00:00.000Z'),
      timezone: 'America/Chicago',
      venueName: 'TBD Venue',
      venueAddress: 'TBD',
      venueCity: 'TBD',
      venueState: 'N/A',
      venueZip: '00000',
      latitude: 0,
      longitude: 0,
      contactEmail: '',
      themePreset: 'classic',
      colorPrimary: '#B91C1C',
      colorSecondary: '#B45309',
      setupCompleted: false,
    });

    const element = await AdminSetupPage();
    render(element);

    expect(mockSetupWizard).toHaveBeenCalledWith({
      initialSavedConfig: expect.objectContaining({
        venueName: '',
        venueAddress: '',
        venueCity: '',
        venueState: '',
        venueZip: '',
        latitude: 0,
        longitude: 0,
      }),
    });
  });

  it('hydrates enabledFeatures from saved AppConfig modules and countdown/calendar flags', async () => {
    (getAppConfig as jest.Mock).mockResolvedValue({
      id: 'global',
      partner1Name: 'Alex',
      partner2Name: 'Sam',
      brideName: 'Alex',
      groomName: 'Sam',
      baseUrl: 'https://alexandsam.example.org',
      weddingDate: new Date('2027-06-20T16:00:00.000Z'),
      timezone: 'America/New_York',
      venueName: 'The Conservatory',
      venueAddress: '100 Park Ave',
      venueCity: 'New York',
      venueState: 'NY',
      venueZip: '10001',
      latitude: 40.75,
      longitude: -73.98,
      contactEmail: 'hosts@alexandsam.example.org',
      themePreset: 'modern',
      colorPrimary: '#0F172A',
      colorSecondary: '#475569',
      showCountdown: false,
      showAddToCalendar: true,
      modules: JSON.stringify({
        registry: false,
        groupGifting: true,
        weather: true,
        weddingParty: true,
        attractions: false,
        gallery: true,
        countdown: false,
        addToCalendar: true,
        interactive3D: false,
      }),
      setupCompleted: false,
    });

    const element = await AdminSetupPage();
    render(element);

    expect(mockSetupWizard).toHaveBeenCalledWith({
      initialSavedConfig: expect.objectContaining({
        themePreset: 'modern',
        colorPrimary: '#0F172A',
        colorSecondary: '#475569',
        enabledFeatures: {
          registry: false,
          groupGifting: false,
          weather: true,
          weddingParty: true,
          attractions: false,
          gallery: true,
          countdown: false,
          addToCalendar: true,
          interactive3D: false,
        },
      }),
    });
  });
});
