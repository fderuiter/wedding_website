import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SetupWizard from '../SetupWizard';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('SetupWizard focus shifting and ARIA error linking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    // Wait for Step 1 Essentials form
    await waitFor(() => expect(screen.getByText('Step 1: The Essentials')).toBeInTheDocument());

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
    global.fetch = jest.fn((url: string | URL | Request) => {
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

    // Wait for Step 1 Essentials form
    await waitFor(() => expect(screen.getByText('Step 1: The Essentials')).toBeInTheDocument());

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

  test('submits theme preset and layout tokens during Step 2 setup save', async () => {
    let savedPayload: any = null;
    let callCount = 0;
    global.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
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

    await waitFor(() => expect(screen.getByText('Step 1: The Essentials')).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Partner 1/i), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/Partner 2/i), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/Wedding Date/i), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText(/Venue Name/i), { target: { value: 'Grand Ballroom' } });
    fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Chicago' } });
    fireEvent.change(screen.getByLabelText(/State/i), { target: { value: 'IL' } });
    fireEvent.change(screen.getByLabelText(/Site URL/i), { target: { value: 'https://alexandsam.com' } });

    // Change theme preset
    const presetSelect = screen.getByLabelText(/Select Theme Preset/i);
    fireEvent.change(presetSelect, { target: { value: 'romantic' } });

    // Change container max width layout token
    const maxWidthInput = screen.getByLabelText(/Container Max Width/i);
    fireEvent.change(maxWidthInput, { target: { value: '72rem' } });

    fireEvent.click(screen.getByRole('button', { name: 'Next Step' }));

    await waitFor(() => {
      expect(screen.getByText('Step 3: Sample Data Selection')).toBeInTheDocument();
    });

    expect(savedPayload).toBeTruthy();
    expect(savedPayload.themePreset).toBe('romantic');
    expect(savedPayload.layoutContainerMaxWidth).toBe('72rem');
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
    await waitFor(() => expect(screen.getByText('Step 1: The Essentials')).toBeInTheDocument());
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
    await waitFor(() => expect(screen.getByText('Step 1: The Essentials')).toBeInTheDocument());
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
});
