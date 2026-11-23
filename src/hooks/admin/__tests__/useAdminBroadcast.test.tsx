import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAdminBroadcast } from '../useAdminBroadcast';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

jest.mock('@/features/admin/apiClient', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('useAdminBroadcast', () => {
  const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
  const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
  const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;

  function createTestQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });
  }

  function createWrapper(queryClient: QueryClient) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips GET /api/admin/broadcast/history by default when fetchHistory is omitted', () => {
    const queryClient = createTestQueryClient();

    const { result } = renderHook(() => useAdminBroadcast(), {
      wrapper: createWrapper(queryClient),
    });

    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current.history).toEqual([]);
    expect(result.current.loadingHistory).toBe(false);
    queryClient.clear();
  });

  it('fetches bounded summary history rows when fetchHistory is true and caps limit at 100', async () => {
    const queryClient = createTestQueryClient();
    mockGet.mockResolvedValueOnce([
      {
        id: 'bc-1',
        channel: 'EMAIL',
        subject: 'Shuttle Info',
        body: 'Bus leaves at 4 PM',
        status: 'SENT',
        totalRecipients: 10,
        sentCount: 10,
        failedCount: 0,
        createdAt: '2026-06-01T12:00:00.000Z',
      },
    ]);

    const { result } = renderHook(
      () => useAdminBroadcast({ fetchHistory: true, page: 1, limit: 250 }),
      { wrapper: createWrapper(queryClient) }
    );

    await waitFor(() => {
      expect(result.current.history).toHaveLength(1);
    });

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith('/api/admin/broadcast/history?page=1&limit=100');
    queryClient.clear();
  });

  it('invalidates both summary and detail broadcast queries after retryBroadcast and cancelScheduledBroadcast', async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

    mockPost.mockResolvedValueOnce({ id: 'bc-1', status: 'SENT' });
    mockDelete.mockResolvedValueOnce({ id: 'bc-2', status: 'CANCELLED' });

    const { result } = renderHook(() => useAdminBroadcast(), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.retryBroadcast({ broadcastId: 'bc-1' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-broadcast-history'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-broadcast-detail'] });

    invalidateSpy.mockClear();

    await act(async () => {
      await result.current.cancelScheduledBroadcast('bc-2');
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-broadcast-history'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin-broadcast-detail'] });
  });
});
