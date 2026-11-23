import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { redirect } from 'next/navigation';
import { getAppConfig } from '@/lib/config';

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => new Headers()),
}));

jest.mock('next/navigation', () => ({
  redirect: jest.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
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
      venueAddress: '',
      venueZip: '55401',
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
        venueCity: 'Minneapolis',
        venueState: 'MN',
        contactEmail: 'hosts@alexandsam.example.org',
        themePreset: 'romantic',
        colorPrimary: '#be123c',
        colorSecondary: '#14532d',
      },
    });
  });
});
