import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddRegistryItemPage from './page';
import { useRouter } from 'next/navigation';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

describe('AddRegistryItemPage', () => {
  let mockPush: jest.Mock;

  beforeEach(() => {
    mockPush = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    window.alert = jest.fn();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the add item form if admin', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: true }) });
    render(<AddRegistryItemPage />);
    await screen.findByRole('heading', { name: /add new registry item/i });
    expect(screen.getByLabelText(/item name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
  });

  it('redirects if not admin', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: false }) });
    render(<AddRegistryItemPage />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/login'));
  });

  it('shows alert if price or quantity is invalid', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: true }) });
    render(<AddRegistryItemPage />);
    await screen.findByRole('heading', { name: /add new registry item/i });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: 'xyz' } });
    fireEvent.submit(screen.getByTestId('form'));
    expect(window.alert).toHaveBeenCalledWith('Price and Quantity must be valid numbers.');
  });

  it('submits the form and redirects on success', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '1' }) });

    render(<AddRegistryItemPage />);
    await screen.findByRole('heading', { name: /add new registry item/i });
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Test Item' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '2' } });
    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Item added successfully!'));
    expect(mockPush).toHaveBeenCalledWith('/registry');
  });

  it('shows alert if API returns error on submit', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: true }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'API error' }) });
    render(<AddRegistryItemPage />);
    await screen.findByRole('heading', { name: /add new registry item/i });
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Test Item' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '2' } });
    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to add item:')));
  });

  it('handles group gift checkbox', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: true }) });
    render(<AddRegistryItemPage />);
    await screen.findByRole('heading', { name: /add new registry item/i });
    const checkbox = screen.getByLabelText(/allow group gifting/i);
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
