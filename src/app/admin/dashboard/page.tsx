"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RegistryItem} from "@/features/registry/types";
import { checkAdminClient } from '@/utils/adminAuth.client';

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
  const [items, setItems] = useState<RegistryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function checkAuthAndFetch() {
      const isAdmin = await checkAdminClient();
      if (!isAdmin) {
        router.replace('/admin/login');
        return;
      }
      // Fetch registry items
      fetch('/api/registry/items')
        .then((res) => {
          if (!res.ok) throw new Error('Failed to fetch items');
          return res.json();
        })
        .then((data) => setItems(data))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
    checkAuthAndFetch();
  }, [router]);

  if (loading) return (
    // Updated background
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-background)] text-[var(--color-foreground)]">
      <h1 className="text-3xl font-bold mb-4 text-rose-700">Admin Dashboard</h1>
      <p className="text-lg text-gray-500">Loading items...</p>
    </main>
  );
  if (error) return (
    // Updated background
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-background)] text-[var(--color-foreground)]">
      <h1 className="text-3xl font-bold mb-4 text-rose-700">Admin Dashboard</h1>
      <p className="text-red-500 text-lg">Error: {error}</p>
    </main>
  );

  return (
    // Updated background, removed dark mode
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] py-10 px-2 sm:px-6">
      <div className="max-w-5xl mx-auto">
        {/* Updated heading color */}
        <h1 className="text-4xl font-extrabold mb-8 text-center text-rose-700 tracking-tight drop-shadow-lg">Admin Dashboard</h1>
        {/* Responsive Table for Desktop, Cards for Mobile */}
        <div className="hidden md:block">
          {/* Updated table container styles */}
          <div className="overflow-x-auto rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-rose-100 dark:border-gray-700">
            {/* Updated table styles */}
            <table className="min-w-full divide-y divide-rose-100">
              {/* Updated table header styles */}
              <thead className="sticky top-0 z-10 bg-rose-50 backdrop-blur border-b border-rose-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Price</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Claimed/Funded</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Contributions</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              {/* Updated table body styles */}
              <tbody className="divide-y divide-rose-100">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-rose-50/50 transition">
                    <td className="px-4 py-3 font-semibold text-gray-800 dark:text-gray-100">{item.name}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">${item.price.toFixed(2)}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{item.purchased ? "Yes" : "No"}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                      {item.contributors && item.contributors.length > 0 ? (
                        <ul className="text-xs space-y-1 text-gray-700 dark:text-gray-300">
                          {item.contributors.map((c, idx) => (
                            <li key={idx}>
                              {c.name} - ${c.amount.toFixed(2)} on {new Date(c.date).toLocaleDateString()}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-gray-400">None</span>
                      )}
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      <button
                        // Updated Edit button (amber)
                        className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
                        onClick={() => router.push(`/registry/edit-item/${item.id}`)}
                      >
                        Edit
                      </button>
                      <button
                        // Updated Delete button (rose)
                        className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-300"
                        onClick={async () => {
                          if (!confirm('Are you sure you want to delete this item?')) return;
                          try {
                            const res = await fetch(`/api/registry/items/${item.id}`, { method: 'DELETE' });
                            if (!res.ok) throw new Error('Failed to delete item');
                            setItems((prev) => prev.filter((i) => i.id !== item.id));
                            alert('Item deleted successfully.');
                          } catch (e: unknown) { // Changed from any to unknown
                            alert((e instanceof Error ? e.message : String(e)) || 'Error deleting item');
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Card Layout for Mobile */}
        <div className="md:hidden space-y-6">
          {items.map((item) => (
            // Updated card styles
            <div key={item.id} className="rounded-xl shadow-lg bg-white dark:bg-gray-800 p-4 flex flex-col gap-2 border border-rose-100 dark:border-gray-700">
              <div className="flex justify-between items-center mb-2">
                {/* Updated item name color */}
                <span className="font-bold text-lg text-rose-700">{item.name}</span>
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">${item.price.toFixed(2)}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs mb-1">
                <span className={`px-2 py-1 rounded-full ${item.purchased ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{item.purchased ? 'Claimed' : 'Available'}</span>
              </div>
              <div className="mb-2">
                <span className="font-semibold text-gray-800 dark:text-gray-100">Contributions:</span>
                {item.contributors && item.contributors.length > 0 ? (
                  <ul className="ml-2 mt-1 space-y-1">
                    {item.contributors.map((c, idx) => (
                      <li key={idx} className="text-xs text-gray-700 dark:text-gray-300">
                        {c.name} - ${c.amount.toFixed(2)} on {new Date(c.date).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="ml-2 text-gray-400">None</span>
                )}
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  // Updated Edit button (amber)
                  className="flex-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
                  onClick={() => router.push(`/registry/edit-item/${item.id}`)}
                >
                  Edit
                </button>
                <button
                  // Updated Delete button (rose)
                  className="flex-1 bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-300"
                  onClick={async () => {
                    if (!confirm('Are you sure you want to delete this item?')) return;
                    try {
                      const res = await fetch(`/api/registry/items/${item.id}`, { method: 'DELETE' });
                      if (!res.ok) throw new Error('Failed to delete item');
                      setItems((prev) => prev.filter((i) => i.id !== item.id));
                      alert('Item deleted successfully.');
                    } catch (e: unknown) { // Changed from any to unknown
                      alert((e instanceof Error ? e.message : String(e)) || 'Error deleting item');
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
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
