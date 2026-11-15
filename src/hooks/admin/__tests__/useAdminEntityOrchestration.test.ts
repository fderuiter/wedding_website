import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAdminEntityOrchestration } from '../useAdminEntityOrchestration';
import { useAdminAttractions } from '../useAdminAttractions';
import { useAdminWeddingParty } from '../useAdminWeddingParty';
import { useAdminContent } from '../useAdminContent';
import { useAdminRegistry } from '../useAdminRegistry';
import { useAdminSubEvents } from '../useAdminSubEvents';
import { useAdminInvitationCodes } from '../useAdminInvitationCodes';
import { apiClient } from '@/features/admin/apiClient';

jest.mock('@/features/admin/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

interface TestItem {
  id: string;
  name: string;
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

describe('useAdminEntityOrchestration', () => {
  let queryClient: QueryClient;
  const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

  beforeEach(() => {
    queryClient = createTestQueryClient();
    jest.clearAllMocks();
  });

  it('fetches entities successfully when options are omitted (default enabled)', async () => {
    const items: TestItem[] = [
      { id: '1', name: 'Entity One' },
      { id: '2', name: 'Entity Two' },
    ];
    mockApiClient.get.mockResolvedValueOnce(items);

    const { result } = renderHook(
      () =>
        useAdminEntityOrchestration<TestItem>({
          queryKey: ['admin-test-entities'],
          endpoint: '/api/admin/test-entities',
          entityName: 'test entity',
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(items);
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/test-entities');
  });

  it('handles res.items shape correctly', async () => {
    const items: TestItem[] = [{ id: '1', name: 'Entity One' }];
    mockApiClient.get.mockResolvedValueOnce({ items });

    const { result } = renderHook(
      () =>
        useAdminEntityOrchestration<TestItem>({
          queryKey: ['admin-test-entities'],
          endpoint: '/api/admin/test-entities',
          entityName: 'test entity',
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(items);
  });

  it('does not fetch when enabled option is false', async () => {
    const { result } = renderHook(
      () =>
        useAdminEntityOrchestration<TestItem>({
          queryKey: ['admin-test-entities'],
          endpoint: '/api/admin/test-entities',
          entityName: 'test entity',
          options: { enabled: false },
        }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(mockApiClient.get).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([]);
  });

  it('fetches when enabled option is true', async () => {
    const items: TestItem[] = [{ id: '1', name: 'Entity One' }];
    mockApiClient.get.mockResolvedValueOnce(items);

    const { result } = renderHook(
      () =>
        useAdminEntityOrchestration<TestItem>({
          queryKey: ['admin-test-entities'],
          endpoint: '/api/admin/test-entities',
          entityName: 'test entity',
          options: { enabled: true },
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.data).toEqual(items);
    expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/test-entities');
  });

  it('creates an entity successfully', async () => {
    const newItem: TestItem = { id: 'created-1', name: 'New Entity' };
    mockApiClient.get.mockResolvedValueOnce([]);
    mockApiClient.post.mockResolvedValueOnce(newItem);

    const { result } = renderHook(
      () =>
        useAdminEntityOrchestration<TestItem>({
          queryKey: ['admin-test-entities'],
          endpoint: '/api/admin/test-entities',
          entityName: 'test entity',
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.create({ name: 'New Entity' });
    });

    expect(mockApiClient.post).toHaveBeenCalledWith('/api/admin/test-entities', { name: 'New Entity' });
  });

  it('updates an entity successfully', async () => {
    const existingItems: TestItem[] = [{ id: 'item-1', name: 'Existing' }];
    const updatedItem: TestItem = { id: 'item-1', name: 'Updated' };
    mockApiClient.get.mockResolvedValueOnce(existingItems);
    mockApiClient.put.mockResolvedValueOnce(updatedItem);

    const { result } = renderHook(
      () =>
        useAdminEntityOrchestration<TestItem>({
          queryKey: ['admin-test-entities'],
          endpoint: '/api/admin/test-entities',
          entityName: 'test entity',
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.update('item-1', { name: 'Updated' });
    });

    expect(mockApiClient.put).toHaveBeenCalledWith('/api/admin/test-entities/item-1', { name: 'Updated' });
  });

  it('removes an entity successfully', async () => {
    const existingItems: TestItem[] = [{ id: 'item-1', name: 'Existing' }];
    mockApiClient.get.mockResolvedValueOnce(existingItems);
    mockApiClient.delete.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(
      () =>
        useAdminEntityOrchestration<TestItem>({
          queryKey: ['admin-test-entities'],
          endpoint: '/api/admin/test-entities',
          entityName: 'test entity',
        }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    await act(async () => {
      await result.current.remove('item-1');
    });

    expect(mockApiClient.delete).toHaveBeenCalledWith('/api/admin/test-entities/item-1');
  });

  describe('delegating admin wrapper hooks', () => {
    it('useAdminAttractions queries /api/admin/attractions', async () => {
      mockApiClient.get.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useAdminAttractions(), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/attractions');
    });

    it('useAdminWeddingParty queries /api/admin/wedding-party', async () => {
      mockApiClient.get.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useAdminWeddingParty(), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/wedding-party');
    });

    it('useAdminContent queries /api/admin/content-nodes', async () => {
      mockApiClient.get.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useAdminContent(), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/content-nodes');
    });

    it('useAdminRegistry queries /api/registry/items', async () => {
      mockApiClient.get.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useAdminRegistry(), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/registry/items');
    });

    it('useAdminSubEvents queries /api/admin/sub-events', async () => {
      mockApiClient.get.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useAdminSubEvents(), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/sub-events');
    });

    it('useAdminInvitationCodes queries /api/admin/invitation-codes', async () => {
      mockApiClient.get.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useAdminInvitationCodes(), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/invitation-codes');
    });

    it('supports disabled option in wrapper hooks', async () => {
      const { result } = renderHook(() => useAdminSubEvents({ enabled: false }), {
        wrapper: createWrapper(queryClient),
      });
      expect(mockApiClient.get).not.toHaveBeenCalled();
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual([]);
    });
  });
});
