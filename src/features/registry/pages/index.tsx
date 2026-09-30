'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Overlay } from '@/components/ui/Overlay';
import { VisibilitySentinel } from '@/components/VisibilitySentinel';

import RegistryCard from '../components/RegistryCard';
import RegistryItemCard from '../components/RegistryItemCard';
import { CategoryFilter } from '@/components/ui/CategoryFilter';
import { PriceRangeFilter } from '../components/PriceRangeFilter';
import RegistryCardSkeleton from '../components/RegistryCardSkeleton';
import EmptyState from '@/components/EmptyState';
import { useRegistry } from '../hooks/useRegistry';
import { Button } from '@/components/ui/Button';
import { FormGroup, Checkbox, Label } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

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
    items,
    isLoading,
    error,
    refetch,
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

  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const isLoadingMore = useRef(false);
  const counterRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasButtonFocused = useRef(false);

  const handleLoadMore = useCallback(() => {
    if (isLoadingMore.current) return;
    if (visibleItems.length >= filteredItems.length) return;
    
    wasButtonFocused.current = document.activeElement === buttonRef.current;
    
    isLoadingMore.current = true;
    setLiveAnnouncement('Loading more gifts...');
    
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
    <ErrorBoundary title="Registry Error" message="An unexpected error occurred while displaying the registry.">
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
            <FormGroup className="flex items-center space-y-0 space-x-2">
              <Checkbox
                checked={showGroupGiftsOnly}
                onChange={(e) => setShowGroupGiftsOnly(e.target.checked)}
              />
              <Label className="font-normal cursor-pointer">
                Show only group gifts
              </Label>
            </FormGroup>
            <FormGroup className="flex items-center space-y-0 space-x-2">
              <Checkbox
                checked={showAvailableOnly}
                onChange={(e) => setShowAvailableOnly(e.target.checked)}
              />
              <Label className="font-normal cursor-pointer">
                Show only available gifts
              </Label>
            </FormGroup>
          </div>
        </nav>

        {error ? (
          <div
            role="alert"
            className="p-8 rounded-2xl bg-white/10 dark:bg-gray-800/90 border border-primary/30 text-center shadow-xl max-w-xl mx-auto my-8 flex flex-col items-center justify-center space-y-4"
          >
            <div className="p-3 rounded-full bg-primary/10 text-primary">
              <Icon name="AlertTriangle" className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-primary">Unable to Load Registry</h2>
            <p className="text-base text-red-500 font-medium">
              Error loading registry: {error instanceof Error ? error.message : String(error)}
            </p>
            <Button onClick={() => refetch()} variant="primary" size="md">
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-10 max-w-7xl mx-auto">
            {Array.from({ length: 12 }).map((_, index) => (
              <RegistryCardSkeleton key={index} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            message="No gifts have been added to the registry yet. Please check back later!"
            onAction={() => refetch()}
            actionLabel="Refresh Registry"
          />
        ) : visibleItems.length > 0 ? (
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

        {!isLoading && !error && visibleItems.length > 0 && (
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
                <Button 
                  ref={buttonRef}
                  type="button"
                  variant="primary"
                  className="mt-2"
                  onClick={handleLoadMore}
                >
                  Load More
                </Button>
                <VisibilitySentinel
                  onVisible={handleLoadMore}
                  className="h-1 w-full"
                />
              </>
            )}
          </div>
        )}
        <Overlay isOpen={!!(selectedItem && isModalOpen)} onClose={handleCloseModal} animationType="scale">
          {selectedItem && (
            <RegistryItemCard
              item={selectedItem}
              onClose={handleCloseModal}
              onContribute={handleContribute}
            />
          )}
        </Overlay>
      </div>
    </ErrorBoundary>
  );
}
