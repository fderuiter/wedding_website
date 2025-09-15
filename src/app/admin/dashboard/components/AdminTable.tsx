'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { RegistryItem } from '@/features/registry/types';
import { UseMutationResult } from '@tanstack/react-query';

interface AdminTableProps {
  items: RegistryItem[];
  deleteMutation: UseMutationResult<Response, Error, string, unknown>;
}

export function AdminTable({ items, deleteMutation }: AdminTableProps) {
  const router = useRouter();

  const handleDeleteClick = (itemId: string) => {
    toast((t) => (
      <span className="flex flex-col gap-2">
        Are you sure you want to delete this item?
        <div className="flex gap-2">
          <button
            className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded text-xs font-semibold"
            onClick={() => {
              deleteMutation.mutate(itemId);
              toast.dismiss(t.id);
            }}
          >
            Delete
          </button>
          <button
            className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-1 rounded text-xs font-semibold"
            onClick={() => toast.dismiss(t.id)}
          >
            Cancel
          </button>
        </div>
      </span>
    ));
  };

  return (
    <div className="hidden md:block">
      <div className="overflow-x-auto rounded-xl shadow-lg bg-white dark:bg-gray-800 border border-rose-100 dark:border-gray-700">
        <table className="min-w-full divide-y divide-rose-100">
          <thead className="sticky top-0 z-10 bg-rose-50 backdrop-blur border-b border-rose-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Item</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Price</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Claimed/Funded</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Contributions</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-rose-800 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
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
                    className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
                    onClick={() => router.push(`/registry/edit-item/${item.id}`)}
                  >
                    Edit
                  </button>
                  <button
                    className="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-300"
                    onClick={() => handleDeleteClick(item.id)}
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
  );
}
