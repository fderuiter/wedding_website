import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditRegistryItemPage from './page';
import { useRouter, useParams } from 'next/navigation';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useParams: jest.fn(),
}));

describe('EditRegistryItemPage', () => {
  let mockPush: jest.Mock;
  let mockParams: { id: string };

  beforeEach(() => {
    mockPush = jest.fn();
    mockParams = { id: '1' };
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useParams as jest.Mock).mockReturnValue(mockParams);
    window.alert = jest.fn();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state initially', () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: true }) });
    (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
    render(<EditRegistryItemPage />);
    expect(screen.getByText(/loading item data/i)).toBeInTheDocument();
  });

  it('redirects if not admin', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: false }) });
    render(<EditRegistryItemPage />);
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/login'));
  });

  it('shows error if item fetch fails', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: true }) })
      .mockResolvedValueOnce({ ok: false, statusText: 'Not Found', json: async () => ({}) });
    render(<EditRegistryItemPage />);
    expect(await screen.findByText(/failed to fetch item/i)).toBeInTheDocument();
  });

  it('renders the edit form with fetched data and submits', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '1', name: 'Gift', price: 10, quantity: 1, description: '', image: '', vendorUrl: '', category: '' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    render(<EditRegistryItemPage />);
    expect(await screen.findByDisplayValue('Gift')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Updated Gift' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '2' } });
    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Item updated successfully!'));
    expect(mockPush).toHaveBeenCalledWith('/registry');
  });

  it('shows validation error if price or quantity is invalid', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ isAdmin: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: '1', name: 'Gift', price: 10, quantity: 1, description: '', image: '', vendorUrl: '', category: '' }) });
    render(<EditRegistryItemPage />);
    expect(await screen.findByLabelText(/item name/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: 'xyz' } });
    fireEvent.submit(screen.getByTestId('form'));
    expect(await screen.findByText(/price and quantity must be valid numbers/i)).toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
