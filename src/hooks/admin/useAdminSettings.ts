import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/admin/apiClient';
import { useToast } from '@/components/ui/ToastProvider';

export function useAdminSettings() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const queryKey = ['admin-settings'];
  const endpoint = '/api/admin/settings';

  const { data: config, isLoading: loading, error: queryError } = useQuery<any, Error>({
    queryKey,
    queryFn: async () => {
      const data = await apiClient.get<any>(endpoint);
      if (data.weddingDate) {
        data.weddingDate = data.weddingDate.split('T')[0];
      }
      return data;
    },
  });

  const error = queryError ? queryError.message : null;

  const { mutateAsync: saveSettings, isPending: saving } = useMutation({
    mutationFn: async (newConfig: any) => {
      return apiClient.put(endpoint, {
        ...newConfig,
        weddingDate: new Date(newConfig.weddingDate).toISOString(),
      });
    },
    onMutate: async (newConfig) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<any>(queryKey);
      queryClient.setQueryData<any>(queryKey, newConfig);
      return { previousData };
    },
    onError: (err: any, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      addToast(err.message || 'Failed to save settings.', 'error');
    },
    onSuccess: () => {
      addToast('Settings saved successfully.', 'success');
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    config,
    loading,
    saving,
    error,
    saveSettings,
    fetchAll: () => queryClient.invalidateQueries({ queryKey })
  };
}
