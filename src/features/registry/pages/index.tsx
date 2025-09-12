'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInView } from 'react-intersection-observer';

import RegistryCard from '@/features/registry/components/RegistryCard';
import Modal from '@/features/registry/components/Modal';
import { CategoryFilter } from '@/features/registry/components/CategoryFilter';
import { PriceRangeFilter } from '@/features/registry/components/PriceRangeFilter';
import RegistryCardSkeleton from '@/features/registry/components/RegistryCardSkeleton';
import EmptyState from '@/components/EmptyState';
import { useRegistry } from '@/features/registry/hooks/useRegistry';

export default function RegistryPage() {
  const {
    isLoading,
    error,
    selectedItem,
    isModalOpen,
    setVisibleItemsCount,
    isAdmin,
    filteredItems,
    visibleItems,
    categories,
    minPrice,
    maxPrice,
    categoryFilter,
    setCategoryFilter,
    priceRange,
    setPriceRange,
    showGroupGiftsOnly,
    setShowGroupGiftsOnly,
    showAvailableOnly,
    setShowAvailableOnly,
    handleCardClick,
    handleCloseModal,
    handleEdit,
    handleDelete,
    handleContribute,
  } = useRegistry();

  const { ref, inView } = useInView({ threshold: 0, triggerOnce: false });

  useEffect(() => {
    if (inView) {
      setVisibleItemsCount(prevCount => prevCount + 8);
    }
  }, [inView, setVisibleItemsCount]);

  const gridVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { staggerChildren: 0.08, duration: 0.7 } },
  };
  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-rose-100 selection:text-rose-900 dark:selection:bg-rose-800 pb-32 px-2 sm:px-4">
      <motion.h1
        className="text-5xl font-extrabold text-center mb-12 pt-12 text-rose-700 tracking-tight drop-shadow-lg"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        tabIndex={0}
        aria-label="Wedding Registry"
      >
        Wedding Registry
      </motion.h1>
      <nav
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

      {visibleItems.length < filteredItems.length && !isLoading && (
        <div ref={ref} className="text-center p-4 col-span-full">
          <p className="text-gray-500">Loading more gifts...</p>
        </div>
      )}
      <AnimatePresence>
        {selectedItem && isModalOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={selectedItem.name}
          >
            <div className="absolute top-4 right-4 z-50">
              <button
                onClick={handleCloseModal}
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
              onContribute={handleContribute}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
