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

describe('Guest Login Page with Unified Sign-In and Help Drawer', () => {
  const mockPush = jest.fn();
  const mockGetParam = jest.fn().mockReturnValue(null);

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetParam.mockReturnValue(null);
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

  it('renders unified login form and help trigger button with no accessibility violations', async () => {
    const { container } = render(<GuestLoginPage />);

    expect(screen.getByRole('heading', { name: /guest portal/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/passcode or invitation code/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter passcode or invitation code')).toBeInTheDocument();

    const helpTrigger = screen.getByRole('button', { name: /need help finding your code\?/i });
    expect(helpTrigger).toBeInTheDocument();
    expect(helpTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(helpTrigger).toHaveAttribute('aria-controls', 'guest-help-drawer');

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('opens help drawer without unauthenticated lookup tab and hides mailto when contactEmail is not configured', async () => {
    const { container } = render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your code\?/i });
    fireEvent.click(helpTrigger);

    expect(helpTrigger).toHaveAttribute('aria-expanded', 'true');

    const drawer = screen.getByRole('dialog');
    expect(drawer).toBeInTheDocument();
    expect(drawer).toHaveAttribute('aria-modal', 'true');

    expect(screen.getByRole('heading', { name: /sign-in help/i })).toBeInTheDocument();
    expect(screen.getByText(/where to find your code:/i)).toBeInTheDocument();
    expect(screen.getByText(/check your physical wedding invitation/i)).toBeInTheDocument();

    // Unauthenticated lookup tab and internal technical copy must not appear
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /look up invitation/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/session hydrated/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unauthorized/i)).not.toBeInTheDocument();

    // No mailto link or placeholder hosts@wedding.example when contactEmail is empty
    expect(screen.queryByRole('link', { name: /contact host/i })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('hosts@wedding.example');
    expect(screen.getByText(/please message the hosts directly/i)).toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('hides mailto link when contactEmail is invalid or set to placeholder hosts@wedding.example', () => {
    const { rerender, container } = render(
      <ThemeProvider config={{ contactEmail: 'hosts@wedding.example' }}>
        <GuestLoginPage />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /need help finding your code\?/i }));
    expect(screen.queryByRole('link', { name: /contact host/i })).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain('hosts@wedding.example');
    expect(screen.getByText(/please message the hosts directly/i)).toBeInTheDocument();

    rerender(
      <ThemeProvider config={{ contactEmail: 'not-an-email' }}>
        <GuestLoginPage />
      </ThemeProvider>
    );
    expect(screen.queryByRole('link', { name: /contact host/i })).not.toBeInTheDocument();
    expect(screen.getByText(/please message the hosts directly/i)).toBeInTheDocument();
  });

  it('renders working mailto link when a valid contactEmail is configured', async () => {
    const { container } = render(
      <ThemeProvider config={{ contactEmail: 'hosts@ourwedding.com' }}>
        <GuestLoginPage />
      </ThemeProvider>
    );

    const helpTrigger = screen.getByRole('button', { name: /need help finding your code\?/i });
    fireEvent.click(helpTrigger);

    const contactBtn = screen.getByRole('link', { name: /contact host/i });
    expect(contactBtn).toBeInTheDocument();
    expect(contactBtn).toHaveAttribute(
      'href',
      'mailto:hosts@ourwedding.com?subject=Guest%20Portal%20Sign-In%20Help'
    );
    expect(screen.queryByText(/please message the hosts directly/i)).not.toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('moves focus inside the dialog when opened', () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your code\?/i });
    fireEvent.click(helpTrigger);

    const closeBtn = screen.getByRole('button', { name: /close help drawer/i });
    expect(document.activeElement).toBe(closeBtn);
  });

  it('traps focus within drawer controls on Tab and Shift+Tab', () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your code\?/i });
    fireEvent.click(helpTrigger);

    const closeBtn = screen.getByRole('button', { name: /close help drawer/i });
    const gotItBtn = screen.getByRole('button', { name: /got it, thanks/i });

    expect(document.activeElement).toBe(closeBtn);

    gotItBtn.focus();
    expect(document.activeElement).toBe(gotItBtn);

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);

    closeBtn.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(gotItBtn);
  });

  it('closes help drawer when clicking backdrop and restores focus', async () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your code\?/i });
    helpTrigger.focus();
    fireEvent.click(helpTrigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(dialog);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(helpTrigger);
  });

  it('closes help drawer when pressing Escape key', async () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your code\?/i });
    fireEvent.click(helpTrigger);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('restores focus to the trigger button when help drawer is closed', async () => {
    render(<GuestLoginPage />);

    const helpTrigger = screen.getByRole('button', { name: /need help finding your code\?/i });
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

    const helpTrigger = screen.getByRole('button', { name: /need help finding your code\?/i });
    fireEvent.click(helpTrigger);

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /close help drawer/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(helpTrigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(helpTrigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const gotItBtn = screen.getByRole('button', { name: /got it, thanks/i });
    fireEvent.click(gotItBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('toggles code visibility when show/hide button is clicked', () => {
    render(<GuestLoginPage />);

    const input = screen.getByPlaceholderText('Enter passcode or invitation code');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: /show code/i }));
    expect(input).toHaveAttribute('type', 'text');

    fireEvent.click(screen.getByRole('button', { name: /hide code/i }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('shows plain-language error alert and stays on /guest/login when code is unrecognized', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: 'Incorrect passcode or invitation code. Need help? Open the help drawer below for assistance.',
          helpPrompt: 'Need help finding your code? Open the help drawer below for instructions on how to reach the hosts.',
        }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { container } = render(<GuestLoginPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter passcode or invitation code'), {
      target: { value: 'wrongcode' },
    });
    fireEvent.click(screen.getByRole('button', { name: /access portal/i }));

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toBeInTheDocument();
    expect(errorAlert).toHaveTextContent(/incorrect passcode or invitation code/i);
    expect(errorAlert).toHaveTextContent(/help drawer/i);
    expect(mockPush).not.toHaveBeenCalled();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('redirects to callbackUrl on successful sign-in with shared passcode or personal invitation code', async () => {
    mockGetParam.mockReturnValue('/rsvp');
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, sessionType: 'invitation', guestName: 'Jordan Lee' }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    render(<GuestLoginPage />);

    fireEvent.change(screen.getByPlaceholderText('Enter passcode or invitation code'), {
      target: { value: 'love2026' },
    });
    fireEvent.click(screen.getByRole('button', { name: /access portal/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/guest/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ passcode: 'love2026' }),
        })
      );
      expect(mockPush).toHaveBeenCalledWith('/rsvp');
    });
  });

  it('prefills and auto-submits a valid code query parameter on load and strips code from browser history', async () => {
    window.history.replaceState({}, '', '/guest/login?callbackUrl=%2Fschedule&code=VALID2026');
    const replaceStateSpy = jest.spyOn(window.history, 'replaceState');
    mockGetParam.mockImplementation((key: string) => {
      if (key === 'code') return 'VALID2026';
      if (key === 'callbackUrl') return '/schedule';
      return null;
    });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, sessionType: 'invitation', guestName: 'Jordan Lee' }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    render(<GuestLoginPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/guest/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ passcode: 'VALID2026' }),
        })
      );
      expect(mockPush).toHaveBeenCalledWith('/schedule');
    });

    expect(replaceStateSpy).toHaveBeenCalledWith(
      expect.anything(),
      '',
      '/guest/login?callbackUrl=%2Fschedule'
    );

    replaceStateSpy.mockRestore();
    window.history.replaceState({}, '', '/');
  });

  it('shows an inline error and keeps the input prefilled and editable when an invalid or sample code is supplied on /guest/login', async () => {
    mockGetParam.mockImplementation((key: string) => {
      if (key === 'code') return 'SAMPLE2026';
      return null;
    });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: 'Incorrect passcode or invitation code. Please check your invitation and try again.',
        }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, sessionType: 'invitation', guestName: 'Real Guest' }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    render(<GuestLoginPage />);

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toHaveTextContent(/incorrect passcode or invitation code/i);

    const input = screen.getByPlaceholderText('Enter passcode or invitation code') as HTMLInputElement;
    expect(input).not.toBeDisabled();
    expect(input.value).toBe('SAMPLE2026');

    fireEvent.change(input, { target: { value: 'REALCODE26' } });
    expect(input.value).toBe('REALCODE26');

    fireEvent.click(screen.getByRole('button', { name: /access portal/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/guest/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ passcode: 'REALCODE26' }),
        })
      );
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('exposes autoComplete="current-password", renders visible busy text on submit, and keeps #passcode focused across failed sign-ins', async () => {
    let resolveLogin: ((value: Response) => void) | null = null;
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolveLogin = resolve;
          })
      );
    globalWithFetch.fetch = fetchMock;

    const { container } = render(<GuestLoginPage />);

    const passcodeInput = screen.getByLabelText(/passcode or invitation code/i) as HTMLInputElement;
    expect(passcodeInput).toHaveAttribute('id', 'passcode');
    expect(passcodeInput).toHaveAttribute('autocomplete', 'current-password');
    expect(passcodeInput).toBeRequired();
    expect(passcodeInput).toHaveAttribute('aria-required', 'true');

    passcodeInput.focus();
    expect(document.activeElement).toBe(passcodeInput);

    fireEvent.change(passcodeInput, { target: { value: 'WRONGCODE' } });
    fireEvent.submit(passcodeInput.closest('form')!);

    // While request is in flight: #passcode is readOnly + aria-busy (never disabled/blurred), button shows visible busy text
    expect(document.activeElement).toBe(passcodeInput);
    expect(passcodeInput).not.toBeDisabled();
    expect(passcodeInput).toHaveAttribute('readonly');
    expect(passcodeInput).toHaveAttribute('aria-busy', 'true');

    const busySubmitButton = screen.getByRole('button', { name: /signing in\.\.\./i });
    expect(busySubmitButton).toBeInTheDocument();
    expect(busySubmitButton).toHaveAttribute('aria-busy', 'true');
    expect(busySubmitButton).toHaveTextContent('Signing in...');
    expect(busySubmitButton.querySelector('.opacity-0')).toBeNull();

    // Resolve with 401 failure
    resolveLogin!({
      ok: false,
      status: 401,
      json: async () => ({
        success: false,
        error: 'Incorrect passcode or invitation code. Please check your invitation and try again.',
      }),
    } as unknown as Response);

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toHaveAttribute('id', 'login-error');
    expect(passcodeInput).toHaveAttribute('aria-invalid', 'true');
    expect(passcodeInput).toHaveAttribute('aria-describedby', 'login-error');
    expect(passcodeInput).not.toHaveAttribute('readonly');
    expect(document.activeElement).toBe(passcodeInput);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders Back to Wedding Photos link when /api/guest/session returns status: photo_qr and hides it when status is none', async () => {
    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            status: 'photo_qr',
            isVerified: false,
            invitationCode: null,
            code: null,
            guestName: null,
            hasPasscodeSession: false,
          },
        }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { container, unmount } = render(<GuestLoginPage />);

    const backLink = await screen.findByTestId('back-to-wedding-photos-link');
    expect(backLink).toBeInTheDocument();
    expect(backLink).toHaveTextContent('Back to Wedding Photos');
    expect(backLink).toHaveAttribute('href', '/photos?tab=guest');
    expect(await axe(container)).toHaveNoViolations();

    unmount();

    // Verify link is hidden when status is none
    globalWithFetch.fetch = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            status: 'none',
            isVerified: false,
            invitationCode: null,
            code: null,
            guestName: null,
            hasPasscodeSession: false,
          },
        }),
      } as unknown as Response);

    render(<GuestLoginPage />);
    await waitFor(() => {
      expect(globalWithFetch.fetch).toHaveBeenCalledWith(
        '/api/guest/session',
        expect.any(Object)
      );
    });
    expect(screen.queryByTestId('back-to-wedding-photos-link')).not.toBeInTheDocument();
  });
});
