import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEntityOrchestration } from '../useEntityOrchestration';
import { ApiClient } from '@/lib/apiClient';

interface TestItem {
  id: string;
  name: string;
  position?: number;
}

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  Wrapper.displayName = 'TestQueryClientWrapper';
  return Wrapper;
};

describe('useEntityOrchestration', () => {
  let queryClient: QueryClient;
  let mockApiClient: jest.Mocked<ApiClient>;

  const queryKey = ['test-entities'];
  const endpoint = '/api/test-entities';
  const entityName = 'Test Entity';

  const initialItems: TestItem[] = [
    { id: '1', name: 'Item One', position: 1 },
    { id: '2', name: 'Item Two', position: 2 },
    { id: '3', name: 'Item Three', position: 3 },
    { id: '4', name: 'Item Four', position: 4 },
  ];

  beforeEach(() => {
    queryClient = createTestQueryClient();
    mockApiClient = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ApiClient>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('fetches entities successfully', async () => {
    mockApiClient.get.mockResolvedValue(initialItems);

    const { result } = renderHook(
      () =>
        useEntityOrchestration<TestItem>({
          queryKey,
          endpoint,
          entityName,
          apiClient: mockApiClient,
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(initialItems);
    expect(mockApiClient.get).toHaveBeenCalledWith(endpoint);
  });

  describe('optimistic reordering', () => {
    beforeEach(() => {
      queryClient.setQueryData<TestItem[]>(queryKey, initialItems);
    });

    it('optimistically reorders cached entities according to orderedIds', async () => {
      mockApiClient.put.mockResolvedValue({ success: true });

      const { result } = renderHook(
        () =>
          useEntityOrchestration<TestItem>({
            queryKey,
            endpoint,
            entityName,
            apiClient: mockApiClient,
          }),
        { wrapper: createWrapper(queryClient) }
      );

      const orderedIds = ['3', '1', '4', '2'];

      await act(async () => {
        await result.current.reorder(orderedIds);
      });

      const cachedData = queryClient.getQueryData<TestItem[]>(queryKey);
      expect(cachedData).toEqual([
        { id: '3', name: 'Item Three', position: 3 },
        { id: '1', name: 'Item One', position: 1 },
        { id: '4', name: 'Item Four', position: 4 },
        { id: '2', name: 'Item Two', position: 2 },
      ]);

      expect(mockApiClient.put).toHaveBeenCalledWith(endpoint, {
        action: 'reorder',
        orderedIds,
      });
    });

    it('preserves unlisted entities by appending them to the end', async () => {
      mockApiClient.put.mockResolvedValue({ success: true });

      const { result } = renderHook(
        () =>
          useEntityOrchestration<TestItem>({
            queryKey,
            endpoint,
            entityName,
            apiClient: mockApiClient,
          }),
        { wrapper: createWrapper(queryClient) }
      );

      const orderedIds = ['3', '1'];

      await act(async () => {
        await result.current.reorder(orderedIds);
      });

      const cachedData = queryClient.getQueryData<TestItem[]>(queryKey);
      expect(cachedData).toEqual([
        { id: '3', name: 'Item Three', position: 3 },
        { id: '1', name: 'Item One', position: 1 },
        { id: '2', name: 'Item Two', position: 2 },
        { id: '4', name: 'Item Four', position: 4 },
      ]);
    });

    it('handles IDs in orderedIds that do not exist in previousData safely', async () => {
      mockApiClient.put.mockResolvedValue({ success: true });

      const { result } = renderHook(
        () =>
          useEntityOrchestration<TestItem>({
            queryKey,
            endpoint,
            entityName,
            apiClient: mockApiClient,
          }),
        { wrapper: createWrapper(queryClient) }
      );

      const orderedIds = ['non-existent-id', '2', '1'];

      await act(async () => {
        await result.current.reorder(orderedIds);
      });

      const cachedData = queryClient.getQueryData<TestItem[]>(queryKey);
      expect(cachedData).toEqual([
        { id: '2', name: 'Item Two', position: 2 },
        { id: '1', name: 'Item One', position: 1 },
        { id: '3', name: 'Item Three', position: 3 },
        { id: '4', name: 'Item Four', position: 4 },
      ]);
    });

    it('rolls back to previousData when reorder API call fails', async () => {
      mockApiClient.put.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(
        () =>
          useEntityOrchestration<TestItem>({
            queryKey,
            endpoint,
            entityName,
            apiClient: mockApiClient,
          }),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        try {
          await result.current.reorder(['4', '3', '2', '1']);
        } catch {
          // Ignore expected rejection
        }
      });

      const cachedData = queryClient.getQueryData<TestItem[]>(queryKey);
      expect(cachedData).toEqual(initialItems);
    });
  });

  describe('CRUD operations', () => {
    beforeEach(() => {
      queryClient.setQueryData<TestItem[]>(queryKey, initialItems);
    });

    it('optimistically creates an item and updates on success', async () => {
      const newItemPayload = { name: 'Item Five' };
      const createdItem: TestItem = { id: '5', name: 'Item Five', position: 5 };
      mockApiClient.post.mockResolvedValue(createdItem);

      const { result } = renderHook(
        () =>
          useEntityOrchestration<TestItem>({
            queryKey,
            endpoint,
            entityName,
            apiClient: mockApiClient,
          }),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.create(newItemPayload);
      });

      const cachedData = queryClient.getQueryData<TestItem[]>(queryKey);
      expect(cachedData).toContainEqual(createdItem);
      expect(mockApiClient.post).toHaveBeenCalledWith(endpoint, newItemPayload);
    });

    it('optimistically updates an item', async () => {
      const updatedItem: TestItem = { id: '2', name: 'Updated Item Two', position: 2 };
      mockApiClient.put.mockResolvedValue(updatedItem);

      const { result } = renderHook(
        () =>
          useEntityOrchestration<TestItem>({
            queryKey,
            endpoint,
            entityName,
            apiClient: mockApiClient,
          }),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.update('2', { name: 'Updated Item Two' });
      });

      const cachedData = queryClient.getQueryData<TestItem[]>(queryKey);
      expect(cachedData?.find((item) => item.id === '2')).toEqual(updatedItem);
      expect(mockApiClient.put).toHaveBeenCalledWith(`${endpoint}/2`, { name: 'Updated Item Two' });
    });

    it('optimistically removes an item', async () => {
      mockApiClient.delete.mockResolvedValue({ success: true });

      const { result } = renderHook(
        () =>
          useEntityOrchestration<TestItem>({
            queryKey,
            endpoint,
            entityName,
            apiClient: mockApiClient,
          }),
        { wrapper: createWrapper(queryClient) }
      );

      await act(async () => {
        await result.current.remove('2');
      });

      const cachedData = queryClient.getQueryData<TestItem[]>(queryKey);
      expect(cachedData?.find((item) => item.id === '2')).toBeUndefined();
      expect(cachedData?.length).toBe(3);
      expect(mockApiClient.delete).toHaveBeenCalledWith(`${endpoint}/2`);
    });
  });
});
