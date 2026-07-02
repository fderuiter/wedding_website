'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { RegistryItem } from '@/features/registry/types';
import RegistryItemForm from '@/features/registry/components/RegistryItemForm';
import { useAdminRegistry } from '@/hooks/admin/useAdminRegistry';
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
  const { addToast } = useToast();
  const { data: items, loading: itemsLoading, error: itemsError, update } = useAdminRegistry();

  const [itemData, setItemData] = useState<RegistryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!itemId) {
      setError('Item ID is missing.');
      setLoading(false);
      return;
    }
    if (!itemsLoading) {
      const foundItem = items.find(item => item.id === itemId);
      if (foundItem) {
        setItemData(foundItem);
      } else if (itemsError) {
        setError(itemsError);
      } else {
        setError('Item not found.');
      }
      setLoading(false);
    }
  }, [itemId, items, itemsLoading, itemsError]);

  const handleEdit = async (values: Partial<RegistryItem>) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await update(itemId, values);
      addToast('Item updated successfully!', 'success');
      router.push('/admin/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item');
      addToast('Failed to update item', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!itemId) {
    return <p className="text-red-500">Error: Item ID is missing.</p>;
  }
  if (loading || !itemData) {
    return <p>Loading item data...</p>;
  }
  if (error) {
    return <p className="text-red-500">Error: {error}</p>;
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
