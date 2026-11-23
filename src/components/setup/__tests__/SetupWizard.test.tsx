import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import SetupWizard from '../SetupWizard';
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

  test('backend save error in Step 2 shifts focus to site URL input', async () => {
    let callCount = 0;
    global.fetch = jest.fn((_url: string | URL | Request) => {
      callCount++;
      if (callCount === 1) {
        // First call: login succeeds
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        } as Response);
      } else {
        // Second call: config save fails
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: 'Backend validation failed.' }),
        } as Response);
      }
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

    await waitFor(() => {
      expect(screen.getByText('Backend validation failed.')).toBeInTheDocument();
    });

    // Check focus shift
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
    const presetSelect = screen.getByLabelText(/Select Theme Preset/i);
    fireEvent.change(presetSelect, { target: { value: 'romantic' } });
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

  test('allows completing Step 2 with empty or whitespace venue fields using empty-string fallback, pre-wedding hero copy, and setupCompleted false', async () => {
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
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });

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
    expect(payload.heroSubtitle).toBe('');
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

      const presetSelect = screen.getByLabelText(/Select Theme Preset/i);
      fireEvent.change(presetSelect, { target: { value: 'romantic' } });

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
    } finally {
      headStyle.remove();
      document.documentElement.className = '';
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
});
