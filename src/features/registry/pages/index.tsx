'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useInView } from 'react-intersection-observer';

import Modal from '@/features/registry/components/Modal';
import { RegistryFilterBar } from '@/features/registry/components/RegistryFilterBar';
import { RegistryGrid } from '@/features/registry/components/RegistryGrid';
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
      <RegistryFilterBar
        categories={categories}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        minPrice={minPrice}
        maxPrice={maxPrice}
        priceRange={priceRange}
        setPriceRange={setPriceRange}
        showGroupGiftsOnly={showGroupGiftsOnly}
        setShowGroupGiftsOnly={setShowGroupGiftsOnly}
        showAvailableOnly={showAvailableOnly}
        setShowAvailableOnly={setShowAvailableOnly}
      />
      <AnimatePresence>
        {error && (
          <motion.p className="text-center text-red-500 mb-8 text-lg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Error loading registry: {error instanceof Error ? error.message : String(error)}
          </motion.p>
        )}
      </AnimatePresence>

      <RegistryGrid
        isLoading={isLoading}
        visibleItems={visibleItems}
        filteredItems={filteredItems}
        isAdmin={isAdmin}
        handleCardClick={handleCardClick}
        handleEdit={handleEdit}
        handleDelete={handleDelete}
        loadMoreRef={ref}
      />
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
