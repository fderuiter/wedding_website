// src/app/add-item/page.tsx

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import RegistryItemForm from '@/features/registry/components/RegistryItemForm';
import { RegistryItem } from '@/features/registry/types'; // Import RegistryItem type

/**
 * @page AddRegistryItemPage
 * @description A page for administrators to add a new item to the wedding registry.
 *
 * This client component first verifies that the user is an authenticated admin.
 * If not, it redirects to the login page.
 * It renders the `RegistryItemForm` in 'add' mode and handles the form submission
 * by sending the new item data to the `/api/registry/add-item` endpoint.
 *
 * @returns {JSX.Element} The rendered "Add Registry Item" page, or a loading/redirecting message.
 */
export default function AddRegistryItemPage() {
  const router = useRouter();

  const mutation = useMutation({
    mutationFn: async (values: Partial<RegistryItem>) => {
      return apiClient.post('/api/registry/add-item', values);
    },
    onSuccess: () => {
      router.push('/admin/dashboard');
    },
    meta: {
      successMessage: 'Item added successfully!'
    }
  });

  const handleAdd = async (values: Partial<RegistryItem>) => {
    mutation.mutate(values);
  };

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Add New Registry Item</h1>
      <RegistryItemForm
        mode="add"
        onSubmit={handleAdd}
        isSubmitting={mutation.isPending}
        submitLabel="Add Item"
      />
    </div>
  );
}
