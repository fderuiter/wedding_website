import { useContext } from 'react';
import {
  QueryClient,
  QueryClientContext,
  useQuery,
  useMutation,
} from '@tanstack/react-query';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

let standaloneFallbackQueryClient: QueryClient | null = null;

function getStandaloneFallbackQueryClient(): QueryClient {
  if (!standaloneFallbackQueryClient) {
    standaloneFallbackQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  }
  return standaloneFallbackQueryClient;
}

export function resolveConfiguredBaseUrl(configuredBaseUrl?: string | null): string {
  const trimmed = typeof configuredBaseUrl === 'string' ? configuredBaseUrl.trim() : '';
  if (trimmed) {
    return trimmed.replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
}

export function useAdminSettings(profileId: string = 'global') {
  const contextQueryClient = useContext(QueryClientContext);
  const queryClient = contextQueryClient ?? getStandaloneFallbackQueryClient();
  const hasProvider = Boolean(contextQueryClient);
  const queryKey = ['admin-settings', profileId];
  const listQueryKey = ['admin-profiles-list'];
  const endpoint = `/api/admin/settings${profileId !== 'global' ? `?id=${profileId}` : ''}`;

  const { data: config, isLoading: loading, error: queryError } = useQuery<any, Error>(
    {
      queryKey,
      queryFn: async () => {
        const data = await apiClient.get<any>(endpoint);
        if (data && data.weddingDate) {
          data.weddingDate = data.weddingDate.split('T')[0];
        }
        return data;
      },
      enabled: hasProvider,
    },
    queryClient
  );

  const { data: profiles, isLoading: loadingList, error: listError } = useQuery<any[], Error>(
    {
      queryKey: listQueryKey,
      queryFn: async () => {
        return apiClient.get<any[]>('/api/admin/settings?list=true');
      },
      enabled: hasProvider,
    },
    queryClient
  );

  const error = queryError ? queryError.message : (listError ? listError.message : null);

  const { mutateAsync: saveSettings, isPending: saving } = useMutation(
    {
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
    },
    queryClient
  );

  const { mutateAsync: createProfile, isPending: creating } = useMutation(
    {
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
    },
    queryClient
  );

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
