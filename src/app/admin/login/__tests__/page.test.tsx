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

    fireEvent.change(screen.getByLabelText(/password/i), {
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

    fireEvent.change(screen.getByLabelText(/password/i), {
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

    fireEvent.change(screen.getByLabelText(/password/i), {
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

    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'secret' },
    });
    const button = screen.getByRole('button', { name: /login/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent('Logging in...');
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
});

