'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // Import useRouter
import RegistryCard from '@/components/RegistryCard';
import Modal from '@/components/Modal';
import { RegistryItem } from '@/types/registry';

export default function RegistryPage() {
  const [items, setItems] = useState<RegistryItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [contributionAmount, setContributionAmount] = useState<number>(0);
  const [purchaserName, setPurchaserName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false); // State to track admin status
  const router = useRouter(); // Initialize router

  useEffect(() => {
    // Check admin status on component mount
    const loggedIn = localStorage.getItem('isAdminLoggedIn') === 'true';
    setIsAdmin(loggedIn);

    // Fetch registry items
    const fetchItems = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/registry/items');
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        setItems(data);
      } catch (e) {
        console.error("Failed to fetch registry items:", e);
        setError(e instanceof Error ? e.message : 'Failed to load registry items.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchItems();
  }, []);

  const handleCardClick = (item: RegistryItem) => {
    if (item.purchased || isAdmin) return; // Don't open modal if purchased or if admin (admin uses edit/delete)
    setSelectedItem(item);
    setContributionAmount(item.isGroupGift ? 0 : item.price); // Pre-fill price for non-group gifts
    setPurchaserName(''); // Reset name field
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedItem(null);
  };

  const handleContributionSubmit = async () => {
    if (!selectedItem) return;

    const contributionData = {
      itemId: selectedItem.id,
      amount: contributionAmount,
      purchaserName: purchaserName,
    };

    try {
      const res = await fetch('/api/registry/contribute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(contributionData),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || `HTTP error! status: ${res.status}`);
      }

      const updatedItem = await res.json();

      // Update the item in the local state
      setItems(prevItems =>
        prevItems.map(item => (item.id === updatedItem.id ? updatedItem : item))
      );
      handleCloseModal();
      alert('Thank you for your contribution!');

    } catch (e) {
      console.error("Failed to submit contribution:", e);
      alert(`Error: ${e instanceof Error ? e.message : 'Could not process contribution.'}`);
    }
  };

  // --- Admin Actions ---
  const handleEditItem = (itemId: string) => {
    router.push(`/registry/edit-item/${itemId}`);
  };

  const handleDeleteItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to delete this item?')) {
      return;
    }

    try {
      const res = await fetch(`/api/registry/items/${itemId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        let errorText = `HTTP error! status: ${res.status}`;
        try {
            const errorData = await res.json();
            errorText = errorData.error || JSON.stringify(errorData);
        } catch (jsonError) {
            // If no JSON body, use the status text
        }
        throw new Error(errorText);
      }

      // Remove item from local state
      setItems(prevItems => prevItems.filter(item => item.id !== itemId));
      alert('Item deleted successfully.');

    } catch (e) {
      console.error("Failed to delete item:", e);
      alert(`Error deleting item: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  };
  // --- End Admin Actions ---

  if (isLoading) return <p className="text-center mt-10">Loading registry...</p>;
  if (error) return <p className="text-center text-red-500 mt-10">Error loading registry: {error}</p>;

  return (
    <div className="container mx-auto p-4">
      <h1 className="text-3xl font-bold text-center my-6">Wedding Registry</h1>
      {isAdmin && (
          <div className="text-center mb-6">
              <button
                  onClick={() => router.push('/registry/add-item')}
                  className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded transition"
              >
                  Add New Item
              </button>
          </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {items.map(item => (
          <RegistryCard
            key={item.id}
            item={item}
            onClick={() => handleCardClick(item)}
            isAdmin={isAdmin} // Pass admin status
            onEdit={handleEditItem} // Pass edit handler
            onDelete={handleDeleteItem} // Pass delete handler
          />
        ))}
      </div>

      {selectedItem && (
        <Modal isOpen={isModalOpen} onClose={handleCloseModal}>
          <h2 className="text-2xl font-bold mb-4">{selectedItem.name}</h2>
          <img src={selectedItem.image || '/images/placeholder.jpg'} alt={selectedItem.name} className="w-full h-64 object-cover mb-4 rounded"/>
          <p className="mb-4">{selectedItem.description}</p>
          <p className="font-semibold text-xl mb-4">Price: ${selectedItem.price.toFixed(2)}</p>

          {selectedItem.isGroupGift && (
            <div className="mb-4 p-3 bg-blue-50 rounded border border-blue-200">
              <p className="text-blue-700 font-medium">This is a group gift!</p>
              <p className="text-sm text-blue-600">${selectedItem.amountContributed.toFixed(2)} contributed so far.</p>
              <p className="text-sm text-blue-600">Remaining: ${(selectedItem.price - selectedItem.amountContributed).toFixed(2)}</p>
              <label htmlFor="contributionAmount" className="block text-sm font-medium text-gray-700 mt-2">Contribution Amount:</label>
              <input
                type="number"
                id="contributionAmount"
                value={contributionAmount}
                onChange={(e) => setContributionAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                max={selectedItem.price - selectedItem.amountContributed}
                step="0.01"
                className="border p-2 rounded w-full mt-1"
                required
              />
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="purchaserName" className="block text-sm font-medium text-gray-700">Your Name (Optional):</label>
            <input
              type="text"
              id="purchaserName"
              value={purchaserName}
              onChange={(e) => setPurchaserName(e.target.value)}
              className="border p-2 rounded w-full mt-1"
            />
          </div>

          <button
            onClick={handleContributionSubmit}
            className="w-full bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition disabled:opacity-50"
            disabled={selectedItem.isGroupGift && (contributionAmount <= 0 || contributionAmount > selectedItem.price - selectedItem.amountContributed)}
          >
            {selectedItem.isGroupGift ? 'Contribute' : 'Claim Gift'}
          </button>
        </Modal>
      )}
    </div>
  );
}
