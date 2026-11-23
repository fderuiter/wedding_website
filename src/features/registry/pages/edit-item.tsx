'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { RegistryItem } from '../types';
import RegistryItemForm from '../components/RegistryItemForm';
import { useAdminRegistry, useAdminRegistryItem } from '@/hooks/admin/useAdminRegistry';
import { AdminEditorContainer } from '@/components/admin/AdminEditorContainer';
import { AdminViewState } from '@/components/admin/AdminViewState';
import { useToast } from '@/components/ui/ToastProvider';

/**
 * @page EditRegistryItemPage
 * @description A page for administrators to edit an existing item in the wedding registry.
 */
export default function EditRegistryItemPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = params?.id as string;
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const { update } = useAdminRegistry({ enabled: false });
  const {
    data: itemData,
    isLoading: itemLoading,
    error: itemError,
    refetch,
  } = useAdminRegistryItem(itemId);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEdit = async (values: Partial<RegistryItem>) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await update(itemId, values);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-registry-item', itemId] }),
        queryClient.invalidateQueries({ queryKey: ['admin-registry'] }),
        queryClient.invalidateQueries({ queryKey: ['registry-items'] }),
      ]);
      addToast('Item updated successfully!', 'success');
      router.push('/admin/dashboard/registry');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update item');
      addToast('Failed to update item', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadError = !itemId
    ? 'Item ID is missing.'
    : itemError || (!itemLoading && !itemData ? 'Item not found.' : null);

  return (
    <>
      {!itemData && <h1 className="sr-only">Edit Registry Item</h1>}
      <AdminViewState
        isLoading={Boolean(itemId) && itemLoading}
        error={loadError}
        onRetry={itemId ? refetch : undefined}
        errorTitle="Unable to Load Registry Item"
        loadingMessage="Loading item data..."
      >
        {itemData && (
          <AdminEditorContainer title="Edit Registry Item" headingLevel="h1">
            {submitError && (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
              >
                Error: {submitError}
              </div>
            )}
            <RegistryItemForm
              mode="edit"
              initialValues={itemData}
              onSubmit={handleEdit}
              isSubmitting={isSubmitting}
              submitLabel="Save Changes"
            />
          </AdminEditorContainer>
        )}
      </AdminViewState>
    </>
  );
}
