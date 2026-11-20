import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import SettingsPage from '../settings/page';
import { useAdminSettings } from '@/hooks/admin/useAdminSettings';
import { useAdminBroadcast } from '@/hooks/admin/useAdminBroadcast';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/hooks/admin/useAdminSettings');
jest.mock('@/hooks/admin/useAdminBroadcast');
jest.mock('@/components/ui/ToastProvider', () => ({
  useToast: () => ({
    addToast: jest.fn(),
  }),
}));

// Mock AdminPreviewLayout to simplify test tree
jest.mock('@/components/admin/AdminPreviewLayout', () => {
  return function MockAdminPreviewLayout({ children }: { children: React.ReactNode }) {
    return <div data-testid="admin-preview-layout">{children}</div>;
  };
});

describe('SettingsPage View State', () => {
  const mockFetchAll = jest.fn();
  const mockSaveSettings = jest.fn();
  const mockCreateProfile = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAdminBroadcast as jest.Mock).mockReturnValue({
      testConnection: jest.fn(),
      testingConnection: false,
    });
  });

  it('renders polite loading live region and skeleton instead of bare text', () => {
    (useAdminSettings as jest.Mock).mockReturnValue({
      config: null,
      loading: true,
      saving: false,
      error: null,
      saveSettings: mockSaveSettings,
      profiles: [],
      loadingList: false,
      createProfile: mockCreateProfile,
      creating: false,
      fetchAll: mockFetchAll,
    });

    render(<SettingsPage />);

    expect(screen.queryByText('Loading settings...')).toBeInTheDocument();
    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(screen.queryByTestId('admin-preview-layout')).not.toBeInTheDocument();
  });

  it('renders accessible error panel with retry handler and dashboard link on query failure', async () => {
    (useAdminSettings as jest.Mock).mockReturnValue({
      config: null,
      loading: false,
      saving: false,
      error: 'Failed to connect to database',
      saveSettings: mockSaveSettings,
      profiles: [],
      loadingList: false,
      createProfile: mockCreateProfile,
      creating: false,
      fetchAll: mockFetchAll,
    });

    render(<SettingsPage />);

    // Should not render bare text
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('Error: Failed to connect to database')).toBeInTheDocument();

    // Verify retry button calls fetchAll
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(retryBtn);
    });
    expect(mockFetchAll).toHaveBeenCalledTimes(1);

    // Verify dashboard navigation button
    const dashboardBtn = screen.getByRole('button', { name: /back to dashboard/i });
    expect(dashboardBtn).toBeInTheDocument();
    fireEvent.click(dashboardBtn);
    expect(mockPush).toHaveBeenCalledWith('/admin/dashboard');
  });

  it('renders accessible error panel when localConfig is null', () => {
    (useAdminSettings as jest.Mock).mockReturnValue({
      config: null,
      loading: false,
      saving: false,
      error: null,
      saveSettings: mockSaveSettings,
      profiles: [],
      loadingList: false,
      createProfile: mockCreateProfile,
      creating: false,
      fetchAll: mockFetchAll,
    });

    render(<SettingsPage />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Error: Failed to load settings.')).toBeInTheDocument();
  });

  it('renders settings layout when configuration is loaded', () => {
    (useAdminSettings as jest.Mock).mockReturnValue({
      config: {
        id: 'global',
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        weddingDate: '2026-10-10',
      },
      loading: false,
      saving: false,
      error: null,
      saveSettings: mockSaveSettings,
      profiles: [],
      loadingList: false,
      createProfile: mockCreateProfile,
      creating: false,
      fetchAll: mockFetchAll,
    });

    render(<SettingsPage />);

    expect(screen.getByTestId('admin-preview-layout')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Site Settings' })).toBeInTheDocument();
  });

  it('displays Configured status without raw secrets for configured messaging credentials', () => {
    (useAdminSettings as jest.Mock).mockReturnValue({
      config: {
        id: 'global',
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        weddingDate: '2026-10-10',
        emailProvider: 'smtp',
        smsProvider: 'twilio',
        smtpHost: 'smtp.example.com',
        smtpUser: 'mailer@example.com',
        twilioAccountSid: 'AC123456',
        hasSmtpPass: true,
        hasTwilioAuthToken: true,
      },
      loading: false,
      saving: false,
      error: null,
      saveSettings: mockSaveSettings,
      profiles: [],
      loadingList: false,
      createProfile: mockCreateProfile,
      creating: false,
      fetchAll: mockFetchAll,
    });

    render(<SettingsPage />);

    const smtpPassInput = screen.getByLabelText(/SMTP Password/i) as HTMLInputElement;
    expect(smtpPassInput.value).toBe('');
    expect(smtpPassInput).toHaveAttribute('placeholder', 'Leave blank to keep saved password');

    const twilioTokenInput = screen.getByLabelText(/Auth Token/i) as HTMLInputElement;
    expect(twilioTokenInput.value).toBe('');
    expect(twilioTokenInput).toHaveAttribute('placeholder', 'Leave blank to keep saved auth token');

    expect(screen.getAllByText('Configured')).toHaveLength(2);
  });

  it('saves an empty themeTokens map when switching from classic to another preset without custom edits', async () => {
    const { getPresetTokens } = await import('@/lib/theme/presets');
    const hydratedClassic: Record<string, string> = {};
    for (const [k, v] of Object.entries(getPresetTokens('classic', 'light'))) {
      if (k.startsWith('--') && typeof v === 'string') {
        hydratedClassic[k] = v;
      }
    }
    mockSaveSettings.mockResolvedValue({ id: 'global', themePreset: 'romantic', themeTokens: {} });

    (useAdminSettings as jest.Mock).mockReturnValue({
      config: {
        id: 'global',
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        weddingDate: '2026-10-10',
        themePreset: 'classic',
        themeTokens: hydratedClassic,
      },
      loading: false,
      saving: false,
      error: null,
      saveSettings: mockSaveSettings,
      profiles: [],
      loadingList: false,
      createProfile: mockCreateProfile,
      creating: false,
      fetchAll: mockFetchAll,
    });

    render(<SettingsPage />);

    const presetSelect = screen.getByLabelText(/Select Theme Preset/i);
    fireEvent.change(presetSelect, { target: { value: 'romantic' } });

    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    await act(async () => {
      fireEvent.submit(saveButtons[0].closest('form')!);
    });

    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockSaveSettings.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        themePreset: 'romantic',
        themeTokens: {},
      })
    );
  });

  it('preserves explicit custom overrides when switching presets on SettingsPage', async () => {
    mockSaveSettings.mockResolvedValue({
      id: 'global',
      themePreset: 'editorial',
      themeTokens: { '--btn-radius': '0.875rem' },
    });

    (useAdminSettings as jest.Mock).mockReturnValue({
      config: {
        id: 'global',
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        weddingDate: '2026-10-10',
        themePreset: 'classic',
        themeTokens: {
          '--btn-radius': '0.875rem',
          '--print-bg': '#ffffff',
        },
      },
      loading: false,
      saving: false,
      error: null,
      saveSettings: mockSaveSettings,
      profiles: [],
      loadingList: false,
      createProfile: mockCreateProfile,
      creating: false,
      fetchAll: mockFetchAll,
    });

    render(<SettingsPage />);

    const presetSelect = screen.getByLabelText(/Select Theme Preset/i);
    fireEvent.change(presetSelect, { target: { value: 'editorial' } });

    const saveButtons = screen.getAllByRole('button', { name: /save/i });
    await act(async () => {
      fireEvent.submit(saveButtons[0].closest('form')!);
    });

    expect(mockSaveSettings).toHaveBeenCalledTimes(1);
    expect(mockSaveSettings.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        themePreset: 'editorial',
        themeTokens: {
          '--btn-radius': '0.875rem',
        },
      })
    );
  });
});
