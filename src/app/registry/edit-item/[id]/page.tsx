'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { RegistryItem } from '@/types/registry';

// Placeholder component for the Edit Item page
export default function EditRegistryItemPage() {
  const router = useRouter();
  const params = useParams();
  const itemId = params?.id as string; // Get item ID from URL

  const [itemData, setItemData] = useState<Partial<RegistryItem>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    // Basic client-side auth check
    const loggedIn = localStorage.getItem('isAdminLoggedIn') === 'true';
    setIsAdmin(loggedIn);
    if (!loggedIn) {
      router.push('/admin/login');
      return; // Stop execution if not logged in
    }

    if (!itemId) {
        setError('Item ID is missing.');
        setLoading(false);
        return;
    }

    // Fetch item data
    const fetchItem = async () => {
      try {
        const response = await fetch(`/api/registry/items/${itemId}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch item: ${response.statusText}`);
        }
        const data: RegistryItem = await response.json();
        setItemData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchItem();
  }, [router, itemId]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = event.target;

    if (type === 'checkbox') {
        const { checked } = event.target as HTMLInputElement;
        setItemData(prev => ({ ...prev, [name]: checked }));
    } else {
        setItemData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    // Convert price and quantity back to numbers before sending
    const price = parseFloat(itemData.price as unknown as string);
    const quantity = parseInt(itemData.quantity as unknown as string, 10);

    if (isNaN(price) || isNaN(quantity)) {
        setError('Price and Quantity must be valid numbers.');
        return;
    }

    const payload = {
        ...itemData,
        price: price,
        quantity: quantity,
    };

    try {
      const response = await fetch(`/api/registry/items/${itemId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      alert('Item updated successfully!');
      router.push('/registry'); // Redirect back to registry page

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update item');
      console.error('Failed to update item:', err);
    }
  };

  if (!isAdmin) {
    return <p>Redirecting to login...</p>; // Or a loading indicator
  }

  if (loading) {
    return <p>Loading item data...</p>;
  }

  if (error) {
    return <p className="text-red-500">Error: {error}</p>;
  }

  // Render the form pre-filled with itemData
  return (
    <div className="container mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Edit Registry Item</h1>
      <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto bg-white p-6 rounded shadow" data-testid="form">
        {/* Form fields similar to Add Item, but using value={itemData.fieldName} and onChange={handleChange} */} 
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">Item Name:</label>
          <input type="text" id="name" name="name" value={itemData.name || ''} onChange={handleChange} required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description:</label>
          <textarea id="description" name="description" value={itemData.description || ''} onChange={handleChange} rows={3} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"></textarea>
        </div>
        <div>
          <label htmlFor="price" className="block text-sm font-medium text-gray-700">Price ($):</label>
          <input type="number" id="price" name="price" value={itemData.price || 0} onChange={handleChange} step="0.01" required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
         <div>
          <label htmlFor="quantity" className="block text-sm font-medium text-gray-700">Quantity:</label>
          <input type="number" id="quantity" name="quantity" value={itemData.quantity || 1} onChange={handleChange} required className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div>
          <label htmlFor="category" className="block text-sm font-medium text-gray-700">Category:</label>
          <input type="text" id="category" name="category" value={itemData.category || ''} onChange={handleChange} className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div>
          <label htmlFor="image" className="block text-sm font-medium text-gray-700">Image URL:</label>
          <input type="url" id="image" name="image" value={itemData.image || ''} onChange={handleChange} placeholder="https://..." className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div>
          <label htmlFor="vendorUrl" className="block text-sm font-medium text-gray-700">Vendor/Product URL:</label>
          <input type="url" id="vendorUrl" name="vendorUrl" value={itemData.vendorUrl || ''} onChange={handleChange} placeholder="https://..." className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border" />
        </div>
        <div className="flex items-center">
           <input type="checkbox" id="isGroupGift" name="isGroupGift" checked={itemData.isGroupGift || false} onChange={handleChange} className="h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" />
           <label htmlFor="isGroupGift" className="ml-2 block text-sm text-gray-900">Allow Group Gifting?</label>
        </div>
        {/* Display contribution info if it's a group gift - usually non-editable here */}
        {itemData.isGroupGift && (
            <div className="text-sm text-gray-600">
                <p>Amount Contributed: ${itemData.amountContributed?.toFixed(2) ?? '0.00'}</p>
                <p>Contributors: {itemData.contributors?.length ?? 0}</p>
            </div>
        )}

        <button type="submit" className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
          Save Changes
        </button>
        {error && <p className="text-red-500 text-sm mt-2">Error: {error}</p>}
      </form>
    </div>
  );
}
