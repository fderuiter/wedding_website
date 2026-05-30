import React from 'react';
import RegistryClient from '@/features/registry/pages/index';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';

export default async function RegistryPage() {
  const items = await prisma.registryItem.findMany({
    include: { contributors: true },
    orderBy: { createdAt: 'desc' },
  });
  
  const isAdmin = await isAdminRequest();

  return <RegistryClient initialItems={items} initialIsAdmin={isAdmin} />;
}