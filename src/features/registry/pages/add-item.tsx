// src/app/add-item/page.tsx

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import RegistryItemForm from '@/features/registry/components/RegistryItemForm';
import { RegistryItem } from '@/features/registry/types';
import { addRegistryItem } from '@/features/registry/actions';

export default function AddRegistryItemClient() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdd = async (values: Partial<RegistryItem>) => {
    setIsSubmitting(true);
    try {
      await addRegistryItem(values);
      alert('Item added successfully!');
      router.push('/admin/dashboard');
    } catch (error) {
      alert(`Failed to add item: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Add New Registry Item</h1>
      <RegistryItemForm
        mode="add"
        onSubmit={handleAdd}
        isSubmitting={isSubmitting}
        submitLabel="Add Item"
      />
    </div>
  );
}
