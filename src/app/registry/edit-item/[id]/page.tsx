import React from 'react';
import EditRegistryItemClient from '@/features/registry/pages/edit-item';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { redirect } from 'next/navigation';

export default async function EditRegistryItemPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    redirect('/admin/login');
  }

  const item = await prisma.registryItem.findUnique({
    where: { id: params.id },
    include: { contributors: true },
  });

  if (!item) {
    return <p className="text-red-500">Item not found</p>;
  }

  return <EditRegistryItemClient initialItem={item} />;
}