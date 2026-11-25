'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Dialog } from '@/components/ui/Dialog';
import { VisibilitySentinel } from '@/components/VisibilitySentinel';

import RegistryCard from '../components/RegistryCard';
import RegistryItemCard from '../components/RegistryItemCard';
import { CategoryFilter } from '@/components/ui/CategoryFilter';
import { PriceRangeFilter } from '../components/PriceRangeFilter';
import RegistryCardSkeleton from '../components/RegistryCardSkeleton';
import EmptyState from '@/components/EmptyState';
import { useRegistry, type SortOption } from '../hooks/useRegistry';
import { Button } from '@/components/ui/Button';
import { FormGroup, Checkbox, Label, Input, Select } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { useStickyOffset } from '@/components/ui/useStickyOffset';
import {
  REGISTRY_INITIAL_VISIBLE_ITEMS,
  REGISTRY_LOAD_MORE_INCREMENT,
} from '@/utils/registryPagination';

import { GuestSessionProvider } from '../context/GuestSessionContext';

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
  return (
    <GuestSessionProvider>
      <RegistryPageContent />
    </GuestSessionProvider>
  );
}

function RegistryPageContent() {
  const {
    items,
    isLoading,
    error,
    refetch,
    selectedItem,
    isModalOpen,
    reconciledReceipt,
    redirectRecoveryError,
    setVisibleItemsCount,
    isAdmin,
    cardCheckoutEnabled,
    stripePublishableKey,
    defaultPaymentHandleType,
    defaultPaymentHandle,
    shippingAddress,
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
    searchQuery = '',
    setSearchQuery,
    sortOption,
    setSortOption,
    handleClearFilters: clearFiltersFromHook,
    handleCardClick,
    handleCloseModal,
    handleEdit,
    handleDelete,
    handleContribute,
    syncItemInCache,
  } = useRegistry();

  const [isLoadingMoreState, setIsLoadingMoreState] = useState(false);
  const [isMobileFiltersExpanded, setIsMobileFiltersExpanded] = useState(false);
  const isLoadingMore = useRef(false);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasButtonFocused = useRef(false);
  const filterNavRef = useStickyOffset<HTMLElement>({
    edge: 'top',
    scope: 'document',
    disableAtMaxHeight: 560,
  });

  useEffect(() => {
    return () => {
      if (loadMoreTimerRef.current) {
        clearTimeout(loadMoreTimerRef.current);
      }
    };
  }, []);

  const handleLoadMore = useCallback(() => {
    if (isLoadingMore.current) return;
    if (visibleItems.length >= filteredItems.length) return;
    
    wasButtonFocused.current = document.activeElement === buttonRef.current;
    
    isLoadingMore.current = true;
    setIsLoadingMoreState(true);
    
    loadMoreTimerRef.current = setTimeout(() => {
      setVisibleItemsCount(prevCount =>
        Math.min(prevCount + REGISTRY_LOAD_MORE_INCREMENT, filteredItems.length)
      );
      isLoadingMore.current = false;
      setIsLoadingMoreState(false);
      loadMoreTimerRef.current = null;
    }, 500);
  }, [setVisibleItemsCount, visibleItems.length, filteredItems.length]);

  const hasCategorySelection = Array.isArray(categoryFilter)
    ? categoryFilter.length > 0
    : Boolean(categoryFilter && categoryFilter !== 'All');
  const hasPriceSelection =
    Array.isArray(priceRange) &&
    priceRange.length === 2 &&
    (priceRange[0] > minPrice || priceRange[1] < maxPrice);
  const hasSortSelection = Boolean(
    sortOption && sortOption !== 'default' && (sortOption as string) !== 'recommended'
  );
  const hasActiveFilters = Boolean(
    (searchQuery && searchQuery.trim() !== '') ||
      hasCategorySelection ||
      hasPriceSelection ||
      showGroupGiftsOnly ||
      showAvailableOnly ||
      hasSortSelection
  );

  const activeSecondaryFilterCount =
    (hasPriceSelection ? 1 : 0) +
    (showGroupGiftsOnly ? 1 : 0) +
    (showAvailableOnly ? 1 : 0);

  const liveAnnouncement = isLoadingMoreState
    ? 'Loading more gifts...'
    : visibleItems.length > 0
      ? `Showing ${visibleItems.length} of ${filteredItems.length} gifts`
      : !isLoading && !error && items.length > 0
        ? 'Showing 0 of 0 gifts'
        : '';

  useEffect(() => {
    if (isLoadingMore.current) return;
    if (visibleItems.length > 0 && wasButtonFocused.current && visibleItems.length >= filteredItems.length) {
      counterRef.current?.focus();
      wasButtonFocused.current = false;
    }
  }, [visibleItems.length, filteredItems.length]);

  const handleClearFilters = useCallback(() => {
    setCategoryFilter([]);
    setPriceRange([minPrice, maxPrice]);
    setShowGroupGiftsOnly(false);
    setShowAvailableOnly(false);
    if (setSearchQuery) {
      setSearchQuery('');
    }
    if (setSortOption) {
      setSortOption('default');
    }
    if (clearFiltersFromHook) {
      clearFiltersFromHook();
    }
  }, [clearFiltersFromHook, setCategoryFilter, setPriceRange, minPrice, maxPrice, setShowGroupGiftsOnly, setShowAvailableOnly, setSearchQuery, setSortOption]);

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
          aria-label="Wedding Registry"
        >
          Wedding Registry
        </motion.h1>
        <nav
          ref={filterNavRef}
          style={{ top: 'var(--header-h)' }}
          className="sticky top-[var(--header-h)] [@media(max-height:560px)]:static z-30 bg-white/90 dark:bg-gray-800/90 backdrop-blur border-b border-primary dark:border-gray-700 max-w-4xl mx-auto px-2 sm:px-6 mb-6 md:mb-10 [@media(max-height:560px)]:mb-4 flex flex-col gap-2.5 md:gap-4 py-2.5 md:py-4 rounded-xl shadow-md"
          aria-label="Registry Filters"
          role="navigation"
        >
          <div className="flex items-center gap-2 w-full">
            <FormGroup className="flex-1 min-w-0 space-y-0">
              <Label htmlFor="registry-search-input" className="sr-only">
                Search gifts
              </Label>
              <div className="relative flex items-center w-full">
                <Icon
                  name="Search"
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-text pointer-events-none"
                />
                <Input
                  id="registry-search-input"
                  type="text"
                  placeholder="Search gifts by name or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery?.(e.target.value)}
                  className="pl-9 pr-9"
                  aria-label="Search gifts"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery?.('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 min-w-6 min-h-6 flex items-center justify-center text-muted-text hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary rounded p-1"
                    aria-label="Clear search query"
                  >
                    <Icon name="X" className="w-4 h-4" />
                  </button>
                )}
              </div>
            </FormGroup>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsMobileFiltersExpanded((prev) => !prev)}
              aria-expanded={isMobileFiltersExpanded}
              aria-controls="registry-secondary-filters"
              data-testid="mobile-filters-toggle"
              className="md:hidden shrink-0 inline-flex items-center gap-1.5 px-3"
            >
              <Icon name="Tag" className="w-3.5 h-3.5" />
              <span>
                Filters{activeSecondaryFilterCount > 0 ? ` (${activeSecondaryFilterCount})` : ''}
              </span>
              <Icon
                name="ChevronDown"
                className={`w-3.5 h-3.5 transition-transform ${
                  isMobileFiltersExpanded ? 'rotate-180' : ''
                }`}
              />
            </Button>
          </div>
          <div className="flex flex-wrap md:flex-row items-center justify-between gap-2 md:gap-4">
            <CategoryFilter
              categories={categories}
              selected={categoryFilter}
              onChange={setCategoryFilter}
              label="Filter gifts by category"
              className="flex-nowrap overflow-x-auto max-w-full pb-1 mb-0 md:flex-wrap md:overflow-visible md:pb-0"
            />
            <div className="flex items-center gap-2 ml-auto shrink-0">
              <FormGroup className="flex items-center space-y-0 space-x-2">
                <Label className="hidden sm:inline font-semibold text-sm whitespace-nowrap">
                  Sort by:
                </Label>
                <Select
                  value={sortOption}
                  onChange={(e) => setSortOption(e.target.value as SortOption)}
                  aria-label="Sort gifts"
                  className="w-auto text-xs sm:text-sm py-1.5 sm:py-2"
                >
                  <option value="default">Default</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="most-wanted">Most Wanted</option>
                </Select>
              </FormGroup>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClearFilters}
                  data-testid="inline-clear-filters-button"
                >
                  Clear Filters
                </Button>
              )}
            </div>
          </div>
          <div
            id="registry-secondary-filters"
            data-testid="registry-secondary-filters"
            className={`${
              isMobileFiltersExpanded ? 'flex' : 'hidden'
            } md:flex flex-col md:flex-row flex-wrap justify-center items-center gap-3 md:gap-4 pt-2 md:pt-0 border-t border-slate-200/70 dark:border-gray-700/70 md:border-t-0`}
          >
            <PriceRangeFilter
              min={minPrice}
              max={maxPrice}
              value={priceRange}
              onChange={setPriceRange}
            />
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
            className="p-8 rounded-2xl bg-white/90 dark:bg-gray-800/90 border border-primary/30 text-center shadow-xl max-w-xl mx-auto my-8 flex flex-col items-center justify-center space-y-4"
          >
            <div className="p-3 rounded-full bg-primary/10 text-primary">
              <Icon name="AlertTriangle" className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-bold text-primary">Unable to Load Registry</h2>
            <p className="text-base text-red-700 dark:text-red-300 font-medium">
              Error loading registry: {error instanceof Error ? error.message : String(error)}
            </p>
            <Button onClick={() => refetch()} variant="primary" size="md">
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-10 max-w-7xl mx-auto">
            {Array.from({ length: REGISTRY_INITIAL_VISIBLE_ITEMS }).map((_, index) => (
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
          >
            {visibleItems.map((item) => (
              <motion.div key={item.id} variants={cardVariants}>
                <RegistryCard
                  item={item}
                  onClick={handleCardClick}
                  isAdmin={isAdmin}
                  cardCheckoutEnabled={cardCheckoutEnabled}
                  defaultPaymentHandleType={defaultPaymentHandleType}
                  defaultPaymentHandle={defaultPaymentHandle}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <EmptyState
            role="status"
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
        <Dialog
          isOpen={!!(selectedItem && isModalOpen)}
          onClose={handleCloseModal}
          aria-labelledby={selectedItem ? `registry-item-title-${selectedItem.id}` : undefined}
          className="max-w-xl w-full p-0 border-none bg-transparent shadow-none"
          contentClassName="p-0"
          style={{
            backgroundColor: 'transparent',
            borderColor: 'transparent',
            boxShadow: 'none',
          }}
        >
          {selectedItem && (
            <RegistryItemCard
              key={selectedItem.id}
              item={selectedItem}
              titleId={`registry-item-title-${selectedItem.id}`}
              onClose={handleCloseModal}
              onContribute={handleContribute}
              onItemUpdated={syncItemInCache}
              cardCheckoutEnabled={cardCheckoutEnabled}
              stripePublishableKey={stripePublishableKey}
              defaultPaymentHandleType={defaultPaymentHandleType}
              defaultPaymentHandle={defaultPaymentHandle}
              shippingAddress={shippingAddress}
              isAdmin={isAdmin}
              reconciledReceipt={reconciledReceipt}
              redirectRecoveryError={redirectRecoveryError}
            />
          )}
        </Dialog>
      </div>
    </ErrorBoundary>
  );
}
