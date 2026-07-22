import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/features/admin/apiClient';

export function useAdminMaintenance() {
  const queryClient = useQueryClient();

  const exportData = () => {
    window.open('/api/admin/maintenance/export', '_blank');
  };

  const { mutateAsync: importData, isPending: importing } = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch (err) {
        throw new Error('File is not valid JSON.');
      }

      return apiClient.post('/api/admin/maintenance/import', payload);
    },
    onSuccess: () => {
      // Invalidate all queries since we completely overwrote the DB
      queryClient.invalidateQueries();
    },
    meta: {
      successMessage: 'Data imported successfully! The database state has been overwritten.'
    }
  });

  return {
    importing,
    exportData,
    importData,
  };
}
