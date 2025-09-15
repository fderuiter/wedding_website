'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { RegistryItem } from '@/features/registry/types';
import { UseMutationResult } from '@tanstack/react-query';

interface AdminCardListProps {
  items: RegistryItem[];
  deleteMutation: UseMutationResult<Response, Error, string, unknown>;
}

export function AdminCardList({ items, deleteMutation }: AdminCardListProps) {
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
    <div className="md:hidden space-y-6">
      {items.map((item) => (
        <div key={item.id} className="rounded-xl shadow-lg bg-white dark:bg-gray-800 p-4 flex flex-col gap-2 border border-rose-100 dark:border-gray-700">
          <div className="flex justify-between items-center mb-2">
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
              className="flex-1 bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-amber-300"
              onClick={() => router.push(`/registry/edit-item/${item.id}`)}
            >
              Edit
            </button>
            <button
              className="flex-1 bg-rose-600 hover:bg-rose-700 text-white px-3 py-2 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-300"
              onClick={() => handleDeleteClick(item.id)}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
