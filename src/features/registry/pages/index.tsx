'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VisibilitySentinel } from '@/components/VisibilitySentinel';

import RegistryCard from '@/features/registry/components/RegistryCard';
import Modal from '@/features/registry/components/Modal';
import { CategoryFilter } from '@/components/ui/CategoryFilter';
import { PriceRangeFilter } from '@/features/registry/components/PriceRangeFilter';
import RegistryCardSkeleton from '@/features/registry/components/RegistryCardSkeleton';
import EmptyState from '@/components/EmptyState';
import { useRegistry } from '@/features/registry/hooks/useRegistry';

/**
 * @page RegistryPage
 * @description The main page component for the wedding registry.
 *
 * This component displays the list of registry items, allowing users to browse, filter,
 * and search for gifts. It integrates `useRegistry` to manage state and API interactions,
 * including fetching items, handling contributions, and managing admin actions (edit/delete).
 * It features infinite scrolling to load more items as the user scrolls down.
 *
 * @returns {JSX.Element} The rendered registry page.
 */
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

  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const isLoadingMore = useRef(false);
  const counterRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasButtonFocused = useRef(false);

  const handleLoadMore = useCallback(() => {
    if (isLoadingMore.current) return;
    if (visibleItems.length >= filteredItems.length) return;
    
    wasButtonFocused.current = document.activeElement === buttonRef.current;
    
    isLoadingMore.current = true;
    setLiveAnnouncement("Loading more gifts...");
    
    setTimeout(() => {
      setVisibleItemsCount(prevCount => prevCount + 8);
      isLoadingMore.current = false;
    }, 500);
  }, [setVisibleItemsCount, visibleItems.length, filteredItems.length]);

  useEffect(() => {
    if (!isLoadingMore.current && visibleItems.length > 0) {
      setLiveAnnouncement(`Showing ${visibleItems.length} of ${filteredItems.length} gifts`);
      
      if (wasButtonFocused.current && visibleItems.length >= filteredItems.length) {
        counterRef.current?.focus();
        wasButtonFocused.current = false;
      }
    }
  }, [visibleItems.length, filteredItems.length]);

  const handleClearFilters = () => {
    setCategoryFilter([]);
    setPriceRange([minPrice, maxPrice]);
    setShowGroupGiftsOnly(false);
    setShowAvailableOnly(false);
  };

  const gridVariants = {
    hidden: { opacity: 0, y: 30 },
    visible: { opacity: 1, y: 0, transition: { staggerChildren: 0.08, duration: 0.7 } },
  };
  const cardVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <div className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] selection:bg-primary selection:text-[var(--color-text-on-primary)] dark:selection:bg-primary pb-32 px-2 sm:px-4">
      <div aria-live="polite" className="sr-only">
        {liveAnnouncement}
      </div>
      <motion.h1
        className="text-5xl font-extrabold text-center mb-12 pt-12 text-primary tracking-tight drop-shadow-lg"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7 }}
        tabIndex={0}
        aria-label="Wedding Registry"
      >
        Wedding Registry
      </motion.h1>
      <nav
        className="sticky top-0 z-30 bg-white/90 dark:bg-gray-800/90 backdrop-blur border-b border-primary dark:border-gray-700 max-w-4xl mx-auto px-2 sm:px-6 mb-10 flex flex-col gap-4 py-4 rounded-xl shadow-md"
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
              className="h-4 w-4 text-primary border-gray-300 rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-offset-2"
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
              className="h-4 w-4 text-primary border-gray-300 rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none focus-visible:ring-offset-2"
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
                    onClick={handleCardClick}
                    isAdmin={isAdmin}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                </motion.div>
              ))}
            </motion.div>
          ) : (
            <EmptyState
              message="No gifts match the current filters. Try adjusting your search!"
              onAction={handleClearFilters}
              actionLabel="Clear Filters"
            />
          )}
        </>
      )}

      {!isLoading && visibleItems.length > 0 && (
        <div className="flex flex-col items-center justify-center p-8 gap-4 max-w-7xl mx-auto">
          <p 
            ref={counterRef}
            tabIndex={-1}
            className="text-sm text-gray-600 dark:text-gray-400 font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-2" 
            aria-hidden="true"
          >
            Showing {visibleItems.length} of {filteredItems.length} gifts
          </p>
          {visibleItems.length < filteredItems.length && (
            <>
              <button 
                ref={buttonRef}
                type="button"
                className="btn-primary mt-2"
                onClick={handleLoadMore}
              >
                Load More
              </button>
              <VisibilitySentinel
                onVisible={handleLoadMore}
                className="h-1 w-full"
              />
            </>
          )}
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
                className="bg-white dark:bg-gray-800 rounded-full p-2 shadow-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
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
