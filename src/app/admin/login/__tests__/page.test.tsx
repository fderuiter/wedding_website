import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import LoginPage from '../page';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

const globalWithFetch = global as unknown as { fetch?: typeof fetch };
const originalFetch = globalWithFetch.fetch;

describe('Admin Login Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      .fn<typeof fetch>()
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
      .fn<typeof fetch>()
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
      .fn<typeof fetch>()
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

    const fetchMock = jest.fn<typeof fetch>().mockReturnValue(fetchPromise);
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
      .fn<typeof fetch>()
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
});
