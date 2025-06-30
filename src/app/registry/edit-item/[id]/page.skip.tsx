import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditRegistryItemPage from './page';
import { useRouter, useParams } from 'next/navigation'; // Import directly

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
  useParams: jest.fn(), // Keep the mock for useParams
}));

describe('EditRegistryItemPage', () => {
  let mockPush: jest.Mock;
  let mockParams: { id: string };

  beforeEach(() => {
    mockPush = jest.fn();
    mockParams = { id: '1' };
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useParams as jest.Mock).mockReturnValue(mockParams); // Use the imported useParams

    Storage.prototype.getItem = jest.fn((key) => (key === 'isAdminLoggedIn' ? 'true' : null));
    window.alert = jest.fn(); // Mock alert

    global.fetch = jest.fn((url, options) => {
      if (url === `/api/registry/items/${mockParams.id}` && options?.method !== 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: '1', name: 'Gift', price: 10, quantity: 1, description: '', image: '', vendorUrl: '', category: '' }) });
      }
      if (url === `/api/registry/items/${mockParams.id}` && options?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }) });
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state initially', () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(() => {})); // Simulate pending fetch
    render(<EditRegistryItemPage />);
    expect(screen.getByText(/loading item data/i)).toBeInTheDocument();
  });

  it('redirects if not admin', () => {
    Storage.prototype.getItem = jest.fn(() => 'false');
    render(<EditRegistryItemPage />);
    // Check for redirection logic (may involve checking mockPush or loading state)
    expect(screen.getByText(/redirecting to login/i)).toBeInTheDocument();
    // await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/admin/login'));
  });

  it('shows error if item fetch fails', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce((url) => {
       if (url === `/api/registry/items/${mockParams.id}`) {
         return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }) });
       }
       return Promise.resolve({ ok: false, status: 500 }); // Default fail
    });
    render(<EditRegistryItemPage />);
    expect(await screen.findByText(/error fetching item/i)).toBeInTheDocument();
  });

  it('renders the edit form with fetched data and submits', async () => {
    render(<EditRegistryItemPage />);

    // Wait for form to load with data
    expect(await screen.findByDisplayValue('Gift')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
    expect(screen.getByDisplayValue('1')).toBeInTheDocument();

    // Change values
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Updated Gift' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '2' } });

    // Submit
    fireEvent.submit(screen.getByTestId('form'));

    // Check results
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Item updated successfully!'));
    expect(mockPush).toHaveBeenCalledWith('/registry');
    expect(global.fetch).toHaveBeenCalledWith(
      `/api/registry/items/${mockParams.id}`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(expect.objectContaining({ name: 'Updated Gift', price: 20, quantity: 2 })),
      })
    );
  });

  it('shows validation error if price or quantity is invalid', async () => {
    render(<EditRegistryItemPage />);
    expect(await screen.findByLabelText(/item name/i)).toBeInTheDocument(); // Wait for form

    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: 'xyz' } });
    fireEvent.submit(screen.getByTestId('form'));

    // Check for validation message within the form component
    expect(await screen.findByText(/price and quantity must be valid numbers/i)).toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled(); // Alert should not be called
    expect(mockPush).not.toHaveBeenCalled(); // Should not redirect
  });
});
