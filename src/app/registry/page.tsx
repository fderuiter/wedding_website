'use client';

import React, { useState, useEffect } from 'react';
import RegistryCard from '@/components/RegistryCard';
import Modal from '@/components/Modal';
import { RegistryItem } from '@/types/registry';
import { motion, AnimatePresence } from 'framer-motion';
import { CategoryFilter } from '@/components/CategoryFilter';
import { PriceRangeFilter } from '@/components/PriceRangeFilter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useInView } from 'react-intersection-observer';
import RegistryCardSkeleton from '@/components/RegistryCardSkeleton';
import EmptyState from '@/components/EmptyState';
import { checkAdminClient } from '@/utils/adminAuth.client';
import { useRouter } from 'next/navigation';

/**
 * @page RegistryPage
 * @description The main page for the wedding registry.
 *
 * This is a feature-rich client component that handles:
 * - Fetching registry items using React Query.
 * - Client-side filtering by category and price range.
 * - Toggling the display of group gifts and available gifts.
 * - Infinite scrolling to load more items as the user scrolls down.
 * - Opening a modal to view item details and make a contribution.
 * - Optimistic updates for contributions to provide a smooth user experience.
 * - Admin controls to edit or delete items if the user is authenticated as an admin.
 *
 * @returns {JSX.Element} The rendered registry page.
 */
/**
 * @page RegistryPage
 * @description The main page for the wedding registry.
 *
 * This is a feature-rich client component that handles:
 * - Fetching registry items using React Query.
 * - Client-side filtering by category and price range.
 * - Toggling the display of group gifts and available gifts.
 * - Infinite scrolling to load more items as the user scrolls down.
 * - Opening a modal to view item details and make a contribution.
 * - Optimistic updates for contributions to provide a smooth user experience.
 * - Admin controls to edit or delete items if the user is authenticated as an admin.
 *
 * @returns {JSX.Element} The rendered registry page.
 */
export default function RegistryPage() {
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [visibleItemsCount, setVisibleItemsCount] = useState(12); // Initial number of items
  const { ref, inView } = useInView({ threshold: 0, triggerOnce: false });
  const [isAdmin, setIsAdmin] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkAdminStatus = async () => {
      const admin = await checkAdminClient();
      setIsAdmin(admin);
    };
    checkAdminStatus();
  }, []);

  // Fetch registry items with React Query
  const {
    data: items = [],
    isLoading,
    error,
  } = useQuery<RegistryItem[], Error>({
    queryKey: ['registry-items'],
    queryFn: async () => {
      const res = await fetch('/api/registry/items');
      if (!res.ok) throw new Error('Failed to fetch registry items');
      return res.json();
    },
  });


  // Infinite scroll effect
  useEffect(() => {
    // When the sentinel comes into view, load more items
    if (inView) {
      setVisibleItemsCount(prevCount => prevCount + 8); // Load 8 more items
    }
  }, [inView]);

  // Optimistic mutation for contribution/claim
  const contributeMutation = useMutation({
    mutationFn: async ({ itemId, purchaserName, amount }: { itemId: string; purchaserName: string; amount: number }) => {
      const res = await fetch('/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, purchaserName, amount }),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Contribution failed');
      }
      return res.json();
    },
    // Optimistic update
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ['registry-items'] });
      const previousItems = queryClient.getQueryData<RegistryItem[]>(['registry-items']);
      if (previousItems) {
        queryClient.setQueryData<RegistryItem[]>(['registry-items'], prev => prev?.map(item => {
          if (item.id !== variables.itemId) return item;
          // Optimistically update the item
          if (item.isGroupGift) {
            const newAmount = item.amountContributed + variables.amount;
            return {
              ...item,
              amountContributed: Math.min(item.price, newAmount),
              contributors: [...item.contributors, { name: variables.purchaserName, amount: variables.amount, date: new Date().toISOString() }],
              purchased: newAmount >= item.price,
            };
          } else {
            return {
              ...item,
              purchased: true,
              purchaserName: variables.purchaserName,
            };
          }
        }) || []);
      }
      return { previousItems };
    },
    // Rollback on error
    onError: (_err, _variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(['registry-items'], context.previousItems);
      }
      alert('Error: Could not process contribution.');
    },
    // Refetch after mutation
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-items'] });
    },
  });

  const handleCardClick = (item: RegistryItem) => {
    if (item.purchased) return;
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedItem(null);
  };

  const handleEdit = (id: string) => {
    router.push(`/registry/edit-item/${id}`);
  };

  const deleteMutation = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/registry/items/${itemId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to delete item');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['registry-items'] });
      alert('Item deleted successfully.');
    },
    onError: (error) => {
      alert(`Error deleting item: ${error.message}`);
    },
  });

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this item?')) {
      deleteMutation.mutate(id);
    }
  };


  // --- Filter State ---
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 1000]);
  const [showGroupGiftsOnly, setShowGroupGiftsOnly] = useState(false);
  const [showAvailableOnly, setShowAvailableOnly] = useState(false);

  // Compute all categories from items
  const categories = React.useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => set.add(item.category));
    return Array.from(set).sort();
  }, [items]);

  // Compute min/max price from items
  const [minPrice, maxPrice] = React.useMemo(() => {
    if (items.length === 0) return [0, 1000];
    let min = items[0].price, max = items[0].price;
    for (const item of items) {
      if (item.price < min) min = item.price;
      if (item.price > max) max = item.price;
    }
    return [Math.floor(min), Math.ceil(max)];
  }, [items]);

  useEffect(() => {
    setPriceRange([minPrice, maxPrice]);
  }, [minPrice, maxPrice]);

  // Filter logic
  const filteredItems = React.useMemo(() => {
    return items.filter(item => {
      const inCategory = categoryFilter.length === 0 || categoryFilter.includes(item.category);
      const inPrice = item.price >= priceRange[0] && item.price <= priceRange[1];
      const isGroupGift = !showGroupGiftsOnly || item.isGroupGift;
      const isAvailable = !showAvailableOnly || !item.purchased;
      return inCategory && inPrice && isGroupGift && isAvailable;
    });
  }, [items, categoryFilter, priceRange, showGroupGiftsOnly, showAvailableOnly]);

  // Apply pagination to the filtered list
  const visibleItems = React.useMemo(() => {
    return filteredItems.slice(0, visibleItemsCount);
  }, [filteredItems, visibleItemsCount]);

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
    // Updated background to match main page
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-rose-100 selection:text-rose-900 dark:selection:bg-rose-800 pb-32 px-2 sm:px-4">
      <motion.h1
        // Updated heading color to rose-700
        className="text-5xl font-extrabold text-center mb-12 pt-12 text-rose-700 tracking-tight drop-shadow-lg"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        tabIndex={0}
        aria-label="Wedding Registry"
      >
        Wedding Registry
      </motion.h1>
      {/* Enhanced Filter Bar - Updated styles */}
      <nav
        // Updated background, border, removed dark mode
        className="sticky top-0 z-30 bg-white/90 dark:bg-gray-800/90 backdrop-blur border-b border-rose-100 dark:border-gray-700 max-w-4xl mx-auto px-2 sm:px-6 mb-10 flex flex-col gap-4 py-4 rounded-xl shadow-md"
        aria-label="Registry Filters"
        role="navigation"
      >
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <CategoryFilter
            categories={categories}
            selected={categoryFilter}
            onChange={setCategoryFilter}
          />
          <PriceRangeFilter
            min={minPrice}
            max={maxPrice}
            value={priceRange}
            onChange={setPriceRange}
          />
        </div>
        <div className="flex flex-wrap justify-center items-center gap-4 mt-4">
          <div className="flex items-center">
            <input
              type="checkbox"
              id="group-gifts-only"
              checked={showGroupGiftsOnly}
              onChange={(e) => setShowGroupGiftsOnly(e.target.checked)}
              className="h-4 w-4 text-rose-600 border-gray-300 rounded focus:ring-rose-500"
            />
            <label htmlFor="group-gifts-only" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
              Show only group gifts
            </label>
          </div>
          <div className="flex items-center">
            <input
              type="checkbox"
              id="available-only"
              checked={showAvailableOnly}
              onChange={(e) => setShowAvailableOnly(e.target.checked)}
              className="h-4 w-4 text-rose-600 border-gray-300 rounded focus:ring-rose-500"
            />
            <label htmlFor="available-only" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
              Show only available gifts
            </label>
          </div>
        </div>
      </nav>
      {/* Feedback messages with animation */}
      <AnimatePresence>
        {error && (
          <motion.p className="text-center text-red-500 mb-8 text-lg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Error loading registry: {error instanceof Error ? error.message : String(error)}
          </motion.p>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-10 max-w-7xl mx-auto">
          {Array.from({ length: 12 }).map((_, index) => (
            <RegistryCardSkeleton key={index} />
          ))}
        </div>
      ) : (
        <>
          {visibleItems.length > 0 ? (
            <motion.div
              className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-10 max-w-7xl mx-auto"
              variants={gridVariants}
              initial="hidden"
              animate="visible"
              aria-live="polite"
            >
              {visibleItems.map((item) => (
                <motion.div key={item.id} variants={cardVariants}>
                  <RegistryCard
                    item={item}
                    onClick={() => handleCardClick(item)}
                    isAdmin={isAdmin}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <EmptyState message="No gifts match the current filters. Try adjusting your search!" />
          )}
        </>
      )}

      {/* Sentinel element for infinite scroll */}
      {visibleItems.length < filteredItems.length && !isLoading && (
        <div ref={ref} className="text-center p-4 col-span-full">
          <p className="text-gray-500">Loading more gifts...</p>
        </div>
      )}
      {/* Modal with animation and accessibility improvements */}
      <AnimatePresence>
        {selectedItem && isModalOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            // Updated modal backdrop
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={selectedItem.name}
          >
            <div className="absolute top-4 right-4 z-50">
              <button
                onClick={handleCloseModal}
                // Updated close button style
                className="bg-white dark:bg-gray-800 rounded-full p-2 shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-rose-400"
                aria-label="Close modal"
                tabIndex={0}
              >
                <span aria-hidden="true" className="text-2xl text-gray-600 dark:text-gray-300">×</span>
              </button>
            </div>
            <Modal
              item={selectedItem}
              onClose={handleCloseModal}
              onContribute={async (itemId, purchaserName, amount) => {
                contributeMutation.mutate({ itemId, purchaserName, amount }, {
                  onSuccess: () => {
                    handleCloseModal();
                    alert('Thank you for your contribution!');
                  }
                });
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
