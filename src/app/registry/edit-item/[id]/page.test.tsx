import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EditRegistryItemPage from './page';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useParams: () => ({ id: '1' })
}));

describe('EditRegistryItemPage', () => {
  beforeEach(() => {
    Storage.prototype.getItem = jest.fn((key) => (key === 'isAdminLoggedIn' ? 'true' : null));
    global.fetch = jest.fn((url, options) => {
      if (url === '/api/registry/items/1') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ id: '1', name: 'Gift', price: 10, quantity: 1 }) });
      }
      if (url === '/api/registry/items/1' && options?.method === 'PUT') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }) });
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state', () => {
    Storage.prototype.getItem = jest.fn(() => 'true');
    (global.fetch as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
    render(<EditRegistryItemPage />);
    expect(screen.getByText(/loading item data/i)).toBeInTheDocument();
  });

  it('redirects if not admin', () => {
    Storage.prototype.getItem = jest.fn(() => 'false');
    render(<EditRegistryItemPage />);
    expect(screen.getByText(/redirecting to login/i)).toBeInTheDocument();
  });

  it('shows error if item fetch fails', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Not found' }) }));
    render(<EditRegistryItemPage />);
    expect(await screen.findByText(/error/i)).toBeInTheDocument();
  });

  it('renders the edit form and submits', async () => {
    window.alert = jest.fn();
    const push = jest.fn();
    jest.spyOn(require('next/navigation'), 'useRouter').mockReturnValue({ push });
    render(<EditRegistryItemPage />);
    expect(await screen.findByLabelText(/item name/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Updated Gift' } });
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: '2' } });
    fireEvent.submit(screen.getByTestId('form'));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Item updated successfully!'));
    expect(push).toHaveBeenCalledWith('/registry');
  });

  it('shows error if price or quantity is invalid', async () => {
    Storage.prototype.getItem = jest.fn(() => 'true');
    render(<EditRegistryItemPage />);
    // Wait for form to render
    expect(await screen.findByLabelText(/item name/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText(/quantity/i), { target: { value: 'xyz' } });
    fireEvent.submit(screen.getByTestId('form'));
    expect(await screen.findByText(/price and quantity must be valid numbers/i)).toBeInTheDocument();
  });

  it('handles group gift checkbox', async () => {
    render(<EditRegistryItemPage />);
    expect(await screen.findByLabelText(/item name/i)).toBeInTheDocument();
    const checkbox = screen.getByLabelText(/allow group gifting/i);
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });
});
