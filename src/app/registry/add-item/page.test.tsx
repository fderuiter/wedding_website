import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddRegistryItemPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() })
}));

describe('AddRegistryItemPage', () => {
  beforeEach(() => {
    Storage.prototype.getItem = jest.fn((key) => (key === 'isAdminLoggedIn' ? 'true' : null));
  });

  it('renders the add item form if admin', () => {
    render(<AddRegistryItemPage />);
    expect(screen.getByRole('heading', { name: /add new registry item/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/item name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
  });

  it('redirects if not admin', () => {
    Storage.prototype.getItem = jest.fn(() => 'false');
    const push = jest.fn();
    jest.spyOn(require('next/navigation'), 'useRouter').mockReturnValue({ push });
    render(<AddRegistryItemPage />);
    expect(screen.getByText(/loading or redirecting/i)).toBeInTheDocument();
  });

  it('shows alert if price or quantity is invalid', () => {
    window.alert = jest.fn();
    render(<AddRegistryItemPage />);
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: 'xyz' } });
    fireEvent.submit(screen.getByTestId('form'));
    expect(window.alert).toHaveBeenCalledWith('Price and Quantity must be valid numbers.');
  });

  it('submits the form and redirects on success', async () => {
    window.alert = jest.fn();
    const push = jest.fn();
    jest.spyOn(require('next/navigation'), 'useRouter').mockReturnValue({ push });
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ id: '1' }) })) as jest.Mock;
    render(<AddRegistryItemPage />);
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Test Item' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '2' } });
    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Item added successfully!'));
    expect(push).toHaveBeenCalledWith('/registry');
  });

  it('shows alert if API returns error on submit', async () => {
    window.alert = jest.fn();
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({ error: 'API error' }) })) as jest.Mock;
    render(<AddRegistryItemPage />);
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Test Item' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '2' } });
    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to add item:')));
  });

  it('handles group gift checkbox', () => {
    render(<AddRegistryItemPage />);
    const checkbox = screen.getByLabelText(/allow group gifting/i);
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
