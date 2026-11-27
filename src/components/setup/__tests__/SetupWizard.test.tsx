import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import SetupWizard, {
  resolveStep2BackendErrorField,
  type Step2ErrorField,
} from '../SetupWizard';
import { getPresetTokens } from '@/lib/theme/presets';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { checkAdminClient } from '@/core/auth/auth.client';

expect.extend(toHaveNoViolations);

jest.mock('@/hooks/admin/useAdminWeddingParty', () => ({
  useAdminWeddingParty: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

jest.mock('@/hooks/admin/useAdminAttractions', () => ({
  useAdminAttractions: () => ({
    data: [],
    isLoading: false,
    error: null,
  }),
}));

jest.mock('@/hooks/admin/useAdminInvitationCodes', () => ({
  useAdminInvitationCodes: () => ({
    data: [],
    isLoading: false,
    error: null,
    fetchAll: jest.fn(() => Promise.resolve([])),
  }),
}));

jest.mock('@/core/auth/auth.client', () => ({
  checkAdminClient: jest.fn(() => Promise.resolve(false)),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('SetupWizard focus shifting and ARIA error linking', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    jest.clearAllMocks();
  });

  test('renders exactly one primary h1 and step title as h2 in initial step', () => {
    renderWithProviders(<SetupWizard />);

    const h1Headings = screen.getAllByRole('heading', { level: 1 });
    expect(h1Headings).toHaveLength(1);
    expect(h1Headings[0]).toHaveClass('sr-only');
    expect(h1Headings[0]).toHaveTextContent('Wedding Website Setup Wizard');

    const h2Headings = screen.getAllByRole('heading', { level: 2 });
    expect(h2Headings).toHaveLength(1);
    expect(h2Headings[0]).toHaveTextContent('Welcome to Your Wedding Site!');
  });

  test('maintains heading hierarchy with one primary h1 and h2 step title across steps', async () => {
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/setup')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Admin Login
    const passInput = screen.getByPlaceholderText('Admin Password');
    fireEvent.change(passInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument();
    });

    const h1Headings = screen.getAllByRole('heading', { level: 1 });
    expect(h1Headings).toHaveLength(1);
    expect(h1Headings[0]).toHaveClass('sr-only');

    const h2Headings = screen.getAllByRole('heading', { level: 2 });
    expect(h2Headings).toHaveLength(1);
    expect(h2Headings[0]).toHaveTextContent('Step 2: The Essentials');
  });

  test('password authentication failure shifts focus, selects text, and sets ARIA error attributes', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: 'Invalid admin password.' }),
      } as Response)
    ) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    const passwordInput = screen.getByPlaceholderText('Admin Password') as HTMLInputElement;
    const selectSpy = jest.spyOn(passwordInput, 'select');

    fireEvent.change(passwordInput, { target: { value: 'wrongpassword' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid admin password.')).toBeInTheDocument();
      expect(passwordInput.getAttribute('aria-describedby')).toBeTruthy();
    });

    // Check focus shift
    expect(document.activeElement).toBe(passwordInput);

    // Check text selection
    expect(selectSpy).toHaveBeenCalled();

    // Check ARIA attributes
    expect(passwordInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = passwordInput.getAttribute('aria-describedby');

    const errorMessage = document.getElementById(describedBy!);
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveTextContent('Invalid admin password.');
  });

  test('site URL configuration error shifts focus and sets ARIA error attributes in Step 2', async () => {
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/setup')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Admin Login
    const passInput = screen.getByPlaceholderText('Admin Password');
    fireEvent.change(passInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Wait for Step 2 Essentials form
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    // Fill form except site URL has a sample/default domain
    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Venue Name/i), { target: { value: 'Grand Ballroom' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'IL' } });

    const siteUrlInput = screen.getByLabelText(/Site URL/i) as HTMLInputElement;
    fireEvent.change(siteUrlInput, { target: { value: 'https://wedding.example' } });

    // Submit form with default URL
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByText(/Please use your own URL/i)).toBeInTheDocument();
    });

    // Check focus shift
    expect(document.activeElement).toBe(siteUrlInput);

    // Check ARIA attributes
    expect(siteUrlInput).toHaveAttribute('aria-invalid', 'true');
    const describedBy = siteUrlInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const errorMessage = document.getElementById(describedBy!);
    expect(errorMessage).toBeInTheDocument();
    expect(errorMessage).toHaveTextContent(/Please use your own URL/i);
  });

  test('routes generic Step 2 backend errors to the form-level alert without marking #siteUrl invalid, while routing URL backend errors to #siteUrl', async () => {
    let callCount = 0;
    global.fetch = jest.fn((_url: string | URL | Request) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      if (callCount === 2) {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Backend validation failed.' }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'Validation Error: Site base URL cannot use a reserved placeholder domain.',
          }),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Admin Login
    const passInput = screen.getByPlaceholderText('Admin Password');
    fireEvent.change(passInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Wait for Step 2 Essentials form
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Venue Name/i), { target: { value: 'Grand Ballroom' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'IL' } });

    const siteUrlInput = screen.getByLabelText(/Site URL/i) as HTMLInputElement;
    fireEvent.change(siteUrlInput, { target: { value: 'https://validweddingurl.com' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    const formBanner = await screen.findByTestId('step2-form-error-banner');
    expect(formBanner).toHaveTextContent('Backend validation failed.');
    expect(document.activeElement).toBe(formBanner);
    expect(siteUrlInput).toHaveAttribute('aria-invalid', 'false');

    // Subsequent URL-specific backend error routes directly to #siteUrl
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => {
      expect(
        screen.getByText(/Site base URL cannot use a reserved placeholder domain/i)
      ).toBeInTheDocument();
    });
    expect(document.activeElement).toBe(siteUrlInput);
    expect(siteUrlInput).toHaveAttribute('aria-invalid', 'true');
  });

  test('submits theme preset and brand colors during Step 2 setup save without rendering layout, print, or sizing inputs', async () => {
    let savedPayload: any = null;
    let callCount = 0;
    global.fetch = jest.fn((_url: string | URL | Request, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      } else {
        if (init && init.body) {
          savedPayload = JSON.parse(init.body as string);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Login
    const passInput = screen.getByPlaceholderText('Admin Password');
    fireEvent.change(passInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    // Step 2 shows preset + color controls only, deferring layout & print tuning to Site Settings
    expect(screen.queryByLabelText(/Container Max Width/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Grid Gap/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Card Padding/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Card Border Radius/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Print Background Color Code/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Base Font Size/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Logo Width/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Venue Name/i), { target: { value: 'Grand Ballroom' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'IL' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });

    // Change theme preset and brand colors
    fireEvent.click(screen.getByRole('radio', { name: /Romantic Preset/i }));
    fireEvent.change(screen.getByLabelText(/Primary Color Code/i), { target: { value: '#9F1239' } });
    fireEvent.change(screen.getByLabelText(/Secondary Color Code/i), { target: { value: '#78350F' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument();
    });

    expect(savedPayload).toBeTruthy();
    expect(savedPayload.themePreset).toBe('romantic');
    expect(savedPayload.colorPrimary).toBe('#9F1239');
    expect(savedPayload.colorSecondary).toBe('#78350F');
    expect(savedPayload.layoutContainerMaxWidth).toBeUndefined();
  });

  test('trims partner names before Step 2 submission and rejects whitespace-only partner names', async () => {
    let savedPayload: Record<string, unknown> | null = null;
    let setupSaveCalls = 0;
    global.fetch = jest.fn((_url: string | URL | Request, init?: RequestInit) => {
      if (init?.body) {
        const parsed = JSON.parse(init.body as string);
        if (parsed.partner1Name !== undefined || parsed.partner2Name !== undefined) {
          setupSaveCalls++;
          savedPayload = parsed;
        }
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Login
    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    const partner1Input = screen.getByLabelText(/Partner 1/i) as HTMLInputElement;
    const partner2Input = screen.getByLabelText(/Partner 2/i) as HTMLInputElement;

    // Whitespace-only partner name should be rejected client-side without calling save endpoint
    fireEvent.change(partner1Input, { target: { value: '   ' } });
    fireEvent.change(partner2Input, { target: { value: '  Sam  ' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByText('Please enter names for both partners.')).toBeInTheDocument();
    });
    expect(setupSaveCalls).toBe(0);
    expect(document.activeElement).toBe(partner1Input);
    expect(partner1Input).toHaveAttribute('aria-invalid', 'true');

    // Now provide padded partner names and verify trimmed payload
    fireEvent.change(partner1Input, { target: { value: '  Alex  ' } });
    fireEvent.change(partner2Input, { target: { value: '  Sam  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument();
    });

    expect(setupSaveCalls).toBe(1);
    expect(savedPayload).toMatchObject({
      partner1Name: 'Alex',
      partner2Name: 'Sam',
      baseUrl: 'https://alexandsam.com',
      seoTitle: "Alex & Sam's Wedding",
      seoDescription: 'Join Alex and Sam for their wedding celebration.',
    });
  });

  test('synchronizes isAdminLoggedIn in localStorage and dispatches storage event on login, save, restore, and finish', async () => {
    const storageEvents: Event[] = [];
    const onStorage = (e: Event) => storageEvents.push(e);
    window.addEventListener('storage', onStorage);

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
    ) as jest.Mock;

    try {
      const { unmount } = renderWithProviders(<SetupWizard />);
      expect(window.localStorage.getItem('isAdminLoggedIn')).toBeNull();

      // 1. Login writes isAdminLoggedIn
      fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
      expect(window.localStorage.getItem('isAdminLoggedIn')).toBe('true');
      expect(storageEvents.length).toBeGreaterThanOrEqual(1);

      // Clear localStorage to verify Step 2 save writes it again
      window.localStorage.removeItem('isAdminLoggedIn');
      storageEvents.length = 0;

      // 2. Save writes isAdminLoggedIn
      fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
      fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
      fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
      fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

      await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());
      expect(window.localStorage.getItem('isAdminLoggedIn')).toBe('true');
      expect(storageEvents.length).toBeGreaterThanOrEqual(1);

      unmount();

      // 3. Restore with valid session cookie writes isAdminLoggedIn
      window.localStorage.removeItem('isAdminLoggedIn');
      storageEvents.length = 0;
      (checkAdminClient as jest.Mock).mockResolvedValueOnce(true);
      window.sessionStorage.setItem('setup_wizard_draft', JSON.stringify({ step: 5 }));

      renderWithProviders(<SetupWizard />);
      await waitFor(() => expect(screen.getByText('Step 5: Complete Setup')).toBeInTheDocument());
      expect(window.localStorage.getItem('isAdminLoggedIn')).toBe('true');
      expect(storageEvents.length).toBeGreaterThanOrEqual(1);

      // 4. Finish ("Go to Admin Dashboard") writes isAdminLoggedIn even if cleared beforehand
      window.localStorage.removeItem('isAdminLoggedIn');
      storageEvents.length = 0;

      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Go to Admin Dashboard' }));
      } finally {
        errorSpy.mockRestore();
      }
      expect(window.localStorage.getItem('isAdminLoggedIn')).toBe('true');
      expect(storageEvents.length).toBeGreaterThanOrEqual(1);
    } finally {
      window.removeEventListener('storage', onStorage);
    }
  });

  test('continues setup progress when localStorage throws in restricted browser storage', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
    ) as jest.Mock;

    try {
      renderWithProviders(<SetupWizard />);

      fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

      await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
    } finally {
      setItemSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  test('Step 4 renders guest list import controls and launches CsvImportWizardModal', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
    ) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Login
    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 2: Essentials
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Venue Name/i), { target: { value: 'Grand Ballroom' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'IL' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    // Step 3: Sample Data Selection -> Skip to Step 4
    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    // Verify Step 4: Guest List Import
    await waitFor(() => expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument());
    const importBtn = screen.getByRole('button', { name: 'Import Guest List CSV' });
    const skipBtn = screen.getByRole('button', { name: 'Skip for Now' });
    expect(importBtn).toBeInTheDocument();
    expect(skipBtn).toBeInTheDocument();

    // Click "Import Guest List CSV" to open modal
    fireEvent.click(importBtn);

    // Modal dialog should open
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Import Guest Invitation Codes')).toBeInTheDocument();
    });
  });

  test('clicking Skip for Now on Step 4 advances user to Step 5 Complete Setup without error', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
    ) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Login
    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 2: Essentials
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Venue Name/i), { target: { value: 'Grand Ballroom' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'IL' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    // Step 3: Sample Data Selection -> Skip to Step 4
    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    // Step 4: Guest List Import -> Click "Skip for Now"
    await waitFor(() => expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Skip for Now' }));

    // Step 5: Complete Setup
    await waitFor(() => expect(screen.getByText('Step 5: Complete Setup')).toBeInTheDocument());
  });

  test('restores administrators directly to persisted step after page refresh when valid session cookie exists', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 3,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
      })
    );

    renderWithProviders(<SetupWizard />);

    // Should revalidate session and restore directly to Step 3
    await waitFor(() => {
      expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument();
    });

    expect(screen.queryByText('Welcome to Your Wedding Site!')).not.toBeInTheDocument();
    expect(screen.queryByText('Step 2: The Essentials')).not.toBeInTheDocument();
  });

  test('login action preserves saved draft step greater than step 2 upon successful authentication', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(false);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 4,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
      })
    );

    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/setup')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Admin Login is presented because cookie is not active
    expect(screen.getByText('Welcome to Your Wedding Site!')).toBeInTheDocument();

    const passInput = screen.getByPlaceholderText('Admin Password');
    fireEvent.change(passInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Upon login, preserved step 4 is restored rather than resetting unconditionally to step 2
    await waitFor(() => {
      expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument();
    });

    expect(screen.queryByText('Step 2: The Essentials')).not.toBeInTheDocument();
  });

  test('clears error messages upon advancing steps', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(false);
    let callCount = 0;
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/setup')) {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          } as Response);
        } else if (callCount === 2) {
          // Trigger error on Step 2
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: 'Config validation failed.' }),
          } as Response);
        } else {
          // Succeed on next attempt
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true }),
          } as Response);
        }
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Login
    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 2: Essentials
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Venue Name/i), { target: { value: 'Grand Ballroom' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'IL' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });

    // Submit and trigger error
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => {
      expect(screen.getByText('Config validation failed.')).toBeInTheDocument();
    });

    // Re-submit successfully
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => {
      expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument();
    });

    // Stale error string is eliminated across step transition
    expect(screen.queryByText('Config validation failed.')).not.toBeInTheDocument();
  });

  test('enforces mutual exclusion across content management modals on Step 5', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({ step: 5 })
    );

    renderWithProviders(<SetupWizard />);

    await waitFor(() => {
      expect(screen.getByText('Step 5: Complete Setup')).toBeInTheDocument();
    });

    // Open wedding party modal
    const partyBtn = screen.getByRole('button', { name: /Manage Wedding Party/i });
    fireEvent.click(partyBtn);

    await waitFor(() => {
      expect(screen.getByText('Manage Wedding Party')).toBeInTheDocument();
    });

    // Directly open attractions modal
    const attractionsBtn = screen.getByRole('button', { name: /Manage Attractions/i });
    fireEvent.click(attractionsBtn);

    await waitFor(() => {
      expect(screen.getByText('Manage Local Attractions')).toBeInTheDocument();
      expect(screen.queryByText('Manage Wedding Party')).not.toBeInTheDocument();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });
  });

  test('allows completing Step 2 with empty or whitespace venue fields using clean empty strings, date-aware copy, live client preview, and setupCompleted false', async () => {
    let savedPayload: Record<string, unknown> | null = null;
    let callCount = 0;
    global.fetch = jest.fn((_url: string | URL | Request, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      } else {
        if (init && init.body) {
          savedPayload = JSON.parse(init.body as string);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
    }) as jest.Mock;

    const replaceStateSpy = jest.spyOn(window.history, 'replaceState');

    renderWithProviders(<SetupWizard />);

    // Step 1: Login
    const passInput = screen.getByPlaceholderText('Admin Password');
    fireEvent.change(passInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    const venueNameInput = screen.getByLabelText(/Venue Name/i);
    const venueCityInput = screen.getByLabelText(/^City$/i);
    const venueStateInput = screen.getByLabelText(/State/i);

    expect(venueNameInput).not.toHaveAttribute('required');
    expect(venueCityInput).not.toHaveAttribute('required');
    expect(venueStateInput).not.toHaveAttribute('required');

    expect(venueNameInput).toHaveAttribute('placeholder', 'Optional');
    expect(venueCityInput).toHaveAttribute('placeholder', 'Optional');
    expect(venueStateInput).toHaveAttribute('placeholder', 'Optional');
    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2028-12-31' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });

    // Live Step 2 preview card updates immediately with partner names, formatted date, and Desktop/Mobile toggle
    const livePreview = screen.getByTestId('step2-live-preview');
    expect(livePreview).toHaveTextContent('Alex & Sam');
    expect(livePreview).toHaveTextContent('December 31, 2028');
    expect(livePreview).not.toHaveTextContent('TBD');

    const viewportFrame = screen.getByTestId('step2-preview-frame');
    expect(viewportFrame).toHaveAttribute('data-viewport', 'desktop');
    fireEvent.click(screen.getByRole('button', { name: /Mobile \(375px\)/i }));
    expect(viewportFrame).toHaveAttribute('data-viewport', 'mobile');

    // Leave venue inputs as empty or whitespace
    fireEvent.change(venueNameInput, { target: { value: '   ' } });
    fireEvent.change(venueCityInput, { target: { value: '' } });
    fireEvent.change(venueStateInput, { target: { value: '  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument();
    });

    expect(savedPayload).toBeTruthy();
    const payload = savedPayload as unknown as Record<string, unknown>;
    expect(payload.venueName).toBe('');
    expect(payload.venueCity).toBe('');
    expect(payload.venueState).toBe('');
    expect(payload.venueAddress).toBe('');
    expect(payload.venueZip).toBe('');
    expect(payload.heroTitle).toBe('Alex & Sam');
    expect(String(payload.heroSubtitle)).not.toContain('Tied the Knot');
    expect(String(payload.heroSubtitle)).toContain('December 31, 2028');
    expect(payload.storyText).not.toBe('Our story...');
    expect(payload.setupCompleted).toBe(false);
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '/admin/setup');
    replaceStateSpy.mockRestore();
  });

  test('navigates backwards from Step 3 to Step 2 and preserves form values', async () => {
    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/setup')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 1: Login
    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 2: The Essentials
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Timezone/i), { target: { value: 'America/New_York' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam2026.com' } });
    fireEvent.change(screen.getByLabelText(/Venue Name/i), { target: { value: 'Grand Ballroom' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'IL' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    // Step 3: Sample Data Selection
    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());

    // Click Back on Step 3
    const backBtn = screen.getByRole('button', { name: 'Back' });
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);

    // Verify returned to Step 2
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
    expect(screen.getByLabelText(/Partner 1/i)).toHaveValue('Alex');
    expect(screen.getByLabelText(/Partner 2/i)).toHaveValue('Sam');
    expect(screen.getByLabelText(/Wedding Date/i)).toHaveValue('2026-12-31');
    expect(screen.getByLabelText(/Timezone/i)).toHaveValue('America/New_York');
    expect(screen.getByLabelText(/Site URL/i)).toHaveValue('https://alexandsam2026.com');
    expect(screen.getByLabelText(/Venue Name/i)).toHaveValue('Grand Ballroom');
    expect(screen.getByLabelText(/^City$/i)).toHaveValue('Chicago');
    expect(screen.getByLabelText(/State/i)).toHaveValue('IL');
  });

  test('navigates backwards from Step 4 to Step 3 and preserves archetype selection', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 3,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
        sampleArchetype: 'destination',
      })
    );

    renderWithProviders(<SetupWizard />);

    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());

    // Advance to Step 4 via Skip
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

    await waitFor(() => expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument());

    // Click Back on Step 4
    const backBtn = screen.getByRole('button', { name: 'Back' });
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);

    // Returned to Step 3
    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());
    // Destination Wedding archetype preset should still be selected
    const destinationPresetBtn = screen.getByText('Destination Wedding').closest('button');
    expect(destinationPresetBtn).toHaveClass('border-primary');
  });

  test('navigates backwards from Step 5 to Step 4', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 5,
        importedGuestCount: 42,
      })
    );

    renderWithProviders(<SetupWizard />);

    await waitFor(() => expect(screen.getByText('Step 5: Complete Setup')).toBeInTheDocument());

    // Click Back on Step 5
    const backBtn = screen.getByRole('button', { name: 'Back' });
    expect(backBtn).toBeInTheDocument();
    fireEvent.click(backBtn);

    // Verify returned to Step 4
    await waitFor(() => expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Import Guest List CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Skip for Now' })).toBeInTheDocument();
    expect(screen.getByText(/42 guest record\(s\) imported/i)).toBeInTheDocument();
  });

  test('supports full bidirectional navigation through steps 2, 3, 4, and 5', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 2,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
        weddingDate: '2026-12-31',
        baseUrl: 'https://alexandsam.com',
      })
    );

    global.fetch = jest.fn((url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/setup')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    // Step 2
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
    // Verify Step 2 does NOT have a Back button (to avoid session reset)
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    // Advance 2 -> 3
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());

    // Advance 3 -> 4
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await waitFor(() => expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument());

    // Advance 4 -> 5
    fireEvent.click(screen.getByRole('button', { name: 'Skip for Now' }));
    await waitFor(() => expect(screen.getByText('Step 5: Complete Setup')).toBeInTheDocument());

    // Step 5 -> Step 4
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument());

    // Step 4 -> Step 3
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());

    // Step 3 -> Step 2
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
    expect(screen.getByLabelText(/Partner 1/i)).toHaveValue('Alex');
    expect(screen.getByLabelText(/Partner 2/i)).toHaveValue('Sam');
  });

  test('saves optional Host Contact Email in Step 2 and preserves it on Back navigation', async () => {
    let savedPayload: Record<string, unknown> | null = null;
    let callCount = 0;
    global.fetch = jest.fn((_url: string | URL | Request, init?: RequestInit) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      if (init?.body) {
        savedPayload = JSON.parse(init.body as string);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    const contactEmailInput = screen.getByLabelText(/Host Contact Email \(Optional\)/i);
    expect(contactEmailInput).not.toHaveAttribute('required');

    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });
    fireEvent.change(contactEmailInput, { target: { value: '  hosts@alexandsam.com  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());
    expect(savedPayload).toBeTruthy();
    expect(savedPayload!.contactEmail).toBe('hosts@alexandsam.com');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
    expect(screen.getByLabelText(/Host Contact Email \(Optional\)/i)).toHaveValue('hosts@alexandsam.com');
  });

  test('rejects placeholder hosts@wedding.example in Host Contact Email and shifts focus with ARIA attributes', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
    ) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    const siteUrlInput = screen.getByLabelText(/Site URL/i);
    fireEvent.change(siteUrlInput, { target: { value: 'https://alexandsam.com' } });

    const contactEmailInput = screen.getByLabelText(/Host Contact Email \(Optional\)/i);
    fireEvent.change(contactEmailInput, { target: { value: 'hosts@wedding.example' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(
        screen.getByText('Please enter a valid contact email address or leave it blank.')
      ).toBeInTheDocument();
    });

    expect(document.activeElement).toBe(contactEmailInput);
    expect(contactEmailInput).toHaveAttribute('aria-invalid', 'true');
    expect(siteUrlInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('routes backend Step 2 field errors for contactEmail and partner names to the corresponding input with exclusive ARIA state', async () => {
    let callCount = 0;
    global.fetch = jest.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      if (callCount === 2) {
        return Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              error: 'Validation Error: contactEmail: Invalid email address format',
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: false,
        json: () =>
          Promise.resolve({
            error: 'Validation Error: Partner names cannot use reserved placeholder values.',
          }),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    fireEvent.change(screen.getByPlaceholderText('Admin Password'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    const partner1Input = screen.getByLabelText(/Partner 1/i);
    const partner2Input = screen.getByLabelText(/Partner 2/i);
    const siteUrlInput = screen.getByLabelText(/Site URL/i);
    const contactEmailInput = screen.getByLabelText(/Host Contact Email \(Optional\)/i);

    fireEvent.change(partner1Input, { target: { value: 'Partner 1' } });
    fireEvent.change(partner2Input, { target: { value: 'Partner 2' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(siteUrlInput, { target: { value: 'https://alexandsam.com' } });
    fireEvent.change(contactEmailInput, { target: { value: 'hosts@alexandsam.com' } });

    // Backend rejects contactEmail -> only contactEmail receives focus and aria-invalid
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => {
      expect(
        screen.getByText('Validation Error: contactEmail: Invalid email address format')
      ).toBeInTheDocument();
    });
    expect(document.activeElement).toBe(contactEmailInput);
    expect(contactEmailInput).toHaveAttribute('aria-invalid', 'true');
    expect(siteUrlInput).not.toHaveAttribute('aria-invalid', 'true');
    expect(partner1Input).not.toHaveAttribute('aria-invalid', 'true');

    // Backend rejects partner names -> only partner1 receives focus and aria-invalid
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => {
      expect(
        screen.getByText('Validation Error: Partner names cannot use reserved placeholder values.')
      ).toBeInTheDocument();
    });
    expect(document.activeElement).toBe(partner1Input);
    expect(partner1Input).toHaveAttribute('aria-invalid', 'true');
    expect(contactEmailInput).not.toHaveAttribute('aria-invalid', 'true');
    expect(siteUrlInput).not.toHaveAttribute('aria-invalid', 'true');
  });

  test('exposes Starter Archetype Presets on Step 3 as an accessible radiogroup with arrow navigation and zero axe violations', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 3,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
        sampleArchetype: 'classic',
      })
    );

    const { container } = renderWithProviders(<SetupWizard />);

    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());

    const presetGroup = screen.getByRole('radiogroup', { name: 'Starter Archetype Preset' });
    expect(presetGroup).toBeInTheDocument();

    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBeGreaterThanOrEqual(3);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    expect(radios[0].querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
    expect(radios[1]).toHaveAttribute('aria-checked', 'false');

    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(radios[1]).toHaveFocus();
    expect(radios[1]).toHaveAttribute('aria-checked', 'true');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  test('renders Wedding Q&A & Starter FAQs toggle on Step 3 and includes faqs in sample data generation payload', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 3,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
        sampleArchetype: 'classic',
      })
    );

    let generatedSamplePayload: Record<string, unknown> | null = null;
    global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/admin/sample-data') && init?.body) {
        generatedSamplePayload = JSON.parse(init.body as string);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());

    const faqCheckbox = screen.getByRole('checkbox', { name: /Wedding Q&A & Starter FAQs/i });
    expect(faqCheckbox).toBeChecked();

    // Toggle off and back on to verify interactive state transition
    fireEvent.click(faqCheckbox);
    expect(faqCheckbox).not.toBeChecked();
    fireEvent.click(faqCheckbox);
    expect(faqCheckbox).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /Populate Sample Data & Continue/i }));

    await waitFor(() => {
      expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument();
    });

    expect(generatedSamplePayload).toBeTruthy();
    expect(generatedSamplePayload!.archetype).toBe('classic');
    expect(generatedSamplePayload!.modules).toContain('faqs');
  });

  test('previews Step 2 essentials preset and brand color changes live via ThemeProvider and maintains dark mode accessibility', async () => {
    const { ThemeProvider } = await import('@/components/ThemeProvider');
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 2,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
        weddingDate: '2026-12-31',
        baseUrl: 'https://alexandsam.com',
      })
    );

    const headStyle = document.createElement('style');
    headStyle.id = 'dynamic-theme-style';
    document.head.appendChild(headStyle);

    try {
      const { container } = renderWithProviders(
        <ThemeProvider initialThemeMode="dark" hasServerStylesheet>
          <SetupWizard />
        </ThemeProvider>
      );

      await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      const introCopy = screen.getByText(/Let's start with your names and when the big day is\./i);
      expect(introCopy).toHaveClass('dark:text-gray-200');
      expect(screen.queryByLabelText(/Container Max Width/i)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('radio', { name: /Romantic Preset/i }));

      const primaryInput = screen.getByLabelText(/Primary Color Code/i);
      fireEvent.change(primaryInput, { target: { value: '#be123c' } });

      const secondaryInput = screen.getByLabelText(/Secondary Color Code/i);
      fireEvent.change(secondaryInput, { target: { value: '#14532d' } });

      await waitFor(() => {
        expect(headStyle.textContent).toContain('--color-primary: #be123c;');
        expect(headStyle.textContent).toContain('--color-secondary: #14532d;');
        expect(headStyle.textContent).toContain('--card-bg: #231118;');
      });

      const axeResults = await axe(container);
      expect(axeResults).toHaveNoViolations();

      // Verify keyboard arrow navigation on Step 2 viewport toggle
      const viewportGroup = screen.getByRole('group', { name: /Step 2 preview viewport/i });
      const desktopBtn = within(viewportGroup).getByRole('button', { name: /^Desktop$/i });
      const mobileBtn = within(viewportGroup).getByRole('button', { name: /Mobile \(375px\)/i });
      const previewFrame = screen.getByTestId('step2-preview-frame');

      desktopBtn.focus();
      fireEvent.keyDown(desktopBtn, { key: 'ArrowRight' });
      expect(mobileBtn).toHaveFocus();
      expect(mobileBtn).toHaveAttribute('aria-pressed', 'true');
      expect(previewFrame).toHaveAttribute('data-viewport', 'mobile');

      fireEvent.keyDown(mobileBtn, { key: 'ArrowLeft' });
      expect(desktopBtn).toHaveFocus();
      expect(desktopBtn).toHaveAttribute('aria-pressed', 'true');
      expect(previewFrame).toHaveAttribute('data-viewport', 'desktop');
    } finally {
      headStyle.remove();
      document.documentElement.className = '';
    }
  });

  test('collects Street Address, Postal Code, and AddressLookupInput coordinates in Step 2 instead of hardcoding empty strings and zeros', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);

    let submittedSetupBody: Record<string, unknown> | null = null;
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/admin/geocode')) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: [
              {
                displayName: 'The Glasshouse, 660 12th Ave, New York, NY 10019, USA',
                name: 'The Glasshouse',
                streetAddress: '660 12th Ave',
                city: 'New York',
                state: 'NY',
                zip: '10019',
                country: 'USA',
                latitude: 40.7654,
                longitude: -73.9965,
              },
            ],
          }),
        };
      }
      if (url.includes('/api/admin/setup') && init?.method === 'POST') {
        submittedSetupBody = JSON.parse(String(init.body));
        return {
          ok: true,
          json: async () => ({ success: true }),
        };
      }
      return { ok: true, json: async () => ({ initialized: false, requiresSetup: true }) };
    }) as unknown as typeof fetch;

    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 2,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
        weddingDate: '2026-10-10',
        baseUrl: 'https://alexandsam.com',
      })
    );

    try {
      renderWithProviders(<SetupWizard />);

      await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

      const lookupInput = screen.getByRole('combobox', { name: 'Lookup Address' });
      fireEvent.change(lookupInput, { target: { value: 'The Glasshouse' } });
      fireEvent.click(screen.getByRole('button', { name: 'Lookup' }));

      const listbox = await screen.findByRole('listbox');
      fireEvent.click(listbox.querySelector('[role="option"]')!);

      expect(screen.getByLabelText('Venue Name')).toHaveValue('The Glasshouse');
      expect(screen.getByLabelText('Street Address')).toHaveValue('660 12th Ave');
      expect(screen.getByLabelText('City')).toHaveValue('New York');
      expect(screen.getByLabelText('State')).toHaveValue('NY');
      expect(screen.getByLabelText('Postal / Zip Code')).toHaveValue('10019');

      fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

      await waitFor(() => {
        expect(submittedSetupBody).not.toBeNull();
      });

      expect(submittedSetupBody).toMatchObject({
        venueName: 'The Glasshouse',
        venueAddress: '660 12th Ave',
        venueCity: 'New York',
        venueState: 'NY',
        venueZip: '10019',
        latitude: 40.7654,
        longitude: -73.9965,
      });
    } finally {
      global.fetch = originalFetch;
    }
  });

  test('invalidates QueryClient caches when Step 3 seeds sample data and excludes sample guests from Step 4/5 guest counts', async () => {
    const invitationCodesModule = jest.requireMock('@/hooks/admin/useAdminInvitationCodes') as {
      useAdminInvitationCodes: () => {
        data: unknown[];
        isLoading: boolean;
        error: null;
        fetchAll: jest.Mock;
      };
    };
    const originalUseAdminInvitationCodes = invitationCodesModule.useAdminInvitationCodes;
    invitationCodesModule.useAdminInvitationCodes = () => ({
      data: [
        { id: 'sample-1', code: 'DEMO1', guestName: 'Sample Guest', isSample: true },
        { id: 'sample-2', code: 'DEMO2', guestName: 'Sample Guest 2', isSample: true },
        { id: 'real-1', code: 'REAL1', guestName: 'Real Guest', isSample: false },
      ],
      isLoading: false,
      error: null,
      fetchAll: jest.fn(() =>
        Promise.resolve([
          { id: 'sample-1', code: 'DEMO1', guestName: 'Sample Guest', isSample: true },
          { id: 'real-1', code: 'REAL1', guestName: 'Real Guest', isSample: false },
        ])
      ),
    });

    (checkAdminClient as jest.Mock).mockResolvedValue(true);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
    ) as jest.Mock;

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <SetupWizard
            initialSavedConfig={{
              partner1Name: 'Alex',
              partner2Name: 'Sam',
              weddingDate: '2027-06-20',
              timezone: 'America/Chicago',
              baseUrl: 'https://alexandsam.com',
              venueName: '',
              venueCity: '',
              venueState: '',
            }}
          />
        </QueryClientProvider>
      );

      // Resumes at Step 3 from initialSavedConfig when sessionStorage is empty
      await waitFor(() => expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Skip to Admin Dashboard' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Populate Sample Data & Continue/i }));

      await waitFor(() => expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument());

      const invalidatedKeys = invalidateSpy.mock.calls.map((call) => call[0]?.queryKey);
      expect(invalidatedKeys).toEqual(
        expect.arrayContaining([
          ['admin-wedding-party'],
          ['admin-attractions'],
          ['admin-invitation-codes'],
          ['admin-registry'],
          ['admin-content-nodes'],
        ])
      );

      // Only the 1 non-sample guest is counted
      expect(screen.getByText(/1 guest record\(s\) imported/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Skip to Admin Dashboard' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Skip for Now' }));
      await waitFor(() => expect(screen.getByText('Step 5: Complete Setup')).toBeInTheDocument());
      expect(screen.getByText('Guest List: 1 invitation code(s) active')).toBeInTheDocument();
    } finally {
      invitationCodesModule.useAdminInvitationCodes = originalUseAdminInvitationCodes;
    }
  });

  test('marks setupCompleted true and clears setup_wizard_draft when finishing Step 5', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      'setup_wizard_draft',
      JSON.stringify({
        step: 5,
        partner1Name: 'Alex',
        partner2Name: 'Sam',
      })
    );

    let completionBody: Record<string, unknown> | null = null;
    global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      if (url.toString().includes('/api/admin/setup') && init?.body) {
        completionBody = JSON.parse(init.body as string);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, setupCompleted: true }),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);

    await waitFor(() => expect(screen.getByText('Step 5: Complete Setup')).toBeInTheDocument());

    // Suppress JSDOM navigation Not implemented console error during window.location.assign
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      fireEvent.click(screen.getByRole('button', { name: /Go to Admin Dashboard/i }));

      await waitFor(() => {
        expect(completionBody).toEqual({ setupCompleted: true });
      });
      expect(window.sessionStorage.getItem('setup_wizard_draft')).toBeNull();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  test('AC 1: persists selected theme preset, custom hex colors, and feature toggles across reload via setup_wizard_draft', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response)
    ) as jest.Mock;

    const firstRender = renderWithProviders(<SetupWizard />);
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('radio', { name: /Editorial Preset/i }));
    fireEvent.change(screen.getByLabelText(/Primary Color Code/i), {
      target: { value: '#1E40AF' },
    });
    fireEvent.change(screen.getByLabelText(/Secondary Color Code/i), {
      target: { value: '#B45309' },
    });
    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Taylor' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Jordan' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2027-09-18' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), {
      target: { value: 'https://taylorandjordan.com' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() =>
      expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument()
    );

    const countdownToggle = screen.getByTestId('setup-feature-toggle-countdown');
    fireEvent.click(countdownToggle);
    expect(countdownToggle).not.toBeChecked();

    firstRender.unmount();

    // Remount simulating browser reload: Step 3 and Step 2 draft state remain intact
    renderWithProviders(<SetupWizard />);
    await waitFor(() =>
      expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument()
    );
    expect(screen.getByTestId('setup-feature-toggle-countdown')).not.toBeChecked();

    const storedDraft = JSON.parse(window.sessionStorage.getItem('setup_wizard_draft')!);
    expect(storedDraft.themePreset).toBe('editorial');
    expect(storedDraft.colorPrimary).toBe('#1E40AF');
    expect(storedDraft.colorSecondary).toBe('#B45309');
    expect(storedDraft.enabledFeatures.countdown).toBe(false);
  });

  test('AC 2: updates Step 2 Live Guest Preview colors in dark mode from getPresetTokens without hardcoded #111827/#374151 and passes jest-axe', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    const { container } = renderWithProviders(<SetupWizard />);

    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('radio', { name: /Romantic Preset/i }));

    const previewCanvas = screen.getByTestId('step2-preview-frame');
    const previewStoryCard = screen.getByTestId('step2-preview-story-card');
    expect(previewCanvas).toHaveAttribute('data-theme-mode', 'light');

    const lightAxe = await axe(container);
    expect(lightAxe).toHaveNoViolations();

    // Switch preview to Dark Mode via the accessible Preview color mode group
    const modeGroup = screen.getByRole('group', { name: /Preview color mode/i });
    const darkBtn = within(modeGroup).getByRole('button', { name: /Dark/i });
    fireEvent.click(darkBtn);

    await waitFor(() => {
      expect(previewCanvas).toHaveAttribute('data-theme-mode', 'dark');
    });

    const darkTokens = getPresetTokens('romantic', 'dark');
    expect(darkTokens['--container-bg']).not.toBe('#111827');
    expect(previewCanvas).toHaveStyle({ backgroundColor: darkTokens['--container-bg'] });
    expect(previewStoryCard).toHaveStyle({ backgroundColor: darkTokens['--card-bg'] });
    expect(screen.getByTestId('step2-preview-headline')).not.toHaveStyle({
      color: 'rgb(17, 24, 39)',
    });

    const darkAxe = await axe(container);
    expect(darkAxe).toHaveNoViolations();
  });

  test('AC 3: defaults fresh session #timezone to browser IANA timezone and supports SearchableTimezoneSelect filtering & keyboard selection', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    const originalDateTimeFormat = Intl.DateTimeFormat;

    try {
      Intl.DateTimeFormat = jest.fn().mockImplementation(
        (_locales?: unknown, options?: { timeZone?: string }) => {
          if (options?.timeZone) {
            return originalDateTimeFormat(undefined, options);
          }
          return {
            resolvedOptions: () => ({ timeZone: 'America/Denver' }),
          };
        }
      ) as unknown as typeof Intl.DateTimeFormat;

      renderWithProviders(<SetupWizard />);
      await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

      const timezoneCombobox = screen.getByRole('combobox', { name: /Timezone/i });
      expect(timezoneCombobox).toHaveValue('America/Denver');

      fireEvent.focus(timezoneCombobox);
      fireEvent.change(timezoneCombobox, { target: { value: 'Honolulu' } });
      fireEvent.keyDown(timezoneCombobox, { key: 'Home' });
      fireEvent.keyDown(timezoneCombobox, { key: 'Enter' });

      expect(timezoneCombobox).toHaveValue('Pacific/Honolulu');
    } finally {
      Intl.DateTimeFormat = originalDateTimeFormat;
    }
  });

  test('AC 4: routes timezone, weddingDate, colorPrimary, and colorSecondary backend errors to exact controls without marking #siteUrl invalid', async () => {
    const cases: Array<{ message: string; expected: Step2ErrorField }> = [
      { message: 'Validation Error: Invalid IANA timezone.', expected: 'timezone' },
      { message: 'Validation Error: Invalid weddingDate format.', expected: 'weddingDate' },
      {
        message: 'Validation Error: Primary color must be a valid hex code.',
        expected: 'colorPrimary',
      },
      {
        message: 'Validation Error: Secondary color must be a valid hex code.',
        expected: 'colorSecondary',
      },
      { message: 'Database connection temporarily unavailable.', expected: 'form' },
    ];
    for (const item of cases) {
      expect(resolveStep2BackendErrorField(item.message)).toBe(item.expected);
    }

    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    const errorQueue = [
      'Validation Error: Invalid IANA timezone.',
      'Validation Error: Invalid weddingDate format.',
      'Validation Error: Primary color must be a valid hex code.',
      'Validation Error: Secondary color must be a valid hex code.',
    ];
    global.fetch = jest.fn(() => {
      const nextErr = errorQueue.shift() || 'Validation Error';
      return Promise.resolve({
        ok: false,
        json: () => Promise.resolve({ error: nextErr }),
      } as Response);
    }) as jest.Mock;

    renderWithProviders(<SetupWizard />);
    await waitFor(() => expect(screen.getByText('Step 2: The Essentials')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2027-08-14' } });
    const siteUrlInput = screen.getByLabelText(/Site URL/i);
    fireEvent.change(siteUrlInput, { target: { value: 'https://alexandsamwedding.com' } });

    const timezoneCombobox = screen.getByRole('combobox', { name: /Timezone/i });
    const weddingDateInput = screen.getByLabelText(/Wedding Date/i);
    const primaryColorInput = screen.getByLabelText(/Primary Color Code/i);
    const secondaryColorInput = screen.getByLabelText(/Secondary Color Code/i);

    // 1. Timezone error
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => expect(timezoneCombobox).toHaveAttribute('aria-invalid', 'true'));
    expect(document.activeElement).toBe(timezoneCombobox);
    expect(siteUrlInput).toHaveAttribute('aria-invalid', 'false');

    // 2. Wedding date error
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => expect(weddingDateInput).toHaveAttribute('aria-invalid', 'true'));
    expect(document.activeElement).toBe(weddingDateInput);
    expect(siteUrlInput).toHaveAttribute('aria-invalid', 'false');

    // 3. Primary color error
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => expect(primaryColorInput).toHaveAttribute('aria-invalid', 'true'));
    expect(document.activeElement).toBe(primaryColorInput);
    expect(document.getElementById('colorPrimary-error')).toHaveTextContent(
      /Primary color must be a valid hex code/i
    );
    expect(siteUrlInput).toHaveAttribute('aria-invalid', 'false');

    // 4. Secondary color error
    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));
    await waitFor(() => expect(secondaryColorInput).toHaveAttribute('aria-invalid', 'true'));
    expect(document.activeElement).toBe(secondaryColorInput);
    expect(document.getElementById('colorSecondary-error')).toHaveTextContent(
      /Secondary color must be a valid hex code/i
    );
    expect(siteUrlInput).toHaveAttribute('aria-invalid', 'false');
  });

  test('AC 5: enforces registry->groupGifting dependency in Step 3, persists modules via POST /api/admin/setup, and purges sample data on Skip', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: url.toString(),
        method: init?.method || 'GET',
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    }) as jest.Mock;

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <SetupWizard
          initialSavedConfig={{
            step: 3,
            partner1Name: 'Alex',
            partner2Name: 'Sam',
            weddingDate: '2027-06-20',
            timezone: 'America/Chicago',
            baseUrl: 'https://alexandsam.com',
          }}
        />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument()
    );

    const step3Axe = await axe(container);
    expect(step3Axe).toHaveNoViolations();

    const registryToggle = screen.getByTestId('setup-feature-toggle-registry');
    const groupGiftingToggle = screen.getByTestId('setup-feature-toggle-groupGifting');
    const countdownToggle = screen.getByTestId('setup-feature-toggle-countdown');
    const calendarToggle = screen.getByTestId('setup-feature-toggle-addToCalendar');

    expect(registryToggle).toBeChecked();
    expect(groupGiftingToggle).toBeChecked();
    expect(screen.getByText(/Registry Items & Cash Funds/i)).toBeInTheDocument();

    // Disable registry -> groupGifting becomes unchecked & disabled, and registry sample checkbox hides
    fireEvent.click(registryToggle);
    expect(registryToggle).not.toBeChecked();
    expect(groupGiftingToggle).not.toBeChecked();
    expect(groupGiftingToggle).toBeDisabled();
    expect(screen.queryByText(/Registry Items & Cash Funds/i)).not.toBeInTheDocument();

    fireEvent.click(countdownToggle);
    fireEvent.click(calendarToggle);

    // Click Skip -> persists modules via POST /api/admin/setup, calls DELETE /api/admin/sample-data, invalidates caches, advances to Step 4
    const skipSampleBtn = screen.getByRole('button', {
      name: /^Skip$/i,
    });
    fireEvent.click(skipSampleBtn);

    await waitFor(() => expect(screen.getByText('Step 4: Guest List Import')).toBeInTheDocument());

    const setupPost = requests.find(
      (req) => req.url.includes('/api/admin/setup') && req.method === 'POST'
    );
    expect(setupPost).toBeDefined();
    expect(setupPost?.body).toMatchObject({
      setupCompleted: false,
      showCountdown: false,
      showAddToCalendar: false,
      modules: expect.objectContaining({
        registry: false,
        groupGifting: false,
        countdown: false,
        addToCalendar: false,
      }),
    });

    const sampleDelete = requests.find(
      (req) => req.url.includes('/api/admin/sample-data') && req.method === 'DELETE'
    );
    expect(sampleDelete).toBeDefined();
    expect(invalidateSpy).toHaveBeenCalled();
  });

  test('AC 6: filters isSample items out of Step 5 Wedding Party & Attractions counts and renders live OnboardingChecklist progress with zero axe violations', async () => {
    (checkAdminClient as jest.Mock).mockResolvedValue(true);
    const partyModule = jest.requireMock('@/hooks/admin/useAdminWeddingParty');
    const attractionsModule = jest.requireMock('@/hooks/admin/useAdminAttractions');
    const origParty = partyModule.useAdminWeddingParty;
    const origAttractions = attractionsModule.useAdminAttractions;

    partyModule.useAdminWeddingParty = () => ({
      data: [
        { id: 'sample-1', name: 'Sample Best Man', isSample: true },
        { id: 'sample-2', name: 'Sample Maid of Honor', isSample: true },
        { id: 'real-1', name: 'Jordan Lee', isSample: false },
      ],
      isLoading: false,
      error: null,
    });
    attractionsModule.useAdminAttractions = () => ({
      data: [
        { id: 'attr-sample', name: 'Sample Museum', isSample: true },
        { id: 'attr-real-1', name: 'Art Institute', isSample: false },
        { id: 'attr-real-2', name: 'Riverwalk', isSample: false },
      ],
      isLoading: false,
      error: null,
    });

    global.fetch = jest.fn((url: string | URL | Request) => {
      if (url.toString().includes('/api/admin/onboarding-milestones')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              milestones: [
                {
                  id: 'wedding-details',
                  title: 'Wedding Details & Theme',
                  description: 'Configured core wedding date, venue, and visual theme.',
                  completed: true,
                  href: '/admin/dashboard/settings',
                  actionLabel: 'Review Settings',
                },
                {
                  id: 'guest-list',
                  title: 'Guest List & Invitations',
                  description: 'Import households and generate invitation codes.',
                  completed: false,
                  href: '/admin/dashboard/rsvps',
                  actionLabel: 'Manage Guests',
                },
              ],
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    }) as jest.Mock;

    try {
      const { container } = renderWithProviders(
        <SetupWizard
          initialSavedConfig={{
            step: 5,
            partner1Name: 'Alex',
            partner2Name: 'Sam',
            weddingDate: '2027-06-20',
            timezone: 'America/Chicago',
            baseUrl: 'https://alexandsam.com',
          }}
        />
      );

      await waitFor(() => expect(screen.getByText('Step 5: Complete Setup')).toBeInTheDocument());

      // Only non-sample items are counted: 1 member and 2 items (not 3 and 3)
      expect(
        screen.getByRole('button', { name: /Manage Wedding Party \(1 member\)/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Manage Attractions \(2 items\)/i })
      ).toBeInTheDocument();

      // OnboardingChecklist renders live readiness progress from /api/admin/onboarding-milestones
      const checklist = await screen.findByTestId('onboarding-checklist');
      expect(checklist).toBeInTheDocument();
      expect(within(checklist).getByText(/1 of 2 milestones completed/i)).toBeInTheDocument();

      const step5Axe = await axe(container);
      expect(step5Axe).toHaveNoViolations();
    } finally {
      partyModule.useAdminWeddingParty = origParty;
      attractionsModule.useAdminAttractions = origAttractions;
    }
  });

  test('renders Ceremony Start Time alongside Wedding Date and Venue Timezone with live confirmation and persists venue-zoned ceremony instants', async () => {
    const submittedPayloads: Record<string, unknown>[] = [];
    global.fetch = jest.fn((url: string | URL | Request, options?: RequestInit) => {
      if (url.toString().includes('/api/admin/setup') && options?.method === 'POST') {
        const parsed = options.body ? JSON.parse(String(options.body)) : {};
        submittedPayloads.push(parsed);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    }) as jest.Mock;

    // 1. Default 16:00 ceremony in America/Chicago -> 2027-06-20T21:00:00.000Z
    const { container, unmount } = renderWithProviders(
      <SetupWizard
        initialSavedConfig={{
          step: 2,
          partner1Name: 'Maya',
          partner2Name: 'Liam',
          weddingDate: '2027-06-20',
          ceremonyTime: '16:00',
          timezone: 'America/Chicago',
          baseUrl: 'https://mayaliam.org',
        }}
      />
    );

    const dateInput = await screen.findByLabelText('Wedding Date');
    const timeInput = screen.getByLabelText(/Ceremony Start Time/i) as HTMLInputElement;
    expect(dateInput).toHaveValue('2027-06-20');
    expect(timeInput.value).toBe('16:00');

    const confirmation = screen.getByTestId('setup-ceremony-confirmation');
    expect(confirmation).toHaveTextContent(/Sunday, June 20, 2027/i);
    expect(confirmation).toHaveTextContent(/4:00 PM/i);
    expect(confirmation).toHaveTextContent(/America\/Chicago/i);

    const step2Axe = await axe(container);
    expect(step2Axe).toHaveNoViolations();

    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    await waitFor(() => {
      expect(submittedPayloads.some((p) => p.partner1Name === 'Maya')).toBe(true);
    });
    const chicagoPayload = submittedPayloads.find((p) => p.partner1Name === 'Maya')!;
    expect(chicagoPayload.weddingDate).toBe('2027-06-20T21:00:00.000Z');
    expect(chicagoPayload.ceremonyTime).toBe('16:00');
    expect(chicagoPayload.timezone).toBe('America/Chicago');

    unmount();
    localStorage.clear();
    sessionStorage.clear();
    submittedPayloads.length = 0;

    // 2. Evening 19:30 ceremony in America/Los_Angeles -> 2027-06-21T02:30:00.000Z and reloads 2027-06-20 + 19:30
    renderWithProviders(
      <SetupWizard
        initialSavedConfig={{
          step: 2,
          partner1Name: 'Maya',
          partner2Name: 'Liam',
          weddingDate: '2027-06-20',
          ceremonyTime: '19:30',
          timezone: 'America/Los_Angeles',
          baseUrl: 'https://mayaliam.org',
        }}
      />
    );

    const laDateInput = await screen.findByLabelText('Wedding Date');
    const laTimeInput = screen.getByLabelText(/Ceremony Start Time/i) as HTMLInputElement;
    expect(laDateInput).toHaveValue('2027-06-20');
    expect(laTimeInput.value).toBe('19:30');
    expect(screen.getByTestId('setup-ceremony-confirmation')).toHaveTextContent(
      /Sunday, June 20, 2027.*7:30 PM.*America\/Los_Angeles/i
    );

    fireEvent.click(screen.getByRole('button', { name: /Next Step/i }));

    await waitFor(() => {
      expect(submittedPayloads.some((p) => p.timezone === 'America/Los_Angeles')).toBe(true);
    });
    const laPayload = submittedPayloads.find((p) => p.timezone === 'America/Los_Angeles')!;
    expect(laPayload.weddingDate).toBe('2027-06-21T02:30:00.000Z');
    expect(laPayload.ceremonyTime).toBe('19:30');
  });
});
