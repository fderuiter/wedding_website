import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';
import type {
  SendBroadcastInput,
  PreviewBroadcastInput,
  TestConnectionInput,
  BroadcastHistoryItem,
} from '@/features/broadcast';

export function useAdminBroadcast() {
  const queryClient = useQueryClient();
  const historyQueryKey = ['admin-broadcast-history'];

  const {
    data: history = [],
    isLoading: loadingHistory,
    error: historyError,
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

  const { mutateAsync: previewBroadcast, isPending: previewing } = useMutation({
    mutationFn: async (payload: PreviewBroadcastInput) => {
      return apiClient.post('/api/admin/broadcast/preview', payload);
    },
  });

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

  return {
    history,
    loadingHistory,
    historyError: historyError ? historyError.message : null,
    sendBroadcast,
    sending,
    previewBroadcast,
    previewing,
    retryBroadcast,
    retrying,
    testConnection,
    testingConnection,
    refetchHistory: () => queryClient.invalidateQueries({ queryKey: historyQueryKey }),
  };
}
