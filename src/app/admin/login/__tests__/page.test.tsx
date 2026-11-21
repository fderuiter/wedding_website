import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { axe, toHaveNoViolations } from 'jest-axe';
import LoginPage from '../page';
import { useRouter, useSearchParams } from 'next/navigation';

expect.extend(toHaveNoViolations);

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useSearchParams: jest.fn(() => new URLSearchParams()),
}));

const globalWithFetch = global as unknown as { fetch?: typeof fetch };
const originalFetch = globalWithFetch.fetch;

describe('Admin Login Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    if (originalFetch) {
      globalWithFetch.fetch = originalFetch;
    } else {
      delete globalWithFetch.fetch;
    }
    jest.restoreAllMocks();
  });

  it('redirects to dashboard on successful login', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ isAdmin: true }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    render(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith('/admin/dashboard');
    });
  });

  it('shows error message on failed login', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invalid password' }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    render(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    expect(await screen.findByText('Invalid password')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows network error message when fetch rejects', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockRejectedValue(new Error('network'));
    globalWithFetch.fetch = fetchMock;

    render(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    expect(await screen.findByText('Network error.')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('disables button while logging in and restores after completion', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push });

    let resolveFetch: (value: Response) => void = () => {};
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockReturnValue(fetchPromise);
    globalWithFetch.fetch = fetchMock;

    render(<LoginPage />);

    fireEvent.change(screen.getByPlaceholderText('••••••••'), {
      target: { value: 'secret' },
    });
    const button = screen.getByRole('button', { name: /login/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Login'); // The text is still there, but wrapped in opacity-0 span. However JSDOM textContent might still see it.
    });

    resolveFetch({
      ok: false,
      json: async () => ({ error: 'Invalid password' }),
    } as unknown as Response);

    await waitFor(() => {
      expect(button).not.toBeDisabled();
      expect(button).toHaveTextContent('Login');
    });
  });

  it('toggles password visibility', () => {
    render(<LoginPage />);

    const passwordInput = screen.getByPlaceholderText('••••••••');
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggleButton = screen.getByLabelText(/show password/i);
    fireEvent.click(toggleButton);

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText(/hide password/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/hide password/i));
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('meets WCAG 2.1 AA accessibility guidelines', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invalid password' }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    render(<LoginPage />);

    // 1. Check sequential focus and lack of autofocus
    const passwordInput = screen.getByPlaceholderText('••••••••');
    expect(passwordInput).not.toHaveAttribute('autoFocus');

    // 2. Back to home link contrast classes
    const backLink = screen.getByRole('link', { name: /back to home/i });
    expect(backLink).toHaveClass('text-gray-700');
    expect(backLink).toHaveClass('dark:text-gray-300');

    // 3. Title gradient light colors for dark mode contrast
    const title = screen.getByRole('heading', { name: /admin login/i });
    expect(title).toHaveClass('dark:from-primary-light');
    expect(title).toHaveClass('dark:to-secondary-light');

    // 4. Form input border for contrast
    expect(passwordInput).toHaveClass('dark:border-gray-400');

    // 5. Visibility toggle button contrast
    const toggleButton = screen.getByLabelText(/show password/i);
    expect(toggleButton).toHaveClass('dark:text-gray-400');

    // Submit and trigger error to check error message text contrast
    fireEvent.change(passwordInput, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    const errorMsg = await screen.findByRole('alert');
    expect(errorMsg).toHaveClass('text-red-600');
    expect(errorMsg).toHaveClass('dark:text-primary-text');
  });

  it('switches to Forgot password view, dispatches reset link request, and passes jest-axe', async () => {
    const push = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push });

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          message: 'If an administrative contact email and email provider are configured, a password reset link valid for 30 minutes has been sent.',
        }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { container } = render(<LoginPage />);

    fireEvent.click(screen.getByRole('button', { name: /forgot password\?/i }));
    expect(screen.getByRole('heading', { name: /reset admin password/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    const statusMsg = await screen.findByRole('status');
    expect(statusMsg).toHaveTextContent(/valid for 30 minutes/i);

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();
  });

  it('renders Set New Password when ?token= is present, handles expired/used token recovery action, and resets password on valid submission', async () => {
    const push = jest.fn();
    const replace = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push, replace });
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams('token=test-reset-token'));

    const fetchMock = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Reset link has expired. Please request a new password reset link.' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          message: 'Admin password has been reset. You can now sign in with your new password.',
        }),
      } as unknown as Response);
    globalWithFetch.fetch = fetchMock;

    const { container } = render(<LoginPage />);

    expect(screen.getByRole('heading', { name: /set new password/i })).toBeInTheDocument();

    const axeResults = await axe(container);
    expect(axeResults).toHaveNoViolations();

    fireEvent.change(screen.getByLabelText(/^New Password$/i), {
      target: { value: 'brand-new-secret-88' },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm New Password$/i), {
      target: { value: 'brand-new-secret-88' },
    });
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));

    // First response simulates expired token
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
    expect(screen.getByRole('button', { name: /request a new reset link/i })).toBeInTheDocument();

    // Retry succeeds and transitions back to sign-in with confirmation banner
    fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
    expect(await screen.findByRole('heading', { name: /admin login/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Admin password has been reset/i);
    expect(replace).toHaveBeenCalledWith('/admin/login');
  });
});
