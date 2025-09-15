import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import AdminDashboardPage from '../page';
import { checkAdminClient } from '@/utils/adminAuth.client';
import { API_ROUTES } from '@/lib/apiRoutes';

// Mock next/navigation
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
}));

// Mock admin check utility
jest.mock('@/utils/adminAuth.client');
const mockCheckAdminClient = checkAdminClient as jest.Mock;

// Mock react-hot-toast
jest.mock('react-hot-toast');
const mockToast = toast as jest.Mock;
const mockToastPromise = toast.promise as jest.Mock;
const mockToastDismiss = jest.fn();
// @ts-expect-error - We are intentionally adding a property to the mock for testing
(toast as { dismiss: jest.Mock }).dismiss = mockToastDismiss;


// Mock fetch
global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false, // Prevent retries in tests
    },
  },
});

const renderWithClient = (client: QueryClient, ui: React.ReactElement) => {
  return render(
    <QueryClientProvider client={client}>
      {ui}
    </QueryClientProvider>
  );
};

const mockItems = [
  { id: '1', name: 'Sample Item 1', price: 100, purchased: false, contributors: [] },
  { id: '2', name: 'Sample Item 2', price: 200, purchased: true, contributors: [] },
];

describe('AdminDashboardPage', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    mockCheckAdminClient.mockResolvedValue(true);
    mockFetch.mockClear();
    mockReplace.mockClear();
    mockPush.mockClear();
    (mockToast as jest.Mock).mockClear();
    (mockToastPromise as jest.Mock).mockClear();
    mockToastDismiss.mockClear();
  });

  it('redirects to login if not admin', async () => {
    mockCheckAdminClient.mockResolvedValue(false);
    renderWithClient(queryClient, <AdminDashboardPage />);
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/admin/login');
    });
  });

  it('renders loading state initially', () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves
    renderWithClient(queryClient, <AdminDashboardPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders items successfully on fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockItems,
    });
    renderWithClient(queryClient, <AdminDashboardPage />);
    expect((await screen.findAllByText('Sample Item 1')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Sample Item 2')).length).toBeGreaterThan(0);
  });

  it('renders error state on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network Error'));
    renderWithClient(queryClient, <AdminDashboardPage />);
    expect(await screen.findByText('Error: Network Error')).toBeInTheDocument();
  });

  it('calls delete mutation and shows toast on delete button click', async () => {
    // Initial fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockItems,
    });
    renderWithClient(queryClient, <AdminDashboardPage />);

    // Wait for items to render
    const deleteButtons = await screen.findAllByRole('button', { name: 'Delete' });
    expect(deleteButtons[0]).toBeInTheDocument();

    // Mock the toast confirmation
    (toast as jest.Mock).mockImplementation((callback) => {
      const t = { id: '1' };
      // Simulate user clicking "Delete" in the toast
      const span = callback(t);
      const deleteButtonInToast = span.props.children[1].props.children[0];
      deleteButtonInToast.props.onClick();
      return t.id;
    });

    // Mock the successful DELETE fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ message: 'Item deleted successfully' }),
    });

    // Click the delete button on the page
    fireEvent.click(deleteButtons[0]);

    // Check that toast was called to ask for confirmation
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalled();
    });

    // Check that the mutation was called
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(API_ROUTES.getRegistryItem(mockItems[0].id), { method: 'DELETE' });
    });
  });
});
