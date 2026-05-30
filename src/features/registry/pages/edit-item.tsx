'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RegistryItem } from '@/features/registry/types';
import RegistryItemForm from '@/features/registry/components/RegistryItemForm';
import { updateRegistryItem } from '@/features/registry/actions';

interface EditRegistryItemClientProps {
  initialItem: RegistryItem;
}

export default function EditRegistryItemClient({ initialItem }: EditRegistryItemClientProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleEdit = async (values: Partial<RegistryItem>) => {
    setIsSubmitting(true);
    setError(null);
    try {
      await updateRegistryItem(initialItem.id, values);
      alert('Item updated successfully!');
      router.push('/admin/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Edit Registry Item</h1>
      {error && <p className="text-red-500 mb-4">{error}</p>}
      <RegistryItemForm
        mode="edit"
        initialValues={initialItem}
        onSubmit={handleEdit}
        isSubmitting={isSubmitting}
        submitLabel="Save Changes"
      />
    </div>
  );
}
