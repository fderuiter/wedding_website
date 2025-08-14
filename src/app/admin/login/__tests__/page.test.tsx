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
});

