'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Dialog } from '@/components/ui/Dialog';
import { VisibilitySentinel } from '@/components/VisibilitySentinel';

import RegistryCard from '../components/RegistryCard';
import RegistryItemCard from '../components/RegistryItemCard';
import { ClaimFulfillmentHub } from '../components/ClaimFulfillmentHub';
import {
  CLAIM_HUB_UPDATED_EVENT,
  readStoredSessionClaimHolds,
} from '../lib/claimHubStorage';
import { useOptionalDemo } from '@/components/demo/DemoContext';
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

import { GuestSessionProvider, useGuestSession } from '../context/GuestSessionContext';

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
    hasShippingAddress,
    shippingAddress,
    giftAccessTier,
    shippingDisclosureTier,
    maxPendingReservations,
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

  const demo = useOptionalDemo();
  const isDemoMode = Boolean(demo?.isDemoMode);
  const { isVerified: isHouseholdVerified, hasPasscodeSession } = useGuestSession();
  const [isClaimHubOpen, setIsClaimHubOpen] = useState(false);
  const [storedHoldCount, setStoredHoldCount] = useState(0);

  useEffect(() => {
    const syncStoredCount = () => {
      setStoredHoldCount(readStoredSessionClaimHolds().length);
    };
    syncStoredCount();
    window.addEventListener(CLAIM_HUB_UPDATED_EVENT, syncStoredCount);
    return () => {
      window.removeEventListener(CLAIM_HUB_UPDATED_EVENT, syncStoredCount);
    };
  }, []);

  const showMyReservedGiftsLink = Boolean(
    isHouseholdVerified || hasPasscodeSession || storedHoldCount > 0 || isDemoMode
  );
  const showPageShippingDisclosureNotice = Boolean(
    !isAdmin &&
      hasShippingAddress &&
      !shippingAddress &&
      (shippingDisclosureTier === 'INVITED_HOUSEHOLDS' ||
        shippingDisclosureTier === 'POST_CLAIM_ONLY')
  );

  const [isLoadingMoreState, setIsLoadingMoreState] = useState(false);
  const isLoadingMore = useRef(false);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterRef = useRef<HTMLParagraphElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const wasButtonFocused = useRef(false);
  const filterNavRef = useStickyOffset<HTMLElement>({
    edge: 'top',
    scope: 'document',
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
          className="sticky top-[var(--header-h)] z-30 bg-white/90 dark:bg-gray-800/90 backdrop-blur border-b border-primary dark:border-gray-700 max-w-4xl mx-auto px-2 sm:px-6 mb-10 flex flex-col gap-4 py-4 rounded-xl shadow-md"
          aria-label="Registry Filters"
          role="navigation"
        >
          <FormGroup className="w-full">
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
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <CategoryFilter
              categories={categories}
              selected={categoryFilter}
              onChange={setCategoryFilter}
              label="Filter gifts by category"
            />
            <PriceRangeFilter
              min={minPrice}
              max={maxPrice}
              value={priceRange}
              onChange={setPriceRange}
            />
            <FormGroup className="flex items-center space-y-0 space-x-2">
              <Label className="font-semibold text-sm whitespace-nowrap">
                Sort by:
              </Label>
              <Select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                aria-label="Sort gifts"
                className="w-auto"
              >
                <option value="default">Default</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="most-wanted">Most Wanted</option>
              </Select>
            </FormGroup>
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
            {showMyReservedGiftsLink && (
              <Link
                href="/guest/claim"
                data-testid="open-claim-hub-button"
                onClick={(e) => {
                  if (
                    !e.metaKey &&
                    !e.ctrlKey &&
                    !e.shiftKey &&
                    !e.altKey &&
                    e.button === 0
                  ) {
                    e.preventDefault();
                    setIsClaimHubOpen(true);
                  }
                }}
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Icon name="Gift" className="w-4 h-4 shrink-0" />
                <span>My Reserved Gifts</span>
                {storedHoldCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-[var(--color-text-on-primary,#ffffff)] text-xs font-bold">
                    {storedHoldCount}
                  </span>
                )}
              </Link>
            )}
          </div>
        </nav>

        {showPageShippingDisclosureNotice && (
          <div
            role="note"
            data-testid="registry-page-shipping-disclosure-notice"
            className="max-w-4xl mx-auto mb-8 px-4 py-3.5 rounded-xl bg-amber-50/90 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-950 dark:text-amber-100 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
          >
            <div className="flex items-start gap-2.5">
              <Icon name="MapPin" className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">
                  {shippingDisclosureTier === 'POST_CLAIM_ONLY'
                    ? "Couple's Shipping Address Revealed After Reserving a Gift"
                    : 'Household Verification Required for Direct Shipping Address'}
                </p>
                <p className="text-xs text-amber-900/90 dark:text-amber-200 mt-0.5">
                  {shippingDisclosureTier === 'POST_CLAIM_ONLY'
                    ? "Select any physical gift and reserve it to immediately view and copy the couple's shipping address, or open My Reserved Gifts to manage existing holds."
                    : "Verify the personal household code printed on your wedding invitation inside any gift card to reveal the couple's direct shipping address."}
                </p>
              </div>
            </div>
            {showMyReservedGiftsLink && (
              <Link
                href="/guest/claim"
                onClick={(e) => {
                  if (
                    !e.metaKey &&
                    !e.ctrlKey &&
                    !e.shiftKey &&
                    !e.altKey &&
                    e.button === 0
                  ) {
                    e.preventDefault();
                    setIsClaimHubOpen(true);
                  }
                }}
                className="text-xs font-semibold text-primary underline whitespace-nowrap shrink-0"
              >
                View My Reserved Gifts
              </Link>
            )}
          </div>
        )}

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
              hasShippingAddress={hasShippingAddress}
              shippingAddress={shippingAddress}
              giftAccessTier={giftAccessTier}
              shippingDisclosureTier={shippingDisclosureTier}
              maxPendingReservations={maxPendingReservations}
              onOpenClaimHub={() => setIsClaimHubOpen(true)}
              isAdmin={isAdmin}
              reconciledReceipt={reconciledReceipt}
              redirectRecoveryError={redirectRecoveryError}
            />
          )}
        </Dialog>

        <Dialog
          isOpen={isClaimHubOpen}
          onClose={() => setIsClaimHubOpen(false)}
          aria-labelledby="registry-claim-hub-modal-title"
          className="max-w-5xl w-full p-0 border-none bg-transparent shadow-none"
          contentClassName="p-0 max-h-[92vh] overflow-y-auto"
          style={{
            backgroundColor: 'transparent',
            borderColor: 'transparent',
            boxShadow: 'none',
          }}
        >
          {isClaimHubOpen && (
            <ClaimFulfillmentHub
              mode="modal"
              titleId="registry-claim-hub-modal-title"
              onClose={() => setIsClaimHubOpen(false)}
              onItemUpdated={syncItemInCache}
              onHoldsChanged={() => {
                void refetch();
              }}
            />
          )}
        </Dialog>
      </div>
    </ErrorBoundary>
  );
}
