import React from 'react';
import { render as tlRender, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { ToastProvider, useToast } from '@/components/ui/ToastProvider';
import AdminDashboardPage from '../page';
import type { RegistryItem } from '@/types/registry';
import { checkAdminClient as mockCheckAdminClient } from '@/core/auth/auth.client';

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
jest.mock('@/core/auth/auth.client');
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
  const renderWithProviders = (ui: React.ReactElement) => {
    return tlRender(
      <ToastProvider>
        <TestWrapper>{ui}</TestWrapper>
      </ToastProvider>
    );
  };

  const TestWrapper = ({ children }: { children: React.ReactNode }) => {
    const { addToast } = useToast();
    const queryClient = React.useMemo(() => new QueryClient({
      defaultOptions: { queries: { retry: false } },
      mutationCache: new MutationCache({
        onSuccess: (_data, _variables, _context, mutation) => {
          if (mutation.meta?.successMessage) addToast(mutation.meta.successMessage as string, 'success');
        },
        onError: () => {
          addToast('Failed to delete item', 'error');
        }
      })
    }), [addToast]);

    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };

  it('shows admin controls', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [mockItem],
    });

    const { unmount } = renderWithProviders(<AdminDashboardPage />);

    expect(await screen.findByRole('button', { name: 'Add New Item' })).toBeInTheDocument();
    expect((await screen.findAllByRole('button', { name: 'Edit registry item: Sample Item' })).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('button', { name: 'Delete registry item: Sample Item' })).length).toBeGreaterThan(0);

    unmount();
  });

  it('renders loading state while fetching items', async () => {
    let resolveFetch: (value: unknown) => void;
    mockFetch.mockImplementation(() =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    renderWithProviders(<AdminDashboardPage />);
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

    renderWithProviders(<AdminDashboardPage />);

    expect(await screen.findByText(/Error: API Error/i)).toBeInTheDocument();
  });

  it('deletes item successfully', async () => {
    let items = [mockItem];
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items') {
        return Promise.resolve({ ok: true, json: async () => items });
      }
      if (url === `/api/registry/items/${mockItem.id}` && options?.method === 'DELETE') {
        items = [];
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminDashboardPage />);

    expect((await screen.findAllByText('Sample Item')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete registry item: Sample Item' })[0]);
    
    // Click custom confirm dialog button
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.queryAllByText('Sample Item').length).toBe(0);
    });

    expect(await screen.findByText('Deleted registry item successfully.')).toBeInTheDocument();
  });

  it('shows error and keeps item when delete fails', async () => {
    mockFetch.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/registry/items') {
        return Promise.resolve({ ok: true, json: async () => [mockItem] });
      }
      if (url === `/api/registry/items/${mockItem.id}` && options?.method === 'DELETE') {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Delete failed' }) });
      }
      return Promise.reject(new Error(`Unhandled request: ${url}`));
    });

    renderWithProviders(<AdminDashboardPage />);

    expect((await screen.findAllByText('Sample Item')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete registry item: Sample Item' })[0]);

    // Click custom confirm dialog button
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to delete item')).toBeInTheDocument();
    });

    expect(screen.getAllByText('Sample Item').length).toBeGreaterThan(0);
  });
});
