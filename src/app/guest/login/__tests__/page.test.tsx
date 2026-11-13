import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import GuestLoginPage from '../page';
import { useRouter, useSearchParams } from 'next/navigation';
import { ThemeProvider } from '@/components/ThemeProvider';

expect.extend(toHaveNoViolations);

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(),
}));

const globalWithFetch = global as unknown as { fetch?: typeof fetch };
const originalFetch = globalWithFetch.fetch;

describe('Guest Login Page with Help Drawer', () => {
  const mockPush = jest.fn();
  const mockGetParam = jest.fn().mockReturnValue(null);

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useSearchParams as jest.Mock).mockReturnValue({ get: mockGetParam });
  });

  afterEach(() => {
    if (originalFetch) {
      globalWithFetch.fetch = originalFetch;
    } else {
      delete globalWithFetch.fetch;
    }
    jest.restoreAllMocks();
  });

  it('renders login form and help trigger button', async () => {
    const { container } = render(<GuestLoginPage />);

    expect(screen.getByRole('heading', { name: /guest portal/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter passcode')).toBeInTheDocument();

    const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
    expect(helpTrigger).toBeInTheDocument();
    expect(helpTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(helpTrigger).toHaveAttribute('aria-controls', 'guest-help-drawer');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('opens help drawer when clicking help trigger and displays recovery instructions and host contact option', async () => {
    const { container } = render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
    fireEvent.click(helpTrigger);

    expect(helpTrigger).toHaveAttribute('aria-expanded', 'true');

    const drawer = screen.getByRole('dialog');
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute('aria-modal', 'true');

    expect(screen.getByRole('heading', { name: /passcode assistance/i })).toBeInTheDocument();
    expect(screen.getByText(/how to locate your guest passcode:/i)).toBeInTheDocument();
    expect(screen.getByText(/check your physical wedding invitation/i)).toBeInTheDocument();

    const contactBtn = screen.getByRole('link', { name: /contact host/i });
    expect(contactBtn).toBeInTheDocument();
    expect(contactBtn).toHaveAttribute('href', 'mailto:hosts@wedding.example?subject=Passcode%20Assistance%20-%20Guest%20Portal');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('uses configured contact email from ThemeProvider in mailto link', async () => {
    render(
      <ThemeProvider config={{ contactEmail: 'custom-hosts@wedding.example' }}>
        <GuestLoginPage />
      </ThemeProvider>
    );

    const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
    fireEvent.click(helpTrigger);

    const contactBtn = screen.getByRole('link', { name: /contact host/i });
    expect(contactBtn).toHaveAttribute('href', 'mailto:custom-hosts@wedding.example?subject=Passcode%20Assistance%20-%20Guest%20Portal');
  });

  it('moves focus inside the dialog when opened', async () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
    fireEvent.click(helpTrigger);

    const closeBtn = screen.getByRole('button', { name: /close help drawer/i });
    expect(document.activeElement).toBe(closeBtn);
  });

  it('traps focus within drawer controls on Tab and Shift+Tab', async () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
    fireEvent.click(helpTrigger);

    const closeBtn = screen.getByRole('button', { name: /close help drawer/i });
    const gotItBtn = screen.getByRole('button', { name: /got it, thanks/i });

    // Focus initial (close button)
    expect(document.activeElement).toBe(closeBtn);

    // Focus last element manually and press Tab
    gotItBtn.focus();
    expect(document.activeElement).toBe(gotItBtn);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);

    // Press Shift+Tab on first element
    closeBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(gotItBtn);
  });

  it('closes help drawer when clicking backdrop and restores focus', async () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
    helpTrigger.focus();
    fireEvent.click(helpTrigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    // Click backdrop (dialog itself)
    fireEvent.click(dialog);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(helpTrigger);
  });

  it('closes help drawer when pressing Escape key', async () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
    fireEvent.click(helpTrigger);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('restores focus to the trigger button when help drawer is closed', async () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
    helpTrigger.focus();
    expect(document.activeElement).toBe(helpTrigger);

    fireEvent.click(helpTrigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /close help drawer/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(helpTrigger);
  });

  it('closes help drawer when clicking close button or dismiss button', async () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
    fireEvent.click(helpTrigger);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /close help drawer/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(helpTrigger).toHaveAttribute('aria-expanded', 'false');

    // Reopen and test dismiss button ("Got it, thanks")
    fireEvent.click(helpTrigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const gotItBtn = screen.getByRole('button', { name: /got it, thanks/i });
    fireEvent.click(gotItBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows error prompt when login fails', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      json: async () => ({
        success: false,
        error: 'Incorrect passcode. Need help? Try using the host help drawer below for assistance.',
        helpPrompt: 'Need help finding your passcode? Open the host help drawer below.',
      }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    render(<GuestLoginPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter passcode'), {
      target: { value: 'wrongpass' },
    });
    fireEvent.click(screen.getByRole('button', { name: /access portal/i }));

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toBeInTheDocument();
    expect(errorAlert).toHaveTextContent(/incorrect passcode/i);
    expect(errorAlert).toHaveTextContent(/host help drawer/i);
  });

  it('redirects on successful login', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    render(<GuestLoginPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter passcode'), {
      target: { value: 'wedding2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: /access portal/i }));

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  describe('Self-Service Invitation Lookup Tab', () => {
    it('displays interactive Look Up Invitation tab in help drawer', async () => {
      const { container } = render(<GuestLoginPage />);

      const helpTrigger = screen.getByRole('button', { name: /need help finding your passcode\?/i });
      fireEvent.click(helpTrigger);

      const lookupTab = screen.getByRole('tab', { name: /look up invitation/i });
      expect(lookupTab).toBeInTheDocument();
      expect(lookupTab).toHaveAttribute('aria-selected', 'false');

      fireEvent.click(lookupTab);
      expect(lookupTab).toHaveAttribute('aria-selected', 'true');

      expect(screen.getByLabelText(/guest name or email/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /look up invitation/i })).toBeInTheDocument();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it('validates input requires at least 2 characters for names or valid email format', async () => {
      render(<GuestLoginPage />);

      fireEvent.click(screen.getByRole('button', { name: /need help finding your passcode\?/i }));
      fireEvent.click(screen.getByRole('tab', { name: /look up invitation/i }));

      const queryInput = screen.getByLabelText(/guest name or email/i);
      const submitBtn = screen.getByRole('button', { name: /look up invitation/i });

      // Empty submission
      fireEvent.click(submitBtn);
      expect(await screen.findByText(/please enter your name or email address/i)).toBeInTheDocument();

      // Short name (<2 chars)
      fireEvent.change(queryInput, { target: { value: 'A' } });
      fireEvent.click(submitBtn);
      expect(await screen.findByText(/name must be at least 2 characters/i)).toBeInTheDocument();

      // Invalid email
      fireEvent.change(queryInput, { target: { value: 'bademail@' } });
      fireEvent.click(submitBtn);
      expect(await screen.findByText(/invalid email format/i)).toBeInTheDocument();
    });

    it('submitting a valid guest name or email displays matching invitation details and grants access', async () => {
      const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          guestName: 'Taylor Swift',
          code: 'LOVER13',
          data: {
            guestName: 'Taylor Swift',
            code: 'LOVER13',
          },
        }),
      } as unknown as Response);
      globalWithFetch.fetch = fetchMock;

      render(<GuestLoginPage />);

      fireEvent.click(screen.getByRole('button', { name: /need help finding your passcode\?/i }));
      fireEvent.click(screen.getByRole('tab', { name: /look up invitation/i }));

      const queryInput = screen.getByLabelText(/guest name or email/i);
      fireEvent.change(queryInput, { target: { value: 'Taylor Swift' } });
      fireEvent.click(screen.getByRole('button', { name: /look up invitation/i }));

      expect(fetchMock).toHaveBeenCalledWith('/api/guest/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'Taylor Swift' }),
      });

      expect(await screen.findByText(/invitation found!/i)).toBeInTheDocument();
      expect(screen.getByText(/Taylor Swift/i)).toBeInTheDocument();
      expect(screen.getByText(/LOVER13/i)).toBeInTheDocument();
      expect(screen.getByText(/session hydrated/i)).toBeInTheDocument();

      const continueBtn = screen.getByRole('button', { name: /continue to portal/i });
      expect(continueBtn).toBeInTheDocument();
      fireEvent.click(continueBtn);
      expect(mockPush).toHaveBeenCalledWith('/');
    });

    it('unmatched searches present clear error notice and direct host contact fallback button', async () => {
      const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          success: false,
          error: 'No invitation found matching the provided details.',
        }),
      } as unknown as Response);
      globalWithFetch.fetch = fetchMock;

      render(
        <ThemeProvider config={{ contactEmail: 'hosts@example.com' }}>
          <GuestLoginPage />
        </ThemeProvider>
      );

      fireEvent.click(screen.getByRole('button', { name: /need help finding your passcode\?/i }));
      fireEvent.click(screen.getByRole('tab', { name: /look up invitation/i }));

      const queryInput = screen.getByLabelText(/guest name or email/i);
      fireEvent.change(queryInput, { target: { value: 'Unknown Person' } });
      fireEvent.click(screen.getByRole('button', { name: /look up invitation/i }));

      expect(await screen.findByText(/no invitation found matching/i)).toBeInTheDocument();
      expect(screen.getByText(/still cannot find your invitation\?/i)).toBeInTheDocument();

      const contactBtn = screen.getByRole('link', { name: /contact host/i });
      expect(contactBtn).toBeInTheDocument();
      expect(contactBtn).toHaveAttribute('href', expect.stringContaining('mailto:hosts@example.com'));
    });

    it('handles rate-limit 429 response and blocks further searches', async () => {
      const fetchMock = jest.fn<typeof fetch>().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          success: false,
          error: 'Too many requests, please try again later.',
        }),
      } as unknown as Response);
      globalWithFetch.fetch = fetchMock;

      render(<GuestLoginPage />);

      fireEvent.click(screen.getByRole('button', { name: /need help finding your passcode\?/i }));
      fireEvent.click(screen.getByRole('tab', { name: /look up invitation/i }));

      const queryInput = screen.getByLabelText(/guest name or email/i);
      fireEvent.change(queryInput, { target: { value: 'Spam Search' } });
      fireEvent.click(screen.getByRole('button', { name: /look up invitation/i }));

      expect(await screen.findByText(/too many requests, please try again later/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /look up invitation/i })).toBeDisabled();
      expect(queryInput).toBeDisabled();
    });
  });
});
