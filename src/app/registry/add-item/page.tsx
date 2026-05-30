import React from 'react';
import AddRegistryItemClient from '@/features/registry/pages/add-item';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { redirect } from 'next/navigation';

export default async function AddRegistryItemPage() {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    redirect('/admin/login');
  }

  return <AddRegistryItemClient />;
}