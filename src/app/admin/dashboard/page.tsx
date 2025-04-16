"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RegistryItem, Contributor } from "@/types/registry";
import { checkAdminClient } from '@/utils/adminAuth.client';

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
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-red-50 dark:from-gray-900 dark:to-gray-800">
      <h1 className="text-3xl font-bold mb-4">Admin Dashboard</h1>
      <p className="text-lg text-gray-500">Loading items...</p>
    </main>
  );
  if (error) return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-yellow-50 to-red-50 dark:from-gray-900 dark:to-gray-800">
      <h1 className="text-3xl font-bold mb-4">Admin Dashboard</h1>
      <p className="text-red-500 text-lg">Error: {error}</p>
    </main>
  );

  return (
    <main className="min-h-screen bg-gradient-to-br from-yellow-50 to-red-50 dark:from-gray-900 dark:to-gray-800 py-10 px-2 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-4xl font-extrabold mb-8 text-center text-primary-700 dark:text-yellow-300 tracking-tight drop-shadow-lg">Admin Dashboard</h1>
        {/* Responsive Table for Desktop, Cards for Mobile */}
        <div className="hidden md:block">
          <div className="overflow-x-auto rounded-xl shadow-lg bg-white dark:bg-gray-900">
            <table className="min-w-full divide-y divide-yellow-200 dark:divide-yellow-800">
              <thead className="sticky top-0 z-10 bg-yellow-100 dark:bg-yellow-900/80 backdrop-blur border-b border-yellow-300 dark:border-yellow-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-yellow-200 uppercase tracking-wider">Item</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-yellow-200 uppercase tracking-wider">Price</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-yellow-200 uppercase tracking-wider">Claimed/Funded</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-yellow-200 uppercase tracking-wider">Contributions</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-yellow-200 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-yellow-100 dark:divide-yellow-800">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-yellow-50 dark:hover:bg-yellow-900/30 transition">
                    <td className="px-4 py-3 font-semibold">{item.name}</td>
                    <td className="px-4 py-3">${item.price.toFixed(2)}</td>
                    <td className="px-4 py-3">{item.purchased ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">
                      {item.contributors && item.contributors.length > 0 ? (
                        <ul className="text-xs space-y-1">
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
                        className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-300"
                        onClick={() => router.push(`/registry/edit-item/${item.id}`)}
                      >
                        Edit
                      </button>
                      <button
                        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-300"
                        onClick={async () => {
                          if (!confirm('Are you sure you want to delete this item?')) return;
                          try {
                            const res = await fetch(`/api/registry/items/${item.id}`, { method: 'DELETE' });
                            if (!res.ok) throw new Error('Failed to delete item');
                            setItems((prev) => prev.filter((i) => i.id !== item.id));
                            alert('Item deleted successfully.');
                          } catch (e: any) {
                            alert(e.message || 'Error deleting item');
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
            <div key={item.id} className="rounded-xl shadow-lg bg-white dark:bg-gray-900 p-4 flex flex-col gap-2 border border-yellow-100 dark:border-yellow-800">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold text-lg text-primary-700 dark:text-yellow-300">{item.name}</span>
                <span className="text-sm font-semibold text-gray-700 dark:text-yellow-200">${item.price.toFixed(2)}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs mb-1">
                <span className={`px-2 py-1 rounded-full ${item.purchased ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{item.purchased ? 'Claimed' : 'Available'}</span>
              </div>
              <div className="mb-2">
                <span className="font-semibold">Contributions:</span>
                {item.contributors && item.contributors.length > 0 ? (
                  <ul className="ml-2 mt-1 space-y-1">
                    {item.contributors.map((c, idx) => (
                      <li key={idx} className="text-xs text-gray-700 dark:text-yellow-100">
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
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-300"
                  onClick={() => router.push(`/registry/edit-item/${item.id}`)}
                >
                  Edit
                </button>
                <button
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-300"
                  onClick={async () => {
                    if (!confirm('Are you sure you want to delete this item?')) return;
                    try {
                      const res = await fetch(`/api/registry/items/${item.id}`, { method: 'DELETE' });
                      if (!res.ok) throw new Error('Failed to delete item');
                      setItems((prev) => prev.filter((i) => i.id !== item.id));
                      alert('Item deleted successfully.');
                    } catch (e: any) {
                      alert(e.message || 'Error deleting item');
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
            className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg text-base font-semibold shadow-lg focus:outline-none focus:ring-2 focus:ring-green-300"
            onClick={() => router.push('/registry/add-item')}
          >
            Add New Item
          </button>
        </div>
      </div>
    </main>
  );
}
