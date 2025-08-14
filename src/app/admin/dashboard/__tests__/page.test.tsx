import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminDashboardPage from '../page';
import type { RegistryItem } from '@/types/registry';
import { checkAdminClient as mockCheckAdminClient } from '@/utils/adminAuth.client';

// Mock next/navigation's useRouter
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
}));

// Mock admin check
jest.mock('@/utils/adminAuth.client');
(mockCheckAdminClient as jest.Mock).mockResolvedValue(true);

// Sample registry item for fetch mock
const mockItem: RegistryItem = {
  id: '1',
  name: 'Sample Item',
  description: 'desc',
  category: 'Home',
  price: 100,
  image: '/img.jpg',
  vendorUrl: null,
  quantity: 1,
  isGroupGift: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
};

// Mock fetch
const mockFetch = jest.fn();

beforeEach(() => {
  (global.fetch as unknown) = mockFetch as unknown as typeof fetch;
  (window.fetch as unknown) = mockFetch as unknown as typeof fetch;
  (mockCheckAdminClient as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe('AdminDashboardPage', () => {
  it('shows admin controls for logged-in admin and hides them for non-admins', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [mockItem],
    });

    const { unmount } = render(<AdminDashboardPage />);

    expect(await screen.findByRole('button', { name: 'Add New Item' })).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: 'Edit' })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('button', { name: 'Delete' })).length).toBeGreaterThan(0);

    unmount();

    mockCheckAdminClient.mockResolvedValueOnce(false);
    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/admin/login');
    });

    expect(screen.queryByRole('button', { name: 'Add New Item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('renders loading state while fetching items', async () => {
    let resolveFetch: (value: unknown) => void;
    mockFetch.mockImplementation(() =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    render(<AdminDashboardPage />);
    expect(screen.getByText('Loading items...')).toBeInTheDocument();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());

    await act(async () => {
      resolveFetch({
        ok: true,
        json: async () => [mockItem],
      });
    });

    expect((await screen.findAllByText('Sample Item')).length).toBeGreaterThan(0);
  });

  it('shows error when item fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    render(<AdminDashboardPage />);

    expect(await screen.findByText('Error: Failed to fetch items')).toBeInTheDocument();
  });

  it('deletes item successfully', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items') {
        return Promise.resolve({ ok: true, json: async () => [mockItem] });
      }
      if (url === `/api/registry/items/${mockItem.id}` && options?.method === 'DELETE') {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();

    render(<AdminDashboardPage />);

    expect((await screen.findAllByText('Sample Item')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);

    await waitFor(() => {
      expect(screen.queryByText('Sample Item')).not.toBeInTheDocument();
    });

    expect(window.alert).toHaveBeenCalledWith('Item deleted successfully.');

    window.confirm = originalConfirm;
    window.alert = originalAlert;
  });

  it('shows alert and keeps item when delete fails', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items') {
        return Promise.resolve({ ok: true, json: async () => [mockItem] });
      }
      if (url === `/api/registry/items/${mockItem.id}` && options?.method === 'DELETE') {
        return Promise.resolve({ ok: false });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    window.confirm = jest.fn().mockReturnValue(true);
    window.alert = jest.fn();

    render(<AdminDashboardPage />);

    expect((await screen.findAllByText('Sample Item')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Failed to delete item');
    });

    expect(screen.getAllByText('Sample Item').length).toBeGreaterThan(0);

    window.confirm = originalConfirm;
    window.alert = originalAlert;
  });
});

