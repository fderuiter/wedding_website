'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { RegistryItem } from '../types';
import RegistryItemForm from '../components/RegistryItemForm';
import { useAdminRegistry, useAdminRegistryItem } from '@/hooks/admin/useAdminRegistry';
import { AdminEditorContainer } from '@/components/admin/AdminEditorContainer';
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
      router.push('/admin/dashboard');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to update item');
      addToast('Failed to update item', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!itemId) {
    return <p className="text-red-500">Error: Item ID is missing.</p>;
  }
  if (itemLoading) {
    return <p>Loading item data...</p>;
  }
  if (submitError || itemError) {
    return <p className="text-red-500">Error: {submitError || itemError?.message}</p>;
  }
  if (!itemData) {
    return <p className="text-red-500">Error: Item not found.</p>;
  }

  return (
    <AdminEditorContainer title="Edit Registry Item">
      <RegistryItemForm
        mode="edit"
        initialValues={itemData}
        onSubmit={handleEdit}
        isSubmitting={isSubmitting}
        submitLabel="Save Changes"
      />
    </AdminEditorContainer>
  );
}
