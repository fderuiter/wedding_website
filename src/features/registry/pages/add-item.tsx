// src/app/add-item/page.tsx

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { checkAdminClient } from '@/utils/adminAuth.client';
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
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null); // Use null for initial state
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const adminStatus = await checkAdminClient();
      setIsAdmin(adminStatus);
      if (!adminStatus) {
        router.push('/admin/login');
      }
    }
    checkAuth();
  }, [router]);

  const handleAdd = async (values: Partial<RegistryItem>) => { // Use Partial<RegistryItem> type
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/registry/add-item', {
        method: 'POST', // Specify the POST method
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        let errorText = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorText = errorData.error || JSON.stringify(errorData);
        } catch {}
        throw new Error(errorText);
      }
      alert('Item added successfully!');
      router.push('/admin/dashboard');
    } catch (error) {
      alert(`Failed to add item: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAdmin) {
    return <p>Loading or redirecting...</p>;
  }

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
