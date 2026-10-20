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
});
