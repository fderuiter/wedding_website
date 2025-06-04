import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

const push = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push })
}));

describe('Admin Login Page', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('renders the login form', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: /admin login/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  it('shows error if password is incorrect', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Invalid password.' }) });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));
    expect(await screen.findByText(/invalid password\./i)).toBeInTheDocument();
  });

  it('redirects on correct password', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'testpass' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/dashboard'));
  });
});
