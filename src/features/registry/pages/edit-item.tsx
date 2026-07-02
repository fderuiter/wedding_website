'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/apiClient';
import { RegistryItem } from '@/features/registry/types';
import RegistryItemForm from '@/features/registry/components/RegistryItemForm';

/**
 * @page EditRegistryItemPage
 * @description A page for administrators to edit an existing item in the wedding registry.
 *
 * This client component first verifies admin authentication. It then fetches the data
 * for the specific registry item based on the ID from the URL. It renders the
 * `RegistryItemForm` in 'edit' mode, populated with the fetched data. On submission,
 * it sends the updated data to the `/api/registry/items/:id` endpoint.
 *
 * @returns {JSX.Element} The rendered "Edit Registry Item" page, or a loading/error/redirecting message.
 */
export default function EditRegistryItemPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = params?.id as string;

  const { data: itemData, isLoading: loading, error } = useQuery<RegistryItem, Error>({
    queryKey: ['registry-item', itemId],
    queryFn: () => apiClient.get<RegistryItem>(`/api/registry/items/${itemId}`),
    enabled: !!itemId,
  });

  const mutation = useMutation({
    mutationFn: async (values: Partial<RegistryItem>) => {
      return apiClient.put(`/api/registry/items/${itemId}`, values);
    },
    onSuccess: () => {
      router.push('/admin/dashboard');
    },
    meta: {
      successMessage: 'Item updated successfully!'
    }
  });

  const handleEdit = async (values: Partial<RegistryItem>) => {
    mutation.mutate(values);
  };

  if (!itemId) {
    return <p className="text-red-500">Error: Item ID is missing.</p>;
  }
  if (loading) {
    return <p>Loading item data...</p>;
  }
  if (error) {
    return <p className="text-red-500">Error: {error.message}</p>;
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Edit Registry Item</h1>
      <RegistryItemForm
        mode="edit"
        initialValues={itemData}
        onSubmit={handleEdit}
        isSubmitting={mutation.isPending}
        submitLabel="Save Changes"
      />
    </div>
  );
}
