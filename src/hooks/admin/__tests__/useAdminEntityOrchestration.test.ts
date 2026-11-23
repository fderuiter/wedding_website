import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAdminEntityOrchestration } from '../useAdminEntityOrchestration';
import { useAdminAttractions } from '../useAdminAttractions';
import { useAdminWeddingParty } from '../useAdminWeddingParty';
import { useAdminContent } from '../useAdminContent';
import { useAdminRegistry, useAdminRegistryItem } from '../useAdminRegistry';
import { useAdminSubEvents } from '../useAdminSubEvents';
import { useAdminInvitationCodes } from '../useAdminInvitationCodes';
import { apiClient } from '@/features/admin';

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

    it('useAdminRegistry queries /api/registry/items?limit=500 while keeping clean mutation paths', async () => {
      mockApiClient.get.mockResolvedValueOnce([]);
      mockApiClient.put.mockResolvedValueOnce({ message: 'Updated', item: { id: '35', name: 'Gift 35' } });
      const { result } = renderHook(() => useAdminRegistry(), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/registry/items?limit=500');

      await act(async () => {
        await result.current.update('35', { name: 'Gift 35' });
      });
      expect(mockApiClient.put).toHaveBeenCalledWith('/api/registry/items/35', { name: 'Gift 35' });
    });

    it('useAdminRegistryItem fetches target item directly via /api/registry/items/:id and unwraps { item } envelopes', async () => {
      const targetGift = { id: 'gift-35', name: 'Espresso Grinder' };
      mockApiClient.get.mockResolvedValueOnce({ item: targetGift });
      const { result } = renderHook(() => useAdminRegistryItem('gift-35'), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/registry/items/gift-35');
      expect(result.current.data).toEqual(targetGift);
    });

    it('useAdminSubEvents queries /api/admin/sub-events', async () => {
      mockApiClient.get.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useAdminSubEvents(), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/sub-events');
    });

    it('useAdminInvitationCodes queries /api/admin/invitation-codes/catalog?limit=1000', async () => {
      mockApiClient.get.mockResolvedValueOnce([]);
      const { result } = renderHook(() => useAdminInvitationCodes(), {
        wrapper: createWrapper(queryClient),
      });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockApiClient.get).toHaveBeenCalledWith('/api/admin/invitation-codes/catalog?limit=1000');
    });

    it('useAdminInvitationCodes.batchUpdateTags applies one optimistic update, rolls back on error, and suppresses global MutationCache toasts', async () => {
      const onSuccessToastSpy = jest.fn();
      const onErrorToastSpy = jest.fn();
      const customQueryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
        mutationCache: new (await import('@tanstack/react-query')).MutationCache({
          onSuccess: (_data, _vars, _ctx, mutation) => {
            if (mutation.meta?.successMessage || mutation.meta?.showSuccessToast !== false) {
              onSuccessToastSpy();
            }
          },
          onError: (_err, _vars, _ctx, mutation) => {
            if (mutation.meta?.errorMessage || mutation.meta?.showErrorToast !== false) {
              onErrorToastSpy();
            }
          },
        }),
      });

      const initialGuests = [
        { id: 'inv-1', code: 'C1', guestName: 'Alice', partyTags: ['Family'], used: false },
        { id: 'inv-2', code: 'C2', guestName: 'Bob', partyTags: [], used: false },
        { id: 'inv-3', code: 'C3', guestName: 'Cara', partyTags: ['Friends'], used: false },
      ];
      mockApiClient.get.mockResolvedValueOnce(initialGuests);

      let resolvePost!: (_val: unknown) => void;
      mockApiClient.post.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolvePost = res;
          })
      );

      const { result } = renderHook(() => useAdminInvitationCodes(), {
        wrapper: createWrapper(customQueryClient),
      });
      await waitFor(() => expect(result.current.data).toHaveLength(3));

      let mutationPromise!: Promise<unknown>;
      act(() => {
        mutationPromise = result.current.batchUpdateTags(['inv-1', 'inv-2'], ['VIP'], 'add');
      });

      // Verify optimistic update applied before server resolves
      await waitFor(() => {
        const cached = customQueryClient.getQueryData<typeof initialGuests>([
          'admin-invitation-codes',
        ]);
        expect(cached?.[0].partyTags).toEqual(['Family', 'VIP']);
        expect(cached?.[1].partyTags).toEqual(['VIP']);
        expect(cached?.[2].partyTags).toEqual(['Friends']);
      });

      await act(async () => {
        resolvePost({
          success: true,
          count: 2,
          updatedCount: 2,
          records: [
            { ...initialGuests[0], partyTags: ['Family', 'VIP'] },
            { ...initialGuests[1], partyTags: ['VIP'] },
          ],
        });
        await mutationPromise;
      });

      expect(mockApiClient.post).toHaveBeenCalledTimes(1);
      expect(mockApiClient.post).toHaveBeenCalledWith('/api/admin/invitation-codes/batch', {
        ids: ['inv-1', 'inv-2'],
        tags: ['VIP'],
        action: 'add',
      });
      expect(onSuccessToastSpy).not.toHaveBeenCalled();

      // Verify rollback on failure and error toast suppression
      mockApiClient.post.mockRejectedValueOnce(new Error('Network failure'));
      await act(async () => {
        await expect(
          result.current.batchUpdateTags(['inv-1', 'inv-2'], ['VIP'], 'remove')
        ).rejects.toThrow('Network failure');
      });

      const rolledBack = customQueryClient.getQueryData<typeof initialGuests>([
        'admin-invitation-codes',
      ]);
      expect(rolledBack?.[0].partyTags).toEqual(['Family', 'VIP']);
      expect(rolledBack?.[1].partyTags).toEqual(['VIP']);
      expect(onErrorToastSpy).not.toHaveBeenCalled();
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
