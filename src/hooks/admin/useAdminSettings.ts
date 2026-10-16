import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/features/admin';

export function useAdminSettings(profileId: string = 'global') {
  const queryClient = useQueryClient();
  const queryKey = ['admin-settings', profileId];
  const listQueryKey = ['admin-profiles-list'];
  const endpoint = `/api/admin/settings${profileId !== 'global' ? `?id=${profileId}` : ''}`;

  const { data: config, isLoading: loading, error: queryError } = useQuery<any, Error>({
    queryKey,
    queryFn: async () => {
      const data = await apiClient.get<any>(endpoint);
      if (data && data.weddingDate) {
        data.weddingDate = data.weddingDate.split('T')[0];
      }
      return data;
    },
  });

  const { data: profiles, isLoading: loadingList, error: listError } = useQuery<any[], Error>({
    queryKey: listQueryKey,
    queryFn: async () => {
      return apiClient.get<any[]>('/api/admin/settings?list=true');
    },
  });

  const error = queryError ? queryError.message : (listError ? listError.message : null);

  const { mutateAsync: saveSettings, isPending: saving } = useMutation({
    mutationFn: async (newConfig: any) => {
      const targetId = newConfig.id || profileId;
      const putEndpoint = `/api/admin/settings?id=${targetId}`;
      return apiClient.put(putEndpoint, {
        ...newConfig,
        weddingDate: newConfig.weddingDate ? new Date(newConfig.weddingDate).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
    },
    meta: {
      successMessage: 'Settings saved successfully.'
    }
  });

  const { mutateAsync: createProfile, isPending: creating } = useMutation({
    mutationFn: async (newProfile: any) => {
      return apiClient.post('/api/admin/settings', {
        ...newProfile,
        weddingDate: newProfile.weddingDate ? new Date(newProfile.weddingDate).toISOString() : new Date().toISOString(),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listQueryKey });
    },
    meta: {
      successMessage: 'Profile created successfully.'
    }
  });

  return {
    config,
    loading,
    saving,
    error,
    saveSettings,
    profiles,
    loadingList,
    createProfile,
    creating,
    fetchAll: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: listQueryKey });
    }
  };
}
