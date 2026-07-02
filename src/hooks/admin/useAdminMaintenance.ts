import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/ToastProvider';

export function useAdminMaintenance() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();

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
        throw new Error("File is not valid JSON.");
      }

      const res = await fetch('/api/admin/maintenance/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to import data.");
      }
      return data;
    },
    onSuccess: () => {
      addToast("Data imported successfully! The database state has been overwritten.", "success");
      // Invalidate all queries since we completely overwrote the DB
      queryClient.invalidateQueries();
    },
    onError: (err: any) => {
      addToast(err.message || "An error occurred during import.", "error");
    }
  });

  return {
    importing,
    exportData,
    importData,
  };
}
