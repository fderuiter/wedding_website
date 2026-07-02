// src/app/add-item/page.tsx

'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import RegistryItemForm from '@/features/registry/components/RegistryItemForm';
import { RegistryItem } from '@/features/registry/types';
import { useAdminRegistry } from '@/hooks/admin/useAdminRegistry';
import { AdminEditorContainer } from '@/components/admin/AdminEditorContainer';
import { useToast } from '@/components/ui/ToastProvider';

/**
 * @page AddRegistryItemPage
 * @description A page for administrators to add a new item to the wedding registry.
 *
 * This client component first verifies that the user is an authenticated admin.
 * If not, it redirects to the login page.
 * It renders the `RegistryItemForm` in 'add' mode and handles the form submission
 * by sending the new item data via the unified useAdminEntity hook.
 *
 * @returns {JSX.Element} The rendered "Add Registry Item" page, or a loading/redirecting message.
 */
export default function AddRegistryItemPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { create } = useAdminRegistry();
  const { addToast } = useToast();

  const handleAdd = async (values: Partial<RegistryItem>) => {
    setIsSubmitting(true);
    try {
      await create(values);
      addToast('Item added successfully!', 'success');
      router.push('/admin/dashboard');
    } catch (error) {
      addToast(`Failed to add item: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AdminEditorContainer title="Add New Registry Item">
      <RegistryItemForm
        mode="add"
        onSubmit={handleAdd}
        isSubmitting={isSubmitting}
        submitLabel="Add Item"
      />
    </AdminEditorContainer>
  );
}
