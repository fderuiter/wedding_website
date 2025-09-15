"use client";
import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { RegistryItem } from "@/features/registry/types";
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { API_ROUTES } from '@/lib/apiRoutes';
import { checkAdminClient } from '@/utils/adminAuth.client';
import { AdminTable } from './components/AdminTable';
import { AdminCardList } from './components/AdminCardList';

/**
 * @page AdminDashboardPage
 * @description The main dashboard for administrators to manage the wedding registry.
 *
 * This client component first checks if the user is authenticated as an admin.
 * If not, it redirects to the login page.
 * If authenticated, it fetches all registry items and displays them in a responsive table.
 * The dashboard provides functionality to edit and delete existing registry items and
 * includes a link to add new items.
 *
 * @returns {JSX.Element} The rendered admin dashboard page, or a loading/error state.
 */
export default function AdminDashboardPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: isAdmin, isLoading: isAdminLoading } = useQuery({
    queryKey: ['adminStatus'],
    queryFn: checkAdminClient,
  });

  const { data: items = [], isLoading: itemsLoading, error } = useQuery<RegistryItem[]>({
    queryKey: ['registry-items-admin'],
    queryFn: async () => {
      const res = await fetch(API_ROUTES.getRegistryItems);
      if (!res.ok) throw new Error('Failed to fetch items');
      return res.json();
    },
    enabled: !!isAdmin, // Only fetch items if the user is an admin
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => fetch(API_ROUTES.getRegistryItem(itemId), { method: 'DELETE' }),
    onSuccess: async (res) => {
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to delete item');
      }
      toast.success('Item deleted successfully.');
      queryClient.invalidateQueries({ queryKey: ['registry-items-admin'] });
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  useEffect(() => {
    if (!isAdminLoading && !isAdmin) {
      router.replace('/admin/login');
    }
  }, [isAdmin, isAdminLoading, router]);

  if (isAdminLoading || itemsLoading) return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-background)] text-[var(--color-foreground)]">
      <h1 className="text-3xl font-bold mb-4 text-rose-700">Admin Dashboard</h1>
      <p className="text-lg text-gray-500">Loading...</p>
    </main>
  );

  if (error) return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-background)] text-[var(--color-foreground)]">
      <h1 className="text-3xl font-bold mb-4 text-rose-700">Admin Dashboard</h1>
      <p className="text-red-500 text-lg">Error: {error.message}</p>
    </main>
  );

  if (!isAdmin) {
    // This is a fallback for while the redirect is happening
    return null;
  }

  return (
    // Updated background, removed dark mode
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] py-10 px-2 sm:px-6">
      <div className="max-w-5xl mx-auto">
        {/* Updated heading color */}
        <h1 className="text-4xl font-extrabold mb-8 text-center text-rose-700 tracking-tight drop-shadow-lg">Admin Dashboard</h1>
        <AdminTable items={items} deleteMutation={deleteMutation} />
        <AdminCardList items={items} deleteMutation={deleteMutation} />
        <div className="mt-10 flex justify-center">
          <button
            // Updated Add New Item button (gradient)
            className="bg-gradient-to-r from-rose-700 to-amber-500 hover:from-amber-500 hover:to-rose-700 text-white px-6 py-3 rounded-lg text-base font-semibold shadow-lg focus:outline-none focus:ring-2 focus:ring-rose-300"
            onClick={() => router.push('/registry/add-item')}
          >
            Add New Item
          </button>
        </div>
      </div>
    </main>
  );
}
