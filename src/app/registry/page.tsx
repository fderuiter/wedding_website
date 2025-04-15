'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation'; // Import useRouter
import RegistryCard from '@/components/RegistryCard';
import Modal from '@/components/Modal';
import { RegistryItem } from '@/types/registry';
import { motion, AnimatePresence } from 'framer-motion';

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

  // Animation variants
  const gridVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { staggerChildren: 0.08, duration: 0.7 } },
  };
  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-yellow-50 pb-24">
      <motion.h1
        className="text-4xl font-bold text-center mb-10 pt-10"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
      >
        Wedding Registry
      </motion.h1>
      {/* Feedback messages with animation */}
      <AnimatePresence>
        {isLoading && (
          <motion.p className="text-center text-gray-500 mb-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Loading registry...
          </motion.p>
        )}
        {error && (
          <motion.p className="text-center text-red-500 mb-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Error loading registry: {error}
          </motion.p>
        )}
      </AnimatePresence>
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-8 px-4"
        variants={gridVariants}
        initial="hidden"
        animate="visible"
      >
        {items.map((item, idx) => (
          <motion.div key={item.id} variants={cardVariants}>
            <RegistryCard
              item={item}
              onClick={() => handleCardClick(item)}
              isAdmin={isAdmin}
              onEdit={handleEditItem}
              onDelete={handleDeleteItem}
            />
          </motion.div>
        ))}
      </motion.div>
      {/* Modal with animation */}
      <AnimatePresence>
        {selectedItem && isModalOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          >
            <Modal
              item={selectedItem}
              onClose={handleCloseModal}
              onContribute={async (itemId, purchaserName, amount) => {
                setPurchaserName(purchaserName);
                setContributionAmount(amount);
                await handleContributionSubmit();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
