import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ApiClient } from '@/lib/apiClient';
import { useEntityOrchestration } from '../useEntityOrchestration';

interface BatchTestItem {
  id: string;
  name: string;
  status: string;
}

describe('useEntityOrchestration batch operations', () => {
  let queryClient: QueryClient;
  const mockApiClient = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<ApiClient>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: Infinity },
        mutations: { retry: false },
      },
    });
    jest.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('fetches entity data and executes removeBatch and updateBatch with optimistic updates', async () => {
    const initialData: BatchTestItem[] = [
      { id: '1', name: 'Item 1', status: 'active' },
      { id: '2', name: 'Item 2', status: 'active' },
      { id: '3', name: 'Item 3', status: 'active' },
    ];
    let items = [...initialData];
    mockApiClient.get.mockImplementation(async () => items);
    mockApiClient.post.mockImplementation(
      async (url: string, payload?: { ids?: string[] } & Partial<BatchTestItem>) => {
        if (url.endsWith('/batch') && payload?.ids) {
          const idSet = new Set(payload.ids);
          const { ids: _ids, ...updates } = payload;
          items = items.map((i) => (idSet.has(i.id) ? { ...i, ...updates } : i));
          return { success: true, count: payload.ids.length, updatedCount: payload.ids.length };
        }
        return { success: true };
      }
    );
    mockApiClient.delete.mockImplementation(
      async (url: string, data?: { ids?: string[] }) => {
        if (url.endsWith('/batch') && data?.ids) {
          const idSet = new Set(data.ids);
          items = items.filter((i) => !idSet.has(i.id));
          return { success: true };
        }
        const id = url.split('/').pop();
        items = items.filter((i) => i.id !== id);
        return { success: true };
      }
    );
    mockApiClient.put.mockImplementation(
      async (url: string, payload?: Partial<BatchTestItem>) => {
        const id = url.split('/').pop();
        items = items.map((i) => (i.id === id ? { ...i, ...payload } : i));
        return { success: true };
      }
    );

    const { result } = renderHook(
      () =>
        useEntityOrchestration<BatchTestItem>({
          queryKey: ['test-entity'],
          endpoint: '/api/test',
          entityName: 'test item',
          apiClient: mockApiClient,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toEqual(initialData));

    // Test updateBatch
    await act(async () => {
      await result.current.updateBatch(['1', '2'], { status: 'inactive' });
    });

    expect(mockApiClient.post).toHaveBeenCalledTimes(1);
    expect(mockApiClient.post).toHaveBeenCalledWith('/api/test/batch', { ids: ['1', '2'], status: 'inactive' });

    await waitFor(() => {
      expect(result.current.data).toEqual([
        { id: '1', name: 'Item 1', status: 'inactive' },
        { id: '2', name: 'Item 2', status: 'inactive' },
        { id: '3', name: 'Item 3', status: 'active' },
      ]);
    });

    // Test removeBatch
    await act(async () => {
      await result.current.removeBatch(['1', '3']);
    });

    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/test/batch', { ids: ['1', '3'] });

    await waitFor(() => {
      expect(result.current.data).toEqual([
        { id: '2', name: 'Item 2', status: 'inactive' },
      ]);
    });
  });

  it('rolls back optimistic updates when updateBatch fails', async () => {
    const initialData: BatchTestItem[] = [
      { id: '1', name: 'Item 1', status: 'active' },
      { id: '2', name: 'Item 2', status: 'active' },
    ];
    mockApiClient.get.mockImplementation(async () => [...initialData]);
    mockApiClient.post.mockRejectedValue(new Error('Batch update failed'));

    const { result } = renderHook(
      () =>
        useEntityOrchestration<BatchTestItem>({
          queryKey: ['test-entity-error'],
          endpoint: '/api/test',
          entityName: 'test item',
          apiClient: mockApiClient,
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.data).toEqual(initialData));

    await act(async () => {
      try {
        await result.current.updateBatch(['1', '2'], { status: 'inactive' });
      } catch {
        // expected error
      }
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(initialData);
    });
  });
});
