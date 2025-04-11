'use client';

import { useEffect, useState, useMemo } from 'react';
import { RegistryItem } from '@/types/registry';
import RegistryCard from '@/components/RegistryCard';
import Modal from '@/components/Modal';
import Fuse from 'fuse.js';

export default function RegistryPage() {
  const [items, setItems] = useState<RegistryItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<RegistryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeItem, setActiveItem] = useState<RegistryItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch items from API
  useEffect(() => {
    setIsLoading(true);
    fetch('/api/registry/items')
      .then((res) => {
        if (!res.ok) {
          throw new Error('Failed to fetch registry items');
        }
        return res.json();
      })
      .then((data: RegistryItem[]) => {
        setItems(data);
        setFilteredItems(data); // Initialize filtered items
        setError(null);
      })
      .catch((err) => {
        console.error("Error fetching registry items:", err);
        setError(err.message || "Could not load registry items.");
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  // Fuse.js search setup
  const fuse = useMemo(() => new Fuse(items, {
    keys: ['name', 'description', 'category'],
    threshold: 0.3, // Adjust threshold for desired fuzziness
  }), [items]);

  // Update filtered items when search term changes
  useEffect(() => {
    if (!searchTerm) {
      setFilteredItems(items);
    } else {
      const results = fuse.search(searchTerm);
      setFilteredItems(results.map(result => result.item));
    }
  }, [searchTerm, items, fuse]);

  // Handle contribution submission
  const handleContribute = async (itemId: string, contributorName: string, amount: number) => {
    try {
      const response = await fetch('/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, contributorName, amount }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Contribution failed');
      }

      const { item: updatedItem } = await response.json();

      // Update local state immediately for better UX
      setItems(prevItems => prevItems.map(item => item.id === itemId ? updatedItem : item));
      setActiveItem(updatedItem); // Update the item shown in the modal

      // Optionally show a success message (could use a toast notification library)
      alert('Thank you for your contribution!');
      // Keep modal open to show updated status, or close it:
      // onClose(); 

    } catch (err: any) {
      console.error("Contribution submission error:", err);
      // Re-throw the error so the Modal component can display it
      throw err;
    }
  };

  const handleCloseModal = () => {
    setActiveItem(null);
  };

  return (
    <section className="py-10 px-4">
      <h1 className="text-4xl font-bold text-center mb-8">Wedding Registry</h1>
      
      {/* Search Input */}
      <div className="flex justify-center mb-6">
        <input
          type="text"
          placeholder="Search gifts by name, description, or category..."
          className="border p-3 rounded-lg w-full max-w-lg shadow-sm focus:ring-2 focus:ring-blue-300 outline-none"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Loading and Error States */}
      {isLoading && <p className="text-center text-gray-600">Loading registry items...</p>}
      {error && <p className="text-center text-red-600">Error: {error}</p>}

      {/* Registry Grid */}
      {!isLoading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredItems.length > 0 ? (
            filteredItems.map(item => (
              <RegistryCard 
                key={item.id} 
                item={item} 
                onClick={() => !item.purchased && setActiveItem(item)} // Only open modal if not purchased
              />
            ))
          ) : (
            <p className="text-center text-gray-600 col-span-full">
              {searchTerm ? 'No gifts found matching your search.' : 'No registry items available at the moment.'}
            </p>
          )}
        </div>
      )}

      {/* Modal for Item Details and Contribution */}
      {activeItem && (
        <Modal 
          item={activeItem} 
          onClose={handleCloseModal} 
          onContribute={handleContribute} 
        />
      )}
    </section>
  );
}
