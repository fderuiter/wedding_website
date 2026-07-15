import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

export function useAdminFeatures() {
  const queryClient = useQueryClient();
  const queryKey = ['admin-features'];
  const endpoint = '/api/admin/features';

  const { data: features = [], isLoading: loading, error: queryError } = useQuery<any[], Error>({
    queryKey,
    queryFn: async () => {
      let data = await apiClient.get<any[]>(endpoint);
      if (!data || data.length === 0) {
        data = [
          { id: 'story', type: 'story', title: 'Our Story', visible: true },
          { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
          { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
          { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
          { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
          { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true }
        ];
      }
      return data;
    },
  });

  const error = queryError ? queryError.message : null;

  const { mutateAsync: saveFeatures } = useMutation({
    mutationFn: async (newFeatures: any[]) => apiClient.put(endpoint, { features: newFeatures }),
    onMutate: async (newFeatures) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<any[]>(queryKey);
      queryClient.setQueryData<any[]>(queryKey, newFeatures);
      return { previousData };
    },
    onError: ( _err: any, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
    meta: {
      showSuccessToast: false
    }
  });

  return {
    features,
    loading,
    error,
    saveFeatures,
    fetchAll: () => queryClient.invalidateQueries({ queryKey })
  };
}
