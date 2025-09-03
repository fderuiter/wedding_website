'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { RegistryItem } from '@/types/registry';
import { checkAdminClient } from '@/utils/adminAuth.client';
import RegistryItemForm from '@/components/RegistryItemForm';

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

  const [itemData, setItemData] = useState<Partial<RegistryItem>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function checkAuthAndFetch() {
      const isAdmin = await checkAdminClient();
      setIsAdmin(isAdmin);
      if (!isAdmin) {
        router.push('/admin/login');
        return;
      }
      if (!itemId) {
        setError('Item ID is missing.');
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/registry/items/${itemId}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch item: ${response.statusText}`);
        }
        const data: RegistryItem = await response.json();
        setItemData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    }
    checkAuthAndFetch();
  }, [router, itemId]);

  const handleEdit = async (values: Partial<RegistryItem>) => {
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/registry/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      alert('Item updated successfully!');
      router.push('/admin/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAdmin) {
    return <p>Redirecting to login...</p>;
  }
  if (loading) {
    return <p>Loading item data...</p>;
  }
  if (error) {
    return <p className="text-red-500">Error: {error}</p>;
  }

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Edit Registry Item</h1>
      <RegistryItemForm
        mode="edit"
        initialValues={itemData}
        onSubmit={handleEdit}
        isSubmitting={isSubmitting}
        submitLabel="Save Changes"
      />
    </div>
  );
}
