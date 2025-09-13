import { renderHook, waitFor, act } from '@testing-library/react';
import { useRegistry } from '../useRegistry';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegistryItem } from '../../types';
import fetchMock from 'jest-fetch-mock';
import * as adminAuth from '@/utils/adminAuth.client';
import { useRouter } from 'next/navigation';

fetchMock.enableMocks();

// Mock dependencies
jest.mock('next/navigation');
jest.mock('@/utils/adminAuth.client');

const mockRouter = {
  push: jest.fn(),
};
(useRouter as jest.Mock).mockReturnValue(mockRouter);

const mockItems: RegistryItem[] = [
  { id: '1', name: 'Item 1', category: 'Kitchen', price: 100, purchased: false, isGroupGift: false, amountContributed: 0, contributors: [], description: 'A nice item', image: 'img1.jpg', quantity: 1, vendorUrl: 'vendor.com/1' },
  { id: '2', name: 'Item 2', category: 'Honeymoon', price: 200, purchased: true, isGroupGift: false, amountContributed: 200, contributors: [], description: 'A fun activity', image: 'img2.jpg', quantity: 1, vendorUrl: 'vendor.com/2' },
  { id: '3', name: 'Item 3', category: 'Kitchen', price: 300, purchased: false, isGroupGift: true, amountContributed: 150, contributors: [], description: 'An expensive item', image: 'img3.jpg', quantity: 1, vendorUrl: 'vendor.com/3' },
  { id: '4', name: 'Item 4', category: 'Electronics', price: 50, purchased: false, isGroupGift: false, amountContributed: 0, contributors: [], description: 'A gadget', image: 'img4.jpg', quantity: 1, vendorUrl: 'vendor.com/4' },
];

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

describe('useRegistry', () => {
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: React.ReactNode }) => JSX.Element;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    fetchMock.resetMocks();
    (adminAuth.checkAdminClient as jest.Mock).mockResolvedValue(false);
    mockRouter.push.mockClear();
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
  });

  // --- Data Fetching ---
  it('should fetch items and handle loading and success states', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items).toEqual(mockItems);
    expect(result.current.error).toBe(null);
  });

  it('should handle fetch error state', async () => {
    const error = new Error('Failed to fetch');
    fetchMock.mockRejectOnce(error);
    const { result } = renderHook(() => useRegistry(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toEqual(error);
    expect(result.current.items).toEqual([]);
  });

  // --- Filtering ---
  describe('filtering', () => {
    beforeEach(() => {
      fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    });

    it('should filter by category', async () => {
      const { result } = renderHook(() => useRegistry(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => result.current.setCategoryFilter(['Kitchen']));

      expect(result.current.filteredItems).toHaveLength(2);
      expect(result.current.filteredItems[0].id).toBe('1');
      expect(result.current.filteredItems[1].id).toBe('3');
    });

    it('should filter by price range', async () => {
        const { result } = renderHook(() => useRegistry(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        act(() => result.current.setPriceRange([0, 150]));

        expect(result.current.filteredItems).toHaveLength(2);
        expect(result.current.filteredItems[0].id).toBe('1');
        expect(result.current.filteredItems[1].id).toBe('4');
    });

    it('should filter by group gifts only', async () => {
        const { result } = renderHook(() => useRegistry(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        act(() => result.current.setShowGroupGiftsOnly(true));

        expect(result.current.filteredItems).toHaveLength(1);
        expect(result.current.filteredItems[0].id).toBe('3');
    });

    it('should filter by available only', async () => {
        const { result } = renderHook(() => useRegistry(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        act(() => result.current.setShowAvailableOnly(true));

        expect(result.current.filteredItems).toHaveLength(3);
        expect(result.current.filteredItems.find(i => i.id === '2')).toBeUndefined();
    });

    it('should combine multiple filters', async () => {
        const { result } = renderHook(() => useRegistry(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        act(() => {
            result.current.setCategoryFilter(['Kitchen']);
            result.current.setShowAvailableOnly(true);
            result.current.setPriceRange([0, 150]);
        });

        expect(result.current.filteredItems).toHaveLength(1);
        expect(result.current.filteredItems[0].id).toBe('1');
    });
  });

  // --- Mutations ---
  describe('mutations', () => {
    it('should handle successful contribution', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockItems));
      const { result } = renderHook(() => useRegistry(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      fetchMock.mockResponseOnce(JSON.stringify({ success: true }));

      await act(async () => {
        await result.current.handleContribute('4', 'Test User', 50);
      });

      expect(window.alert).toHaveBeenCalledWith('Thank you for your contribution!');
      const updatedItem = result.current.items.find(i => i.id === '4');
      expect(updatedItem?.purchased).toBe(true);
      expect(updatedItem?.purchaserName).toBe('Test User');
    });

    it('should handle successful group gift contribution', async () => {
        fetchMock.mockResponseOnce(JSON.stringify(mockItems));
        const { result } = renderHook(() => useRegistry(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        fetchMock.mockResponseOnce(JSON.stringify({ success: true }));

        await act(async () => {
          await result.current.handleContribute('3', 'Test User', 50);
        });

        const updatedItem = result.current.items.find(i => i.id === '3');
        expect(updatedItem?.amountContributed).toBe(200);
        expect(updatedItem?.purchased).toBe(false);
      });

    it('should handle failed contribution and rollback', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockItems));
      const { result } = renderHook(() => useRegistry(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      fetchMock.mockResponseOnce(JSON.stringify({ error: 'Contribution failed' }), { status: 500 });

      await act(async () => {
        await expect(result.current.handleContribute('4', 'Test User', 50)).rejects.toThrow();
      });

      expect(window.alert).toHaveBeenCalledWith('Error: Could not process contribution.');
      const rolledBackItem = result.current.items.find(i => i.id === '4');
      expect(rolledBackItem?.purchased).toBe(false);
    });

    it('should handle successful deletion', async () => {
      fetchMock.mockResponseOnce(JSON.stringify(mockItems));
      const { result } = renderHook(() => useRegistry(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      fetchMock.mockResponseOnce(JSON.stringify({ success: true }));

      act(() => result.current.handleDelete('1'));

      await waitFor(() => {
        expect(fetchMock.mock.calls[1][0]).toBe('/api/registry/items/1');
        expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');
        expect(window.alert).toHaveBeenCalledWith('Item deleted successfully.');
      });
    });
  });

  // --- UI Handlers ---
  describe('UI handlers', () => {
    beforeEach(() => {
      fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    });

    it('should open and close modal', async () => {
      const { result } = renderHook(() => useRegistry(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.isModalOpen).toBe(false);
      expect(result.current.selectedItem).toBeNull();

      const itemToSelect = result.current.items.find(i => i.id === '1')!;
      act(() => result.current.handleCardClick(itemToSelect));

      expect(result.current.isModalOpen).toBe(true);
      expect(result.current.selectedItem).toEqual(itemToSelect);

      act(() => result.current.handleCloseModal());

      expect(result.current.isModalOpen).toBe(false);
      expect(result.current.selectedItem).toBeNull();
    });

    it('should not open modal for purchased item', async () => {
        const { result } = renderHook(() => useRegistry(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));

        const purchasedItem = result.current.items.find(i => i.id === '2')!;
        act(() => result.current.handleCardClick(purchasedItem));

        expect(result.current.isModalOpen).toBe(false);
    });

    it('should handle edit by navigating', async () => {
      const { result } = renderHook(() => useRegistry(), { wrapper });
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      act(() => result.current.handleEdit('1'));

      expect(mockRouter.push).toHaveBeenCalledWith('/registry/edit-item/1');
    });
  });
});
