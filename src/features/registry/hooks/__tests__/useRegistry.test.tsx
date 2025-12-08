import fetchMock from 'jest-fetch-mock';
fetchMock.enableMocks();

import { renderHook, act, waitFor } from '@testing-library/react';
import { useRegistry } from '../useRegistry';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { RegistryItem } from '../../types';
import { checkAdminClient } from '@/utils/adminAuth.client';

// Mock next/navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock admin check
jest.mock('@/utils/adminAuth.client');
const mockedCheckAdminClient = checkAdminClient as jest.Mock;


// Mock window.confirm and window.alert
global.confirm = jest.fn(() => true);
global.alert = jest.fn();

const createTestQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const wrapper = (client: QueryClient) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={client}>
            {children}
        </QueryClientProvider>
    );
    Wrapper.displayName = 'QueryClientWrapper';
    return Wrapper;
};

const mockItems: RegistryItem[] = [
    { id: '1', name: 'Item 1', category: 'Category A', price: 100, purchased: false, isGroupGift: false, amountContributed: 0, contributors: [], imageUrl: '', description: '' },
    { id: '2', name: 'Item 2', category: 'Category B', price: 200, purchased: true, isGroupGift: false, amountContributed: 0, contributors: [], purchaserName: 'John Doe', imageUrl: '', description: '' },
    { id: '3', name: 'Item 3', category: 'Category A', price: 300, purchased: false, isGroupGift: true, amountContributed: 150, contributors: [], imageUrl: '', description: '' },
];

describe('useRegistry', () => {
    let queryClient: QueryClient;

  beforeEach(() => {
    fetchMock.resetMocks();
    mockedCheckAdminClient.mockResolvedValue(false);
    queryClient = createTestQueryClient();
  });

  it('should fetch registry items and return initial state', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.items).toEqual(mockItems);
    expect(result.current.isAdmin).toBe(false);
  });

  it('should handle card click and open modal', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const item = result.current.items[0];

    act(() => {
      result.current.handleCardClick(item);
    });

    expect(result.current.selectedItem).toEqual(item);
    expect(result.current.isModalOpen).toBe(true);
  });

  it('should not open modal for purchased item', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const item = result.current.items[1];

    act(() => {
      result.current.handleCardClick(item);
    });

    expect(result.current.selectedItem).toBeNull();
    expect(result.current.isModalOpen).toBe(false);
  });

  it('should handle modal close', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
        result.current.handleCardClick(result.current.items[0]);
    });

    expect(result.current.isModalOpen).toBe(true);

    act(() => {
        result.current.handleCloseModal();
    });

    expect(result.current.isModalOpen).toBe(false);
    expect(result.current.selectedItem).toBeNull();
  });

  it('should handle edit', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
        result.current.handleEdit('1');
    });

    expect(mockPush).toHaveBeenCalledWith('/registry/edit-item/1');
  });

  it('should handle delete', async () => {
    // We need to return valid items for the initial query, then handle the delete
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    fetchMock.mockResponseOnce(JSON.stringify({}));

    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });

    // Wait for initial load
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
        result.current.handleDelete('1');
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/registry/items/1', { method: 'DELETE' });
    });
  });

  it('should handle contribution', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({}));
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });

    await act(async () => {
        await result.current.handleContribute('1', 'Jane Doe', 50);
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: '1', purchaserName: 'Jane Doe', amount: 50 }),
    });
  });

  it('should filter items by category', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
        result.current.setCategoryFilter(['Category B']);
    });

    expect(result.current.filteredItems.length).toBe(1);
    expect(result.current.filteredItems[0].id).toBe('2');
  });

  it('should filter by price range', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
        result.current.setPriceRange([150, 250]);
    });

    expect(result.current.filteredItems.length).toBe(1);
    expect(result.current.filteredItems[0].id).toBe('2');
  });

  it('should filter by group gifts only', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
        result.current.setShowGroupGiftsOnly(true);
    });

    expect(result.current.filteredItems.length).toBe(1);
    expect(result.current.filteredItems[0].id).toBe('3');
  });

  it('should filter by available only', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(mockItems));
    const { result } = renderHook(() => useRegistry(), { wrapper: wrapper(queryClient) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
        result.current.setShowAvailableOnly(true);
    });

    expect(result.current.filteredItems.length).toBe(2);
    expect(result.current.filteredItems.map(i => i.id)).toEqual(['1', '3']);
  });
});
