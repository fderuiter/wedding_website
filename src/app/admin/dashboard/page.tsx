"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { RegistryItem, Contributor } from "@/types/registry";

export default function AdminDashboardPage() {
  const router = useRouter();
  const [items, setItems] = useState<RegistryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const isLoggedIn = localStorage.getItem("isAdminLoggedIn");
      if (isLoggedIn !== "true") {
        router.replace("/admin/login");
        return;
      }
      // Fetch registry items
      fetch("/api/registry/items")
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch items");
          return res.json();
        })
        .then((data) => setItems(data))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [router]);

  if (loading) return <main><h1>Admin Dashboard</h1><p>Loading items...</p></main>;
  if (error) return <main><h1>Admin Dashboard</h1><p className="text-red-500">Error: {error}</p></main>;

  return (
    <main>
      <h1>Admin Dashboard</h1>
      <table className="min-w-full border mt-6">
        <thead>
          <tr className="bg-gray-100">
            <th className="border px-2 py-1">Item</th>
            <th className="border px-2 py-1">Price</th>
            <th className="border px-2 py-1">Claimed/Funded</th>
            <th className="border px-2 py-1">Contributions</th>
            <th className="border px-2 py-1">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b">
              <td className="border px-2 py-1 font-semibold">{item.name}</td>
              <td className="border px-2 py-1">${item.price.toFixed(2)}</td>
              <td className="border px-2 py-1">{item.purchased ? "Yes" : "No"}</td>
              <td className="border px-2 py-1">
                {item.contributors && item.contributors.length > 0 ? (
                  <ul className="text-xs">
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
              <td className="border px-2 py-1 space-x-2">
                <button
                  className="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-xs"
                  onClick={() => router.push(`/registry/edit-item/${item.id}`)}
                >
                  Edit
                </button>
                <button
                  className="bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded text-xs"
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
      <div className="mt-6">
        <button
          className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded text-sm font-semibold"
          onClick={() => router.push('/registry/add-item')}
        >
          Add New Item
        </button>
      </div>
    </main>
  );
}
