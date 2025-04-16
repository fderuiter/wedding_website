// src/app/add-item/page.tsx

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { checkAdminClient } from '@/utils/adminAuth.client';
import RegistryItemForm from '@/components/RegistryItemForm';

// Basic placeholder component for the Add Item page
export default function AddRegistryItemPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      const isAdmin = await checkAdminClient();
      setIsAdmin(isAdmin);
      if (!isAdmin) {
        router.push('/admin/login');
      }
    }
    checkAuth();
  }, [router]);

  const handleAdd = async (values: any) => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/registry/add-item', {
        method: 'POST',
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
      router.push('/registry');
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
