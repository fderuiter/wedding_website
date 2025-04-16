// src/app/add-item/page.tsx

'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { checkAdminClient } from '@/utils/adminAuth';

// Basic placeholder component for the Add Item page
export default function AddRegistryItemPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const newItemData = Object.fromEntries(formData.entries());

    // Convert price and quantity to numbers, handle potential errors
    const price = parseFloat(newItemData.price as string);
    const quantity = parseInt(newItemData.quantity as string, 10);

    if (isNaN(price) || isNaN(quantity)) {
        alert('Price and Quantity must be valid numbers.');
        return;
    }


    try {
      const response = await fetch('/api/registry/add-item', { // Ensure this points to the correct API route
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            ...newItemData,
            price: price, // Send as number
            quantity: quantity, // Send as number
            isGroupGift: newItemData.isGroupGift === 'on' // Handle checkbox
        }),
      });

      if (!response.ok) {
        let errorText = `HTTP error! status: ${response.status}`;
        try {
          // Try to parse potential JSON error body
          const errorData = await response.json();
          errorText = errorData.error || JSON.stringify(errorData);
        } catch (jsonError) {
          // If JSON parsing fails, try to get response as text
          try {
            errorText += `, Body: ${await response.text()}`;
          } catch (textError) {
            // Ignore if reading text also fails
          }
        }
        throw new Error(errorText);
      }

      const result = await response.json();
      console.log('Item added:', result);
      alert('Item added successfully!');
      // Optionally redirect or clear the form
      router.push('/registry'); // Redirect to registry page after adding

    } catch (error) {
      console.error('Failed to add item:', error);
      alert(`Failed to add item: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  if (!isAdmin) {
    // Optional: Show loading state or nothing while checking auth
    return <p>Loading or redirecting...</p>;
  }

  // Render the form only if admin is logged in
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Add New Registry Item</h1>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto bg-white p-6 rounded shadow" data-testid="form">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">Item Name:</label>
          <input type="text" id="name" name="name" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description:</label>
          <textarea id="description" name="description" rows={3} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"></textarea>
        </div>
        <div>
          <label htmlFor="price" className="block text-sm font-medium text-gray-700">Price ($):</label>
          <input type="number" id="price" name="price" step="0.01" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
         <div>
          <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">Quantity:</label>
          <input type="number" id="quantity" name="quantity" defaultValue="1" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category:</label>
          <input type="text" id="category" name="category" className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div>
          <label htmlFor="image" className="block text-sm font-medium text-gray-700">Image URL:</label>
          <input type="url" id="image" name="image" placeholder="https://..." className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div>
          <label htmlFor="vendorUrl" className="block text-sm font-medium text-gray-700">Vendor/Product URL:</label>
          <input type="url" id="vendorUrl" name="vendorUrl" placeholder="https://..." className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div className="flex items-center">
           <input type="checkbox" id="isGroupGift" name="isGroupGift" className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" />
           <label htmlFor="isGroupGift" className="ml-2 block text-sm text-gray-900">Allow Group Gifting?</label>
        </div>

        <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
          Add Item
        </button>
      </form>
    </div>
  );
}
