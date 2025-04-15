import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import LoginPage from './page';

// Mock next/navigation useRouter
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() })
}));

describe('Admin Login Page', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV, NEXT_PUBLIC_ADMIN_PASSWORD: 'testpass' };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('renders the login form', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: /admin login/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  it('shows error if password is incorrect', () => {
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));
    expect(screen.getByText(/incorrect password/i)).toBeInTheDocument();
  });

  it('redirects on correct password', () => {
    const push = jest.fn();
    jest.spyOn(require('next/navigation'), 'useRouter').mockReturnValue({ push });
    // Set up the environment variable before rendering
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD = 'testpass';
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'testpass' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));
    // Simulate localStorage for isAdminLoggedIn
    expect(localStorage.getItem('isAdminLoggedIn')).toBe('true');
    // Simulate navigation
    expect(push).toHaveBeenCalledWith('/registry/add-item');
  });

  it('shows warning if env variable is missing', () => {
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD = '';
    render(<LoginPage />);
    expect(screen.getByText(/admin password environment variable/i)).toBeInTheDocument();
  });
});
