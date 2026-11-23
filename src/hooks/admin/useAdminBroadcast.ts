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

export function useAdminBroadcast() {
  const queryClient = useQueryClient();
  const historyQueryKey = ['admin-broadcast-history'];

  const {
    data: history = [],
    isLoading: loadingHistory,
  } = useQuery<BroadcastHistoryItem[], Error>({
    queryKey: historyQueryKey,
    queryFn: async () => {
      return apiClient.get<BroadcastHistoryItem[]>('/api/admin/broadcast/history');
    },
  });

  const { mutateAsync: sendBroadcast, isPending: sending } = useMutation({
    mutationFn: async (payload: SendBroadcastInput) => {
      return apiClient.post('/api/admin/broadcast/send', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: historyQueryKey });
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
      queryClient.invalidateQueries({ queryKey: historyQueryKey });
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
      queryClient.invalidateQueries({ queryKey: historyQueryKey });
    },
  });

  return {
    history,
    loadingHistory,
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
  };
}
