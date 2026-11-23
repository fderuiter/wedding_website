import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';
import type {
  SendBroadcastInput,
  PreviewBroadcastInput,
  SendTestBroadcastInput,
  TestConnectionInput,
  BroadcastHistoryItem,
  BroadcastTargetFilters,
} from '@/features/broadcast';

interface UseAdminBroadcastOptions {
  fetchHistory?: boolean;
  page?: number;
  limit?: number;
}

const HISTORY_QUERY_KEY = ['admin-broadcast-history'] as const;
const DETAIL_QUERY_KEY = ['admin-broadcast-detail'] as const;

export function useAdminBroadcast(options: UseAdminBroadcastOptions = {}) {
  const { fetchHistory = false, page = 1, limit = 50 } = options;
  const safePage = Math.max(1, Math.trunc(page));
  const clampedLimit = Math.min(Math.max(1, Math.trunc(limit)), 100);

  const queryClient = useQueryClient();

  const invalidateBroadcastQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: HISTORY_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: DETAIL_QUERY_KEY });
  }, [queryClient]);

  const {
    data: history = [],
    isLoading: loadingHistory,
    error: historyError,
  } = useQuery<BroadcastHistoryItem[], Error>({
    queryKey: [...HISTORY_QUERY_KEY, { page: safePage, limit: clampedLimit }],
    queryFn: async () => {
      return apiClient.get<BroadcastHistoryItem[]>(
        `/api/admin/broadcast/history?page=${safePage}&limit=${clampedLimit}`
      );
    },
    enabled: fetchHistory,
  });

  const { mutateAsync: sendBroadcast, isPending: sending } = useMutation({
    mutationFn: async (payload: SendBroadcastInput) => {
      return apiClient.post('/api/admin/broadcast/send', payload);
    },
    onSuccess: () => {
      invalidateBroadcastQueries();
    },
  });

  const { mutateAsync: sendTestBroadcast, isPending: sendingTest } = useMutation({
    mutationFn: async (payload: SendTestBroadcastInput) => {
      return apiClient.post('/api/admin/broadcast/test-send', payload);
    },
  });

  const { mutateAsync: previewBroadcast, isPending: previewing } = useMutation({
    mutationFn: async (payload: PreviewBroadcastInput) => {
      return apiClient.post('/api/admin/broadcast/preview', payload);
    },
  });

  const countRecipients = useCallback(
    async (
      targetFilters?: BroadcastTargetFilters
    ): Promise<{
      recipientCount: number;
      matchedCount?: number;
      missingContactCount?: number;
      baseUrlWarning?: string;
    }> => {
      const res = await apiClient.post<{
        recipientCount?: number;
        matchedCount?: number;
        missingContactCount?: number;
        baseUrlWarning?: string;
      }>('/api/admin/broadcast/preview', {
        channel: 'EMAIL',
        body: '{{guestName}}',
        targetFilters,
      });
      const resolvedCount =
        typeof res?.recipientCount === 'number'
          ? res.recipientCount
          : typeof res?.matchedCount === 'number'
            ? res.matchedCount
            : 0;
      return {
        recipientCount: resolvedCount,
        matchedCount: res?.matchedCount,
        missingContactCount: res?.missingContactCount,
        baseUrlWarning: res?.baseUrlWarning,
      };
    },
    []
  );

  const { mutateAsync: retryBroadcast, isPending: retrying } = useMutation({
    mutationFn: async (payload: { broadcastId: string; recipientIds?: string[] }) => {
      return apiClient.post('/api/admin/broadcast/retry', payload);
    },
    onSuccess: () => {
      invalidateBroadcastQueries();
    },
  });

  const { mutateAsync: testConnection, isPending: testingConnection } = useMutation({
    mutationFn: async (payload: TestConnectionInput) => {
      return apiClient.post('/api/admin/broadcast/test-connection', payload);
    },
  });

  const { mutateAsync: cancelScheduledBroadcast, isPending: cancelling } = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/api/admin/broadcast/schedule/${id}`);
    },
    onSuccess: () => {
      invalidateBroadcastQueries();
    },
  });

  return {
    history,
    loadingHistory,
    historyError: historyError ? historyError.message : null,
    sendBroadcast,
    sending,
    sendTestBroadcast,
    sendingTest,
    previewBroadcast,
    previewing,
    countRecipients,
    retryBroadcast,
    retrying,
    testConnection,
    testingConnection,
    cancelScheduledBroadcast,
    cancelling,
    refetchHistory: invalidateBroadcastQueries,
  };
}
